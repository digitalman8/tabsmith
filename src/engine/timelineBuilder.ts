import * as alphaTab from '@coderline/alphatab';
import type {
  ActiveLaneSpan,
  ChordEvent,
  HarmonicKind,
  HighwayNote,
  MeasureMarker,
  NoteTechnique,
  SlideKind,
  SongData,
  SongSection,
  SourceFormat,
  TrackTimeline,
} from '../types/music';

interface TempoPoint {
  tick: number;
  tempo: number;
  ms: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToNoteLabel(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[pc];
}

function detectTuningName(tuningLowToHigh: number[], isBass: boolean, fallbackName: string): string {
  const key = tuningLowToHigh.join(',');
  const presets: Record<string, string> = {
    '40,45,50,55,59,64': 'E Standard',
    '38,45,50,55,59,64': 'Drop D',
    '39,44,49,54,58,63': 'Eb Standard',
    '38,43,48,53,57,62': 'D Standard',
    '36,43,48,53,57,62': 'Drop C',
    '36,41,46,51,55,60': 'C Standard',
    '40,45,50,55,57,64': 'DADGAD',
    '38,45,50,54,57,62': 'Open D',
    '38,43,50,55,59,62': 'Open G',
    '28,33,38,43': 'Bass 4 Standard (E A D G)',
    '26,33,38,43': 'Bass 4 Drop D',
    '23,28,33,38,43': 'Bass 5 Standard (B E A D G)',
    '35,40,45,50,55,59,64': '7-String Standard',
  };
  if (presets[key]) {
    return presets[key];
  }
  if (fallbackName && fallbackName.trim().length > 0 && fallbackName.toLowerCase() !== 'default') {
    return fallbackName.trim();
  }
  const labels = tuningLowToHigh.map(midiToNoteLabel).join(' ');
  return isBass ? `Baixo (${labels})` : labels || 'Standard';
}

function mapSlideOut(slideOut: alphaTab.model.SlideOutType): SlideKind {
  switch (slideOut) {
    case alphaTab.model.SlideOutType.Shift:
      return 'shift';
    case alphaTab.model.SlideOutType.Legato:
      return 'legato';
    case alphaTab.model.SlideOutType.OutUp:
    case alphaTab.model.SlideOutType.PickSlideUp:
      return 'outUp';
    case alphaTab.model.SlideOutType.OutDown:
    case alphaTab.model.SlideOutType.PickSlideDown:
      return 'outDown';
    default:
      return 'none';
  }
}

function mapSlideIn(slideIn: alphaTab.model.SlideInType): SlideKind {
  switch (slideIn) {
    case alphaTab.model.SlideInType.IntoFromBelow:
      return 'intoFromBelow';
    case alphaTab.model.SlideInType.IntoFromAbove:
      return 'intoFromAbove';
    default:
      return 'none';
  }
}

function mapHarmonic(harmonic: alphaTab.model.HarmonicType): HarmonicKind {
  switch (harmonic) {
    case alphaTab.model.HarmonicType.Natural:
      return 'natural';
    case alphaTab.model.HarmonicType.Artificial:
      return 'artificial';
    case alphaTab.model.HarmonicType.Pinch:
      return 'pinch';
    case alphaTab.model.HarmonicType.Tap:
      return 'tap';
    case alphaTab.model.HarmonicType.Semi:
    case alphaTab.model.HarmonicType.Feedback:
      return 'artificial';
    default:
      return 'none';
  }
}

function inferChordName(notes: HighwayNote[], tuningLowToHigh: number[]): string {
  if (notes.length < 2) return '';
  const pitches = Array.from(
    new Set(
      notes
        .map((n) => {
          const openMidi = tuningLowToHigh[n.stringIndex] ?? 40;
          return openMidi + n.fret;
        })
        .sort((a, b) => a - b)
    )
  );
  if (pitches.length < 2) return '';

  const rootMidi = pitches[0];
  const rootName = midiToNoteLabel(rootMidi);
  const intervals = new Set(pitches.map((p) => (p - rootMidi) % 12));

  if (intervals.size === 2 && intervals.has(7)) {
    return `${rootName}5`;
  }
  if (intervals.has(4) && intervals.has(7)) {
    if (intervals.has(10)) return `${rootName}7`;
    if (intervals.has(11)) return `${rootName}maj7`;
    return rootName;
  }
  if (intervals.has(3) && intervals.has(7)) {
    if (intervals.has(10)) return `${rootName}m7`;
    return `${rootName}m`;
  }
  if (intervals.has(5) && intervals.has(7)) {
    return `${rootName}sus4`;
  }
  if (intervals.has(2) && intervals.has(7)) {
    return `${rootName}sus2`;
  }
  if (intervals.has(3) && intervals.has(6)) {
    return `${rootName}dim`;
  }
  return rootName;
}

/**
 * Computes Rocksmith-style active fret lanes (4-5 fret windows) with hysteresis
 * so the highlighted lane and camera stay steady during riffs and shift smoothly
 * when moving to another fretboard region.
 */
export function computeActiveLanes(
  notes: HighwayNote[],
  songDurationMs: number,
  spanWidth = 5
): ActiveLaneSpan[] {
  const safeDuration = Math.max(songDurationMs, 1000);
  const fretted = notes
    .filter((n) => n.fret > 0 && !n.techniques.deadNote)
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  if (fretted.length === 0) {
    return [{ startTimeMs: 0, endTimeMs: safeDuration, anchorFret: 1, spanWidth }];
  }

  const maxAnchor = Math.max(1, 24 - spanWidth + 1);
  const clampAnchor = (f: number) => Math.max(1, Math.min(maxAnchor, Math.round(f)));

  // Group fretted notes into contiguous position windows of at most (spanWidth - 1) spread
  interface Segment {
    startMs: number;
    endMs: number;
    minFret: number;
    maxFret: number;
  }

  const segments: Segment[] = [];
  let cur: Segment = {
    startMs: fretted[0].startTimeMs,
    endMs: fretted[0].endTimeMs,
    minFret: fretted[0].fret,
    maxFret: fretted[0].fret,
  };

  for (let i = 1; i < fretted.length; i++) {
    const n = fretted[i];
    const nextMin = Math.min(cur.minFret, n.fret);
    const nextMax = Math.max(cur.maxFret, n.fret);
    const timeGap = n.startTimeMs - cur.endMs;

    if (nextMax - nextMin <= spanWidth - 1 && timeGap < 4000) {
      cur.minFret = nextMin;
      cur.maxFret = nextMax;
      cur.endMs = Math.max(cur.endMs, n.endTimeMs);
    } else {
      segments.push(cur);
      cur = {
        startMs: n.startTimeMs,
        endMs: n.endTimeMs,
        minFret: n.fret,
        maxFret: n.fret,
      };
    }
  }
  segments.push(cur);

  // Convert segments into continuous ActiveLaneSpan timeline with hysteresis
  const rawSpans: ActiveLaneSpan[] = [];
  let activeAnchor = clampAnchor(
    segments[0].minFret <= 4 && segments[0].maxFret <= spanWidth ? 1 : segments[0].minFret
  );

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const fitsCurrent =
      seg.minFret >= activeAnchor && seg.maxFret <= activeAnchor + spanWidth - 1;

    if (!fitsCurrent) {
      if (seg.maxFret <= spanWidth && seg.minFret <= 3) {
        activeAnchor = 1;
      } else {
        // Position anchor so minFret sits nicely at start or centered if smaller than span
        const spread = seg.maxFret - seg.minFret;
        const paddingBefore = Math.floor((spanWidth - 1 - spread) / 2);
        activeAnchor = clampAnchor(seg.minFret - Math.max(0, paddingBefore));
      }
    }

    const prevEnd = i === 0 ? 0 : rawSpans[rawSpans.length - 1].endTimeMs;
    const spanStart = i === 0 ? 0 : prevEnd;
    const nextSeg = segments[i + 1];
    const spanEnd = nextSeg ? (seg.endMs + nextSeg.startMs) * 0.5 : safeDuration;

    if (rawSpans.length > 0 && rawSpans[rawSpans.length - 1].anchorFret === activeAnchor) {
      rawSpans[rawSpans.length - 1].endTimeMs = spanEnd;
    } else {
      rawSpans.push({
        startTimeMs: spanStart,
        endTimeMs: Math.max(spanStart, spanEnd),
        anchorFret: activeAnchor,
        spanWidth,
      });
    }
  }

  if (rawSpans.length > 0) {
    rawSpans[0].startTimeMs = 0;
    rawSpans[rawSpans.length - 1].endTimeMs = safeDuration;
  }

  return rawSpans;
}

export interface BuildSongOptions {
  id: string;
  title?: string;
  artist?: string;
  sourceFormat: SourceFormat;
  rawBytes?: ArrayBuffer;
  alphaTex?: string;
}

export function buildSongData(score: alphaTab.model.Score, options: BuildSongOptions): SongData {
  const settings = new alphaTab.Settings();
  const midiFile = new alphaTab.midi.MidiFile();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile);
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();

  const division = midiFile.division || 960;
  const tickShift = handler.tickShift || 0;
  const masterBarLookups = generator.tickLookup.masterBars;

  // Build ordered tempo map from tickLookup.masterBars
  const rawTempoChanges = new Map<number, number>();
  rawTempoChanges.set(0, score.tempo > 0 ? score.tempo : 120);

  for (const mbLookup of masterBarLookups) {
    for (const tc of mbLookup.tempoChanges) {
      if (tc.tempo > 0) {
        rawTempoChanges.set(Math.max(0, tc.tick + tickShift), tc.tempo);
      }
    }
  }

  const sortedTicks = Array.from(rawTempoChanges.keys()).sort((a, b) => a - b);
  const tempoPoints: TempoPoint[] = [];
  let accMs = 0;

  for (let i = 0; i < sortedTicks.length; i++) {
    const tick = sortedTicks[i];
    const tempo = rawTempoChanges.get(tick)!;
    if (i > 0) {
      const prev = tempoPoints[i - 1];
      const deltaTicks = tick - prev.tick;
      accMs += (deltaTicks * 60000) / (prev.tempo * division);
    }
    tempoPoints.push({ tick, tempo, ms: accMs });
  }

  const tickToMs = (tick: number): number => {
    const safeTick = Math.max(0, tick);
    let idx = 0;
    for (let i = tempoPoints.length - 1; i >= 0; i--) {
      if (tempoPoints[i].tick <= safeTick) {
        idx = i;
        break;
      }
    }
    const p = tempoPoints[idx];
    return p.ms + ((safeTick - p.tick) * 60000) / (p.tempo * division);
  };

  const tempoAtTick = (tick: number): number => {
    for (let i = tempoPoints.length - 1; i >= 0; i--) {
      if (tempoPoints[i].tick <= tick) {
        return tempoPoints[i].tempo;
      }
    }
    return tempoPoints[0]?.tempo ?? 120;
  };

  // Extract unrolled measures
  const measures: MeasureMarker[] = [];
  let totalTicks = 0;

  for (let i = 0; i < masterBarLookups.length; i++) {
    const mbLookup = masterBarLookups[i];
    const startTick = mbLookup.start + tickShift;
    const endTick = mbLookup.end + tickShift;
    totalTicks = Math.max(totalTicks, endTick);

    const mb = mbLookup.masterBar;
    const num = mb.timeSignatureNumerator || 4;
    const den = mb.timeSignatureDenominator || 4;
    const beatLengthTicks = division * (4 / den);

    const beats: number[] = [];
    for (let bt = startTick; bt < endTick - 1; bt += beatLengthTicks) {
      beats.push(tickToMs(bt));
    }

    measures.push({
      measureIndex: mb.index,
      unrolledIndex: i,
      startTimeMs: tickToMs(startTick),
      endTimeMs: tickToMs(endTick),
      startTick,
      endTick,
      tempo: tempoAtTick(startTick),
      timeSignatureNumerator: num,
      timeSignatureDenominator: den,
      sectionName: mb.section?.text?.trim() || undefined,
      beats,
    });
  }

  const durationMs =
    measures.length > 0 ? measures[measures.length - 1].endTimeMs : tickToMs(totalTicks);

  // Extract sections
  const sections: SongSection[] = [];
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    if (m.sectionName) {
      if (sections.length > 0) {
        sections[sections.length - 1].endTimeMs = m.startTimeMs;
        sections[sections.length - 1].endMeasure = i - 1;
      }
      sections.push({
        name: m.sectionName,
        startTimeMs: m.startTimeMs,
        endTimeMs: durationMs,
        startMeasure: i,
        endMeasure: measures.length - 1,
      });
    }
  }

  // Fallback sections when score has none and has > 4 measures
  if (sections.length === 0 && measures.length > 0) {
    const chunkSize = measures.length <= 8 ? measures.length : 4;
    for (let i = 0; i < measures.length; i += chunkSize) {
      const endIdx = Math.min(measures.length - 1, i + chunkSize - 1);
      sections.push({
        name: `Comp. ${i + 1}–${endIdx + 1}`,
        startTimeMs: measures[i].startTimeMs,
        endTimeMs: measures[endIdx].endTimeMs,
        startMeasure: i,
        endMeasure: endIdx,
      });
    }
  }

  // Extract notes and chords per track across unrolled MasterBarTickLookups
  const rawDrumOnsets: number[] = [];

  const tracks: TrackTimeline[] = score.tracks.map((track) => {
    const primaryStaff = track.staves.find((s) => s.isStringed) ?? track.staves[0];
    const isPercussion = Boolean(primaryStaff?.isPercussion);
    const rawTuningTopToBottom = primaryStaff?.tuning ? [...primaryStaff.tuning] : [64, 59, 55, 50, 45, 40];
    const tuningLowToHigh = [...rawTuningTopToBottom].reverse();
    const stringCount = Math.max(1, tuningLowToHigh.length);
    const program = track.playbackInfo?.program ?? 25;
    const isBass =
      !isPercussion &&
      ((program >= 32 && program <= 39) ||
        track.name.toLowerCase().includes('bass') ||
        track.name.toLowerCase().includes('baixo') ||
        (stringCount <= 5 && (tuningLowToHigh[0] ?? 40) < 35));

    const tuningName = isPercussion
      ? 'Percussão'
      : detectTuningName(tuningLowToHigh, isBass, primaryStaff?.tuningName ?? '');

    const notes: HighwayNote[] = [];
    const chords: ChordEvent[] = [];

    if (isPercussion && primaryStaff) {
      for (let barIdx = 0; barIdx < masterBarLookups.length; barIdx++) {
        const mbLookup = masterBarLookups[barIdx];
        const barStartTick = mbLookup.start + tickShift;
        const seenBeatIds = new Set<number>();
        let slice = mbLookup.firstBeat;
        while (slice) {
          for (const item of slice.highlightedBeats) {
            const beat = item.beat;
            if (beat.voice.bar.staff.track.index !== track.index) continue;
            if (seenBeatIds.has(beat.id)) continue;
            seenBeatIds.add(beat.id);
            if (!beat.isRest && beat.notes.length > 0) {
              rawDrumOnsets.push(tickToMs(barStartTick + item.playbackStart));
            }
          }
          slice = slice.nextBeat;
        }
      }
    }

    if (!isPercussion && primaryStaff) {
      const activeTieByString = new Map<number, HighwayNote>();
      let prevChordSignature = '';
      let prevChordStartMs = -Infinity;

      for (let barIdx = 0; barIdx < masterBarLookups.length; barIdx++) {
        const mbLookup = masterBarLookups[barIdx];
        const barStartTick = mbLookup.start + tickShift;
        const measure = measures[barIdx];
        const seenBeatIds = new Set<number>();

        interface BeatCandidate {
          beat: alphaTab.model.Beat;
          startTick: number;
        }
        const barBeats: BeatCandidate[] = [];

        let slice = mbLookup.firstBeat;
        while (slice) {
          for (const item of slice.highlightedBeats) {
            const beat = item.beat;
            if (beat.voice.bar.staff.track.index !== track.index) continue;
            if (beat.voice.bar.staff.index !== primaryStaff.index) continue;
            if (seenBeatIds.has(beat.id)) continue;
            seenBeatIds.add(beat.id);
            barBeats.push({
              beat,
              startTick: barStartTick + item.playbackStart,
            });
          }
          slice = slice.nextBeat;
        }

        barBeats.sort((a, b) => a.startTick - b.startTick);

        for (let bIdx = 0; bIdx < barBeats.length; bIdx++) {
          const { beat, startTick } = barBeats[bIdx];
          if (beat.isRest || beat.notes.length === 0) {
            continue;
          }

          const startTimeMs = tickToMs(startTick);
          const durationTicks = Math.max(1, beat.playbackDuration);
          const endTimeMs = tickToMs(startTick + durationTicks);
          const durationMs = Math.max(30, endTimeMs - startTimeMs);

          const beatNotes: HighwayNote[] = [];
          const explicitChordName = beat.chord?.name?.trim() || '';

          for (const note of beat.notes) {
            if (!note.isVisible) continue;
            if (note.string < 1 || note.string > stringCount) continue;

            const stringIndex = note.string - 1; // 0 = lowest/thickest, N-1 = highest/thinnest

            // Merge tied destination into the sounding origin note
            if (note.isTieDestination) {
              const prevNote = activeTieByString.get(stringIndex);
              if (prevNote) {
                prevNote.endTimeMs = Math.max(prevNote.endTimeMs, endTimeMs);
                prevNote.durationMs = prevNote.endTimeMs - prevNote.startTimeMs;
                continue;
              }
            }

            const slideOut = mapSlideOut(note.slideOutType);
            const slideIn = mapSlideIn(note.slideInType);
            const slideType: SlideKind = slideOut !== 'none' ? slideOut : slideIn;
            const slideTargetFret =
              note.slideTarget && note.slideTarget.fret >= 0 ? note.slideTarget.fret : null;

            const maxBendVal = note.maxBendPoint?.value ?? 0;
            // alphaTab bend value is in quarter-tones (4 = 2 semitones / full step)
            const bendSemitones = maxBendVal > 0 ? maxBendVal / 2 : 0;

            const isHammerDest = note.isHammerPullDestination;
            const originFret = note.hammerPullOrigin?.fret;
            const hammerOn =
              isHammerDest && originFret !== undefined && note.fret > originFret;
            const pullOff =
              isHammerDest && originFret !== undefined && note.fret < originFret;

            const techniques: NoteTechnique = {
              palmMute: note.isPalmMute || beat.isPalmMute,
              deadNote: note.isDead,
              hammerOn,
              pullOff,
              slideType,
              slideTargetFret,
              bendSemitones,
              vibrato:
                note.vibrato !== alphaTab.model.VibratoType.None ||
                beat.vibrato !== alphaTab.model.VibratoType.None,
              harmonic: mapHarmonic(note.harmonicType),
              accent: note.accentuated !== alphaTab.model.AccentuationType.None,
              ghost: note.isGhost,
              letRing: note.isLetRing || beat.isLetRing,
              tieDestination: note.isTieDestination,
            };

            const hwNote: HighwayNote = {
              id: `t${track.index}-m${barIdx}-b${bIdx}-s${stringIndex}`,
              startTimeMs,
              endTimeMs,
              durationMs,
              startTick,
              stringIndex,
              fret: Math.max(0, note.fret),
              isOpen: note.fret === 0 && !note.isDead,
              techniques,
              measureIndex: barIdx,
              beatIndex: bIdx,
            };

            activeTieByString.set(stringIndex, hwNote);
            beatNotes.push(hwNote);
          }

          if (beatNotes.length >= 2) {
            const chordId = `chord-t${track.index}-m${barIdx}-b${bIdx}`;
            const chordName = explicitChordName || inferChordName(beatNotes, tuningLowToHigh);
            const frets: (number | null)[] = new Array(stringCount).fill(null);
            let minFret = 24;
            let maxFret = 0;

            for (const bn of beatNotes) {
              bn.chordId = chordId;
              bn.chordName = chordName;
              frets[bn.stringIndex] = bn.fret;
              if (bn.fret > 0) {
                minFret = Math.min(minFret, bn.fret);
                maxFret = Math.max(maxFret, bn.fret);
              }
            }

            if (minFret > maxFret) {
              minFret = 0;
              maxFret = 0;
            }

            const sig = frets.map((f) => (f === null ? '-' : String(f))).join(',');
            const beatDurLimit = (60000 / (measure?.tempo || 120)) * 2.1;
            const isRepeatStrum =
              sig === prevChordSignature && startTimeMs - prevChordStartMs <= beatDurLimit;

            prevChordSignature = sig;
            prevChordStartMs = startTimeMs;

            chords.push({
              id: chordId,
              startTimeMs,
              endTimeMs,
              name: chordName,
              frets,
              minFret,
              maxFret,
              isRepeatStrum,
            });
          } else if (beatNotes.length === 1 && explicitChordName) {
            beatNotes[0].chordName = explicitChordName;
          }

          notes.push(...beatNotes);
        }
      }
    }

    notes.sort((a, b) => a.startTimeMs - b.startTimeMs || a.stringIndex - b.stringIndex);

    return {
      trackIndex: track.index,
      name: track.name || `Faixa ${track.index + 1}`,
      shortName: track.shortName || track.name || `F${track.index + 1}`,
      isPercussion,
      isBass,
      stringCount,
      tuningMidi: tuningLowToHigh,
      tuningName,
      capo: primaryStaff?.capo ?? 0,
      notes,
      chords,
      lanes: computeActiveLanes(notes, durationMs),
    };
  });

  // Choose best default track (prefer first non-percussion guitar track with most notes)
  let defaultTrackIndex = 0;
  let bestScore = -1;
  for (const t of tracks) {
    if (t.isPercussion) continue;
    const scoreWeight = (t.isBass ? 0.4 : 1.0) * (t.notes.length + 1);
    if (scoreWeight > bestScore) {
      bestScore = scoreWeight;
      defaultTrackIndex = t.trackIndex;
    }
  }

  // Deduplicate drum onsets within 25ms for rhythm alignment
  rawDrumOnsets.sort((a, b) => a - b);
  const drumOnsetsMs: number[] = [];
  for (const t of rawDrumOnsets) {
    if (drumOnsetsMs.length === 0 || t - drumOnsetsMs[drumOnsetsMs.length - 1] >= 25) {
      drumOnsetsMs.push(t);
    }
  }

  return {
    id: options.id,
    title: options.title || score.title || 'Tablatura sem título',
    artist: options.artist || score.artist || 'Artista desconhecido',
    sourceFormat: options.sourceFormat,
    durationMs,
    totalTicks,
    measures,
    sections,
    tracks,
    defaultTrackIndex,
    drumOnsetsMs,
    hasEmbeddedAudio: Boolean(score.backingTrack),
    rawBytes: options.rawBytes,
    alphaTex: options.alphaTex,
  };
}
