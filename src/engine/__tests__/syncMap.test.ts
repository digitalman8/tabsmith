import { describe, expect, it } from 'vitest';
import {
  audioToTabMs,
  getSegmentTempoRatio,
  removeAnchorById,
  tabToAudioMs,
  upsertMeasureAnchor,
} from '../syncMap';
import { detectFirstAudioOnsetMs } from '../waveformAnalyzer';
import type { AudioSyncConfig } from '../../types/music';

describe('syncMap & waveformAnalyzer', () => {
  it('performs exact bidirectional conversion with 0, 1, and multiple anchors', () => {
    const configs: AudioSyncConfig[] = [
      { anchors: [], fineOffsetMs: 320, tempoScale: 1.0 },
      {
        anchors: [{ id: 'a0', measureIndex: 0, tabTimeMs: 0, audioTimeMs: 1450 }],
        fineOffsetMs: -40,
        tempoScale: 1.0,
      },
      {
        anchors: [
          { id: 'a0', measureIndex: 0, tabTimeMs: 0, audioTimeMs: 1000 },
          { id: 'a4', measureIndex: 4, tabTimeMs: 8000, audioTimeMs: 9200 },
          { id: 'a12', measureIndex: 12, tabTimeMs: 24000, audioTimeMs: 25800 },
        ],
        fineOffsetMs: 75,
        tempoScale: 1.0,
      },
    ];

    for (const cfg of configs) {
      for (const tabMs of [0, 1500, 4000, 8000, 15000, 24000, 30000]) {
        const audioMs = tabToAudioMs(tabMs, cfg);
        const roundTrip = audioToTabMs(audioMs, cfg);
        expect(roundTrip).toBeCloseTo(tabMs, 4);
      }
    }
  });

  it('follows intuitive fineOffsetMs sign convention (negative moves tab earlier in audio)', () => {
    const base: AudioSyncConfig = {
      anchors: [{ id: 'a0', measureIndex: 0, tabTimeMs: 0, audioTimeMs: 2000 }],
      fineOffsetMs: 0,
      tempoScale: 1.0,
    };
    const earlier: AudioSyncConfig = { ...base, fineOffsetMs: -150 };
    const later: AudioSyncConfig = { ...base, fineOffsetMs: 150 };

    expect(tabToAudioMs(1000, base)).toBe(3000);
    expect(tabToAudioMs(1000, earlier)).toBe(2850);
    expect(tabToAudioMs(1000, later)).toBe(3150);
  });

  it('compensates real-world tempo drift between anchors accurately', () => {
    // Tab takes 10000ms, real recording takes 10400ms (1000ms -> 11400ms)
    const cfg: AudioSyncConfig = {
      anchors: [
        { id: 'a0', measureIndex: 0, tabTimeMs: 0, audioTimeMs: 1000 },
        { id: 'a5', measureIndex: 5, tabTimeMs: 10000, audioTimeMs: 11400 },
      ],
      fineOffsetMs: 0,
      tempoScale: 1.0,
    };

    expect(tabToAudioMs(5000, cfg)).toBeCloseTo(6200, 3);
    expect(audioToTabMs(6200, cfg)).toBeCloseTo(5000, 3);
    expect(getSegmentTempoRatio(cfg, 5000)).toBeCloseTo(10000 / 10400, 4);
  });

  it('upserts and removes measure anchors while enforcing monotonicity', () => {
    let cfg: AudioSyncConfig = { anchors: [], fineOffsetMs: 0, tempoScale: 1.0 };
    cfg = upsertMeasureAnchor(cfg, 0, 0, 1000);
    cfg = upsertMeasureAnchor(cfg, 8, 16000, 17500);
    // Attempt to place measure 4 before measure 0's audio time -> safely clamped >= 1020ms
    cfg = upsertMeasureAnchor(cfg, 4, 8000, 500);

    expect(cfg.anchors.length).toBe(3);
    expect(cfg.anchors[0].measureIndex).toBe(0);
    expect(cfg.anchors[1].measureIndex).toBe(4);
    expect(cfg.anchors[1].audioTimeMs).toBeGreaterThan(cfg.anchors[0].audioTimeMs);
    expect(cfg.anchors[2].measureIndex).toBe(8);

    // Update existing measure 4 anchor cleanly
    cfg = upsertMeasureAnchor(cfg, 4, 8000, 9200);
    expect(cfg.anchors.length).toBe(3);
    expect(cfg.anchors[1].audioTimeMs).toBe(9200);

    cfg = removeAnchorById(cfg, 'anchor-m4');
    expect(cfg.anchors.length).toBe(2);
    expect(cfg.anchors.map((a) => a.measureIndex)).toEqual([0, 8]);
  });

  it('detects first musical audio onset skipping leading silence and tiny background noise', () => {
    const sampleRate = 10000;
    const totalSamples = sampleRate * 3; // 3 seconds
    const samples = new Float32Array(totalSamples);

    // Subtle noise floor for first 1.2s
    for (let i = 0; i < sampleRate * 1.2; i++) {
      samples[i] = 0.002 * Math.sin(i * 0.1);
    }

    // Strong guitar transient starting at 1.200s (1200ms)
    for (let i = Math.floor(sampleRate * 1.2); i < totalSamples; i++) {
      samples[i] = 0.65 * Math.sin(i * 0.25);
    }

    const onsetMs = detectFirstAudioOnsetMs(samples, sampleRate);
    expect(onsetMs).toBeGreaterThanOrEqual(1180);
    expect(onsetMs).toBeLessThanOrEqual(1225);
  });
});
