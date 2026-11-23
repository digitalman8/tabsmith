import { describe, expect, it } from 'vitest';
import { DEMO_SONGS } from '../../data/demoSongs';
import { loadTabFromAlphaTex } from '../tabLoader';
import { buildTabPayload, runAutoSync } from '../autoSyncEngine';
import { tabToAudioMs } from '../syncMap';

/**
 * Synthesizes a realistic harmonic guitar + bass + percussive waveform at 11025 Hz
 * mapped through an arbitrary ground-truth warp function `tabMs -> audioMs` and optional semitone shift.
 */
function synthesizeWarpedAudio(params: {
  payload: ReturnType<typeof buildTabPayload>;
  sampleRate: number;
  warpTabToAudioMs: (tabMs: number) => number;
  semitoneShift: number;
  trailingSilenceMs?: number;
}): Float32Array {
  const { payload, sampleRate, warpTabToAudioMs, semitoneShift, trailingSilenceMs = 1200 } = params;
  const totalAudioMs = warpTabToAudioMs(payload.durationMs) + trailingSilenceMs;
  const totalSamples = Math.ceil((totalAudioMs / 1000) * sampleRate);
  const out = new Float32Array(totalSamples);

  // Render pitched guitar + bass notes with rich harmonics (simulating electric guitar)
  for (const n of payload.notes) {
    const startAudioMs = warpTabToAudioMs(n.startTimeMs);
    const endAudioMs = warpTabToAudioMs(n.endTimeMs);
    const s0 = Math.max(0, Math.floor((startAudioMs / 1000) * sampleRate));
    const s1 = Math.min(totalSamples, Math.ceil((endAudioMs / 1000) * sampleRate));
    if (s1 <= s0) continue;

    const midi = n.midi + semitoneShift;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const amp = n.isBass ? 0.24 : 0.18;

    for (let i = s0; i < s1; i++) {
      const tSec = (i - s0) / sampleRate;
      const env = Math.exp(-tSec * 3.8) * Math.min(1, tSec / 0.008);
      const phase = 2 * Math.PI * freq * tSec;
      // Rich distorted-like harmonic stack (1st, 2nd, 3rd, 4th harmonics)
      const wave =
        Math.sin(phase) +
        0.55 * Math.sin(phase * 2) +
        0.32 * Math.sin(phase * 3) +
        0.16 * Math.sin(phase * 4);
      out[i] += wave * amp * env;
    }
  }

  // Render percussive drum bursts (kick/snare thump)
  for (const dMs of payload.drumOnsetsMs) {
    const startAudioMs = warpTabToAudioMs(dMs);
    const s0 = Math.max(0, Math.floor((startAudioMs / 1000) * sampleRate));
    const len = Math.floor(0.06 * sampleRate);
    for (let k = 0; k < len && s0 + k < totalSamples; k++) {
      const tSec = k / sampleRate;
      const env = Math.exp(-tSec * 45);
      // Low kick thump + deterministic snare-like high transient
      const thump = Math.sin(2 * Math.PI * (110 - tSec * 700) * tSec) * 0.22;
      const snap = Math.sin(k * 1.73) * Math.cos(k * 0.61) * 0.12;
      out[s0 + k] += (thump + snap) * env;
    }
  }

  // Soft-clip normalize like a mastered studio track
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.tanh(out[i]);
  }
  return out;
}

describe('autoSyncEngine (Chroma + Onset + Banded DTW)', () => {
  it('aligns standard tuning audio with 1.8s intro silence and steady 3% slower tempo', () => {
    const { songData } = loadTabFromAlphaTex(DEMO_SONGS[0].alphaTex, {
      id: 'neon-sync-test',
      title: DEMO_SONGS[0].title,
      sourceFormat: 'demo',
    });
    const payload = buildTabPayload(songData);
    const sampleRate = 11025;

    // Ground truth: 1800ms intro silence + recording plays 3% slower than tab BPM
    const warp = (tabMs: number) => 1800 + tabMs * 1.03;
    const samples = synthesizeWarpedAudio({
      payload,
      sampleRate,
      warpTabToAudioMs: warp,
      semitoneShift: 0,
    });

    const result = runAutoSync(samples, sampleRate, payload);

    expect(result.detectedSemitoneShift).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(65);
    expect(result.syncConfig.anchors.length).toBeGreaterThanOrEqual(2);

    // Measure alignment error across every measure of the song
    const diffs: number[] = [];
    let totalAbsErr = 0;
    for (const m of songData.measures) {
      const predictedAudioMs = tabToAudioMs(m.startTimeMs, result.syncConfig);
      const expectedAudioMs = warp(m.startTimeMs);
      diffs.push(Math.round(predictedAudioMs - expectedAudioMs));
      totalAbsErr += Math.abs(predictedAudioMs - expectedAudioMs);
    }
    const meanAbsErrMs = totalAbsErr / songData.measures.length;
    expect(meanAbsErrMs, `diffs(ms): ${diffs.join(', ')}`).toBeLessThan(45);
  });

  it('recovers alignment under 2.4s silence, non-linear tempo drift (-4% then +3%), and Eb (-1 semitone) detuning', () => {
    const { songData } = loadTabFromAlphaTex(DEMO_SONGS[0].alphaTex, {
      id: 'neon-drift-eb-test',
      title: DEMO_SONGS[0].title,
      sourceFormat: 'demo',
    });
    const payload = buildTabPayload(songData);
    const sampleRate = 11025;
    const midMs = songData.durationMs * 0.5;

    // Ground truth: 2400ms intro silence, first half 4% slower (1.04x), second half 3% faster (0.97x)
    const warp = (tabMs: number) => {
      if (tabMs <= midMs) {
        return 2400 + tabMs * 1.04;
      }
      return 2400 + midMs * 1.04 + (tabMs - midMs) * 0.97;
    };

    const samples = synthesizeWarpedAudio({
      payload,
      sampleRate,
      warpTabToAudioMs: warp,
      semitoneShift: -1, // Eb Standard studio recording vs E Standard tab!
    });

    const result = runAutoSync(samples, sampleRate, payload);

    expect(result.detectedSemitoneShift).toBe(-1);
    expect(result.confidence).toBeGreaterThanOrEqual(60);

    const diffs: number[] = [];
    let totalAbsErr = 0;
    for (const m of songData.measures) {
      const predictedAudioMs = tabToAudioMs(m.startTimeMs, result.syncConfig);
      const expectedAudioMs = warp(m.startTimeMs);
      diffs.push(Math.round(predictedAudioMs - expectedAudioMs));
      totalAbsErr += Math.abs(predictedAudioMs - expectedAudioMs);
    }
    const meanAbsErrMs = totalAbsErr / songData.measures.length;
    expect(meanAbsErrMs, `diffs(ms): ${diffs.join(', ')}`).toBeLessThan(60);
  });
});
