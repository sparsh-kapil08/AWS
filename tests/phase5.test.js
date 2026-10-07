import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { dbStore } from '../src/db/store.js';
import { parseSpokenTranscript } from '../src/services/nluParser.js';
import { processFarmerVoiceInput } from '../src/services/voiceAiEngine.js';

describe('Phase 5 - Interactive Voice AI Assistant Tests', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Interactive Voice AI Engine Response Generation', () => {
    it('generates spoken Hindi weather AI response when farmer asks "मौसम कैसा रहेगा"', async () => {
      const plot = {
        id: 'plot_voice_ai_1',
        farmer_id: 'farmer_ai',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      const result = await processFarmerVoiceInput({
        transcript: 'मौसम कैसा रहेगा गेहूँ के लिए',
        plotId: plot.id,
        lang: 'hi'
      });

      expect(result.spoken_text_hi).toBeDefined();
      expect(result.spoken_text_hi.length).toBeGreaterThan(0);
      expect(result.crop).toBe('wheat');
    });

    it('enforces safety warning on chemical dose queries ("दवा कितनी डालूँ")', async () => {
      const result = await processFarmerVoiceInput({
        transcript: 'कीटनाशक दवा कितनी मात्रा में डालूँ',
        plotId: null,
        lang: 'hi'
      });

      expect(result.spoken_text_hi).toContain('सुरक्षा चेतावनी');
      expect(result.spoken_text_hi).toContain('कृषि केंद्र');
      expect(result.spoken_text_hi).not.toContain('50ml');
    });
  });

  describe('2. Voice API Endpoint /api/voice/chat', () => {
    it('returns conversational voice AI object with spoken text', async () => {
      const res = await request(app)
        .post('/api/voice/chat')
        .send({
          transcript: 'पानी कब लगाऊँ',
          plot_id: null,
          lang: 'hi'
        });

      expect(res.status).toBe(200);
      expect(res.body.spoken_text_hi).toBeDefined();
      expect(res.body.nlu).toBeDefined();
    });
  });

});
