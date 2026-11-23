import type { AudioSyncAnchor, AudioSyncConfig } from '../types/music';

const MIN_ANCHOR_GAP_MS = 20;
const MIN_EXTRAP_SLOPE = 0.65;
const MAX_EXTRAP_SLOPE = 1.5;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Sorts anchors by tabTimeMs and ensures strictly increasing audioTimeMs
 * so bidirectional piecewise-linear mapping is always invertible and monotonic.
 */
export function normalizeSyncConfig(config: AudioSyncConfig): AudioSyncConfig {
  const tempoScale = clamp(Number.isFinite(config.tempoScale) ? config.tempoScale : 1.0, 0.5, 2.0);
  const fineOffsetMs = Number.isFinite(config.fineOffsetMs) ? Math.round(config.fineOffsetMs) : 0;

  const dedupedByMeasure = new Map<number, AudioSyncAnchor>();
  for (const a of config.anchors) {
    if (!Number.isFinite(a.tabTimeMs) || !Number.isFinite(a.audioTimeMs)) continue;
    dedupedByMeasure.set(a.measureIndex, {
      ...a,
      tabTimeMs: Math.max(0, a.tabTimeMs),
      audioTimeMs: Math.max(0, a.audioTimeMs),
    });
  }

  const sorted = Array.from(dedupedByMeasure.values()).sort(
    (a, b) => a.tabTimeMs - b.tabTimeMs || a.measureIndex - b.measureIndex
  );

  const monotonic: AudioSyncAnchor[] = [];
  for (const a of sorted) {
    if (monotonic.length === 0) {
      monotonic.push(a);
      continue;
    }
    const prev = monotonic[monotonic.length - 1];
    // Skip duplicate tab timestamps
    if (a.tabTimeMs <= prev.tabTimeMs + 1) continue;
    const safeAudioMs = Math.max(prev.audioTimeMs + MIN_ANCHOR_GAP_MS, a.audioTimeMs);
    monotonic.push({
      ...a,
      audioTimeMs: safeAudioMs,
    });
  }

  return {
    anchors: monotonic,
    fineOffsetMs,
    tempoScale,
    ...(config.mode !== undefined ? { mode: config.mode } : {}),
    ...(config.confidence !== undefined ? { confidence: config.confidence } : {}),
    ...(config.detectedSemitoneShift !== undefined
      ? { detectedSemitoneShift: config.detectedSemitoneShift }
      : {}),
  };
}

function getEdgeSlopes(anchors: AudioSyncAnchor[], tempoScale: number): {
  headSlope: number; // dTab / dAudio before first anchor
  tailSlope: number; // dTab / dAudio after last anchor
} {
  if (anchors.length < 2) {
    return { headSlope: tempoScale, tailSlope: tempoScale };
  }
  const first = anchors[0];
  const second = anchors[1];
  const firstAudioDiff = Math.max(MIN_ANCHOR_GAP_MS, second.audioTimeMs - first.audioTimeMs);
  const headSlope = clamp((second.tabTimeMs - first.tabTimeMs) / firstAudioDiff, MIN_EXTRAP_SLOPE, MAX_EXTRAP_SLOPE);

  const penult = anchors[anchors.length - 2];
  const last = anchors[anchors.length - 1];
  const lastAudioDiff = Math.max(MIN_ANCHOR_GAP_MS, last.audioTimeMs - penult.audioTimeMs);
  const tailSlope = clamp((last.tabTimeMs - penult.tabTimeMs) / lastAudioDiff, MIN_EXTRAP_SLOPE, MAX_EXTRAP_SLOPE);

  return { headSlope, tailSlope };
}

/**
 * Converts an audio timestamp (ms) into the mapped tablature timeline timestamp (ms).
 */
export function audioToTabMs(audioMs: number, config: AudioSyncConfig): number {
  const norm = normalizeSyncConfig(config);
  const adjAudioMs = audioMs - norm.fineOffsetMs;
  const { anchors, tempoScale } = norm;

  if (anchors.length === 0) {
    return adjAudioMs * tempoScale;
  }

  if (anchors.length === 1) {
    const a0 = anchors[0];
    return a0.tabTimeMs + (adjAudioMs - a0.audioTimeMs) * tempoScale;
  }

  const { headSlope, tailSlope } = getEdgeSlopes(anchors, tempoScale);

  if (adjAudioMs <= anchors[0].audioTimeMs) {
    return anchors[0].tabTimeMs + (adjAudioMs - anchors[0].audioTimeMs) * headSlope;
  }

  const lastIdx = anchors.length - 1;
  if (adjAudioMs >= anchors[lastIdx].audioTimeMs) {
    return anchors[lastIdx].tabTimeMs + (adjAudioMs - anchors[lastIdx].audioTimeMs) * tailSlope;
  }

  for (let i = 0; i < lastIdx; i++) {
    const left = anchors[i];
    const right = anchors[i + 1];
    if (adjAudioMs >= left.audioTimeMs && adjAudioMs <= right.audioTimeMs) {
      const span = Math.max(1, right.audioTimeMs - left.audioTimeMs);
      const frac = (adjAudioMs - left.audioTimeMs) / span;
      return left.tabTimeMs + frac * (right.tabTimeMs - left.tabTimeMs);
    }
  }

  return adjAudioMs * tempoScale;
}

/**
 * Converts a tablature timeline timestamp (ms) into the corresponding external audio timestamp (ms).
 * Exact inverse of `audioToTabMs` across all piecewise-linear segments.
 */
export function tabToAudioMs(tabMs: number, config: AudioSyncConfig): number {
  const norm = normalizeSyncConfig(config);
  const { anchors, tempoScale, fineOffsetMs } = norm;

  if (anchors.length === 0) {
    return tabMs / tempoScale + fineOffsetMs;
  }

  if (anchors.length === 1) {
    const a0 = anchors[0];
    return a0.audioTimeMs + (tabMs - a0.tabTimeMs) / tempoScale + fineOffsetMs;
  }

  const { headSlope, tailSlope } = getEdgeSlopes(anchors, tempoScale);

  if (tabMs <= anchors[0].tabTimeMs) {
    return anchors[0].audioTimeMs + (tabMs - anchors[0].tabTimeMs) / headSlope + fineOffsetMs;
  }

  const lastIdx = anchors.length - 1;
  if (tabMs >= anchors[lastIdx].tabTimeMs) {
    return anchors[lastIdx].audioTimeMs + (tabMs - anchors[lastIdx].tabTimeMs) / tailSlope + fineOffsetMs;
  }

  for (let i = 0; i < lastIdx; i++) {
    const left = anchors[i];
    const right = anchors[i + 1];
    if (tabMs >= left.tabTimeMs && tabMs <= right.tabTimeMs) {
      const span = Math.max(1, right.tabTimeMs - left.tabTimeMs);
      const frac = (tabMs - left.tabTimeMs) / span;
      return left.audioTimeMs + frac * (right.audioTimeMs - left.audioTimeMs) + fineOffsetMs;
    }
  }

  return tabMs / tempoScale + fineOffsetMs;
}

/**
 * Inserts or updates an anchor for the given measureIndex, keeping adjacent anchors strictly ordered.
 * Note: `desiredAudioMs` is the visible audio position on the waveform (including `fineOffsetMs`).
 */
export function upsertMeasureAnchor(
  config: AudioSyncConfig,
  measureIndex: number,
  tabTimeMs: number,
  desiredAudioMs: number
): AudioSyncConfig {
  const norm = normalizeSyncConfig(config);
  const rawAudioMs = Math.max(0, desiredAudioMs - norm.fineOffsetMs);

  const others = norm.anchors.filter((a) => a.measureIndex !== measureIndex);
  const prevNeighbor = [...others].reverse().find((a) => a.tabTimeMs < tabTimeMs);
  const nextNeighbor = others.find((a) => a.tabTimeMs > tabTimeMs);

  let clampedAudio = rawAudioMs;
  if (prevNeighbor) {
    clampedAudio = Math.max(clampedAudio, prevNeighbor.audioTimeMs + MIN_ANCHOR_GAP_MS);
  }
  if (nextNeighbor) {
    clampedAudio = Math.min(clampedAudio, nextNeighbor.audioTimeMs - MIN_ANCHOR_GAP_MS);
  }
  clampedAudio = Math.max(0, clampedAudio);

  const nextAnchor: AudioSyncAnchor = {
    id: `anchor-m${measureIndex}`,
    measureIndex,
    tabTimeMs: Math.max(0, tabTimeMs),
    audioTimeMs: clampedAudio,
  };

  return normalizeSyncConfig({
    ...norm,
    anchors: [...others, nextAnchor],
  });
}

export function removeAnchorById(config: AudioSyncConfig, id: string): AudioSyncConfig {
  return normalizeSyncConfig({
    ...config,
    anchors: config.anchors.filter((a) => a.id !== id),
  });
}

/**
 * Returns local recording tempo ratio relative to the tab (1.0 = exact tab BPM, <1.0 = recording slower, >1.0 = faster).
 */
export function getSegmentTempoRatio(config: AudioSyncConfig, tabMs: number): number {
  const norm = normalizeSyncConfig(config);
  const { anchors, tempoScale } = norm;
  if (anchors.length < 2) return tempoScale;

  for (let i = 0; i < anchors.length - 1; i++) {
    const left = anchors[i];
    const right = anchors[i + 1];
    if (tabMs <= right.tabTimeMs || i === anchors.length - 2) {
      const audioSpan = Math.max(1, right.audioTimeMs - left.audioTimeMs);
      return (right.tabTimeMs - left.tabTimeMs) / audioSpan;
    }
  }
  return tempoScale;
}
