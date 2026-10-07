import { parseSpokenTranscript } from './nluParser.js';
import { dbStore } from '../db/store.js';
import { determineCropStage } from '../agronomy/stageCalculator.js';
import { ForecastService } from './forecastService.js';
import { evaluateRulesForPlot } from '../agronomy/rulesEngine.js';
import { ElNinoService } from './elNinoService.js';
import { askGemini } from './geminiService.js';

const forecastService = new ForecastService();

/**
 * Determine the effective lat/lon to use for forecasts.
 * Priority: registered plot → passed lat/lon from browser → India center fallback
 */
function resolveLocation(plot, passedLat, passedLon) {
  if (plot && plot.lat && plot.lon) {
    return { lat: plot.lat, lon: plot.lon };
  }
  if (passedLat != null && passedLon != null && !isNaN(passedLat) && !isNaN(passedLon)) {
    return { lat: passedLat, lon: passedLon };
  }
  return { lat: 26.9124, lon: 75.7873 }; // Jaipur default
}

/**
 * Check if El Niño is relevant to inject into THIS specific response.
 * Only inject when:
 *  1. El Niño / La Niña is actually detected (cached ONI status)
 *  2. The intent is weather-related (ask_weather) OR the query mentions rain/monsoon/drought
 */
function shouldMentionElNino(nlu, transcript) {
  const cached = ElNinoService.getCached();
  if (!cached || cached.status === 'neutral' || !cached.farmer_sentence_hi) return false;

  // Only weather / rainfall queries get the El Niño tag
  const isWeatherQuery = nlu.intent === 'ask_weather';
  const hasRainKeyword = /बारिश|मानसून|सूखा|पानी|वर्षा|monsoon|rain|drought/i.test(transcript);

  return isWeatherQuery || hasRainKeyword;
}

/**
 * Interactive Conversational Agronomy Voice AI Engine
 * @param {object} params
 * @param {string} params.transcript
 * @param {string|null} params.plotId
 * @param {string} params.lang
 * @param {number|null} params.lat  – passed from browser (district selector / GPS)
 * @param {number|null} params.lon
 */
export async function processFarmerVoiceInput({ transcript, plotId, lang = 'hi', lat = null, lon = null }) {
  const plot = plotId ? dbStore.plots.get(plotId) : null;
  const nlu = parseSpokenTranscript(transcript, lang);

  // Resolve effective lat/lon for forecasts
  const loc = resolveLocation(plot, lat, lon);

  let spokenTextHi = '';
  let spokenTextEn = '';
  let alertLevel = 'green';
  let isSimulated = false;
  let actionRequired = null;

  // 1. Check if plot has an ACTIVE severe weather alert
  let activeAlert = null;
  if (plot) {
    const alerts = Array.from(dbStore.alerts.values()).filter(
      a => a.plot_id === plot.id && ['created', 'delivered', 'opened', 'played'].includes(a.status)
    );
    if (alerts.length > 0) {
      activeAlert = alerts.sort((a, b) => (a.level === 'red' ? -1 : 1))[0];
    }
  }

  // 2. Priority: mention active red alert
  if (activeAlert) {
    alertLevel = activeAlert.level;
    const event = activeAlert.event_id ? dbStore.events.get(activeAlert.event_id) : null;
    isSimulated = event ? event.simulated : false;

    if (isSimulated) {
      spokenTextHi += 'यह अभ्यास संदेश है। ';
    }
    if (activeAlert.level === 'red') {
      spokenTextHi += 'सावधान! आपके क्षेत्र में भारी मौसम की चेतावनी है। ';
    }
  }

  // 3. Process Intent with Agronomy Context
  const crop = plot ? plot.crop : (nlu.slots.crop || 'wheat');
  const sowingDate = plot ? plot.sowing_date : (nlu.slots.sowing_date || new Date().toISOString().split('T')[0]);
  const stageOverride = plot ? plot.stage_override : undefined;

  const rules = Array.from(dbStore.cropStageRules.values());
  const stageInfo = determineCropStage(crop, sowingDate, stageOverride, rules);

  const cropNames = { wheat: 'गेहूँ', mustard: 'सरसों', chickpea: 'चना' };
  const cropHindi = cropNames[crop] || crop;

  switch (nlu.intent) {
    case 'ask_weather': {
      // Always use resolved location (plot > browser district > default)
      const forecast = await forecastService.fetchForecast(loc.lat, loc.lon);
      const rain48h = (forecast.data.precipitation_sum[0] || 0) + (forecast.data.precipitation_sum[1] || 0);
      const maxTemp = forecast.data.temperature_2m_max[0] || 30;
      const minTemp = forecast.data.temperature_2m_min[0] || 15;
      const rainProb = forecast.data.precipitation_probability_max[0] || 0;

      if (rain48h > 15) {
        spokenTextHi += `अगले 48 घंटों में भारी बारिश की संभावना है — लगभग ${Math.round(rain48h)} मिलीमीटर। ${Math.round(rainProb)}% संभावना है। तापमान ${Math.round(maxTemp)} डिग्री रहेगा।`;
        spokenTextEn += `Heavy rain of around ${Math.round(rain48h)}mm expected in next 48 hours (${Math.round(rainProb)}% chance). Max temp ${Math.round(maxTemp)}°C.`;
      } else if (rain48h > 3) {
        spokenTextHi += `अगले 48 घंटों में हल्की बारिश हो सकती है — करीब ${Math.round(rain48h)} मिलीमीटर। अधिकतम तापमान ${Math.round(maxTemp)} डिग्री रहेगा।`;
        spokenTextEn += `Light rain of about ${Math.round(rain48h)}mm expected. Max temp ${Math.round(maxTemp)}°C.`;
      } else {
        spokenTextHi += `अगले दो दिनों में मौसम साफ रहेगा। अधिकतम तापमान ${Math.round(maxTemp)} डिग्री, न्यूनतम ${Math.round(minTemp)} डिग्री रहने का अनुमान है।`;
        spokenTextEn += `Clear weather for next 2 days. Max ${Math.round(maxTemp)}°C, min ${Math.round(minTemp)}°C.`;
      }

      // El Niño: only append for weather queries when actually detected
      if (shouldMentionElNino(nlu, transcript)) {
        const elNinoSentence = ElNinoService.getFarmerSentence();
        if (elNinoSentence) {
          spokenTextHi += ` ${elNinoSentence}`;
        }
      }
      break;
    }

    case 'ask_action': {
      const forecast = await forecastService.fetchForecast(loc.lat, loc.lon);
      const matches = evaluateRulesForPlot(crop, stageInfo.stage, forecast.data, rules);
      const rain48h = (forecast.data.precipitation_sum[0] || 0) + (forecast.data.precipitation_sum[1] || 0);
      const minTemp = forecast.data.temperature_2m_min[0] || 15;

      if (matches.length > 0 && matches[0].actionKey === 'skip_irrigation_rain_expected') {
        spokenTextHi += `आपकी ${cropHindi} की फसल ${stageInfo.stage} चरण में है। अगले 48 घंटों में ${Math.round(rain48h)} मिमी बारिश की संभावना है — अभी सिंचाई न करें।`;
        alertLevel = matches[0].severity;
      } else if (matches.length > 0 && matches[0].actionKey === 'apply_light_irrigation_frost') {
        spokenTextHi += `पाले का खतरा है, तापमान ${Math.round(minTemp)} डिग्री तक गिर सकता है। फसल बचाने के लिए अभी हल्की सिंचाई करें।`;
        alertLevel = 'red';
      } else if (rain48h > 5) {
        spokenTextHi += `${cropHindi} की फसल ${stageInfo.stage} में है। बारिश आने वाली है, खेत में पानी रोकने का इंतजाम करें।`;
      } else {
        spokenTextHi += `आपकी ${cropHindi} फसल ${stageInfo.stage} चरण में ठीक है। नियमित देखभाल जारी रखें, मिट्टी में नमी बनाए रखें।`;
      }
      break;
    }

    case 'register_crop': {
      actionRequired = 'confirm_readback';
      spokenTextHi += `आपकी फसल ${cropHindi} है, बुवाई का समय ${stageInfo.daysSinceSowing} दिन पहले दर्ज किया जा रहा है। क्या यह जानकारी सही है?`;
      spokenTextEn += `Your crop is ${crop}, sown ${stageInfo.daysSinceSowing} days ago. Is this correct?`;
      break;
    }

    case 'confirm': {
      spokenTextHi += 'धन्यवाद! आपकी फसल की जानकारी सफलतापूर्वक सहेज ली गई है। अब आप मौसम और सिंचाई सलाह सुन सकते हैं।';
      actionRequired = 'save_confirmed';
      break;
    }

    case 'deny': {
      spokenTextHi += 'कोई बात नहीं, कृपया अपनी सही फसल और चरण चुनें।';
      actionRequired = 'reselect';
      break;
    }

    default: {
      // Chemical dose queries always get safety warning — never ask Gemini for dosages
      if (/दवा|कीटनाशक|pesticide|chemical dose/i.test(transcript)) {
        spokenTextHi += 'सुरक्षा चेतावनी: कीटनाशक या दवा की सही मात्रा के लिए कृपया पास के कृषि केंद्र (Krishi Kendra) के विशेषज्ञ से सलाह लें। बिना सलाह दवा न छिड़कें।';
        spokenTextEn += 'Safety warning: Consult your local Krishi Kendra for exact chemical dosage.';
        break;
      }

      // Greeting — quick reply without Gemini call
      if (/नमस्ते|हेलो|hello|hi\b/i.test(transcript)) {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'सुप्रभात' : hour < 17 ? 'नमस्ते' : 'शुभ संध्या';
        spokenTextHi += `${greeting} किसान भाई! मैं आपका खेतवाणी सहायक हूँ। मौसम, सिंचाई, उर्वरक, बीज, मंडी भाव — कुछ भी पूछिए।`;
        break;
      }

      // ── Gemini AI for all other open-ended questions ──────────────────────
      // Fetch live weather context to pass to Gemini so it can give location-aware answers
      let rain48h = null, maxTemp = null, minTemp = null;
      try {
        const forecast = await forecastService.fetchForecast(loc.lat, loc.lon);
        rain48h = (forecast.data.precipitation_sum[0] || 0) + (forecast.data.precipitation_sum[1] || 0);
        maxTemp = forecast.data.temperature_2m_max[0] || 30;
        minTemp = forecast.data.temperature_2m_min[0] || 15;
      } catch (_) { /* non-fatal — Gemini still answers without weather */ }

      const geminiContext = {
        crop,
        cropHindi,
        stage: stageInfo.stage,
        locationName: plot ? `${plot.lat.toFixed(1)}°N ${plot.lon.toFixed(1)}°E` : 'राजस्थान',
        rain48h,
        maxTemp,
        minTemp
      };

      const geminiReply = await askGemini(transcript, geminiContext);
      spokenTextHi += geminiReply;
      break;
    }
  }

  return {
    query: transcript,
    nlu,
    spoken_text_hi: spokenTextHi.trim(),
    spoken_text_en: spokenTextEn.trim(),
    alert_level: alertLevel,
    is_simulated: isSimulated,
    action_required: actionRequired,
    crop,
    stage: stageInfo.stage,
    active_alert: activeAlert || null,
    location_used: loc
  };
}
