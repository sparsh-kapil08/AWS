export const SEED_CROP_STAGE_RULES = [
  // Wheat Rules
  {
    id: 'rule_wheat_cri_rain',
    crop: 'wheat',
    stage: 'crown_root_initiation',
    start_day: 0,
    end_day: 25,
    risk_type: 'rain_expected',
    threshold: 5,
    unit: 'mm_48h',
    severity: 'yellow',
    action_key: 'skip_irrigation_rain_expected',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_wheat_tillering_dry',
    crop: 'wheat',
    stage: 'tillering',
    start_day: 26,
    end_day: 45,
    risk_type: 'dry_spell',
    threshold: 10,
    unit: 'dry_days',
    severity: 'yellow',
    action_key: 'irrigate_dry_spell',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_wheat_flowering_heat',
    crop: 'wheat',
    stage: 'flowering',
    start_day: 46,
    end_day: 75,
    risk_type: 'heatwave',
    threshold: 32,
    unit: 'temp_max',
    severity: 'yellow',
    action_key: 'light_irrigation_heatwave',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_wheat_grain_filling_rain',
    crop: 'wheat',
    stage: 'grain_filling',
    start_day: 76,
    end_day: 110,
    risk_type: 'rain_expected',
    threshold: 10,
    unit: 'mm_48h',
    severity: 'yellow',
    action_key: 'skip_irrigation_rain_expected',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },

  // Mustard Rules
  {
    id: 'rule_mustard_seedling_rain',
    crop: 'mustard',
    stage: 'seedling_branching',
    start_day: 0,
    end_day: 30,
    risk_type: 'rain_expected',
    threshold: 5,
    unit: 'mm_48h',
    severity: 'yellow',
    action_key: 'skip_irrigation_rain_expected',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_mustard_flowering_frost',
    crop: 'mustard',
    stage: 'flowering_pod_formation',
    start_day: 31,
    end_day: 60,
    risk_type: 'frost',
    threshold: 4,
    unit: 'temp_min',
    severity: 'red',
    action_key: 'apply_light_irrigation_frost',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_mustard_maturity_rain',
    crop: 'mustard',
    stage: 'maturity',
    start_day: 61,
    end_day: 90,
    risk_type: 'heavy_rain',
    threshold: 15,
    unit: 'mm_48h',
    severity: 'red',
    action_key: 'protect_harvested_crop',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },

  // Chickpea Rules
  {
    id: 'rule_chickpea_veg_rain',
    crop: 'chickpea',
    stage: 'vegetative',
    start_day: 0,
    end_day: 35,
    risk_type: 'rain_expected',
    threshold: 5,
    unit: 'mm_48h',
    severity: 'yellow',
    action_key: 'skip_irrigation_rain_expected',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_chickpea_flowering_rain',
    crop: 'chickpea',
    stage: 'flowering_pod_initiation',
    start_day: 36,
    end_day: 70,
    risk_type: 'rain_expected',
    threshold: 10,
    unit: 'mm_48h',
    severity: 'yellow',
    action_key: 'skip_irrigation_rain_expected',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'rule_chickpea_pod_filling_heat',
    crop: 'chickpea',
    stage: 'pod_filling',
    start_day: 71,
    end_day: 105,
    risk_type: 'heatwave',
    threshold: 35,
    unit: 'temp_max',
    severity: 'yellow',
    action_key: 'light_irrigation_heatwave',
    source: 'PLACEHOLDER',
    version: 1,
    created_at: new Date().toISOString()
  }
];

export const SEED_AUDIO_CLIPS = [
  {
    id: 'audio_sim_intro',
    clip_key: 'simulated_intro',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/simulated_intro.mp3',
    text: 'यह अभ्यास संदेश है',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_rain_coming',
    clip_key: 'heavy_rain_coming',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/heavy_rain_coming.mp3',
    text: 'तेज बारिश की संभावना है',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_frost_coming',
    clip_key: 'frost_coming',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/frost_coming.mp3',
    text: 'पाला पड़ने की संभावना है',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_heat_coming',
    clip_key: 'heatwave_coming',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/heatwave_coming.mp3',
    text: 'भीषण गर्मी और तापमान बढ़ने की संभावना है',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_when_today_evening',
    clip_key: 'time_today_evening',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/time_today_evening.mp3',
    text: 'आज शाम तक',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_when_tomorrow_morning',
    clip_key: 'time_tomorrow_morning',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/time_tomorrow_morning.mp3',
    text: 'कल सुबह तक',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_when_next_48h',
    clip_key: 'time_next_48h',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/time_next_48h.mp3',
    text: 'अगले दो दिनों में',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_action_skip_irrigation',
    clip_key: 'skip_irrigation_rain_expected',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/skip_irrigation.mp3',
    text: 'सिंचाई रोक दें, खेत में पानी न लगाएं',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_action_irrigate_frost',
    clip_key: 'apply_light_irrigation_frost',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/irrigate_frost.mp3',
    text: 'खेत में हल्की सिंचाई करें ताकि फसल पाले से बचे',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_action_chemical_advice',
    clip_key: 'consult_krishi_kendra',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/consult_krishi_kendra.mp3',
    text: 'कीटनाशक या दवा के लिए कृषि केंद्र से पूछिए',
    created_at: new Date().toISOString()
  },
  {
    id: 'audio_action_all_clear',
    clip_key: 'event_all_clear',
    lang: 'hi',
    s3_url: 'https://khetvaani-audio.s3.amazonaws.com/hi/event_all_clear.mp3',
    text: 'मौसम की चेतावनी समाप्त हो गई है, अब स्थिति सामान्य है',
    created_at: new Date().toISOString()
  }
];
