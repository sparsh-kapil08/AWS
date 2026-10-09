import { dbStore } from '../db/store.js';
import { eventBus, ALERT_CREATED, ALERT_SUPERSEDED } from './eventBus.js';
import { ForecastService } from './forecastService.js';
import { ElNinoService, getRegionalElNinoImpact } from './elNinoService.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';

const forecastService = new ForecastService();

export class AlertPolicyEngine {
  /**
   * Process candidate alert for a plot
   */
  static createOrUpdateAlert({
    plotId,
    eventId = null,
    ruleId = null,
    level,
    clipSequence,
    reasonKey
  }) {
    const dedupeKey = `${plotId}_${ruleId || 'no_rule'}_${eventId || 'no_event'}`;
    const now = new Date().toISOString();

    // Check existing active alert with same dedupe_key
    const existingAlerts = Array.from(dbStore.alerts.values()).filter(a => a.plot_id === plotId);
    const sameDedupe = existingAlerts.find(
      a => a.dedupe_key === dedupeKey && ['created', 'delivered', 'opened', 'played'].includes(a.status)
    );

    if (sameDedupe) {
      // Update existing alert in-place
      sameDedupe.level = level;
      sameDedupe.clip_sequence = clipSequence;
      sameDedupe.reason_key = reasonKey;
      sameDedupe.status = 'created';
      sameDedupe.created_at = now;

      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: sameDedupe.id,
        state: 'created',
        at: now,
        channel: 'event_fanout_update'
      });

      eventBus.emit(ALERT_CREATED, sameDedupe);
      return sameDedupe;
    }

    // Check older active alerts for the plot to supersede
    let supersededId = undefined;
    for (const older of existingAlerts) {
      if (['created', 'delivered', 'opened', 'played'].includes(older.status)) {
        older.status = 'superseded';
        supersededId = older.id;
        dbStore.alertEvents.push({
          id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          alert_id: older.id,
          state: 'superseded',
          at: now,
          channel: 'system_supersede'
        });
        eventBus.emit(ALERT_SUPERSEDED, older);
      }
    }

    // Create new alert
    const alertId = `alt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAlert = {
      id: alertId,
      plot_id: plotId,
      event_id: eventId,
      rule_id: ruleId,
      level,
      clip_sequence: clipSequence,
      reason_key: reasonKey,
      status: 'created',
      supersedes_id: supersededId,
      dedupe_key: dedupeKey,
      created_at: now
    };

    dbStore.alerts.set(alertId, newAlert);

    dbStore.alertEvents.push({
      id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      alert_id: alertId,
      state: 'created',
      at: now,
      channel: 'event_fanout'
    });

    eventBus.emit(ALERT_CREATED, newAlert);
    return newAlert;
  }

  /**
   * Automated GPS & El Niño Climate Alert Evaluator.
   * Evaluates live forecast and regional El Niño vulnerability for a farmer's coordinates.
   * Runs automatically without requiring manual admin intervention.
   * @param {object} params
   * @param {string} params.plotId
   * @param {number} params.lat
   * @param {number} params.lon
   * @param {string} params.crop
   * @param {string} params.sowingDate
   * @returns {Promise<object|null>} Evaluated alert or null if normal conditions
   */
  static async evaluateAutomatedClimateAlert({ plotId, lat, lon, crop = 'wheat', sowingDate = null }) {
    const numLat = Number(lat) || 26.9124;
    const numLon = Number(lon) || 75.7873;
    const effectiveSowing = sowingDate || new Date().toISOString().split('T')[0];

    // 1. Fetch live 7-day forecast
    const forecast = await forecastService.fetchForecast(numLat, numLon);
    const rain48h = (forecast.data.precipitation_sum[0] || 0) + (forecast.data.precipitation_sum[1] || 0);
    const maxTemp = forecast.data.temperature_2m_max[0] || 30;
    const minTemp = forecast.data.temperature_2m_min[0] || 15;

    let dryDays = 0;
    for (const p of forecast.data.precipitation_sum || []) {
      if (p < 1.0) dryDays++;
      else break;
    }

    // 2. Fetch or retrieve El Niño status
    let elNinoStatus = ElNinoService.getCached();
    if (!elNinoStatus) {
      elNinoStatus = await ElNinoService.fetchElNinoStatus();
    }
    const regionalImpact = getRegionalElNinoImpact(numLat, numLon, elNinoStatus.status, elNinoStatus.latest_oni);

    // 3. Evaluate crop stage rules
    const rules = Array.from(dbStore.cropStageRules.values());
    const stageInfo = determineCropStage(crop, effectiveSowing, undefined, rules);
    const stageMatches = evaluateRulesForPlot(crop, stageInfo.stage, forecast.data, rules);

    // 4. Automated Decision Engine
    let alertLevel = null;
    let actionKey = null;
    let reasonKey = null;
    let clipSequence = [];

    if (minTemp <= 4) {
      // Frost danger (Critical Red)
      alertLevel = 'red';
      actionKey = 'apply_light_irrigation_frost';
      reasonKey = 'frost_temperature_danger';
      clipSequence = ['time_next_48h', 'apply_light_irrigation_frost'];
    } else if (rain48h >= 25) {
      // Heavy unseasonal rain (Red/Yellow)
      alertLevel = rain48h >= 45 ? 'red' : 'yellow';
      actionKey = 'skip_irrigation_rain_expected';
      reasonKey = 'heavy_rainfall_predicted';
      clipSequence = ['time_next_48h', 'skip_irrigation_rain_expected'];
    } else if (maxTemp >= 40) {
      // Heatwave advisory
      alertLevel = 'yellow';
      actionKey = 'maintain_soil_moisture_heat';
      reasonKey = 'heatwave_temperature_spike';
      clipSequence = ['time_next_48h', 'skip_irrigation_rain_expected'];
    } else if (elNinoStatus.status === 'el_nino' && regionalImpact.monsoonDeficitRiskPercent >= 60 && dryDays >= 4) {
      // Automated El Niño Regional Drought Advisory
      alertLevel = 'yellow';
      actionKey = 'el_nino_conserve_water';
      reasonKey = 'el_nino_regional_dry_spell_predicted';
      clipSequence = ['time_next_48h', 'skip_irrigation_rain_expected'];
    } else if (stageMatches.length > 0) {
      const match = stageMatches[0];
      alertLevel = match.severity;
      actionKey = match.actionKey;
      reasonKey = match.reasonKey;
      clipSequence = ['time_next_48h', match.actionKey];
    }

    if (!alertLevel || !plotId) {
      return null;
    }

    // Create or update alert in database store & emit SSE
    return AlertPolicyEngine.createOrUpdateAlert({
      plotId,
      ruleId: stageMatches.length > 0 ? stageMatches[0].ruleId : 'automated_climate_rule',
      level: alertLevel,
      clipSequence,
      reasonKey
    });
  }

  /**
   * Handle event resolution / cancellation for all affected alerts
   */
  static resolveAlertsForEvent(eventId) {
    const now = new Date().toISOString();
    const affectedAlerts = Array.from(dbStore.alerts.values()).filter(
      a => a.event_id === eventId && ['created', 'delivered', 'opened', 'played', 'acknowledged'].includes(a.status)
    );

    const createdAllClearAlerts = [];

    for (const alert of affectedAlerts) {
      alert.status = 'superseded';
      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: alert.id,
        state: 'superseded',
        at: now,
        channel: 'event_resolved'
      });

      // Emit All Clear alert for the plot returning it to green
      const plot = dbStore.plots.get(alert.plot_id);
      const isDemo = plot ? plot.is_demo : false;
      const allClearId = `alt_clear_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      const clipSeq = ['event_all_clear'];
      if (isDemo) clipSeq.unshift('simulated_intro');

      const allClearAlert = {
        id: allClearId,
        plot_id: alert.plot_id,
        event_id: eventId,
        rule_id: undefined,
        level: 'green',
        clip_sequence: clipSeq,
        reason_key: 'event_resolved_all_clear',
        status: 'created',
        supersedes_id: alert.id,
        dedupe_key: `${alert.plot_id}_all_clear_${eventId}`,
        created_at: now
      };

      dbStore.alerts.set(allClearId, allClearAlert);
      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: allClearId,
        state: 'created',
        at: now,
        channel: 'event_resolved_all_clear'
      });

      eventBus.emit(ALERT_CREATED, allClearAlert);
      createdAllClearAlerts.push(allClearAlert);
    }

    return createdAllClearAlerts;
  }
}
