import { dbStore } from '../db/store.js';
import { eventBus, EVENT_CHANGED } from './eventBus.js';
import { FanOutWorker } from './fanOutWorker.js';

export class EventService {
  /**
   * Single service function executing event write, admin audit log, event.changed bus emission, and fan-out
   */
  static async createOrUpdateEvent({
    id,
    type,
    severity,
    center_lat,
    center_lon,
    radius_km,
    starts_at,
    ends_at,
    status = 'active',
    simulated = false,
    created_by = 'admin_console'
  }) {
    const now = new Date().toISOString();
    const eventId = id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const existing = dbStore.events.get(eventId);
    const beforeState = existing ? { ...existing } : null;
    const nextVersion = existing ? existing.version + 1 : 1;

    const eventRecord = {
      id: eventId,
      type,
      severity,
      center_lat,
      center_lon,
      radius_km,
      starts_at: starts_at || now,
      ends_at: ends_at || new Date(Date.now() + 86400000 * 2).toISOString(),
      status,
      simulated: simulated === true || simulated === 'true',
      created_by,
      version: nextVersion,
      created_at: existing ? existing.created_at : now
    };

    // 1. Write event to DB store
    dbStore.events.set(eventId, eventRecord);

    // 2. Write admin audit trail
    const auditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      who: created_by,
      action: existing ? 'UPDATE_EVENT' : 'CREATE_EVENT',
      before: beforeState,
      after: eventRecord,
      at: now
    };
    dbStore.adminAudit.push(auditRecord);

    // 3. Process fan-out worker
    const alerts = await FanOutWorker.processEvent(eventRecord);

    // 4. Emit event.changed on bus
    eventBus.emit(EVENT_CHANGED, {
      event: eventRecord,
      action: existing ? 'UPDATE' : 'CREATE',
      alertsGenerated: alerts.length
    });

    return {
      event: eventRecord,
      audit: auditRecord,
      alerts
    };
  }

  /**
   * Single service function to resolve or cancel an active weather event
   */
  static async resolveOrCancelEvent(eventId, status = 'resolved', user = 'admin_console') {
    const eventRecord = dbStore.events.get(eventId);
    if (!eventRecord) {
      throw new Error(`Event not found: ${eventId}`);
    }

    const beforeState = { ...eventRecord };
    const now = new Date().toISOString();

    eventRecord.status = status;
    eventRecord.version += 1;

    dbStore.events.set(eventId, eventRecord);

    const auditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      who: user,
      action: `RESOLVE_EVENT_${status.toUpperCase()}`,
      before: beforeState,
      after: eventRecord,
      at: now
    };
    dbStore.adminAudit.push(auditRecord);

    // Fan-out worker processes resolution & all-clear alerts
    const alerts = await FanOutWorker.processEvent(eventRecord);

    eventBus.emit(EVENT_CHANGED, {
      event: eventRecord,
      action: 'RESOLVE',
      alertsGenerated: alerts.length
    });

    return {
      event: eventRecord,
      audit: auditRecord,
      alerts
    };
  }
}
