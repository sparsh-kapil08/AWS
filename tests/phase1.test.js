import { describe, it, expect, beforeEach } from 'vitest';
import { calculateDaysSinceSowing, determineCropStage } from '../src/agronomy/stageCalculator.js';
import { evaluateRulesForPlot } from '../src/agronomy/rulesEngine.js';
import { dbStore } from '../src/db/store.js';

describe('Phase 1 - Stage Calculator & Rules Engine Tests (Pure JS)', () => {

  beforeEach(() => {
    dbStore.reset();
  });

  describe('1. Stage Calculator', () => {
    it('calculates days since sowing correctly', () => {
      const referenceDate = new Date('2026-10-15T00:00:00.000Z');
      const days = calculateDaysSinceSowing('2026-10-01', referenceDate);
      expect(days).toBe(14);
    });

    it('maps wheat sowing date to Crown Root Initiation (CRI) stage (days 0-25)', () => {
      const referenceDate = new Date('2026-10-15T00:00:00.000Z');
      const rules = Array.from(dbStore.cropStageRules.values());
      const result = determineCropStage('wheat', '2026-10-01', undefined, rules, referenceDate);
      
      expect(result.crop).toBe('wheat');
      expect(result.stage).toBe('crown_root_initiation');
      expect(result.daysSinceSowing).toBe(14);
      expect(result.isOverride).toBe(false);
    });

    it('maps mustard sowing date to flowering & pod formation (days 31-60)', () => {
      const referenceDate = new Date('2026-11-15T00:00:00.000Z');
      const rules = Array.from(dbStore.cropStageRules.values());
      const result = determineCropStage('mustard', '2026-10-01', undefined, rules, referenceDate);
      
      expect(result.crop).toBe('mustard');
      expect(result.stage).toBe('flowering_pod_formation');
      expect(result.daysSinceSowing).toBe(45);
    });

    it('respects stage_override when specified by farmer/admin', () => {
      const referenceDate = new Date('2026-10-15T00:00:00.000Z');
      const rules = Array.from(dbStore.cropStageRules.values());
      const result = determineCropStage('wheat', '2026-10-01', 'flowering', rules, referenceDate);
      
      expect(result.stage).toBe('flowering');
      expect(result.isOverride).toBe(true);
    });
  });

  describe('2. Rules Engine & Agronomy Logic', () => {
    it('triggers skip_irrigation_rain_expected for wheat CRI when 48h rain >= 5mm', () => {
      const rules = Array.from(dbStore.cropStageRules.values());
      const mockForecast = {
        time: ['2026-10-15', '2026-10-16'],
        temperature_2m_max: [30, 29],
        temperature_2m_min: [18, 17],
        precipitation_sum: [4, 3]
      };

      const results = evaluateRulesForPlot('wheat', 'crown_root_initiation', mockForecast, rules);
      expect(results.length).toBeGreaterThan(0);
      
      const match = results[0];
      expect(match.actionKey).toBe('skip_irrigation_rain_expected');
      expect(match.severity).toBe('yellow');
      expect(match.valueEvaluated).toBe(7);
      expect(match.source).toBe('PLACEHOLDER');
    });

    it('triggers apply_light_irrigation_frost for mustard when temp_min <= 4°C', () => {
      const rules = Array.from(dbStore.cropStageRules.values());
      const mockForecast = {
        time: ['2026-10-15', '2026-10-16'],
        temperature_2m_max: [20, 18],
        temperature_2m_min: [2, 5],
        precipitation_sum: [0, 0]
      };

      const results = evaluateRulesForPlot('mustard', 'flowering_pod_formation', mockForecast, rules);
      expect(results.length).toBeGreaterThan(0);

      const match = results.find(r => r.actionKey === 'apply_light_irrigation_frost');
      expect(match).toBeDefined();
      expect(match?.severity).toBe('red');
      expect(match?.valueEvaluated).toBe(2);
    });

    it('does NOT trigger advice when forecast parameters do not meet thresholds', () => {
      const rules = Array.from(dbStore.cropStageRules.values());
      const mockForecast = {
        time: ['2026-10-15', '2026-10-16'],
        temperature_2m_max: [25, 26],
        temperature_2m_min: [15, 16],
        precipitation_sum: [0, 1]
      };

      const results = evaluateRulesForPlot('wheat', 'crown_root_initiation', mockForecast, rules);
      expect(results.length).toBe(0);
    });
  });

  describe('3. Threshold Provenance Verification', () => {
    it('verifies that all seeded rules contain explicit source column set to PLACEHOLDER', () => {
      const rules = Array.from(dbStore.cropStageRules.values());
      expect(rules.length).toBeGreaterThan(0);

      for (const rule of rules) {
        expect(rule.source).toBeDefined();
        expect(typeof rule.source).toBe('string');
        expect(rule.source.length).toBeGreaterThan(0);
        expect(rule.source).toBe('PLACEHOLDER');
      }
    });
  });

});
