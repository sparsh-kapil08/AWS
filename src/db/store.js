import { SEED_CROP_STAGE_RULES, SEED_AUDIO_CLIPS } from './seedData.js';

export class InStore {
  constructor() {
    this.farmers = new Map();
    this.helpers = new Map();
    this.plots = new Map();
    this.forecastCache = new Map();
    this.cropStageRules = new Map();
    this.audioClips = new Map();
    this.events = new Map();
    this.alerts = new Map();
    this.alertEvents = [];
    this.acknowledgements = [];
    this.adminAudit = [];
    this.seedDefaults();
  }

  seedDefaults() {
    for (const rule of SEED_CROP_STAGE_RULES) {
      this.cropStageRules.set(rule.id, { ...rule });
    }
    for (const clip of SEED_AUDIO_CLIPS) {
      this.audioClips.set(clip.clip_key, { ...clip });
    }
  }

  reset() {
    this.farmers.clear();
    this.helpers.clear();
    this.plots.clear();
    this.forecastCache.clear();
    this.cropStageRules.clear();
    this.audioClips.clear();
    this.events.clear();
    this.alerts.clear();
    this.alertEvents = [];
    this.acknowledgements = [];
    this.adminAudit = [];
    this.seedDefaults();
  }
}

export const dbStore = new InStore();
