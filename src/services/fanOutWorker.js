import { dbStore } from '../db/store.js';
import { isPlotWithinEventArea } from './spatialUtils.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';
import { ForecastService } from './forecastService.js';
import { buildClipSequence } from './clipBuilder.js';
import { AlertPolicyEngine } from './alertPolicy.js';

const forecastService = new ForecastService();

export class FanOutWorker {
  static async processEvent(event) {
    // If event status is resolved or cancelled, trigger resolution policy
    if (event.status === 'resolved' || event.status === 'cancelled') {
      return AlertPolicyEngine.resolveAlertsForEvent(event.id);
    }

    if (event.status !== 'active' && event.status !== 'updated') {
      return [];
    }

    const allPlots = Array.from(dbStore.plots.values());
    const generatedAlerts = [];

    for (const plot of allPlots) {
      // 1. Spatial filter: check if plot is inside event radius
      const isTargeted = isPlotWithinEventArea(
        plot.lat,
        plot.lon,
        event.center_lat,
        event.center_lon,
        event.radius_km
      );

      if (!isTargeted) continue;

      // 2. NON-NEGOTIABLE SIMULATED GUARD:
      // SIMULATED events may ONLY target plots where is_demo=true.
      if (event.simulated && !plot.is_demo) {
        // Enforced strictly in fan-out worker
        continue;
      }

      // 3. Determine crop stage
      const rules = Array.from(dbStore.cropStageRules.values());
      const stageInfo = determineCropStage(plot.crop, plot.sowing_date, plot.stage_override, rules);

      // 4. Fetch forecast (with read-time event overlay)
      const forecast = await forecastService.fetchForecast(plot.lat, plot.lon);

      // 5. Evaluate rules engine
      const ruleMatches = evaluateRulesForPlot(plot.crop, stageInfo.stage, forecast.data, rules, event);

      // Highest severity wins or event-direct alert
      let alertLevel = event.severity;
      let actionKey = 'skip_irrigation_rain_expected';
      let ruleId = undefined;
      let reasonKey = `${event.type}_event_active`;

      if (ruleMatches.length > 0) {
        // Pick match with highest severity (red > yellow > green)
        const redMatch = ruleMatches.find(r => r.severity === 'red');
        const chosenMatch = redMatch || ruleMatches[0];
        
        // Severity prioritization: red > yellow > green
        if (event.severity === 'red' || chosenMatch.severity === 'red') {
          alertLevel = 'red';
        } else if (event.severity === 'yellow' || chosenMatch.severity === 'yellow') {
          alertLevel = 'yellow';
        } else {
          alertLevel = 'green';
        }

        actionKey = chosenMatch.actionKey;
        ruleId = chosenMatch.ruleId;
        reasonKey = chosenMatch.reasonKey;
      }

      // 6. Build clip sequence
      const clipSeqKeys = buildClipSequence({
        eventType: event.type,
        actionKey,
        isSimulated: event.simulated,
        isAllClear: false
      });

      // 7. Apply alert policy (idempotent dedupe / supersede)
      const alert = AlertPolicyEngine.createOrUpdateAlert({
        plotId: plot.id,
        eventId: event.id,
        ruleId,
        level: alertLevel,
        clipSequence: clipSeqKeys,
        reasonKey
      });

      generatedAlerts.push(alert);
    }

    return generatedAlerts;
  }
}
