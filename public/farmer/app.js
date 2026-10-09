/**
 * KhetVaani - Interactive Conversational Voice AI Farmer PWA Client
 * With GPS & District Location Selection + Live Sync Stream
 */

let currentPlotId = localStorage.getItem('khetvaani_plot_id') || null;
let currentCrop = 'wheat';
let currentStage = 'crown_root_initiation';
let farmerLat = 26.9124; // Default Jaipur coordinates
let farmerLon = 75.7873;
let locationName = 'जयपुर';
let activeAlert = null;
let recognition = null;
let isListening = false;

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initSpeechRecognition();
  initRegistrationModal();

  if (!currentPlotId) {
    document.getElementById('modal-register').style.display = 'flex';
  } else {
    sendVoiceQuery('नमस्ते');
    initSSE();
  }
});

function initUI() {
  const micBtn = document.getElementById('btn-voice-mic');
  micBtn.addEventListener('click', toggleVoiceListening);

  // Quick Cards Voice Shortcuts
  document.querySelectorAll('.quick-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.getAttribute('data-query');
      sendVoiceQuery(query);
    });
  });

  document.getElementById('btn-open-register').addEventListener('click', () => {
    document.getElementById('modal-register').style.display = 'flex';
  });

  document.getElementById('btn-refresh-gps').addEventListener('click', () => {
    requestGPSLocation();
  });

  const selectDist = document.getElementById('select-district');
  selectDist.addEventListener('change', (e) => {
    const selectedOpt = selectDist.options[selectDist.selectedIndex];
    farmerLat = parseFloat(selectedOpt.getAttribute('data-lat'));
    farmerLon = parseFloat(selectedOpt.getAttribute('data-lon'));
    locationName = selectedOpt.text.split(' ')[0];
    updateReadbackText();
    updateLocationPill();
    fetchClimateRisk();
  });

  document.getElementById('btn-speak-climate').addEventListener('click', () => {
    const text = document.getElementById('climate-advisory-text').innerText;
    speakText(text);
  });

  fetchClimateRisk();
}

/**
 * Fetch automated GPS Location Climate & El Niño Risk Predictions
 */
async function fetchClimateRisk() {
  try {
    const res = await fetch(`/api/farmer/climate-risk?lat=${farmerLat}&lon=${farmerLon}&crop=${currentCrop}&plot_id=${currentPlotId || ''}`);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.success) return;

    const zoneText = document.getElementById('climate-zone-text');
    const metricDeficit = document.getElementById('metric-deficit-risk');
    const metricVuln = document.getElementById('metric-drought-vuln');
    const metricRain = document.getElementById('metric-rain-48h');
    const advisoryBox = document.getElementById('climate-advisory-text');

    const oniSign = data.el_nino.latest_oni >= 0 ? `+${data.el_nino.latest_oni}` : `${data.el_nino.latest_oni}`;
    const statusLabel = data.el_nino.status === 'el_nino' ? 'अल नीनो' : data.el_nino.status === 'la_nina' ? 'ला नीना' : 'तटस्थ';
    
    zoneText.innerText = `📍 ${data.location.region_name} | NOAA ONI: ${oniSign}°C (${statusLabel})`;
    metricDeficit.innerText = `${data.el_nino.monsoon_deficit_risk_percent}%`;
    metricVuln.innerText = data.el_nino.drought_vulnerability === 'high' ? 'उच्च (High)' : data.el_nino.drought_vulnerability === 'medium' ? 'मध्यम' : 'सामान्य';
    metricRain.innerText = `${data.forecast_summary.rain_48h_mm} mm`;
    advisoryBox.innerText = data.el_nino.localized_advice_hi || data.automated_prediction.summary_hi;

    // If autonomous prediction detected high risk, update body status class
    if (data.automated_prediction.alert_level === 'red') {
      document.getElementById('body-app').className = 'state-red';
    } else if (data.automated_prediction.alert_level === 'yellow' && document.getElementById('body-app').className === 'state-green') {
      document.getElementById('body-app').className = 'state-yellow';
    }
  } catch (err) {
    console.warn('Climate risk fetch warning:', err);
  }
}

/**
 * GPS Geolocation Request
 */
function requestGPSLocation() {
  const locPill = document.getElementById('location-pill');
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        farmerLat = position.coords.latitude;
        farmerLon = position.coords.longitude;
        locationName = `GPS (${farmerLat.toFixed(2)}°, ${farmerLon.toFixed(2)}°)`;
        updateLocationPill();
        updateReadbackText();
        fetchClimateRisk();
      },
      (error) => {
        alert('GPS की अनुमति नहीं मिली। कृपया सूची से अपना जिला चुनें।');
      }
    );
  }
}

function updateLocationPill() {
  const locPill = document.getElementById('location-pill');
  locPill.innerText = `📍 ${locationName} (${farmerLat.toFixed(2)}°, ${farmerLon.toFixed(2)}°)`;
}

/**
 * Web Speech Recognition Setup (hi-IN)
 */
function initSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.warn('Web Speech Recognition API not supported in browser');
    return;
  }

  recognition = new SpeechRec();
  recognition.lang = 'hi-IN';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isListening = true;
    updateMicState(true, 'सुन रहा हूँ... बोलिए (Listening...)');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('user-query-text').innerText = `"${transcript}"`;
    sendVoiceQuery(transcript);
  };

  recognition.onerror = (event) => {
    console.warn('Speech recognition error:', event.error);
    updateMicState(false, 'बोलकर पूछें (Tap to Talk)');
  };

  recognition.onend = () => {
    isListening = false;
    updateMicState(false, 'बोलकर पूछें (Tap to Talk)');
  };
}

function toggleVoiceListening() {
  if (isListening) {
    if (recognition) recognition.stop();
  } else {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (recognition) {
      recognition.start();
    } else {
      const promptText = prompt('अपनी समस्या या सवाल लिखें:', 'मौसम कैसा रहेगा');
      if (promptText) sendVoiceQuery(promptText);
    }
  }
}

function updateMicState(listening, labelText) {
  const micBtn = document.getElementById('btn-voice-mic');
  const micLabel = document.getElementById('mic-label');
  micLabel.innerText = labelText;

  if (listening) {
    micBtn.classList.add('listening');
  } else {
    micBtn.classList.remove('listening');
  }
}

/**
 * Send Voice Query to Backend Voice AI Engine
 */
async function sendVoiceQuery(text) {
  document.getElementById('user-query-text').innerText = `"${text}"`;
  setSoundwaves(true);

  try {
    const res = await fetch('/api/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: text,
        plot_id: currentPlotId,
        lang: 'hi',
        lat: farmerLat,   // always send current district/GPS coordinates
        lon: farmerLon
      })
    });

    const data = await res.json();
    renderAiResponse(data);
  } catch (err) {
    console.error('Voice AI query failed:', err);
    setSoundwaves(false);
  }
}

/**
 * Render AI Response & Speak Out Loud
 */
function renderAiResponse(data) {
  const body = document.getElementById('body-app');
  const aiReply = document.getElementById('ai-reply-text');
  const ackActions = document.getElementById('ack-actions');
  const cropBadge = document.getElementById('crop-badge');
  const stageBadge = document.getElementById('stage-badge');

  body.className = `state-${data.alert_level || 'green'}`;

  aiReply.innerText = data.spoken_text_hi;

  const cropNames = { wheat: '🌾 गेहूँ', mustard: '🌼 सरसों', chickpea: '🌱 चना' };
  cropBadge.innerText = `${cropNames[data.crop] || data.crop}`;
  stageBadge.innerText = `🌱 ${data.stage}`;

  if (data.active_alert) {
    activeAlert = data.active_alert;
    ackActions.style.display = 'flex';
  } else {
    activeAlert = null;
    ackActions.style.display = 'none';
  }

  // Speak AI Hindi Response Out Loud
  speakText(data.spoken_text_hi, () => {
    setSoundwaves(false);
  });
}

function setSoundwaves(active) {
  const soundwaves = document.getElementById('soundwaves');
  soundwaves.style.display = active ? 'flex' : 'none';
}

function speakText(text, onEnd) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'hi-IN';
    utterance.rate = 0.9;
    utterance.onend = () => { if (onEnd) onEnd(); };
    utterance.onerror = () => { if (onEnd) onEnd(); };
    window.speechSynthesis.speak(utterance);
  } else {
    if (onEnd) onEnd();
  }
}

/**
 * Spoken Read-Back Registration Flow (NON-NEGOTIABLE RULE)
 */
function initRegistrationModal() {
  const modal = document.getElementById('modal-register');
  const cropCards = document.querySelectorAll('.photo-select-grid .photo-select-card[data-crop]');
  const confirmBtn = document.getElementById('btn-confirm-register');
  const cancelBtn = document.getElementById('btn-close-register');
  const readbackAudioBtn = document.getElementById('btn-readback-audio');

  cropCards.forEach(card => {
    card.addEventListener('click', () => {
      cropCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentCrop = card.getAttribute('data-crop');
      updateReadbackText();
    });
  });

  readbackAudioBtn.addEventListener('click', () => {
    const text = updateReadbackText();
    speakText(text);
  });

  confirmBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_name: 'किसान भाई',
          lat: farmerLat,
          lon: farmerLon,
          crop: currentCrop,
          sowing_date: new Date().toISOString().split('T')[0],
          stage_override: currentStage,
          is_demo: false, // Production Real Plot
          confirmed_readback: true // Explicit readback confirmation
        })
      });

      const data = await res.json();
      if (data.success) {
        currentPlotId = data.plot.id;
        localStorage.setItem('khetvaani_plot_id', currentPlotId);
        modal.style.display = 'none';
        updateLocationPill();
        sendVoiceQuery('नमस्ते, मेरी नई फसल दर्ज हो गई है');
        initSSE();
      }
    } catch (err) {
      console.error('Registration failed:', err);
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (currentPlotId) modal.style.display = 'none';
  });
}

function updateReadbackText() {
  const cropNames = { wheat: 'गेहूँ', mustard: 'सरसों', chickpea: 'चना' };
  const text = `आपकी फसल ${cropNames[currentCrop] || currentCrop} है, ${locationName} लोकेशन पर। क्या यह सही है?`;
  document.getElementById('readback-text').innerHTML = `आपकी फसल <b>${cropNames[currentCrop] || currentCrop}</b> है, <b>${locationName}</b> पर। क्या यह सही है?`;
  return text;
}

/**
 * Real-Time Live Sync (< 5 seconds latency requirement)
 * Listens for ALERT_CREATED, ALERT_SUPERSEDED, and EVENT_CHANGED
 */
function initSSE() {
  if (!currentPlotId) return;

  const sseUrl = `/api/alerts/stream?plot_id=${currentPlotId}`;
  const evtSource = new EventSource(sseUrl);

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ALERT_CREATED' || data.type === 'ALERT_SUPERSEDED' || data.type === 'EVENT_CHANGED') {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        sendVoiceQuery('मौसम अपडेट क्या है');
      }
    } catch (err) {
      console.warn('SSE message parse error:', err);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    setTimeout(() => {
      initSSE();
    }, 3000);
  };
}

/**
 * Submit Acknowledgement
 */
async function submitAck(responseType) {
  if (!activeAlert) return;

  try {
    await fetch(`/api/alerts/${activeAlert.id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: responseType })
    });

    // Clear alert state cleanly — no re-query that might inject El Niño again
    activeAlert = null;
    document.getElementById('ack-actions').style.display = 'none';

    const ackMessages = {
      done: 'धन्यवाद! आपकी प्रतिक्रिया दर्ज कर ली गई है। अगर कोई और जानकारी चाहिए तो पूछिए।',
      cannot: 'समझ गए। आपकी समस्या दर्ज कर ली है। कृषि सहायक जल्द संपर्क करेगा।',
      not_my_field: 'ठीक है। यह अलर्ट आपके लिए नहीं था — हटा दिया गया है।'
    };

    const msg = ackMessages[responseType] || 'धन्यवाद, आपकी प्रतिक्रिया दर्ज कर ली गई है।';
    document.getElementById('ai-reply-text').innerText = msg;
    document.getElementById('body-app').className = 'state-green';
    speakText(msg);

  } catch (err) {
    console.error('Failed to submit ack:', err);
  }
}
