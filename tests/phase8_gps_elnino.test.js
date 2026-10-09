import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { dbStore } from '../src/db/store.js';
import { getRegionalElNinoImpact, ElNinoService } from '../src/services/elNinoService.js';
import { AlertPolicyEngine } from '../src/services/alertPolicy.js';

describe('Phase 8: GPS Location El Niño Regional Predictions & Autonomous Alerts', () => {
  beforeEach(() => {
    dbStore.plots.clear();
    dbStore.alerts.clear();
    dbStore.events.clear();
    dbStore.farmers.clear();
  });

  describe('1. Regional El Niño Impact Engine across GPS Coordinates', () => {
    it('accurately identifies North-West India (Jaipur / Punjab / Gujarat) with high drought risk during El Niño', () => {
      // Jaipur: 26.91N, 75.78E
      const impact = getRegionalElNinoImpact(26.9124, 75.7873, 'el_nino', 0.8);
      expect(impact.zone_key).toBe('north_west');
      expect(impact.drought_vulnerability).toBe('high');
      expect(impact.monsoon_deficit_risk_percent).toBe(75);
      expect(impact.localized_farmer_advice_hi).toContain('उत्तर-पश्चिम भारत');
      expect(impact.localized_farmer_advice_hi).toContain('अल नीनो');
    });

    it('accurately identifies South Peninsular India (Tamil Nadu / Chennai) with enhanced NE monsoon risk during El Niño', () => {
      // Chennai / Madurai: 13.08N, 80.27E
      const impact = getRegionalElNinoImpact(13.0827, 80.2707, 'el_nino', 0.9);
      expect(impact.zone_key).toBe('south_peninsular');
      expect(impact.excess_rain_risk_percent).toBeGreaterThanOrEqual(65);
      expect(impact.localized_farmer_advice_hi).toContain('दक्षिण भारत');
      expect(impact.localized_farmer_advice_hi).toContain('जल निकासी');
    });

    it('accurately identifies Central & Deccan India (Indore / Nagpur) with dry spell risks during El Niño', () => {
      // Indore: 22.71N, 75.85E
      const impact = getRegionalElNinoImpact(21.1458, 79.0882, 'el_nino', 0.8);
      expect(impact.zone_key).toBe('central_deccan');
      expect(impact.monsoon_deficit_risk_percent).toBe(65);
      expect(impact.localized_farmer_advice_hi).toContain('मध्य भारत');
    });

    it('handles La Niña conditions with excess moisture predictions', () => {
      const impact = getRegionalElNinoImpact(26.9124, 75.7873, 'la_nina', -0.8);
      expect(impact.excess_rain_risk_percent).toBe(65);
      expect(impact.localized_farmer_advice_hi).toContain('ला नीना');
    });
  });

  describe('2. Autonomous Alert & Prediction API without Manual Admin', () => {
    it('returns real-time GPS location climate risk and prediction via /api/farmer/climate-risk', async () => {
      const res = await request(app)
        .get('/api/farmer/climate-risk')
        .query({ lat: 26.9124, lon: 75.7873, crop: 'wheat' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.location.zone_key).toBe('north_west');
      expect(res.body.el_nino.monsoon_deficit_risk_percent).toBeGreaterThan(0);
      expect(res.body.automated_prediction.is_autonomous).toBe(true);
      expect(res.body.automated_prediction.summary_hi).toBeTruthy();
    });

    it('evaluates and returns automated alerts for registered plots without admin intervention', async () => {
      const plot = {
        id: 'plot_auto_test_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: new Date().toISOString().split('T')[0],
        is_demo: false,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      const adviceRes = await request(app)
        .get(`/api/farmer/plots/${plot.id}/advice`);

      expect(adviceRes.status).toBe(200);
      expect(['active_alert', 'routine_briefing']).toContain(adviceRes.body.type);
      expect(adviceRes.body.level).toBeDefined();
    });

    it('injects localized GPS El Niño advice in conversational voice AI response', async () => {
      const res = await request(app)
        .post('/api/voice/chat')
        .send({
          transcript: 'मौसम कैसा रहेगा',
          lat: 26.9124,
          lon: 75.7873,
          lang: 'hi'
        });

      expect(res.status).toBe(200);
      expect(res.body.spoken_text_hi).toContain('मौसम');
      expect(res.body.location_used.lat).toBe(26.9124);
    });
  });
});
