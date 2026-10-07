/**
 * KhetVaani - Google Gemini AI Service
 * 
 * Used for open-ended farmer questions that the structured NLU doesn't cover.
 * Model: gemini-2.0-flash (fast, cheap, multilingual)
 * 
 * System prompt positions the AI as a Hindi-speaking agronomy expert.
 * All responses are kept SHORT (1-2 sentences) for voice delivery.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
function getGeminiUrl() {
  const key = process.env.GEMINI_API_KEY;
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

/**
 * Build the system prompt for the farming AI.
 * Injects live context: crop, stage, location, weather so Gemini gives
 * relevant answers, not generic ones.
 */
function buildSystemPrompt(context) {
  const { crop, cropHindi, stage, locationName, rain48h, maxTemp, minTemp } = context;

  return `तुम KhetVaani हो — एक Hindi-speaking AI कृषि सहायक जो भारतीय किसानों की मदद करता है।

वर्तमान किसान की जानकारी:
- फसल: ${cropHindi} (${crop})
- अवस्था (Stage): ${stage}
- स्थान: ${locationName || 'राजस्थान'}
- अगले 48 घंटों में बारिश: ${rain48h != null ? Math.round(rain48h) + ' मिमी' : 'जानकारी नहीं'}
- अधिकतम तापमान: ${maxTemp != null ? Math.round(maxTemp) + '°C' : 'जानकारी नहीं'}
- न्यूनतम तापमान: ${minTemp != null ? Math.round(minTemp) + '°C' : 'जानकारी नहीं'}

नियम:
1. हमेशा HINDI में जवाब दो।
2. जवाब सिर्फ 1-2 सरल वाक्यों में दो — किसान को voice से सुनना है।
3. सरल व्यावहारिक भाषा उपयोग करो, तकनीकी शब्द कम।
4. सिर्फ खेती, मौसम, फसल, सिंचाई, उर्वरक, कीट, मंडी भाव से जुड़े सवालों का जवाब दो।
5. अगर कोई रासायनिक दवा की मात्रा पूछे तो कृषि केंद्र से सलाह लेने को कहो — खुद मात्रा मत बताओ।
6. अगर सवाल खेती से बिल्कुल अलग हो, तो विनम्रता से बताओ कि तुम केवल कृषि सहायक हो।`;
}

/**
 * Call Gemini API with farmer context + user's question.
 * Returns Hindi spoken text string.
 * Falls back to a default message if API is unavailable or key not set.
 */
export async function askGemini(transcript, context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return fallbackResponse(transcript, context);
  }

  try {
    const systemPrompt = buildSystemPrompt(context);

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: transcript }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 150,
        thinkingConfig: {
          thinkingBudget: 0
        }
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const res = await fetch(getGeminiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[GeminiService] API error ${res.status}: ${errText}`);
      return fallbackResponse(transcript, context);
    }

    const json = await res.json();
    const candidate = json?.candidates?.[0];

    // Check for blocked content
    if (candidate?.finishReason === 'SAFETY') {
      return 'इस सवाल का जवाब देने में असमर्थ हूँ। कृपया खेती से जुड़ा कोई और सवाल पूछें।';
    }

    const parts = candidate?.content?.parts || [];
    const textPart = parts.find(p => p.text && !p.thought);
    let text = (textPart ? textPart.text : parts[0]?.text)?.trim();

    if (!text) {
      return fallbackResponse(transcript, context);
    }

    // Clean markdown bold/bullets so speech synthesis speaks naturally
    text = text.replace(/[*#_`]/g, '').replace(/\n+/g, ' ').trim();

    return text;

  } catch (err) {
    console.warn('[GeminiService] Request failed:', err.message);
    return fallbackResponse(transcript, context);
  }
}

/**
 * Fallback when Gemini is unavailable or key not configured.
 * Gives a sensible response based on keywords in the transcript.
 */
function fallbackResponse(transcript, context) {
  const { cropHindi, stage } = context;
  const t = transcript.toLowerCase();

  if (t.includes('खाद') || t.includes('उर्वरक') || t.includes('fertilizer') || t.includes('नाइट्रोजन') || t.includes('यूरिया')) {
    return `${cropHindi} की ${stage} अवस्था में उर्वरक की सही मात्रा के लिए अपने नजदीकी कृषि विभाग या KVK से सलाह लें।`;
  }
  if (t.includes('बीज') || t.includes('seed') || t.includes('बुवाई') || t.includes('sowing')) {
    return `${cropHindi} की बुवाई के लिए प्रमाणित बीज का उपयोग करें और अपने जिले के अनुसार उचित समय पर बुवाई करें।`;
  }
  if (t.includes('मंडी') || t.includes('भाव') || t.includes('price') || t.includes('rate')) {
    return 'मंडी भाव जानने के लिए agmarknet.gov.in वेबसाइट देखें या अपनी नजदीकी मंडी से संपर्क करें।';
  }
  if (t.includes('कीड़ा') || t.includes('रोग') || t.includes('disease') || t.includes('pest') || t.includes('पत्ती')) {
    return `${cropHindi} में कीड़े या रोग दिखने पर अपने कृषि केंद्र (Krishi Kendra) पर जाएं — वे पत्ती देखकर सही दवा बताएंगे।`;
  }
  if (t.includes('सिंचाई') || t.includes('पानी') || t.includes('irrigation') || t.includes('drip')) {
    return `${cropHindi} की ${stage} अवस्था में मिट्टी की नमी देखकर सिंचाई करें। अधिक पानी से जड़ें खराब हो सकती हैं।`;
  }
  if (t.includes('काटना') || t.includes('harvest') || t.includes('कटाई')) {
    return `${cropHindi} की कटाई का सही समय फसल की परिपक्वता देखकर तय करें — दाने कड़े हो जाएं तो कटाई करें।`;
  }

  return `मैं आपकी ${cropHindi} फसल के लिए हर सवाल का जवाब देने की कोशिश करता हूँ। कृपया अपना सवाल थोड़ा और स्पष्ट करें।`;
}
