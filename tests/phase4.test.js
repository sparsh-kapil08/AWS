import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbStore } from '../src/db/store.js';
import adminRoutes from '../src/routes/adminRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

describe('Phase 4 - Admin Console & Rule Editor Integration Tests', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Crop Stage Rule Editor - Preview & Confirmation Flow', () => {
    it('previews affected plots when a rule threshold is updated', async () => {
      // Seed a plot matching wheat CRI
      const plot = {
        id: 'plot_preview_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      const ruleId = 'rule_wheat_cri_rain'; // threshold = 5mm

      // Request preview with lower threshold = 2mm
      const previewRes = await request(app)
        .post(`/api/admin/rules/${ruleId}/preview`)
        .send({ threshold: 2 });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.rule_id).toBe(ruleId);
      expect(previewRes.body.preview).toBeDefined();
      expect(previewRes.body.preview.affected_plots).toBeDefined();
    });

    it('commits updated rule version and creates admin_audit trail on confirm', async () => {
      const ruleId = 'rule_mustard_flowering_frost';
      const ruleBefore = dbStore.cropStageRules.get(ruleId);
      const initialVersion = ruleBefore.version;

      const confirmRes = await request(app)
        .post(`/api/admin/rules/${ruleId}/confirm`)
        .send({
          threshold: 3, // Changed from 4 to 3°C
          source: 'ICAR-2026-FROST-STD',
          user: 'agronomy_admin_lead'
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.rule.version).toBe(initialVersion + 1);
      expect(confirmRes.body.rule.source).toBe('ICAR-2026-FROST-STD');

      // Check admin_audit entry
      expect(dbStore.adminAudit.length).toBeGreaterThan(0);
      const audit = dbStore.adminAudit.find(a => a.action === 'EDIT_CROP_STAGE_RULE');
      expect(audit).toBeDefined();
      expect(audit.who).toBe('agronomy_admin_lead');
    });
  });

  describe('2. Live Admin Dashboard Metrics & Flagged Rules', () => {
    it('returns event stats, plot map levels, and flags PLACEHOLDER rules', async () => {
      // Create active event
      dbStore.events.set('evt_test_dash', {
        id: 'evt_test_dash',
        type: 'heavy_rain',
        severity: 'red',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 10,
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 86400000).toISOString(),
        status: 'active',
        simulated: true,
        created_by: 'admin',
        version: 1,
        created_at: new Date().toISOString()
      });

      const res = await request(app).get('/api/admin/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.event_stats).toBeDefined();
      expect(res.body.event_stats.length).toBeGreaterThan(0);
      
      // Verify unverified PLACEHOLDER rules are flagged
      expect(res.body.flagged_rules).toBeDefined();
      expect(res.body.flagged_rules.length).toBeGreaterThan(0);
      expect(res.body.flagged_rules[0].source).toBe('PLACEHOLDER');
    });

    it('lists unopened alerts older than 10 minutes for helper follow-up', async () => {
      const oldTime = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 mins ago
      dbStore.alerts.set('alt_old_unopened', {
        id: 'alt_old_unopened',
        plot_id: 'plot_1',
        level: 'red',
        clip_sequence: ['heavy_rain_coming'],
        reason_key: 'test',
        status: 'created', // UNOPENED
        dedupe_key: 'test_old',
        created_at: oldTime
      });

      const res = await request(app).get('/api/admin/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.follow_up_alerts).toBeDefined();
      expect(res.body.follow_up_alerts.length).toBe(1);
      expect(res.body.follow_up_alerts[0].id).toBe('alt_old_unopened');
    });
  });

});
