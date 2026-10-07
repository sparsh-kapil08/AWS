import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { dbStore } from '../src/db/store.js';
import { runDailyForecastJob } from '../src/services/dailyJob.js';

describe('Phase 6 - End-to-End Live Flow & Daily Job Integration Tests', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Complete Live End-to-End Flow (Admin Action -> Farmer Client -> Ack -> Dashboard -> All Clear)', () => {
    it('executes full live end-to-end workflow within 5 seconds', async () => {
      // 1. Farmer registers plot (with confirmed read-back)
      const regRes = await request(app)
        .post('/api/register')
        .send({
          farmer_name: 'रामकुमार',
          lat: 26.9124,
          lon: 75.7873,
          crop: 'wheat',
          sowing_date: '2026-10-01',
          is_demo: true,
          confirmed_readback: true
        });

      expect(regRes.status).toBe(200);
      const plotId = regRes.body.plot.id;

      // 2. Admin creates heavy_rain red event
      const eventRes = await request(app)
        .post('/api/admin/events')
        .send({
          type: 'heavy_rain',
          severity: 'red',
          center_lat: 26.9124,
          center_lon: 75.7873,
          radius_km: 15,
          simulated: true,
          created_by: 'admin_live_e2e'
        });

      expect(eventRes.status).toBe(200);
      expect(eventRes.body.success).toBe(true);
      const eventId = eventRes.body.event.id;

      // 3. Farmer client fetches advice -> receives red alert & clip sequence
      const adviceRes = await request(app).get(`/api/plots/${plotId}/advice`);
      expect(adviceRes.status).toBe(200);
      expect(adviceRes.body.type).toBe('active_alert');
      expect(adviceRes.body.level).toBe('red');
      expect(adviceRes.body.clip_sequence).toContain('simulated_intro');
      expect(adviceRes.body.clip_sequence).toContain('heavy_rain_coming');

      const alertId = adviceRes.body.alert.id;

      // 4. Farmer taps ✔ "कर लिया" (done)
      const ackRes = await request(app)
        .post(`/api/alerts/${alertId}/ack`)
        .send({ response: 'done' });

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.success).toBe(true);

      // 5. Admin dashboard shows updated ack counts
      const dashRes = await request(app).get('/api/admin/dashboard');
      expect(dashRes.status).toBe(200);
      const evtStat = dashRes.body.event_stats.find(e => e.event_id === eventId);
      expect(evtStat).toBeDefined();
      expect(evtStat.stats.acked).toBe(1);

      // 6. Admin resolves event
      const resolveRes = await request(app)
        .post(`/api/admin/events/${eventId}/resolve`)
        .send({ status: 'resolved' });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.event.status).toBe('resolved');

      // 7. Farmer client fetches advice -> receives green all-clear state
      const finalAdviceRes = await request(app).get(`/api/plots/${plotId}/advice`);
      expect(finalAdviceRes.status).toBe(200);
      expect(finalAdviceRes.body.level).toBe('green');
      expect(finalAdviceRes.body.clip_sequence).toContain('event_all_clear');
    });
  });

  describe('2. Offline Farmer Reconnect & Stale Alert Handling', () => {
    it('returns pending alerts when offline farmer reconnects', async () => {
      const plotId = 'plot_offline_1';
      dbStore.plots.set(plotId, {
        id: plotId,
        farmer_id: 'f1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      });

      dbStore.alerts.set('alt_pending_offline', {
        id: 'alt_pending_offline',
        plot_id: plotId,
        level: 'yellow',
        clip_sequence: ['heavy_rain_coming'],
        reason_key: 'offline_test',
        status: 'created',
        dedupe_key: 'off_1',
        created_at: new Date().toISOString()
      });

      // Farmer reconnects and polls pending alerts
      const res = await request(app).get(`/api/alerts/pending?plot_id=${plotId}`);
      expect(res.status).toBe(200);
      expect(res.body.alerts.length).toBe(1);
      expect(res.body.alerts[0].id).toBe('alt_pending_offline');
    });
  });

  describe('3. Daily Job Execution', () => {
    it('runs daily forecast job across registered plots using unified rules engine', async () => {
      dbStore.plots.set('plot_daily_1', {
        id: 'plot_daily_1',
        farmer_id: 'farmer_daily',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      });

      const result = await runDailyForecastJob();
      expect(result.plotsEvaluated).toBe(1);
      expect(result.alertsGenerated).toBeDefined();
    });
  });

});
