import express from 'express';
import { parseSpokenTranscript } from '../services/nluParser.js';
import { processFarmerVoiceInput } from '../services/voiceAiEngine.js';

const router = express.Router();

/**
 * 1. Parse raw transcript to structured JSON Schema
 */
router.post('/parse', (req, res) => {
  const { transcript, lang } = req.body;
  const nluResult = parseSpokenTranscript(transcript, lang || 'hi');
  return res.json(nluResult);
});

/**
 * 2. Interactive Voice AI Dialogue Endpoint
 * Multi-turn conversational agronomy AI for farmer client
 */
router.post('/chat', async (req, res) => {
  try {
    const { transcript, plot_id, lang, lat, lon } = req.body;
    const aiResponse = await processFarmerVoiceInput({
      transcript: transcript || '',
      plotId: plot_id,
      lang: lang || 'hi',
      // lat/lon passed from browser district selector or GPS — used when no plot registered
      lat: lat != null ? Number(lat) : null,
      lon: lon != null ? Number(lon) : null
    });
    return res.json(aiResponse);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
