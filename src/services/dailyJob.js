import { dbStore } from '../db/store.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { ForecastService } from './forecastService.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';
import { buildClipSequence } from './clipBuilder.js';
import { AlertPolicyEngine } from './alertPolicy.js';
import { EventService } from './eventService.js';
import { ElNinoService } from './elNinoService.js';

const forecastService = new ForecastService();

/**
 * Daily Forecast Job (EventBridge -> Lambda handler)
 * Evaluates daily forecast across all registered farmer plots using the SINGLE alert policy pipeline.
 * Also checks NOAA ONI for El Niño / La Niña and auto-generates a weather event if detected.
 */
export async function runDailyForecastJob() {
  const plots = Array.from(dbStore.plots.values());
  const rules = Array.from(dbStore.cropStageRules.values());
  const generatedAlerts = [];

  // ── El Niño Check ──────────────────────────────────────────────────────────
  // Fetch live ONI data from NOAA. If El Niño or La Niña detected, auto-broadcast
  // a weather event to all registered plots (uses a wide radius to cover all).
  let elNinoData = null;
  try {
    elNinoData = await ElNinoService.fetchElNinoStatus();
    console.log(`[DailyJob] ONI status: ${elNinoData.status} (${elNinoData.latest_oni} °C anomaly, season ${elNinoData.season} ${elNinoData.year})`);

    if (elNinoData.status === 'el_nino' || elNinoData.status === 'la_nina') {
      // Determine center from registered plots (centroid) or India center fallback
      let centerLat = 26.9124;
      let centerLon = 75.7873;
      if (plots.length > 0) {
        centerLat = plots.reduce((s, p) => s + p.lat, 0) / plots.length;
        centerLon = plots.reduce((s, p) => s + p.lon, 0) / plots.length;
      }

      // El Niño -> dry_spell risk; La Niña -> heavy_rain risk
      const eventType = elNinoData.status === 'el_nino' ? 'dry_spell' : 'heavy_rain';
      const severity = 'yellow'; // seasonal uncertainty is advisory-level

      await EventService.createOrUpdateEvent({
        type: eventType,
        severity,
        center_lat: centerLat,
        center_lon: centerLon,
        radius_km: 1000, // covers all of India
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
        status: 'active',
        simulated: false,
        created_by: 'el_nino_auto_service'
      });

      console.log(`[DailyJob] El Niño auto-event created: type=${eventType}, severity=${severity}`);
    }
  } catch (err) {
    console.warn('[DailyJob] El Niño check failed (non-fatal):', err.message);
  }

  // ── Standard Daily Forecast per Plot ──────────────────────────────────────
  for (const plot of plots) {
    const stageInfo = determineCropStage(plot.crop, plot.sowing_date, plot.stage_override, rules);
    const forecast = await forecastService.fetchForecast(plot.lat, plot.lon);
    
    // Evaluate rules engine against daily forecast
    const ruleMatches = evaluateRulesForPlot(plot.crop, stageInfo.stage, forecast.data, rules);

    if (ruleMatches.length > 0) {
      const redMatch = ruleMatches.find(r => r.severity === 'red');
      const chosenMatch = redMatch || ruleMatches[0];

      const clipSeq = buildClipSequence({
        eventType: 'heavy_rain',
        actionKey: chosenMatch.actionKey,
        isSimulated: plot.is_demo
      });

      const alert = AlertPolicyEngine.createOrUpdateAlert({
        plotId: plot.id,
        ruleId: chosenMatch.ruleId,
        level: chosenMatch.severity,
        clipSequence: clipSeq,
        reasonKey: chosenMatch.reasonKey
      });

      generatedAlerts.push(alert);
    }
  }

  return {
    plotsEvaluated: plots.length,
    alertsGenerated: generatedAlerts.length,
    alerts: generatedAlerts,
    el_nino: elNinoData
  };
}
