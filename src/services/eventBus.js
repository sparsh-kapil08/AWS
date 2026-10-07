import { EventEmitter } from 'node:events';

class AppEventBus extends EventEmitter {}

export const eventBus = new AppEventBus();

// Constants
export const EVENT_CHANGED = 'event.changed';
export const ALERT_CREATED = 'alert.created';
export const ALERT_SUPERSEDED = 'alert.superseded';
export const ALERT_RESOLVED = 'alert.resolved';
