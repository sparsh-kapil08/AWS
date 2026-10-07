export function buildClipSequence({
  eventType,
  actionKey,
  isSimulated = false,
  isAllClear = false
}) {
  const sequence = [];

  // 1. Simulated intro if simulated
  if (isSimulated) {
    sequence.push('simulated_intro');
  }

  // 2. If All Clear resolution event
  if (isAllClear) {
    sequence.push('event_all_clear');
    return sequence;
  }

  // 3. What's coming
  switch (eventType) {
    case 'heavy_rain':
      sequence.push('heavy_rain_coming');
      break;
    case 'frost':
      sequence.push('frost_coming');
      break;
    case 'heatwave':
      sequence.push('heatwave_coming');
      break;
    case 'dry_spell':
      sequence.push('heavy_rain_coming'); // fallback or risk indicator
      break;
    case 'hail_conducive':
      sequence.push('heavy_rain_coming');
      break;
    default:
      sequence.push('heavy_rain_coming');
  }

  // 4. When (relative time words)
  sequence.push('time_next_48h');

  // 5. Action (one action per alert)
  if (actionKey === 'chemical_spray') {
    sequence.push('consult_krishi_kendra');
  } else if (actionKey) {
    sequence.push(actionKey);
  } else {
    sequence.push('skip_irrigation_rain_expected');
  }

  return sequence;
}
