import { describe, expect, it } from 'vitest';
import { DEMO_SONGS } from '../../data/demoSongs';
import { loadTabFromAlphaTex } from '../tabLoader';
import { computeActiveLanes } from '../timelineBuilder';
import { DEFAULT_PRACTICE_SETTINGS, type HighwayNote } from '../../types/music';

describe('timelineBuilder & demoSongs', () => {
  it('loads all 3 demo songs with tracks, sections, and measures', () => {
    for (const demo of DEMO_SONGS) {
      const { songData } = loadTabFromAlphaTex(demo.alphaTex, {
        id: demo.id,
        title: demo.title,
        artist: demo.artist,
        sourceFormat: 'demo',
      });

      expect(songData.title).toBe(demo.title);
      expect(songData.measures.length).toBeGreaterThanOrEqual(7);
      expect(songData.sections.length).toBeGreaterThanOrEqual(3);
      expect(songData.tracks.length).toBe(3);

      const leadTrack = songData.tracks[songData.defaultTrackIndex];
      expect(leadTrack.isPercussion).toBe(false);
      expect(leadTrack.notes.length).toBeGreaterThan(20);
      expect(leadTrack.lanes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('maps Low E string to stringIndex 0 and High e to stringIndex 5 with matching low-to-high tuningMidi', () => {
    const tex = `\\tempo 120
0.6.4 2.5.4 3.2.4 5.1.4 |`;

    const { songData } = loadTabFromAlphaTex(tex, {
      id: 'test-strings',
      sourceFormat: 'alphatex',
    });

    const track = songData.tracks[0];
    expect(track.tuningMidi).toEqual([40, 45, 50, 55, 59, 64]);
    expect(track.tuningName).toBe('E Standard');
    expect(track.notes.map((n) => [n.stringIndex, n.fret])).toEqual([
      [0, 0], // Low E open
      [1, 2], // A string fret 2
      [4, 3], // B string fret 3
      [5, 5], // High e fret 5
    ]);
  });

  it('unrolls repeats and converts tempo changes accurately to milliseconds', () => {
    const tex = `\\tempo 120
\\ro 0.6.1 | \\rc 2 2.6.1 |
\\tempo 60 3.6.1 |`;

    const { songData } = loadTabFromAlphaTex(tex, {
      id: 'test-repeats-tempo',
      sourceFormat: 'alphatex',
    });

    // 4/4 at 120 BPM = 2000ms per bar. Bars 0-1 repeat twice -> 4 bars * 2000ms = 8000ms.
    // Bar 4 at 60 BPM = 4000ms -> total = 12000ms.
    expect(songData.measures.length).toBe(5);
    expect(songData.measures[0].startTimeMs).toBeCloseTo(0, 1);
    expect(songData.measures[2].startTimeMs).toBeCloseTo(4000, 1);
    expect(songData.measures[4].startTimeMs).toBeCloseTo(8000, 1);
    expect(songData.measures[4].tempo).toBe(60);
    expect(songData.durationMs).toBeCloseTo(12000, 1);
  });

  it('extracts guitar techniques (palmMute, hammerOn, pullOff, bend, vibrato, slide, harmonic)', () => {
    const { songData: rock } = loadTabFromAlphaTex(DEMO_SONGS[0].alphaTex, {
      id: 'neon',
      sourceFormat: 'demo',
    });
    const rockNotes = rock.tracks[0].notes;
    expect(rockNotes.some((n) => n.techniques.palmMute)).toBe(true);
    expect(rockNotes.some((n) => n.techniques.hammerOn)).toBe(true);
    expect(rockNotes.some((n) => n.techniques.slideType !== 'none')).toBe(true);
    expect(rock.tracks[0].chords.some((c) => c.isRepeatStrum)).toBe(true);

    const { songData: blues } = loadTabFromAlphaTex(DEMO_SONGS[1].alphaTex, {
      id: 'blues',
      sourceFormat: 'demo',
    });
    const bluesNotes = blues.tracks[0].notes;
    expect(bluesNotes.some((n) => n.techniques.bendSemitones >= 2)).toBe(true);
    expect(bluesNotes.some((n) => n.techniques.pullOff)).toBe(true);
    expect(bluesNotes.some((n) => n.techniques.vibrato)).toBe(true);

    const { songData: arp } = loadTabFromAlphaTex(DEMO_SONGS[2].alphaTex, {
      id: 'arp',
      sourceFormat: 'demo',
    });
    expect(arp.tracks[0].notes.some((n) => n.techniques.harmonic === 'natural')).toBe(true);
  });

  it('computes stable active fret lanes without jittering on open strings', () => {
    const makeNote = (idx: number, startMs: number, fret: number): HighwayNote => ({
      id: `n-${idx}`,
      startTimeMs: startMs,
      endTimeMs: startMs + 250,
      durationMs: 250,
      startTick: idx * 480,
      stringIndex: 0,
      fret,
      isOpen: fret === 0,
      techniques: {
        palmMute: false,
        deadNote: false,
        hammerOn: false,
        pullOff: false,
        slideType: 'none',
        slideTargetFret: null,
        bendSemitones: 0,
        vibrato: false,
        harmonic: 'none',
        accent: false,
        ghost: false,
        letRing: false,
        tieDestination: false,
      },
      measureIndex: 0,
      beatIndex: idx,
    });

    const notes: HighwayNote[] = [
      makeNote(0, 0, 0), // open string should not force anchor change
      makeNote(1, 300, 7),
      makeNote(2, 600, 9),
      makeNote(3, 900, 0), // open string still keeps 7..11 lane
      makeNote(4, 1200, 10),
      makeNote(5, 2000, 2),
      makeNote(6, 2300, 3),
    ];

    const lanes = computeActiveLanes(notes, 3000, 5);
    expect(lanes.length).toBe(2);
    expect(lanes[0].anchorFret).toBeGreaterThanOrEqual(6);
    expect(lanes[0].anchorFret).toBeLessThanOrEqual(7);
    expect(lanes[1].anchorFret).toBe(1);
    // Contiguous segments with no time gaps for time-segmented highway lanes
    expect(lanes[0].startTimeMs).toBe(0);
    expect(lanes[0].endTimeMs).toBe(lanes[1].startTimeMs);
    expect(lanes[1].endTimeMs).toBe(3000);
  });

  it('exposes wide dynamic camera as the default practice cameraMode', () => {
    expect(DEFAULT_PRACTICE_SETTINGS.cameraMode).toBe('dynamic');
  });
});
