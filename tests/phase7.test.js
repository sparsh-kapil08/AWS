/**
 * Phase 7 Tests – El Niño / NOAA ONI Integration
 * Tests:
 *   1. ONI parser (pure-JS service, no network)
 *   2. El Niño auto-event creation via daily job
 *   3. Farmer voice response includes El Niño sentence when active
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElNinoService } from '../src/services/elNinoService.js';
import { dbStore } from '../src/db/store.js';
import { processFarmerVoiceInput } from '../src/services/voiceAiEngine.js';

// ─── Test 1: ONI Parser & Status Detection ──────────────────────────────────

describe('Phase 7-A: ElNinoService – ONI status detection', () => {
  beforeEach(() => {
    ElNinoService.cachedData = null;
  });

  it('detects El Niño when ONI >= +0.5', async () => {
    // Stub global fetch to return mock NOAA ONI text
    const mockOniText = `YEAR SEASON TOTAL ANOM
1950   DJF    27.1  -0.8
2024   JAS    27.4   0.8`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockOniText
    });

    const data = await ElNinoService.fetchElNinoStatus();

    expect(data.status).toBe('el_nino');
    expect(data.latest_oni).toBe(0.8);
    expect(data.season).toBe('JAS');
    expect(data.year).toBe(2024);
    expect(data.sample_size).toBe(2); // 2 data rows parsed
    expect(data.uncertainty_label).toBe('uncertain');
    expect(data.farmer_sentence_hi).toContain('अल नीनो');
  });

  it('detects La Niña when ONI <= -0.5', async () => {
    const mockOniText = `YEAR SEASON TOTAL ANOM
2024   MAM    27.1  -0.9`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockOniText
    });

    const data = await ElNinoService.fetchElNinoStatus();

    expect(data.status).toBe('la_nina');
    expect(data.latest_oni).toBe(-0.9);
    expect(data.farmer_sentence_hi).toContain('ला नीना');
  });

  it('detects neutral when -0.5 < ONI < +0.5', async () => {
    const mockOniText = `YEAR SEASON TOTAL ANOM
2024   SON    27.2   0.2`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockOniText
    });

    const data = await ElNinoService.fetchElNinoStatus();

    expect(data.status).toBe('neutral');
    expect(data.farmer_sentence_hi).toBe('');
  });

  it('falls back to calibrated data when NOAA fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const data = await ElNinoService.fetchElNinoStatus();

    expect(data).toBeDefined();
    expect(['el_nino', 'la_nina', 'neutral']).toContain(data.status);
    expect(data.sample_size).toBe(75); // calibrated fallback value
    expect(data.historical_spread).toHaveProperty('std_dev');
  });

  it('computes historical spread correctly from multiple rows', async () => {
    // Anomalies: -1.0, 0.0, +1.0 → min=-1.0, max=+1.0, mean=0.0, stddev≈0.82
    const mockOniText = `YEAR SEASON TOTAL ANOM
2022   DJF    27.0  -1.0
2023   JAS    27.0   0.0
2024   JAS    27.0   1.0`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockOniText
    });

    const data = await ElNinoService.fetchElNinoStatus();

    expect(data.historical_spread.min).toBe(-1.0);
    expect(data.historical_spread.max).toBe(1.0);
    // std dev of [-1, 0, 1] = sqrt((1+0+1)/3) ≈ 0.82
    expect(data.historical_spread.std_dev).toBeCloseTo(0.82, 1);
  });
});

// ─── Test 2: El Niño Auto-Event in Daily Job ────────────────────────────────

describe('Phase 7-B: Daily Job – El Niño auto-event creation', () => {
  beforeEach(() => {
    dbStore.reset();
    dbStore.seedDefaults();
    ElNinoService.cachedData = null;
  });

  it('creates a dry_spell event when El Niño detected', async () => {
    // Pre-cache El Niño data so daily job doesn't need live fetch
    ElNinoService.cachedData = {
      status: 'el_nino',
      latest_oni: 0.8,
      season: 'JAS',
      year: 2024,
      sample_size: 75,
      historical_spread: { min: -2.0, max: 2.6, std_dev: 0.82 },
      uncertainty_label: 'uncertain',
      farmer_sentence_hi: 'मौसम विभाग के अनुसार अल नीनो के कारण मानसूनी वर्षा में अनिश्चितता की संभावना है।',
      farmer_sentence_en: 'El Niño conditions may cause rainfall uncertainty.',
      fetched_at: new Date().toISOString()
    };

    // Stub global fetch to return cached data immediately
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'YEAR SEASON TOTAL ANOM\n2024 JAS 27.4 0.8',
      json: async () => ({ hourly: { precipitation: [], temperature_2m: [] }, daily: { precipitation_sum: [0,0,0,0,0,0,0], temperature_2m_max: [30,30,30,30,30,30,30], temperature_2m_min: [20,20,20,20,20,20,20] } })
    });

    const { runDailyForecastJob } = await import('../src/services/dailyJob.js');
    const result = await runDailyForecastJob();

    // El Niño data returned in result
    expect(result.el_nino).toBeDefined();

    // A dry_spell event should have been created
    const events = Array.from(dbStore.events.values());
    const elNinoEvent = events.find(e => e.type === 'dry_spell' && e.created_by === 'el_nino_auto_service');
    expect(elNinoEvent).toBeDefined();
    expect(elNinoEvent.simulated).toBe(false);
    expect(elNinoEvent.severity).toBe('yellow');
    expect(elNinoEvent.radius_km).toBe(1000);
  });
});

// ─── Test 3: Voice AI El Niño sentence injection ────────────────────────────

describe('Phase 7-C: Voice AI – El Niño sentence prepended to farmer response', () => {
  beforeEach(() => {
    dbStore.reset();
    dbStore.seedDefaults();
    ElNinoService.cachedData = null;
  });

  it('prepends El Niño sentence when status is el_nino AND query is weather-related', async () => {
    ElNinoService.cachedData = {
      status: 'el_nino',
      latest_oni: 0.8,
      farmer_sentence_hi: 'मौसम विभाग के अनुसार अल नीनो के कारण मानसूनी वर्षा में अनिश्चितता की संभावना है।',
      farmer_sentence_en: 'El Niño uncertainty.',
      fetched_at: new Date().toISOString()
    };

    // Stub fetch for forecast calls inside voiceAiEngine
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: { precipitation: [], temperature_2m: [] },
        daily: {
          precipitation_sum: [0,0,0,0,0,0,0],
          temperature_2m_max: [30,30,30,30,30,30,30],
          temperature_2m_min: [20,20,20,20,20,20,20],
          precipitation_probability_max: [10,10,10,10,10,10,10]
        }
      })
    });

    // Use a weather query – El Niño only injects for weather/rain queries (by design)
    const result = await processFarmerVoiceInput({
      transcript: 'मौसम कैसा रहेगा',
      plotId: null,
      lang: 'hi',
      lat: 26.9124,
      lon: 75.7873
    });

    expect(result.spoken_text_hi).toContain('अल नीनो');
  });

  it('does NOT include El Niño sentence when status is neutral', async () => {
    ElNinoService.cachedData = {
      status: 'neutral',
      latest_oni: 0.1,
      farmer_sentence_hi: '',
      farmer_sentence_en: '',
      fetched_at: new Date().toISOString()
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          precipitation_sum: [0,0,0,0,0,0,0],
          temperature_2m_max: [30,30,30,30,30,30,30],
          temperature_2m_min: [20,20,20,20,20,20,20]
        }
      })
    });

    const result = await processFarmerVoiceInput({
      transcript: 'नमस्ते',
      plotId: null,
      lang: 'hi'
    });

    expect(result.spoken_text_hi).not.toContain('अल नीनो');
    expect(result.spoken_text_hi).not.toContain('ला नीना');
  });
});
