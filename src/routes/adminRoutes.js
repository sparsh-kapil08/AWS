import express from 'express';
import { dbStore } from '../db/store.js';
import { EventService } from '../services/eventService.js';
import { eventBus, EVENT_CHANGED, ALERT_CREATED } from '../services/eventBus.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { ForecastService } from '../services/forecastService.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';
import { ElNinoService } from '../services/elNinoService.js';

const router = express.Router();
const forecastService = new ForecastService();

/**
 * 1. Create or Update Weather Event
 */
router.post('/events', async (req, res) => {
  try {
    const { id, type, severity, center_lat, center_lon, radius_km, starts_at, ends_at, status, simulated, created_by } = req.body;
    
    const result = await EventService.createOrUpdateEvent({
      id,
      type,
      severity,
      center_lat: Number(center_lat),
      center_lon: Number(center_lon),
      radius_km: Number(radius_km),
      starts_at,
      ends_at,
      status: status || 'active',
      simulated: simulated === true || simulated === 'true',
      created_by: created_by || 'admin_console'
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 2. Resolve or Cancel Weather Event
 */
router.post('/events/:event_id/resolve', async (req, res) => {
  try {
    const { event_id } = req.params;
    const { status, user } = req.body;

    const result = await EventService.resolveOrCancelEvent(event_id, status || 'resolved', user || 'admin_console');
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 3. Crop Stage Rule Editor - Preview Impact
 */
router.post('/rules/:rule_id/preview', async (req, res) => {
  try {
    const { rule_id } = req.params;
    const { threshold, unit, severity, action_key } = req.body;

    const existingRule = dbStore.cropStageRules.get(rule_id);
    if (!existingRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const tempRule = {
      ...existingRule,
      threshold: threshold !== undefined ? Number(threshold) : existingRule.threshold,
      unit: unit || existingRule.unit,
      severity: severity || existingRule.severity,
      action_key: action_key || existingRule.action_key
    };

    const allPlots = Array.from(dbStore.plots.values());
    const affectedPlots = [];

    for (const plot of allPlots) {
      if (plot.crop !== tempRule.crop) continue;

      const rules = Array.from(dbStore.cropStageRules.values());
      const stageInfo = determineCropStage(plot.crop, plot.sowing_date, plot.stage_override, rules);

      if (stageInfo.stage === tempRule.stage) {
        const forecast = await forecastService.fetchForecast(plot.lat, plot.lon);
        const matchesBefore = evaluateRulesForPlot(plot.crop, stageInfo.stage, forecast.data, [existingRule]);
        const matchesAfter = evaluateRulesForPlot(plot.crop, stageInfo.stage, forecast.data, [tempRule]);

        const beforeTriggered = matchesBefore.length > 0;
        const afterTriggered = matchesAfter.length > 0;

        if (beforeTriggered !== afterTriggered || (matchesAfter[0] && matchesAfter[0].severity !== (matchesBefore[0]?.severity))) {
          affectedPlots.push({
            plot_id: plot.id,
            farmer_id: plot.farmer_id,
            crop: plot.crop,
            stage: stageInfo.stage,
            before_alert: beforeTriggered ? matchesBefore[0].severity : 'none',
            after_alert: afterTriggered ? matchesAfter[0].severity : 'none'
          });
        }
      }
    }

    return res.json({
      rule_id,
      preview: {
        affected_plots_count: affectedPlots.length,
        affected_plots: affectedPlots
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Crop Stage Rule Editor - Confirm Edit
 */
router.post('/rules/:rule_id/confirm', async (req, res) => {
  try {
    const { rule_id } = req.params;
    const { threshold, unit, severity, action_key, source, user } = req.body;

    const existingRule = dbStore.cropStageRules.get(rule_id);
    if (!existingRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const beforeState = { ...existingRule };
    const nextVersion = existingRule.version + 1;
    const now = new Date().toISOString();

    const updatedRule = {
      ...existingRule,
      threshold: threshold !== undefined ? Number(threshold) : existingRule.threshold,
      unit: unit || existingRule.unit,
      severity: severity || existingRule.severity,
      action_key: action_key || existingRule.action_key,
      source: source || existingRule.source,
      version: nextVersion,
      created_at: now
    };

    dbStore.cropStageRules.set(rule_id, updatedRule);

    const auditRecord = {
      id: `audit_rule_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      who: user || 'admin_console',
      action: 'EDIT_CROP_STAGE_RULE',
      before: beforeState,
      after: updatedRule,
      at: now
    };
    dbStore.adminAudit.push(auditRecord);

    return res.json({
      success: true,
      rule: updatedRule,
      audit: auditRecord
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 5. Dashboard Stats Endpoint
 */
router.get('/dashboard', (req, res) => {
  const events = Array.from(dbStore.events.values());
  const alerts = Array.from(dbStore.alerts.values());
  const acks = dbStore.acknowledgements;
  const plots = Array.from(dbStore.plots.values());
  const rules = Array.from(dbStore.cropStageRules.values());

  const eventStats = events.map(evt => {
    const evtAlerts = alerts.filter(a => a.event_id === evt.id);
    const targeted = evtAlerts.length;
    const delivered = evtAlerts.filter(a => ['delivered', 'opened', 'played', 'acknowledged'].includes(a.status)).length;
    const opened = evtAlerts.filter(a => ['opened', 'played', 'acknowledged'].includes(a.status)).length;
    const played = evtAlerts.filter(a => ['played', 'acknowledged'].includes(a.status)).length;
    const acked = evtAlerts.filter(a => a.status === 'acknowledged').length;
    const cannotDo = acks.filter(ack => evtAlerts.some(a => a.id === ack.alert_id) && ack.response === 'cannot').length;

    return {
      event_id: evt.id,
      type: evt.type,
      severity: evt.severity,
      simulated: evt.simulated,
      status: evt.status,
      stats: { targeted, delivered, opened, played, acked, cannotDo }
    };
  });

  const placeholderRules = rules.filter(r => r.source === 'PLACEHOLDER');
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const followUpAlerts = alerts.filter(a => 
    a.created_at < tenMinutesAgo && 
    ['created', 'delivered'].includes(a.status) &&
    a.level !== 'green'
  );

  return res.json({
    event_stats: eventStats,
    plots: plots.map(p => {
      const pAlerts = alerts.filter(a => a.plot_id === p.id && a.status === 'created');
      const level = pAlerts.length > 0 ? pAlerts[0].level : 'green';
      return { ...p, current_level: level };
    }),
    flagged_rules: placeholderRules,
    follow_up_alerts: followUpAlerts,
    audit_logs: dbStore.adminAudit.slice(-20)
  });
});

/**
 * 6. Admin Live Dashboard SSE Stream
 * Includes heartbeat pings to prevent browser ERR_INCOMPLETE_CHUNKED_ENCODING
 */
router.get('/dashboard/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', at: new Date().toISOString() })}\n\n`);

  const heartbeatTimer = setInterval(() => {
    res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  }, 15000);

  const sendUpdate = (data) => {
    res.write(`data: ${JSON.stringify({ type: 'DASHBOARD_UPDATE', payload: data })}\n\n`);
  };

  eventBus.on(EVENT_CHANGED, sendUpdate);
  eventBus.on(ALERT_CREATED, sendUpdate);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    eventBus.removeListener(EVENT_CHANGED, sendUpdate);
    eventBus.removeListener(ALERT_CREATED, sendUpdate);
  });
});

/**
 * 7. El Niño / NOAA ONI Status Endpoint (Admin Only)
 * Live fetch from NOAA + returns full stats: ONI value, sample size, historical spread, std dev
 */
router.get('/el-nino', async (req, res) => {
  try {
    // Use cached data if < 3 hours old to avoid hammering NOAA
    const cached = ElNinoService.getCached();
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    if (cached && cached.fetched_at && (Date.now() - new Date(cached.fetched_at).getTime()) < THREE_HOURS) {
      return res.json({ source: 'cache', ...cached });
    }

    const data = await ElNinoService.fetchElNinoStatus();
    return res.json({ source: 'live_noaa', ...data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
