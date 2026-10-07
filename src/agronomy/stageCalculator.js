export function calculateDaysSinceSowing(sowingDateStr, referenceDate = new Date()) {
  const sowingDate = new Date(sowingDateStr);
  const ref = new Date(referenceDate.toISOString().split('T')[0]);
  const sowing = new Date(sowingDate.toISOString().split('T')[0]);
  
  const diffTime = ref.getTime() - sowing.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function determineCropStage(
  crop,
  sowingDateStr,
  stageOverride,
  rules = [],
  referenceDate = new Date()
) {
  if (stageOverride && stageOverride.trim() !== '') {
    return {
      crop,
      stage: stageOverride,
      daysSinceSowing: calculateDaysSinceSowing(sowingDateStr, referenceDate),
      isOverride: true
    };
  }

  const daysSinceSowing = calculateDaysSinceSowing(sowingDateStr, referenceDate);
  const cropRules = rules.filter(r => r.crop === crop);
  const matchingRule = cropRules.find(r => daysSinceSowing >= r.start_day && daysSinceSowing <= r.end_day);
  
  if (matchingRule) {
    return {
      crop,
      stage: matchingRule.stage,
      daysSinceSowing,
      isOverride: false
    };
  }

  let fallbackStage = 'vegetative';
  if (crop === 'wheat') {
    if (daysSinceSowing <= 25) fallbackStage = 'crown_root_initiation';
    else if (daysSinceSowing <= 45) fallbackStage = 'tillering';
    else if (daysSinceSowing <= 75) fallbackStage = 'flowering';
    else fallbackStage = 'grain_filling';
  } else if (crop === 'mustard') {
    if (daysSinceSowing <= 30) fallbackStage = 'seedling_branching';
    else if (daysSinceSowing <= 60) fallbackStage = 'flowering_pod_formation';
    else fallbackStage = 'maturity';
  } else if (crop === 'chickpea') {
    if (daysSinceSowing <= 35) fallbackStage = 'vegetative';
    else if (daysSinceSowing <= 70) fallbackStage = 'flowering_pod_initiation';
    else fallbackStage = 'pod_filling';
  }

  return {
    crop,
    stage: fallbackStage,
    daysSinceSowing,
    isOverride: false
  };
}
