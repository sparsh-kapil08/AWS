import { dbStore } from '../db/store.js';
import { eventBus, ALERT_CREATED, ALERT_SUPERSEDED } from './eventBus.js';

export class AlertPolicyEngine {
  /**
   * Process candidate alert for a plot
   */
  static createOrUpdateAlert({
    plotId,
    eventId = null,
    ruleId = null,
    level,
    clipSequence,
    reasonKey
  }) {
    const dedupeKey = `${plotId}_${ruleId || 'no_rule'}_${eventId || 'no_event'}`;
    const now = new Date().toISOString();

    // Check existing active alert with same dedupe_key
    const existingAlerts = Array.from(dbStore.alerts.values()).filter(a => a.plot_id === plotId);
    const sameDedupe = existingAlerts.find(
      a => a.dedupe_key === dedupeKey && ['created', 'delivered', 'opened', 'played'].includes(a.status)
    );

    if (sameDedupe) {
      // Update existing alert in-place
      sameDedupe.level = level;
      sameDedupe.clip_sequence = clipSequence;
      sameDedupe.reason_key = reasonKey;
      sameDedupe.status = 'created';
      sameDedupe.created_at = now;

      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: sameDedupe.id,
        state: 'created',
        at: now,
        channel: 'event_fanout_update'
      });

      eventBus.emit(ALERT_CREATED, sameDedupe);
      return sameDedupe;
    }

    // Check older active alerts for the plot to supersede
    let supersededId = undefined;
    for (const older of existingAlerts) {
      if (['created', 'delivered', 'opened', 'played'].includes(older.status)) {
        older.status = 'superseded';
        supersededId = older.id;
        dbStore.alertEvents.push({
          id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          alert_id: older.id,
          state: 'superseded',
          at: now,
          channel: 'system_supersede'
        });
        eventBus.emit(ALERT_SUPERSEDED, older);
      }
    }

    // Create new alert
    const alertId = `alt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAlert = {
      id: alertId,
      plot_id: plotId,
      event_id: eventId,
      rule_id: ruleId,
      level,
      clip_sequence: clipSequence,
      reason_key: reasonKey,
      status: 'created',
      supersedes_id: supersededId,
      dedupe_key: dedupeKey,
      created_at: now
    };

    dbStore.alerts.set(alertId, newAlert);

    dbStore.alertEvents.push({
      id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      alert_id: alertId,
      state: 'created',
      at: now,
      channel: 'event_fanout'
    });

    eventBus.emit(ALERT_CREATED, newAlert);
    return newAlert;
  }

  /**
   * Handle event resolution / cancellation for all affected alerts
   */
  static resolveAlertsForEvent(eventId) {
    const now = new Date().toISOString();
    const affectedAlerts = Array.from(dbStore.alerts.values()).filter(
      a => a.event_id === eventId && ['created', 'delivered', 'opened', 'played', 'acknowledged'].includes(a.status)
    );

    const createdAllClearAlerts = [];

    for (const alert of affectedAlerts) {
      alert.status = 'superseded';
      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: alert.id,
        state: 'superseded',
        at: now,
        channel: 'event_resolved'
      });

      // Emit All Clear alert for the plot returning it to green
      const plot = dbStore.plots.get(alert.plot_id);
      const isDemo = plot ? plot.is_demo : false;
      const allClearId = `alt_clear_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      const clipSeq = ['event_all_clear'];
      if (isDemo) clipSeq.unshift('simulated_intro');

      const allClearAlert = {
        id: allClearId,
        plot_id: alert.plot_id,
        event_id: eventId,
        rule_id: undefined,
        level: 'green',
        clip_sequence: clipSeq,
        reason_key: 'event_resolved_all_clear',
        status: 'created',
        supersedes_id: alert.id,
        dedupe_key: `${alert.plot_id}_all_clear_${eventId}`,
        created_at: now
      };

      dbStore.alerts.set(allClearId, allClearAlert);
      dbStore.alertEvents.push({
        id: `ae_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        alert_id: allClearId,
        state: 'created',
        at: now,
        channel: 'event_resolved_all_clear'
      });

      eventBus.emit(ALERT_CREATED, allClearAlert);
      createdAllClearAlerts.push(allClearAlert);
    }

    return createdAllClearAlerts;
  }
}
