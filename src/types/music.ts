export interface StringVisualStyle {
  name: string;
  color: string;
  glow: string;
  dark: string;
}

/**
 * Rocksmith standard color palette ordered by stringIndex:
 * 0 = lowest/thickest string (e.g. Low E), N-1 = highest/thinnest string (e.g. High e).
 */
export const ROCKSMITH_6_COLORS: StringVisualStyle[] = [
  { name: 'E', color: '#ff3b3b', glow: 'rgba(255, 59, 59, 0.85)', dark: '#7f1d1d' },
  { name: 'A', color: '#facc15', glow: 'rgba(250, 204, 21, 0.85)', dark: '#713f12' },
  { name: 'D', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.85)', dark: '#0c4a6e' },
  { name: 'G', color: '#fb923c', glow: 'rgba(251, 146, 60, 0.85)', dark: '#7c2d12' },
  { name: 'B', color: '#4ade80', glow: 'rgba(74, 222, 128, 0.85)', dark: '#14532d' },
  { name: 'e', color: '#c084fc', glow: 'rgba(192, 132, 252, 0.85)', dark: '#581c87' },
];

export const BASS_4_COLORS: StringVisualStyle[] = [
  ROCKSMITH_6_COLORS[0], // E Red
  ROCKSMITH_6_COLORS[1], // A Yellow
  ROCKSMITH_6_COLORS[2], // D Blue
  ROCKSMITH_6_COLORS[3], // G Orange
];

export const BASS_5_COLORS: StringVisualStyle[] = [
  { name: 'B', color: '#f472b6', glow: 'rgba(244, 114, 182, 0.85)', dark: '#831843' },
  ...BASS_4_COLORS,
];

export const GUITAR_7_COLORS: StringVisualStyle[] = [
  { name: 'B', color: '#f472b6', glow: 'rgba(244, 114, 182, 0.85)', dark: '#831843' },
  ...ROCKSMITH_6_COLORS,
];

export const GUITAR_8_COLORS: StringVisualStyle[] = [
  { name: 'F#', color: '#e2e8f0', glow: 'rgba(226, 232, 240, 0.85)', dark: '#334155' },
  ...GUITAR_7_COLORS,
];

export function getStringPalette(stringCount: number, isBass = false): StringVisualStyle[] {
  if (stringCount <= 4) {
    return BASS_4_COLORS.slice(0, Math.max(1, stringCount));
  }
  if (stringCount === 5) {
    return isBass ? BASS_5_COLORS : ROCKSMITH_6_COLORS.slice(0, 5);
  }
  if (stringCount === 6) {
    return ROCKSMITH_6_COLORS;
  }
  if (stringCount === 7) {
    return GUITAR_7_COLORS;
  }
  if (stringCount === 8) {
    return GUITAR_8_COLORS;
  }
  const result: StringVisualStyle[] = [];
  for (let i = 0; i < stringCount; i++) {
    result.push(ROCKSMITH_6_COLORS[i % ROCKSMITH_6_COLORS.length]);
  }
  return result;
}

export type SlideKind =
  | 'none'
  | 'shift'
  | 'legato'
  | 'intoFromBelow'
  | 'intoFromAbove'
  | 'outUp'
  | 'outDown';

export type HarmonicKind = 'none' | 'natural' | 'artificial' | 'pinch' | 'tap';

export interface NoteTechnique {
  palmMute: boolean;
  deadNote: boolean;
  hammerOn: boolean;
  pullOff: boolean;
  slideType: SlideKind;
  slideTargetFret: number | null;
  bendSemitones: number; // e.g. 1 = half step, 2 = full step (in quarter-tones / 2 or semitones)
  vibrato: boolean;
  harmonic: HarmonicKind;
  accent: boolean;
  ghost: boolean;
  letRing: boolean;
  tieDestination: boolean;
}

export interface HighwayNote {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  startTick: number;
  /** Canonical index: 0 = lowest/thickest string, stringCount - 1 = highest/thinnest string */
  stringIndex: number;
  fret: number;
  isOpen: boolean;
  chordId?: string;
  chordName?: string;
  techniques: NoteTechnique;
  measureIndex: number;
  beatIndex: number;
}

export interface ChordEvent {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  name: string;
  /** Fret per stringIndex (null = string not played) */
  frets: (number | null)[];
  minFret: number;
  maxFret: number;
  isRepeatStrum: boolean;
}

export interface MeasureMarker {
  measureIndex: number;
  unrolledIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  startTick: number;
  endTick: number;
  tempo: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  sectionName?: string;
  beats: number[];
}

export interface ActiveLaneSpan {
  startTimeMs: number;
  endTimeMs: number;
  anchorFret: number;
  spanWidth: number;
}

export interface SongSection {
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  startMeasure: number;
  endMeasure: number;
}

export interface TrackTimeline {
  trackIndex: number;
  name: string;
  shortName: string;
  isPercussion: boolean;
  isBass: boolean;
  stringCount: number;
  /** MIDI note numbers ordered from lowest/thickest string (0) to highest/thinnest string (N-1) */
  tuningMidi: number[];
  tuningName: string;
  capo: number;
  notes: HighwayNote[];
  chords: ChordEvent[];
  lanes: ActiveLaneSpan[];
}

export type SourceFormat = 'gp' | 'musicxml' | 'alphatex' | 'ascii' | 'demo';

export interface SongData {
  id: string;
  title: string;
  artist: string;
  sourceFormat: SourceFormat;
  durationMs: number;
  totalTicks: number;
  measures: MeasureMarker[];
  sections: SongSection[];
  tracks: TrackTimeline[];
  defaultTrackIndex: number;
  drumOnsetsMs: number[];
  hasEmbeddedAudio: boolean;
  rawBytes?: ArrayBuffer;
  alphaTex?: string;
}

export interface TrackMixState {
  volume: number; // 0..1
  muted: boolean;
  solo: boolean;
}

export interface PracticeSettings {
  playbackSpeed: number; // 0.25..1.5
  highwayLookaheadSec: number; // 1.5..5.0
  invertStrings: boolean; // false = Rocksmith (Low E on top), true = Classic tab (High e on top)
  leftHanded: boolean;
  showMiniTab: boolean;
  showFretNumbersOnNotes: boolean;
  countInBars: 0 | 1 | 2;
  metronomeEnabled: boolean;
  metronomeVolume: number; // 0..1
  loopEnabled: boolean;
  loopStartMs: number;
  loopEndMs: number;
  speedTrainerEnabled: boolean;
  speedTrainerStart: number;
  speedTrainerTarget: number;
  speedTrainerStep: number;
  speedTrainerRepsPerStep: number;
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  playbackSpeed: 1.0,
  highwayLookaheadSec: 2.8,
  invertStrings: false,
  leftHanded: false,
  showMiniTab: true,
  showFretNumbersOnNotes: true,
  countInBars: 1,
  metronomeEnabled: false,
  metronomeVolume: 0.65,
  loopEnabled: false,
  loopStartMs: 0,
  loopEndMs: 0,
  speedTrainerEnabled: false,
  speedTrainerStart: 0.6,
  speedTrainerTarget: 1.0,
  speedTrainerStep: 0.05,
  speedTrainerRepsPerStep: 2,
};

export type AudioPlaybackSource = 'synth' | 'external';

export interface AudioSyncAnchor {
  id: string;
  measureIndex: number;
  tabTimeMs: number;
  audioTimeMs: number;
}

export interface AudioSyncConfig {
  anchors: AudioSyncAnchor[];
  /** Shift in ms added to tabToAudioMs: negative moves tab earlier in audio, positive moves tab later */
  fineOffsetMs: number;
  /** Fallback tempo multiplier when < 2 anchors exist (1.0 = identical BPM) */
  tempoScale: number;
  mode?: 'auto' | 'manual';
  confidence?: number; // 0..100
  detectedSemitoneShift?: number; // -2..+2
}

export const DEFAULT_AUDIO_SYNC_CONFIG: AudioSyncConfig = {
  anchors: [],
  fineOffsetMs: 0,
  tempoScale: 1.0,
};

export interface LibrarySongRecord {
  id: string;
  title: string;
  artist: string;
  sourceFormat: SourceFormat;
  createdAt: number;
  lastPlayedAt: number;
  rawBytes?: ArrayBuffer;
  alphaTex?: string;
  audioBlob?: Blob;
  audioFileName?: string;
  audioOffsetMs: number;
  audioSync?: AudioSyncConfig;
  savedLoop?: {
    startMs: number;
    endMs: number;
  };
  isBuiltInDemo?: boolean;
}
