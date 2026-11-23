import type { AudioSyncAnchor, AudioSyncConfig, SongData } from '../types/music';
import { normalizeSyncConfig } from './syncMap';

export interface AutoSyncNoteEvent {
  startTimeMs: number;
  endTimeMs: number;
  midi: number;
  isBass: boolean;
}

export interface AutoSyncMeasureInfo {
  unrolledIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

export interface AutoSyncTabPayload {
  durationMs: number;
  measures: AutoSyncMeasureInfo[];
  notes: AutoSyncNoteEvent[];
  drumOnsetsMs: number[];
}

export interface AutoSyncProgress {
  stage: 'audio' | 'coarse' | 'dtw' | 'refine';
  label: string;
  percent: number;
}

export interface AutoSyncResult {
  syncConfig: AudioSyncConfig;
  confidence: number;
  detectedSemitoneShift: number;
  globalTempoRatio: number;
  processingMs: number;
}

const HOP_MS = 50; // 20 frames/sec
const FFT_SIZE = 2048;
const COARSE_FACTOR = 4; // 200ms coarse frames
const SEMITONE_CANDIDATES = [-2, -1, 0, 1, 2];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function buildTabPayload(song: SongData): AutoSyncTabPayload {
  const notes: AutoSyncNoteEvent[] = [];
  for (const track of song.tracks) {
    if (track.isPercussion) continue;
    for (const n of track.notes) {
      if (n.techniques.deadNote) continue;
      const openMidi = track.tuningMidi[n.stringIndex] ?? 40;
      notes.push({
        startTimeMs: n.startTimeMs,
        endTimeMs: n.endTimeMs,
        midi: openMidi + n.fret + track.capo,
        isBass: track.isBass,
      });
    }
  }
  notes.sort((a, b) => a.startTimeMs - b.startTimeMs);

  return {
    durationMs: song.durationMs,
    measures: song.measures.map((m) => ({
      unrolledIndex: m.unrolledIndex,
      startTimeMs: m.startTimeMs,
      endTimeMs: m.endTimeMs,
    })),
    notes,
    drumOnsetsMs: song.drumOnsetsMs ?? [],
  };
}

/** Iterative in-place Radix-2 Cooley-Tukey FFT (length must be power of 2). */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(ang);
    const wLenIm = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

interface FeatureSet {
  nFrames: number;
  chroma: Float32Array; // length = nFrames * 12 (L2-normalized per frame)
  onset: Float32Array; // length = nFrames (0..1)
  energy: Float32Array; // length = nFrames (0..1)
}

function smoothAndNormalizeChroma(raw: Float32Array, nFrames: number, energy: Float32Array): Float32Array {
  const out = new Float32Array(nFrames * 12);
  for (let t = 0; t < nFrames; t++) {
    const tPrev = Math.max(0, t - 1);
    const tNext = Math.min(nFrames - 1, t + 1);
    let normSq = 0;
    const base = t * 12;
    const bPrev = tPrev * 12;
    const bNext = tNext * 12;

    for (let c = 0; c < 12; c++) {
      const v = raw[bPrev + c] * 0.25 + raw[base + c] * 0.5 + raw[bNext + c] * 0.25;
      out[base + c] = v;
      normSq += v * v;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 1e-6 && energy[t] > 0.02) {
      const inv = 1 / norm;
      for (let c = 0; c < 12; c++) {
        out[base + c] *= inv;
      }
    } else {
      for (let c = 0; c < 12; c++) {
        out[base + c] = 0;
      }
    }
  }
  return out;
}

function extractAudioFeatures(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (p: AutoSyncProgress) => void
): { features: FeatureSet; onset10ms: Float32Array } {
  const hopSamples = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  const nFrames = Math.max(1, Math.floor(samples.length / hopSamples));
  const rawChroma = new Float32Array(nFrames * 12);
  const onset = new Float32Array(nFrames);
  const energy = new Float32Array(nFrames);

  // Precompute Hann window
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  // Precompute FFT bin -> chroma pitch-class linear interpolation table (65 Hz .. 2800 Hz)
  const minBin = Math.max(1, Math.floor((65 * FFT_SIZE) / sampleRate));
  const maxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil((2800 * FFT_SIZE) / sampleRate));
  const binCount = Math.max(0, maxBin - minBin + 1);
  const pcLowArr = new Uint8Array(binCount);
  const pcHighArr = new Uint8Array(binCount);
  const wLowArr = new Float32Array(binCount);
  const wHighArr = new Float32Array(binCount);

  for (let i = 0; i < binCount; i++) {
    const k = minBin + i;
    const freq = (k * sampleRate) / FFT_SIZE;
    const midiFloat = 69 + 12 * Math.log2(freq / 440);
    const mLow = Math.floor(midiFloat);
    const frac = midiFloat - mLow;
    const pcLow = ((mLow % 12) + 12) % 12;
    pcLowArr[i] = pcLow;
    pcHighArr[i] = (pcLow + 1) % 12;
    wLowArr[i] = 1 - frac;
    wHighArr[i] = frac;
  }

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  let maxEnergy = 1e-6;
  let maxOnset = 1e-6;
  let prevShortRms = 0;

  for (let f = 0; f < nFrames; f++) {
    if (f % 400 === 0 && onProgress) {
      onProgress({
        stage: 'audio',
        label: 'Extraindo harmonia e batidas do áudio...',
        percent: Math.round(5 + (f / nFrames) * 35),
      });
    }

    // Symmetric Hann window centered slightly after frame start (+25ms) matching [f*50 .. (f+1)*50]
    const frameStart = f * hopSamples;
    const center = frameStart + (hopSamples >> 1);
    const start = center - (FFT_SIZE >> 1);

    // Short 50ms causal RMS for zero-pre-echo onset detection
    let shortRmsSq = 0;
    const shortEnd = Math.min(samples.length, frameStart + hopSamples);
    for (let i = frameStart; i < shortEnd; i++) {
      const s = samples[i];
      shortRmsSq += s * s;
    }
    const shortRms = Math.sqrt(shortRmsSq / Math.max(1, shortEnd - frameStart));
    energy[f] = shortRms;
    if (shortRms > maxEnergy) maxEnergy = shortRms;

    const rise = Math.max(0, shortRms - prevShortRms);
    prevShortRms = shortRms;
    onset[f] = rise;
    if (rise > maxOnset) maxOnset = rise;

    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
      re[i] = s * hann[i];
      im[i] = 0;
    }

    fftInPlace(re, im);

    const base = f * 12;
    const invFft = 1 / FFT_SIZE;
    for (let i = 0; i < binCount; i++) {
      const k = minBin + i;
      const magNorm = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * invFft;
      const energyWeight = magNorm * magNorm;
      rawChroma[base + pcLowArr[i]] += energyWeight * wLowArr[i];
      rawChroma[base + pcHighArr[i]] += energyWeight * wHighArr[i];
    }

    for (let c = 0; c < 12; c++) {
      rawChroma[base + c] = Math.log1p(1200 * rawChroma[base + c]);
    }
  }

  for (let f = 0; f < nFrames; f++) {
    energy[f] /= maxEnergy;
    onset[f] /= maxOnset;
  }

  const chroma = smoothAndNormalizeChroma(rawChroma, nFrames, energy);

  // High-resolution 10ms onset curve for final measure snap
  const win10 = Math.max(1, Math.round(sampleRate * 0.01));
  const n10 = Math.max(1, Math.floor(samples.length / win10));
  const rms10 = new Float32Array(n10);
  for (let w = 0; w < n10; w++) {
    const s0 = w * win10;
    let sumSq = 0;
    for (let i = 0; i < win10; i++) {
      const v = samples[s0 + i];
      sumSq += v * v;
    }
    rms10[w] = Math.sqrt(sumSq / win10);
  }
  const onset10ms = new Float32Array(n10);
  let maxO10 = 1e-6;
  for (let w = 1; w < n10; w++) {
    const d = rms10[w] - rms10[w - 1];
    if (d > 0) {
      onset10ms[w] = d;
      if (d > maxO10) maxO10 = d;
    }
  }
  for (let w = 0; w < n10; w++) {
    onset10ms[w] /= maxO10;
  }

  return {
    features: { nFrames, chroma, onset, energy },
    onset10ms,
  };
}

function extractTabFeatures(payload: AutoSyncTabPayload): FeatureSet {
  const nFrames = Math.max(4, Math.ceil(payload.durationMs / HOP_MS));
  const rawChroma = new Float32Array(nFrames * 12);
  const onset = new Float32Array(nFrames);
  const energy = new Float32Array(nFrames);

  for (const n of payload.notes) {
    const fStart = clamp(Math.round(n.startTimeMs / HOP_MS), 0, nFrames - 1);
    const fEnd = clamp(Math.round(n.endTimeMs / HOP_MS), fStart, nFrames - 1);
    const pc0 = ((n.midi % 12) + 12) % 12;
    const pc5 = (pc0 + 7) % 12; // 3rd harmonic (octave + fifth)
    const pc3 = (pc0 + 4) % 12; // 5th harmonic (major third)
    const baseW = n.isBass ? 1.25 : 1.0;

    onset[fStart] += baseW;
    for (let f = fStart; f <= fEnd; f++) {
      const dtMs = Math.max(0, f * HOP_MS - n.startTimeMs);
      const decay = Math.exp(-dtMs / 480) * baseW;
      const base = f * 12;
      rawChroma[base + pc0] += decay;
      rawChroma[base + pc5] += decay * 0.22;
      rawChroma[base + pc3] += decay * 0.06;
      energy[f] += decay;
    }
  }

  for (const drumMs of payload.drumOnsetsMs) {
    const f = Math.round(drumMs / HOP_MS);
    if (f >= 0 && f < nFrames) {
      onset[f] += 0.9;
      energy[f] += 0.35;
    }
  }

  let maxE = 1e-6;
  let maxO = 1e-6;
  for (let f = 0; f < nFrames; f++) {
    if (energy[f] > maxE) maxE = energy[f];
    if (onset[f] > maxO) maxO = onset[f];
    const base = f * 12;
    for (let c = 0; c < 12; c++) {
      rawChroma[base + c] = Math.log1p(3 * rawChroma[base + c]);
    }
  }

  for (let f = 0; f < nFrames; f++) {
    energy[f] /= maxE;
    onset[f] /= maxO;
  }

  const chroma = smoothAndNormalizeChroma(rawChroma, nFrames, energy);
  return { nFrames, chroma, onset, energy };
}

function downsampleFeatures(fs: FeatureSet, factor: number): FeatureSet {
  const n = Math.max(1, Math.floor(fs.nFrames / factor));
  const chroma = new Float32Array(n * 12);
  const onset = new Float32Array(n);
  const energy = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const baseOut = i * 12;
    let eSum = 0;
    let oMax = 0;
    for (let k = 0; k < factor; k++) {
      const src = i * factor + k;
      const baseIn = src * 12;
      eSum += fs.energy[src];
      if (fs.onset[src] > oMax) oMax = fs.onset[src];
      for (let c = 0; c < 12; c++) {
        chroma[baseOut + c] += fs.chroma[baseIn + c];
      }
    }
    energy[i] = eSum / factor;
    onset[i] = oMax;
    let normSq = 0;
    for (let c = 0; c < 12; c++) normSq += chroma[baseOut + c] * chroma[baseOut + c];
    const norm = Math.sqrt(normSq);
    if (norm > 1e-6) {
      const inv = 1 / norm;
      for (let c = 0; c < 12; c++) chroma[baseOut + c] *= inv;
    }
  }

  return { nFrames: n, chroma, onset, energy };
}

function shiftedChromaDot(
  tabChroma: Float32Array,
  tFrame: number,
  audioChroma: Float32Array,
  aFrame: number,
  semitoneShift: number
): number {
  const tBase = tFrame * 12;
  const aBase = aFrame * 12;
  const shiftMod = ((semitoneShift % 12) + 12) % 12;
  let dot = 0;
  for (let c = 0; c < 12; c++) {
    const shiftedC = (c + shiftMod) % 12;
    dot += tabChroma[tBase + c] * audioChroma[aBase + shiftedC];
  }
  return dot;
}

interface CoarseAlignment {
  semitoneShift: number;
  offset50ms: number;
  tempoRatio: number; // tabTime / audioTime
}

function findCoarseAlignment(
  tabF: FeatureSet,
  audioF: FeatureSet,
  onProgress?: (p: AutoSyncProgress) => void
): CoarseAlignment {
  onProgress?.({
    stage: 'coarse',
    label: 'Detectando início real, andamento e afinação...',
    percent: 44,
  });

  const tabC = downsampleFeatures(tabF, COARSE_FACTOR);
  const audioC = downsampleFeatures(audioF, COARSE_FACTOR);

  // Locate active musical span of the tab so leading/trailing empty bars don't hurt correlation
  let activeStart = 0;
  let activeEnd = tabC.nFrames - 1;
  while (activeStart < tabC.nFrames - 1 && tabC.energy[activeStart] < 0.04) activeStart++;
  while (activeEnd > activeStart && tabC.energy[activeEnd] < 0.04) activeEnd--;
  const activeLen = Math.max(1, activeEnd - activeStart + 1);

  const minOffsetC = -Math.min(150, Math.floor(tabC.nFrames * 0.4));
  const maxOffsetC = Math.max(150, audioC.nFrames - Math.floor(tabC.nFrames * 0.45));

  interface Candidate {
    shift: number;
    offsetC: number;
    score: number;
  }

  const scoreAt = (
    shift: number,
    offsetC: number,
    tempoRatio: number,
    stride: number
  ): number => {
    let simSum = 0;
    let onsetSum = 0;
    let count = 0;

    for (let t = activeStart; t <= activeEnd; t += stride) {
      if (tabC.energy[t] < 0.04) continue;
      const a = Math.round(offsetC + t / tempoRatio);
      if (a < 0 || a >= audioC.nFrames) continue;
      simSum += shiftedChromaDot(tabC.chroma, t, audioC.chroma, a, shift);
      onsetSum += tabC.onset[t] * audioC.onset[a];
      count++;
    }

    const expectedActive = Math.max(1, activeLen / stride);
    if (count < expectedActive * 0.45) return -1;

    const meanSim = simSum / count;
    const meanOnset = onsetSum / count;
    const shiftBonus = shift === 0 ? 0.022 : 0;
    return meanSim + 0.16 * meanOnset + shiftBonus;
  };

  // Pass 1: Broad sweep across semitone shifts & offsets at tempoRatio = 1.0
  const topCandidates: Candidate[] = [];
  const stride1 = activeLen > 300 ? 2 : 1;

  for (const shift of SEMITONE_CANDIDATES) {
    for (let off = minOffsetC; off <= maxOffsetC; off += 1) {
      const sc = scoreAt(shift, off, 1.0, stride1);
      if (sc <= 0) continue;

      // Maintain top 6 well-separated candidates
      const existing = topCandidates.find(
        (c) => c.shift === shift && Math.abs(c.offsetC - off) <= 6
      );
      if (existing) {
        if (sc > existing.score) {
          existing.offsetC = off;
          existing.score = sc;
        }
      } else if (topCandidates.length < 6) {
        topCandidates.push({ shift, offsetC: off, score: sc });
        topCandidates.sort((a, b) => b.score - a.score);
      } else if (sc > topCandidates[topCandidates.length - 1].score) {
        topCandidates[topCandidates.length - 1] = { shift, offsetC: off, score: sc };
        topCandidates.sort((a, b) => b.score - a.score);
      }
    }
  }

  if (topCandidates.length === 0) {
    return { semitoneShift: 0, offset50ms: 0, tempoRatio: 1.0 };
  }

  onProgress?.({
    stage: 'coarse',
    label: 'Refinando velocidade global da gravação...',
    percent: 56,
  });

  // Pass 2: Refine global tempo ratio & exact coarse offset around top candidates
  const tempoRatios = [0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08];
  let bestShift = topCandidates[0].shift;
  let bestOffsetC = topCandidates[0].offsetC;
  let bestRatio = 1.0;
  let bestScore = -1;

  for (const cand of topCandidates) {
    for (const ratio of tempoRatios) {
      for (let dOff = -4; dOff <= 4; dOff += 2) {
        const off = cand.offsetC + dOff;
        const sc = scoreAt(cand.shift, off, ratio, 1);
        if (sc > bestScore) {
          bestScore = sc;
          bestShift = cand.shift;
          bestOffsetC = off;
          bestRatio = ratio;
        }
      }
    }
  }

  return {
    semitoneShift: bestShift,
    offset50ms: bestOffsetC * COARSE_FACTOR,
    tempoRatio: bestRatio,
  };
}

function runBandedDtw(
  tabF: FeatureSet,
  audioF: FeatureSet,
  coarse: CoarseAlignment,
  onProgress?: (p: AutoSyncProgress) => void
): { tabToAudioFrame: Float32Array; meanAlignedSim: number } {
  const nTab = tabF.nFrames;
  const nAudio = audioF.nFrames;
  const bandHalf = clamp(Math.round(nTab * 0.08), 120, 240); // ±6s to ±12s
  const bandW = bandHalf * 2 + 1;

  const centerA = new Int32Array(nTab);
  for (let t = 0; t < nTab; t++) {
    centerA[t] = Math.round(coarse.offset50ms + t / coarse.tempoRatio);
  }

  const localCost = (t: number, a: number): number => {
    if (a < 0 || a >= nAudio) return 1.15;
    const tabQuiet = tabF.energy[t] < 0.04;
    const audQuiet = audioF.energy[a] < 0.035;
    if (tabQuiet && audQuiet) return 0.08;
    if (tabQuiet || audQuiet) return 0.72;

    const sim = shiftedChromaDot(tabF.chroma, t, audioF.chroma, a, coarse.semitoneShift);
    const onsetDiff = Math.abs(tabF.onset[t] - audioF.onset[a]);
    return 0.78 * (1 - sim) + 0.22 * onsetDiff;
  };

  const INF = 1e12;
  let dpPrev2 = new Float32Array(bandW).fill(INF);
  let dpPrev1 = new Float32Array(bandW).fill(INF);
  let dpCurr = new Float32Array(bandW).fill(INF);

  // Backpointers: 0 = start, 1 = (t-1, a-1), 2 = (t-1, a-2), 3 = (t-2, a-1)
  const backPtr = new Uint8Array(nTab * bandW);

  // Free start along t = 0 within the band
  for (let j = 0; j < bandW; j++) {
    const a = centerA[0] + (j - bandHalf);
    if (a >= 0 && a < nAudio) {
      dpPrev1[j] = localCost(0, a);
    }
  }

  for (let t = 1; t < nTab; t++) {
    if (t % 300 === 0 && onProgress) {
      onProgress({
        stage: 'dtw',
        label: 'Alinhando compasso a compasso (DTW)...',
        percent: Math.round(60 + (t / nTab) * 30),
      });
    }

    dpCurr.fill(INF);
    const cNow = centerA[t];
    const shift1 = cNow - centerA[t - 1];
    const shift2 = t >= 2 ? cNow - centerA[t - 2] : 0;
    const rowOffset = t * bandW;

    for (let j = 0; j < bandW; j++) {
      const a = cNow + (j - bandHalf);
      if (a < 0 || a >= nAudio) continue;

      const c0 = localCost(t, a);
      let bestVal = INF;
      let bestStep = 0;

      // Subsequence-unbiased step weights normalized per unit of Δt (= 1.0 * cost per tab frame):
      // Step 1: (t-1, a-1) — Δt = 1
      const j1 = j - 1 + shift1;
      if (j1 >= 0 && j1 < bandW && dpPrev1[j1] < INF) {
        const val = dpPrev1[j1] + c0;
        if (val < bestVal) {
          bestVal = val;
          bestStep = 1;
        }
      }

      // Step 2: (t-1, a-2) — Δt = 1 (audio slower, up to 0.5x tempo)
      const j2 = j - 2 + shift1;
      if (a >= 1 && j2 >= 0 && j2 < bandW && dpPrev1[j2] < INF) {
        const val = dpPrev1[j2] + 0.5 * localCost(t, a - 1) + 0.5 * c0 + 0.025;
        if (val < bestVal) {
          bestVal = val;
          bestStep = 2;
        }
      }

      // Step 3: (t-2, a-1) — Δt = 2 (audio faster, up to 2.0x tempo)
      if (t >= 2) {
        const j3 = j - 1 + shift2;
        if (j3 >= 0 && j3 < bandW && dpPrev2[j3] < INF) {
          const val = dpPrev2[j3] + localCost(t - 1, a) + c0 + 0.05;
          if (val < bestVal) {
            bestVal = val;
            bestStep = 3;
          }
        }
      }

      // Allow clean free-start on t = 1 if t = 0 sat slightly outside audio bounds
      if (t === 1 && bestVal >= INF) {
        bestVal = c0;
        bestStep = 0;
      }

      dpCurr[j] = bestVal;
      backPtr[rowOffset + j] = bestStep;
    }

    const tmp = dpPrev2;
    dpPrev2 = dpPrev1;
    dpPrev1 = dpCurr;
    dpCurr = tmp;
  }

  // Pick optimal endpoint in final row t = nTab - 1
  let bestEndJ = bandHalf;
  let bestEndCost = INF;
  for (let j = 0; j < bandW; j++) {
    const a = centerA[nTab - 1] + (j - bandHalf);
    if (a >= 0 && a < nAudio && dpPrev1[j] < bestEndCost) {
      bestEndCost = dpPrev1[j];
      bestEndJ = j;
    }
  }

  const tabToAudioFrame = new Float32Array(nTab);
  tabToAudioFrame.fill(-1);

  let t = nTab - 1;
  let j = bestEndJ;
  while (t >= 0) {
    const a = centerA[t] + (j - bandHalf);
    tabToAudioFrame[t] = clamp(a, 0, nAudio - 1);

    const step = backPtr[t * bandW + j];
    if (step === 1 && t >= 1) {
      const nextJ = j - 1 + (centerA[t] - centerA[t - 1]);
      t -= 1;
      j = nextJ;
    } else if (step === 2 && t >= 1) {
      const nextJ = j - 2 + (centerA[t] - centerA[t - 1]);
      t -= 1;
      j = nextJ;
    } else if (step === 3 && t >= 2) {
      const prevA = a - 1;
      tabToAudioFrame[t - 1] = clamp((a + prevA) * 0.5, 0, nAudio - 1);
      const nextJ = j - 1 + (centerA[t] - centerA[t - 2]);
      t -= 2;
      j = nextJ;
    } else {
      break;
    }

    if (j < 0 || j >= bandW) break;
  }

  // Fill any unvisited leading frames cleanly using coarse slope
  let firstValid = 0;
  while (firstValid < nTab && tabToAudioFrame[firstValid] < 0) firstValid++;
  if (firstValid >= nTab) {
    for (let i = 0; i < nTab; i++) {
      tabToAudioFrame[i] = clamp(centerA[i], 0, nAudio - 1);
    }
  } else {
    for (let i = firstValid - 1; i >= 0; i--) {
      tabToAudioFrame[i] = Math.max(0, tabToAudioFrame[i + 1] - 1 / coarse.tempoRatio);
    }
  }

  // Compute mean cosine similarity along aligned active frames for confidence metric
  let simSum = 0;
  let simCount = 0;
  for (let i = 0; i < nTab; i++) {
    if (tabF.energy[i] < 0.05) continue;
    const a = clamp(Math.round(tabToAudioFrame[i]), 0, nAudio - 1);
    simSum += shiftedChromaDot(tabF.chroma, i, audioF.chroma, a, coarse.semitoneShift);
    simCount++;
  }

  return {
    tabToAudioFrame,
    meanAlignedSim: simCount > 0 ? simSum / simCount : 0.4,
  };
}

interface MeasurePoint {
  measureIndex: number;
  tabTimeMs: number;
  audioTimeMs: number;
}

/** Ramer-Douglas-Peucker simplification keeping essential tempo-change anchor points. */
function simplifyAnchorsRdp(points: MeasurePoint[], epsilonMs: number): MeasurePoint[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const tabSpan = Math.max(1, last.tabTimeMs - first.tabTimeMs);

  let maxErr = -1;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const frac = (points[i].tabTimeMs - first.tabTimeMs) / tabSpan;
    const expectedAudio = first.audioTimeMs + frac * (last.audioTimeMs - first.audioTimeMs);
    const err = Math.abs(points[i].audioTimeMs - expectedAudio);
    if (err > maxErr) {
      maxErr = err;
      maxIdx = i;
    }
  }

  if (maxErr > epsilonMs) {
    const left = simplifyAnchorsRdp(points.slice(0, maxIdx + 1), epsilonMs);
    const right = simplifyAnchorsRdp(points.slice(maxIdx), epsilonMs);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

export function runAutoSync(
  samples: Float32Array,
  sampleRate: number,
  payload: AutoSyncTabPayload,
  onProgress?: (p: AutoSyncProgress) => void
): AutoSyncResult {
  const tStart = performance.now();

  const { features: audioF, onset10ms } = extractAudioFeatures(samples, sampleRate, onProgress);
  const tabF = extractTabFeatures(payload);
  const coarse = findCoarseAlignment(tabF, audioF, onProgress);
  const { tabToAudioFrame, meanAlignedSim } = runBandedDtw(tabF, audioF, coarse, onProgress);

  onProgress?.({
    stage: 'refine',
    label: 'Ajustando início dos compassos aos ataques reais...',
    percent: 94,
  });

  // Check whether each measure starts with a real musical attack (note or drum)
  const allOnsetsMs: number[] = [
    ...payload.notes.map((n) => n.startTimeMs),
    ...payload.drumOnsetsMs,
  ].sort((a, b) => a - b);

  const hasAttackNear = (ms: number): boolean => {
    let lo = 0;
    let hi = allOnsetsMs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Math.abs(allOnsetsMs[mid] - ms) <= 45) return true;
      if (allOnsetsMs[mid] < ms) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };

  const sampleDtwAudioMs = (tabMs: number): number => {
    const fFloat = clamp(tabMs / HOP_MS, 0, tabToAudioFrame.length - 1);
    const f0 = Math.floor(fFloat);
    const f1 = Math.min(tabToAudioFrame.length - 1, f0 + 1);
    const frac = fFloat - f0;
    const frame = tabToAudioFrame[f0] * (1 - frac) + tabToAudioFrame[f1] * frac;
    return frame * HOP_MS;
  };

  // 1. Sample raw DTW audio timestamps for every measure
  const rawMeasureAudioMs = payload.measures.map((m) => sampleDtwAudioMs(m.startTimeMs));

  // 2. 5-measure median residual filter removes single-bar repeated-riff DTW wobbles
  // while preserving genuine multi-bar drummer tempo drift!
  const baseAudio0 = rawMeasureAudioMs[0] ?? 0;
  const residuals = payload.measures.map(
    (m, idx) => rawMeasureAudioMs[idx] - (baseAudio0 + m.startTimeMs / coarse.tempoRatio)
  );
  const smoothedMeasureAudioMs = payload.measures.map((m, idx) => {
    const win: number[] = [];
    for (let k = Math.max(0, idx - 2); k <= Math.min(residuals.length - 1, idx + 2); k++) {
      win.push(residuals[k]);
    }
    win.sort((a, b) => a - b);
    const medRes = win[win.length >> 1];
    return baseAudio0 + m.startTimeMs / coarse.tempoRatio + medRes;
  });

  const measurePoints: MeasurePoint[] = payload.measures.map((m, idx) => {
    let audioMs = smoothedMeasureAudioMs[idx];

    // Fine 10ms onset snap (±55ms window) when measure beat 1 has an attack
    if (hasAttackNear(m.startTimeMs)) {
      const centerW = Math.round(audioMs / 10);
      const wStart = Math.max(1, centerW - 5);
      const wEnd = Math.min(onset10ms.length - 2, centerW + 5);
      let meanW = 0;
      let countW = 0;
      let bestW = centerW;
      let bestVal = -1;

      for (let w = wStart; w <= wEnd; w++) {
        meanW += onset10ms[w];
        countW++;
        const isPeak = onset10ms[w] >= onset10ms[w - 1] && onset10ms[w] >= onset10ms[w + 1];
        if (isPeak && onset10ms[w] > bestVal) {
          bestVal = onset10ms[w];
          bestW = w;
        }
      }
      meanW = countW > 0 ? meanW / countW : 0;
      if (bestVal >= 0.08 && bestVal >= meanW * 1.35) {
        audioMs = bestW * 10;
      }
    }

    return {
      measureIndex: m.unrolledIndex,
      tabTimeMs: m.startTimeMs,
      audioTimeMs: Math.max(0, Math.round(audioMs)),
    };
  });

  // Enforce monotonic measure spacing
  for (let i = 1; i < measurePoints.length; i++) {
    if (measurePoints[i].audioTimeMs <= measurePoints[i - 1].audioTimeMs + 80) {
      measurePoints[i].audioTimeMs = measurePoints[i - 1].audioTimeMs + 80;
    }
  }

  // Simplify to clean tempo-change anchors via Douglas-Peucker (adaptive epsilon if very long song)
  let simplified = simplifyAnchorsRdp(measurePoints, 42);
  if (simplified.length > 36) {
    simplified = simplifyAnchorsRdp(measurePoints, 75);
  }

  const anchors: AudioSyncAnchor[] = simplified.map((p) => ({
    id: `anchor-m${p.measureIndex}`,
    measureIndex: p.measureIndex,
    tabTimeMs: p.tabTimeMs,
    audioTimeMs: p.audioTimeMs,
  }));

  // Compute honest 5..99% confidence score from aligned chroma similarity
  const confidence = clamp(Math.round(((meanAlignedSim - 0.32) / 0.52) * 100), 5, 99);

  const syncConfig: AudioSyncConfig = normalizeSyncConfig({
    anchors,
    fineOffsetMs: 0,
    tempoScale: coarse.tempoRatio,
    mode: 'auto',
    confidence,
    detectedSemitoneShift: coarse.semitoneShift,
  });

  onProgress?.({
    stage: 'refine',
    label: 'Sincronia automática concluída!',
    percent: 100,
  });

  return {
    syncConfig,
    confidence,
    detectedSemitoneShift: coarse.semitoneShift,
    globalTempoRatio: coarse.tempoRatio,
    processingMs: Math.round(performance.now() - tStart),
  };
}
