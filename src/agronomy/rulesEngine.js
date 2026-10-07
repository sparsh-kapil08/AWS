export function evaluateRulesForPlot(
  crop,
  currentStage,
  forecast,
  rules,
  eventOverlay = null
) {
  const results = [];
  const stageRules = rules.filter(r => r.crop === crop && r.stage === currentStage);

  const rain48h = (forecast.precipitation_sum[0] || 0) + (forecast.precipitation_sum[1] || 0);
  const todayMaxTemp = forecast.temperature_2m_max[0] || 0;
  const todayMinTemp = forecast.temperature_2m_min[0] || 0;

  let dryDays = 0;
  for (const p of forecast.precipitation_sum || []) {
    if (p < 1.0) dryDays++;
    else break;
  }

  let effectiveRain48h = rain48h;
  let effectiveMinTemp = todayMinTemp;
  let effectiveMaxTemp = todayMaxTemp;

  if (eventOverlay && eventOverlay.status === 'active') {
    if (eventOverlay.type === 'heavy_rain') {
      effectiveRain48h += 40;
    } else if (eventOverlay.type === 'frost') {
      effectiveMinTemp = Math.min(effectiveMinTemp, 2);
    } else if (eventOverlay.type === 'heatwave') {
      effectiveMaxTemp = Math.max(effectiveMaxTemp, 38);
    }
  }

  for (const rule of stageRules) {
    let matched = false;
    let evaluatedVal = 0;

    switch (rule.unit) {
      case 'mm_48h':
        evaluatedVal = effectiveRain48h;
        matched = evaluatedVal >= rule.threshold;
        break;
      case 'dry_days':
        evaluatedVal = dryDays;
        matched = evaluatedVal >= rule.threshold;
        break;
      case 'temp_max':
        evaluatedVal = effectiveMaxTemp;
        matched = evaluatedVal >= rule.threshold;
        break;
      case 'temp_min':
        evaluatedVal = effectiveMinTemp;
        matched = evaluatedVal <= rule.threshold;
        break;
      default:
        matched = false;
    }

    if (matched) {
      results.push({
        ruleId: rule.id,
        matched: true,
        crop,
        stage: currentStage,
        severity: rule.severity,
        actionKey: rule.action_key,
        reasonKey: `${rule.risk_type}_threshold_exceeded`,
        source: rule.source,
        valueEvaluated: evaluatedVal,
        threshold: rule.threshold,
        unit: rule.unit
      });
    }
  }

  return results;
}
