import express from 'express';
import { dbStore } from '../db/store.js';
import { eventBus, ALERT_CREATED, ALERT_SUPERSEDED, EVENT_CHANGED } from '../services/eventBus.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { ForecastService } from '../services/forecastService.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';
import { ElNinoService, getRegionalElNinoImpact } from '../services/elNinoService.js';
import { AlertPolicyEngine } from '../services/alertPolicy.js';

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
 * Also evaluates automated GPS & El Niño climate predictions without waiting for admin
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

  // Evaluate automated GPS & El Niño climate conditions in real-time
  try {
    const autoAlert = await AlertPolicyEngine.evaluateAutomatedClimateAlert({
      plotId: plot.id,
      lat: plot.lat,
      lon: plot.lon,
      crop: plot.crop,
      sowingDate: plot.sowing_date
    });

    if (autoAlert && autoAlert.level !== 'green') {
      return res.json({
        type: 'active_alert',
        alert: autoAlert,
        event: null,
        level: autoAlert.level,
        clip_sequence: autoAlert.clip_sequence,
        is_simulated: false,
        is_automated_prediction: true
      });
    }
  } catch (err) {
    console.warn('[FarmerAdvice] Automated climate evaluation warning:', err.message);
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
 * 3. Real-Time GPS Location Climate & El Niño Risk Prediction API
 * Automatically computes regional drought / excess rain vulnerabilities for the farmer's current coordinates
 */
router.get('/climate-risk', async (req, res) => {
  try {
    const lat = Number(req.query.lat) || 26.9124;
    const lon = Number(req.query.lon) || 75.7873;
    const crop = req.query.crop || 'wheat';
    const plotId = req.query.plot_id || null;

    // 1. Fetch live NOAA ONI status
    let elNinoData = ElNinoService.getCached();
    if (!elNinoData) {
      elNinoData = await ElNinoService.fetchElNinoStatus();
    }

    // 2. Compute regional climate risk profile for GPS coordinate
    const regionalImpact = getRegionalElNinoImpact(lat, lon, elNinoData.status, elNinoData.latest_oni);

    // 3. Fetch 7-day live numerical weather forecast
    const forecast = await forecastService.fetchForecast(lat, lon);
    const rain48h = (forecast.data.precipitation_sum[0] || 0) + (forecast.data.precipitation_sum[1] || 0);
    const maxTemp = forecast.data.temperature_2m_max[0] || 30;
    const minTemp = forecast.data.temperature_2m_min[0] || 15;

    // 4. Automated localized prediction
    let alertLevel = 'green';
    if (minTemp <= 4 || rain48h >= 45) {
      alertLevel = 'red';
    } else if (rain48h >= 20 || maxTemp >= 40 || (elNinoData.status === 'el_nino' && regionalImpact.monsoonDeficitRiskPercent >= 60)) {
      alertLevel = 'yellow';
    }

    // 5. Check if active alert in database
    let activeAlert = null;
    if (plotId) {
      const existing = Array.from(dbStore.alerts.values()).filter(
        a => a.plot_id === plotId && ['created', 'delivered', 'opened', 'played'].includes(a.status)
      );
      if (existing.length > 0) {
        activeAlert = existing[0];
      }
    }

    return res.json({
      success: true,
      location: {
        lat,
        lon,
        region_name: regionalImpact.region_name,
        zone_key: regionalImpact.zone_key
      },
      el_nino: {
        status: elNinoData.status,
        latest_oni: elNinoData.latest_oni,
        season: elNinoData.season,
        year: elNinoData.year,
        monsoon_deficit_risk_percent: regionalImpact.monsoon_deficit_risk_percent,
        excess_rain_risk_percent: regionalImpact.excess_rain_risk_percent,
        drought_vulnerability: regionalImpact.drought_vulnerability,
        localized_advice_hi: regionalImpact.localized_farmer_advice_hi,
        localized_advice_en: regionalImpact.localized_farmer_advice_en
      },
      forecast_summary: {
        rain_48h_mm: Math.round(rain48h * 10) / 10,
        max_temp_c: Math.round(maxTemp),
        min_temp_c: Math.round(minTemp),
        rain_probability_max: forecast.data.precipitation_probability_max[0] || 0
      },
      automated_prediction: {
        alert_level: alertLevel,
        is_autonomous: true,
        summary_hi: regionalImpact.localized_farmer_advice_hi,
        summary_en: regionalImpact.localized_farmer_advice_en
      },
      active_alert: activeAlert
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Pending alerts polling endpoint with last_seen cursor
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
 * 5. Submit acknowledgement (✔ "कर लिया", ✖ "नहीं कर सकता", "मेरा खेत नहीं")
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
 * 6. SSE Endpoint for Live Push (< 5s latency)
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
