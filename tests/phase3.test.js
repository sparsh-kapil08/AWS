import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbStore } from '../src/db/store.js';
import farmerRoutes from '../src/routes/farmerRoutes.js';
import { EventService } from '../src/services/eventService.js';

const app = express();
app.use(express.json());
app.use('/api', farmerRoutes);

describe('Phase 3 - Farmer API & Real-time Integration Tests', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Registration Spoken Read-back Confirmation Guard', () => {
    it('REJECTS plot registration when confirmed_readback is false or missing', async () => {
      const res = await request(app)
        .post('/api/register')
        .send({
          farmer_name: 'रामलाल',
          phone: '9876543210',
          lat: 26.9124,
          lon: 75.7873,
          crop: 'wheat',
          sowing_date: '2026-10-01',
          confirmed_readback: false // NOT CONFIRMED
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Never save a plot until the farmer confirms a spoken read-back');
      expect(dbStore.plots.size).toBe(0);
    });

    it('PERMITS plot registration when confirmed_readback is true', async () => {
      const res = await request(app)
        .post('/api/register')
        .send({
          farmer_name: 'रामलाल',
          phone: '9876543210',
          lat: 26.9124,
          lon: 75.7873,
          crop: 'wheat',
          sowing_date: '2026-10-01',
          is_demo: true,
          confirmed_readback: true // CONFIRMED READ-BACK
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.plot.id).toBeDefined();
      expect(dbStore.plots.size).toBe(1);
    });
  });

  describe('2. Active Advice Priority Rule', () => {
    it('returns ACTIVE weather event alert FIRST before routine briefing', async () => {
      // Seed Demo Plot
      const plot = {
        id: 'plot_active_priority',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      // Create Active Event
      await EventService.createOrUpdateEvent({
        type: 'heavy_rain',
        severity: 'red',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 10,
        simulated: true
      });

      // Request advice via API
      const res = await request(app).get(`/api/plots/${plot.id}/advice`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe('active_alert');
      expect(res.body.level).toBe('red');
      expect(res.body.clip_sequence).toBeDefined();
    });
  });

  describe('3. Acknowledgement Submission', () => {
    it('records farmer response (done / cannot / not_my_field)', async () => {
      const alertId = 'alt_test_ack_1';
      dbStore.alerts.set(alertId, {
        id: alertId,
        plot_id: 'plot_1',
        level: 'yellow',
        clip_sequence: ['heavy_rain_coming'],
        reason_key: 'test',
        status: 'created',
        dedupe_key: 'test',
        created_at: new Date().toISOString()
      });

      const res = await request(app)
        .post(`/api/alerts/${alertId}/ack`)
        .send({ response: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const alert = dbStore.alerts.get(alertId);
      expect(alert.status).toBe('acknowledged');
      expect(dbStore.acknowledgements.length).toBe(1);
      expect(dbStore.acknowledgements[0].response).toBe('done');
    });
  });

});
