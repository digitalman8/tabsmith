import { DEFAULT_AUDIO_SYNC_CONFIG, type AudioSyncConfig, type SongData } from '../types/music';
import { normalizeSyncConfig } from './syncMap';

export interface WaveformData {
  durationMs: number;
  sampleRate: number;
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  firstOnsetMs: number;
  /** Anti-aliased mono PCM downsampled to analysisSampleRate (11025 Hz) for fast Auto-Sync DSP */
  analysisMono: Float32Array;
  analysisSampleRate: number;
}

const TARGET_ANALYSIS_SR = 11025;

function downsampleMonoBox(samples: Float32Array, srcRate: number, dstRate: number): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (srcRate <= dstRate * 1.05) {
    return { samples: new Float32Array(samples), sampleRate: srcRate };
  }
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j];
    }
    out[i] = sum / (end - start);
  }
  return { samples: out, sampleRate: dstRate };
}

/**
 * Pure onset detector: scans 10ms RMS windows to skip leading silence/hiss
 * and locate the first sustained musical attack in milliseconds.
 */
export function detectFirstAudioOnsetMs(samples: Float32Array, sampleRate: number): number {
  if (samples.length === 0 || sampleRate <= 0) return 0;

  const windowSize = Math.max(1, Math.floor(sampleRate * 0.01)); // 10ms windows
  const numWindows = Math.floor(samples.length / windowSize);
  if (numWindows === 0) return 0;

  const rmsValues = new Float32Array(numWindows);
  let maxRms = 0;

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    rmsValues[w] = rms;
    if (rms > maxRms) maxRms = rms;
  }

  if (maxRms < 0.005) return 0;

  // Threshold ignores background hiss/tape noise while catching clean acoustic or electric attacks
  const threshold = Math.max(0.02, maxRms * 0.11);

  for (let w = 0; w < numWindows - 1; w++) {
    if (rmsValues[w] >= threshold && rmsValues[w + 1] >= threshold * 0.7) {
      // Backtrack slightly (12ms) to capture the sharp attack transient start
      return Math.max(0, Math.round(w * 10 - 12));
    }
  }

  return 0;
}

export async function decodeAudioToWaveform(
  blob: Blob,
  bucketCount = 3000
): Promise<WaveformData> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error('Web Audio API indisponível neste navegador.');
  }

  const audioCtx = new Ctx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const durationMs = audioBuffer.duration * 1000;

    // Downmix to mono
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const chData = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        mono[i] += chData[i] / channels;
      }
    }

    const firstOnsetMs = detectFirstAudioOnsetMs(mono, sampleRate);

    const safeBuckets = Math.max(100, Math.min(bucketCount, length));
    const peaksMin = new Float32Array(safeBuckets);
    const peaksMax = new Float32Array(safeBuckets);
    const step = length / safeBuckets;

    for (let b = 0; b < safeBuckets; b++) {
      const start = Math.floor(b * step);
      const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * step)));
      let minV = 1;
      let maxV = -1;
      for (let i = start; i < end; i++) {
        const v = mono[i];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      peaksMin[b] = minV;
      peaksMax[b] = maxV;
    }

    const downsampled = downsampleMonoBox(mono, sampleRate, TARGET_ANALYSIS_SR);

    return {
      durationMs,
      sampleRate,
      peaksMin,
      peaksMax,
      firstOnsetMs,
      analysisMono: downsampled.samples,
      analysisSampleRate: downsampled.sampleRate,
    };
  } finally {
    await audioCtx.close().catch(() => {});
  }
}

/**
 * Aligns the first audible transient in the MP3/WAV with the first real note in the tablature
 * so the user starts from a sensible anchor instead of raw 0ms.
 */
export function buildAutoInitialSync(
  songData: SongData | null,
  activeTrackIndex: number,
  firstOnsetMs: number
): AudioSyncConfig {
  if (!songData) {
    return {
      ...DEFAULT_AUDIO_SYNC_CONFIG,
      fineOffsetMs: Math.round(firstOnsetMs),
    };
  }

  const preferredTrack =
    songData.tracks.find((t) => t.trackIndex === activeTrackIndex && !t.isPercussion) ??
    songData.tracks.find((t) => !t.isPercussion && t.notes.length > 0);

  const firstNote = preferredTrack?.notes.find((n) => !n.techniques.deadNote) ?? preferredTrack?.notes[0];
  if (!firstNote) {
    return normalizeSyncConfig({
      anchors: [
        {
          id: 'anchor-m0',
          measureIndex: 0,
          tabTimeMs: 0,
          audioTimeMs: Math.max(0, Math.round(firstOnsetMs)),
        },
      ],
      fineOffsetMs: 0,
      tempoScale: 1.0,
    });
  }

  // If the first sounding note is near measure 0 or offset works cleanly back to bar 1 start
  const bar0AudioMs = firstOnsetMs - firstNote.startTimeMs;
  if (bar0AudioMs >= 0) {
    return normalizeSyncConfig({
      anchors: [
        {
          id: 'anchor-m0',
          measureIndex: 0,
          tabTimeMs: 0,
          audioTimeMs: Math.round(bar0AudioMs),
        },
      ],
      fineOffsetMs: 0,
      tempoScale: 1.0,
    });
  }

  const mIdx = Math.max(0, firstNote.measureIndex);
  const measure = songData.measures[mIdx];
  const measureTabStart = measure?.startTimeMs ?? firstNote.startTimeMs;
  const noteOffsetInMeasure = firstNote.startTimeMs - measureTabStart;

  return normalizeSyncConfig({
    anchors: [
      {
        id: `anchor-m${mIdx}`,
        measureIndex: mIdx,
        tabTimeMs: measureTabStart,
        audioTimeMs: Math.max(0, Math.round(firstOnsetMs - noteOffsetInMeasure)),
      },
    ],
    fineOffsetMs: 0,
    tempoScale: 1.0,
  });
}
