/**
 * KhetVaani - Structured Spoken NLU Parser
 * NON-NEGOTIABLE RULE: The LLM/NLP may parse speech into the JSON schema below and nothing else.
 */

export function parseSpokenTranscript(transcript, lang = 'hi') {
  if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
    return {
      intent: 'unknown',
      confidence: 0.0,
      slots: {
        language: lang,
        district_text: null,
        crop: null,
        sowing_date: null,
        date_is_approximate: false,
        stage: null,
        weather_variable: null,
        horizon_days: null,
        field_to_correct: null
      },
      raw_transcript: transcript || ''
    };
  }

  const raw = transcript.toLowerCase().trim();
  let intent = 'unknown';
  let confidence = 0.85;

  const slots = {
    language: lang,
    district_text: null,
    crop: null,
    sowing_date: null,
    date_is_approximate: false,
    stage: null,
    weather_variable: null,
    horizon_days: null,
    field_to_correct: null
  };

  // Crop detection
  if (raw.includes('गेहूँ') || raw.includes('gehu') || raw.includes('wheat')) {
    slots.crop = 'wheat';
  } else if (raw.includes('सरसों') || raw.includes('sarson') || raw.includes('mustard')) {
    slots.crop = 'mustard';
  } else if (raw.includes('चना') || raw.includes('chana') || raw.includes('chickpea')) {
    slots.crop = 'chickpea';
  }

  // Weather variable detection
  if (raw.includes('बारिश') || raw.includes('पानी') || raw.includes('rain')) {
    slots.weather_variable = 'rain';
  } else if (raw.includes('गर्मी') || raw.includes('तापमान') || raw.includes('heat')) {
    slots.weather_variable = 'heat';
  } else if (raw.includes('पाला') || raw.includes('frost')) {
    slots.weather_variable = 'frost';
  } else if (raw.includes('मौसम') || raw.includes('weather')) {
    slots.weather_variable = 'rain'; // default weather query variable
  }

  // Intent detection
  if (raw.includes('मौसम') || raw.includes('weather') || raw.includes('बारिश होगी')) {
    intent = 'ask_weather';
    confidence = 0.95;
  } else if (raw.includes('क्या करूँ') || raw.includes('पानी लगाऊँ') || raw.includes('what to do')) {
    intent = 'ask_action';
    confidence = 0.95;
  } else if (raw.includes('हाँ') || raw.includes('सही है') || raw.includes('yes') || raw.includes('confirm')) {
    intent = 'confirm';
    confidence = 0.98;
  } else if (raw.includes('नहीं') || raw.includes('गलत') || raw.includes('no') || raw.includes('deny')) {
    intent = 'deny';
    confidence = 0.98;
  } else if (raw.includes('बीस दिन') || raw.includes('20 days') || raw.includes('सोनू') || slots.crop) {
    if (raw.includes('बीस दिन पहले') || raw.includes('20 days ago')) {
      const d = new Date();
      d.setDate(d.getDate() - 20);
      slots.sowing_date = d.toISOString().split('T')[0];
      slots.date_is_approximate = true;
      slots.stage = 'crown_root_initiation';
    }
    intent = 'register_crop';
    confidence = 0.90;
  }

  // Treat low confidence as unknown
  if (confidence < 0.60) {
    intent = 'unknown';
  }

  return {
    intent,
    confidence,
    slots,
    raw_transcript: transcript
  };
}
