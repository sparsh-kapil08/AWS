import express from 'express';
import { dbStore } from '../db/store.js';
import { eventBus, ALERT_CREATED, ALERT_SUPERSEDED, EVENT_CHANGED } from '../services/eventBus.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { ForecastService } from '../services/forecastService.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';

const router = express.Router();
const forecastService = new ForecastService();

/**
 * 1. Register farmer and plot (NON-NEGOTIABLE RULE: Requires spoken read-back confirmation)
 */
router.post('/register', (req, res) => {
  const { 
    farmer_name, 
    phone, 
    lat, 
    lon, 
    crop, 
    sowing_date, 
    stage_override, 
    is_demo, 
    confirmed_readback 
  } = req.body;

  if (!confirmed_readback) {
    return res.status(400).json({
      error: 'NON-NEGOTIABLE RULE: Never save a plot until the farmer confirms a spoken read-back.'
    });
  }

  const farmerId = `farmer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const farmer = {
    id: farmerId,
    phone: phone || '0000000000',
    name: farmer_name || 'किसान भाई',
    lang: 'hi',
    created_at: new Date().toISOString()
  };
  dbStore.farmers.set(farmerId, farmer);

  const plotId = `plot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const plot = {
    id: plotId,
    farmer_id: farmerId,
    lat: Number(lat) || 26.9124,
    lon: Number(lon) || 75.7873,
    crop: crop || 'wheat',
    sowing_date: sowing_date || new Date().toISOString().split('T')[0],
    stage_override: stage_override || undefined,
    is_demo: Boolean(is_demo),
    created_at: new Date().toISOString()
  };
  dbStore.plots.set(plotId, plot);

  return res.json({
    success: true,
    farmer,
    plot
  });
});

/**
 * 2. Get active advice for plot ("अब क्या करूँ" / "मेरी फसल")
 * RULE: Must return ACTIVE alert first before routine briefing
 */
router.get('/plots/:plot_id/advice', async (req, res) => {
  const { plot_id } = req.params;
  const plot = dbStore.plots.get(plot_id);
  if (!plot) {
    return res.status(404).json({ error: 'Plot not found' });
  }

  // Check active created/delivered alerts first
  const activeAlerts = Array.from(dbStore.alerts.values())
    .filter(a => a.plot_id === plot_id && ['created', 'delivered', 'opened', 'played'].includes(a.status))
    .sort((a, b) => (a.level === 'red' ? -1 : a.level === 'yellow' ? -1 : 1));

  if (activeAlerts.length > 0) {
    const primaryAlert = activeAlerts[0];
    const event = primaryAlert.event_id ? dbStore.events.get(primaryAlert.event_id) : null;
    return res.json({
      type: 'active_alert',
      alert: primaryAlert,
      event: event || null,
      level: primaryAlert.level,
      clip_sequence: primaryAlert.clip_sequence,
      is_simulated: event ? event.simulated : false
    });
  }

  // Routine stage-aware briefing fallback
  const rules = Array.from(dbStore.cropStageRules.values());
  const stageInfo = determineCropStage(plot.crop, plot.sowing_date, plot.stage_override, rules);
  const forecast = await forecastService.fetchForecast(plot.lat, plot.lon);
  const ruleMatches = evaluateRulesForPlot(plot.crop, stageInfo.stage, forecast.data, rules);

  let clipSeq = ['time_next_48h', 'skip_irrigation_rain_expected'];
  let level = 'green';

  if (ruleMatches.length > 0) {
    level = ruleMatches[0].severity;
    clipSeq = ['time_next_48h', ruleMatches[0].actionKey];
  }

  return res.json({
    type: 'routine_briefing',
    crop: plot.crop,
    stage: stageInfo.stage,
    level,
    clip_sequence: clipSeq,
    is_simulated: false
  });
});

/**
 * 3. Pending alerts polling endpoint with last_seen cursor
 */
router.get('/alerts/pending', (req, res) => {
  const { plot_id, last_seen } = req.query;
  let alerts = Array.from(dbStore.alerts.values());

  if (plot_id) {
    alerts = alerts.filter(a => a.plot_id === plot_id);
  }

  if (last_seen) {
    alerts = alerts.filter(a => a.created_at > last_seen);
  }

  alerts = alerts.filter(a => ['created', 'delivered'].includes(a.status));
  return res.json({ alerts });
});

/**
 * 4. Submit acknowledgement (✔ "कर लिया", ✖ "नहीं कर सकता", "मेरा खेत नहीं")
 */
router.post('/alerts/:alert_id/ack', (req, res) => {
  const { alert_id } = req.params;
  const { response } = req.body;

  const alert = dbStore.alerts.get(alert_id);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  alert.status = 'acknowledged';
  const ackRecord = {
    id: `ack_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    alert_id,
    response: response || 'done',
    at: new Date().toISOString()
  };

  dbStore.acknowledgements.push(ackRecord);
  dbStore.alertEvents.push({
    id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    alert_id,
    state: 'acknowledged',
    at: new Date().toISOString(),
    channel: 'pwa_touch_ack'
  });

  return res.json({ success: true, acknowledgement: ackRecord });
});

/**
 * 5. SSE Endpoint for Live Push (< 5s latency)
 * Includes explicit headers, no-buffering, and 15s heartbeat pings to prevent ERR_INCOMPLETE_CHUNKED_ENCODING
 */
router.get('/alerts/stream', (req, res) => {
  const { plot_id } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);

  // Periodic 15s heartbeat comment ping
  const heartbeatTimer = setInterval(() => {
    res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  }, 15000);

  const onAlertCreated = (alert) => {
    if (!plot_id || alert.plot_id === plot_id) {
      res.write(`data: ${JSON.stringify({ type: 'ALERT_CREATED', alert })}\n\n`);
    }
  };

  const onAlertSuperseded = (alert) => {
    if (!plot_id || alert.plot_id === plot_id) {
      res.write(`data: ${JSON.stringify({ type: 'ALERT_SUPERSEDED', alert })}\n\n`);
    }
  };

  const onEventChanged = (evtData) => {
    res.write(`data: ${JSON.stringify({ type: 'EVENT_CHANGED', event: evtData })}\n\n`);
  };

  eventBus.on(ALERT_CREATED, onAlertCreated);
  eventBus.on(ALERT_SUPERSEDED, onAlertSuperseded);
  eventBus.on(EVENT_CHANGED, onEventChanged);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    eventBus.removeListener(ALERT_CREATED, onAlertCreated);
    eventBus.removeListener(ALERT_SUPERSEDED, onAlertSuperseded);
    eventBus.removeListener(EVENT_CHANGED, onEventChanged);
  });
});

export default router;
