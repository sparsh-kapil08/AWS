import { describe, it, expect, beforeEach } from 'vitest';
import { dbStore } from '../src/db/store.js';
import { EventService } from '../src/services/eventService.js';
import { buildClipSequence } from '../src/services/clipBuilder.js';

describe('Phase 2 - Event Model, Fan-out Worker & Alert Policy Integration Tests', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Strict Simulated Isolation Guard (NON-NEGOTIABLE RULE)', () => {
    it('MUST NEVER create alerts for non-demo plots when an event is simulated', async () => {
      // Seed Demo Plot
      const demoPlot = {
        id: 'plot_demo_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };

      // Seed Non-Demo Real Farmer Plot at identical location
      const realPlot = {
        id: 'plot_real_1',
        farmer_id: 'farmer_2',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: false, // NON-DEMO PLOT
        created_at: new Date().toISOString()
      };

      dbStore.plots.set(demoPlot.id, demoPlot);
      dbStore.plots.set(realPlot.id, realPlot);

      // Admin creates a SIMULATED heavy_rain event
      const result = await EventService.createOrUpdateEvent({
        type: 'heavy_rain',
        severity: 'red',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 15,
        simulated: true, // SIMULATED EVENT
        created_by: 'admin_test'
      });

      expect(result.event.simulated).toBe(true);
      
      // Check produced alerts
      const demoAlerts = Array.from(dbStore.alerts.values()).filter(a => a.plot_id === demoPlot.id);
      const realAlerts = Array.from(dbStore.alerts.values()).filter(a => a.plot_id === realPlot.id);

      // Demo plot receives alert
      expect(demoAlerts.length).toBe(1);
      expect(demoAlerts[0].clip_sequence).toContain('simulated_intro'); // Starts with "यह अभ्यास संदेश है"

      // Non-demo plot MUST receive 0 alerts!
      expect(realAlerts.length).toBe(0);
    });
  });

  describe('2. Admin Action Event Pipeline & Fan-out', () => {
    it('creates weather event, writes admin_audit log, and generates plot alert within radius', async () => {
      const plot = {
        id: 'plot_jaipur_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: false,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      const result = await EventService.createOrUpdateEvent({
        type: 'heavy_rain',
        severity: 'yellow',
        center_lat: 26.9000,
        center_lon: 75.7800,
        radius_km: 10,
        simulated: false,
        created_by: 'admin_user_1'
      });

      expect(result.event.status).toBe('active');
      expect(result.audit.action).toBe('CREATE_EVENT');

      const alerts = Array.from(dbStore.alerts.values());
      expect(alerts.length).toBe(1);
      expect(alerts[0].plot_id).toBe('plot_jaipur_1');
      expect(alerts[0].level).toBe('yellow');
    });

    it('does NOT create alert for plots outside the event radius', async () => {
      const farPlot = {
        id: 'plot_delhi_1',
        farmer_id: 'farmer_delhi',
        lat: 28.6139, // Delhi (~240 km from Jaipur)
        lon: 77.2090,
        crop: 'wheat',
        sowing_date: '2026-10-01',
        is_demo: false,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(farPlot.id, farPlot);

      await EventService.createOrUpdateEvent({
        type: 'heavy_rain',
        severity: 'yellow',
        center_lat: 26.9000, // Jaipur
        center_lon: 75.7800,
        radius_km: 20,
        simulated: false
      });

      const alerts = Array.from(dbStore.alerts.values()).filter(a => a.plot_id === farPlot.id);
      expect(alerts.length).toBe(0);
    });
  });

  describe('3. Deduplication and Supersede Policy', () => {
    it('supersedes older active alert when an event severity is updated', async () => {
      const plot = {
        id: 'plot_dedupe_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'mustard',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      // Create yellow event
      const res1 = await EventService.createOrUpdateEvent({
        type: 'frost',
        severity: 'yellow',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 10,
        simulated: true
      });

      const alert1 = res1.alerts[0];
      expect(alert1.level).toBe('yellow');

      // Update same event to red severity
      const res2 = await EventService.createOrUpdateEvent({
        id: res1.event.id, // SAME EVENT ID
        type: 'frost',
        severity: 'red',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 10,
        simulated: true
      });

      const alert2 = res2.alerts[0];

      // Verification: alert1 status updated or superseded, alert2 active
      expect(alert2.level).toBe('red');
      const activeAlerts = Array.from(dbStore.alerts.values()).filter(
        a => a.plot_id === plot.id && a.status === 'created'
      );
      expect(activeAlerts.length).toBe(1);
    });
  });

  describe('4. Resolution & All Clear Flow', () => {
    it('supersedes alerts and emits green all-clear alert when event is resolved', async () => {
      const plot = {
        id: 'plot_resolve_1',
        farmer_id: 'farmer_1',
        lat: 26.9124,
        lon: 75.7873,
        crop: 'chickpea',
        sowing_date: '2026-10-01',
        is_demo: true,
        created_at: new Date().toISOString()
      };
      dbStore.plots.set(plot.id, plot);

      // 1. Create active event
      const createRes = await EventService.createOrUpdateEvent({
        type: 'heatwave',
        severity: 'red',
        center_lat: 26.9124,
        center_lon: 75.7873,
        radius_km: 10,
        simulated: true
      });

      const initialAlert = createRes.alerts[0];
      expect(initialAlert.status).toBe('created');

      // 2. Admin resolves event
      const resolveRes = await EventService.resolveOrCancelEvent(createRes.event.id, 'resolved');
      
      expect(resolveRes.event.status).toBe('resolved');

      // Check plot's alert state
      const initialUpdated = dbStore.alerts.get(initialAlert.id);
      expect(initialUpdated.status).toBe('superseded');

      const allClearAlerts = Array.from(dbStore.alerts.values()).filter(
        a => a.plot_id === plot.id && a.level === 'green'
      );
      expect(allClearAlerts.length).toBe(1);
      expect(allClearAlerts[0].clip_sequence).toContain('event_all_clear');
    });
  });

});
