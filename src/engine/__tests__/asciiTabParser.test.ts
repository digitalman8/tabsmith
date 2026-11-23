import { describe, expect, it } from 'vitest';
import { asciiTabToAlphaTex } from '../asciiTabParser';
import { loadTabFromInput } from '../tabLoader';

describe('asciiTabParser', () => {
  it('parses 6-string ASCII tab with multi-digit frets, chords, and techniques into valid AlphaTex', () => {
    const ascii = `[Intro]
e|---------------------------------|
B|---------------------------------|
G|---------7h9-----12~-------------|
D|-----7---7-------12b-------------|
A|-5/7-----------------------------|
E|-0-----------x-------------------|`;

    const parsed = asciiTabToAlphaTex(ascii, { title: 'Teste Riff', bpm: 120 });
    expect(parsed.stringCount).toBe(6);
    expect(parsed.isBass).toBe(false);
    expect(parsed.measureCount).toBe(1);
    expect(parsed.noteCount).toBe(10);

    const { songData } = loadTabFromInput({
      id: 'ascii-1',
      title: 'Teste Riff',
      text: ascii,
      sourceFormat: 'ascii',
      asciiBpm: 120,
    });

    const track = songData.tracks[0];
    expect(track.stringCount).toBe(6);
    expect(track.notes.some((n) => n.fret === 12)).toBe(true);
    expect(track.notes.some((n) => n.techniques.deadNote)).toBe(true);
    expect(track.notes.some((n) => n.techniques.slideType !== 'none')).toBe(true);
    expect(track.notes.some((n) => n.techniques.bendSemitones > 0)).toBe(true);
    expect(track.notes.some((n) => n.techniques.vibrato)).toBe(true);
    expect(track.chords.length).toBeGreaterThanOrEqual(1);
  });

  it('parses 4-string bass ASCII tab cleanly', () => {
    const bassTab = `G|-----------------|-----------------|
D|-----------------|---------5---7---|
A|-----3---5-------|-----5-----------|
E|-0-----------3---|-5---------------|`;

    const parsed = asciiTabToAlphaTex(bassTab, { title: 'Bass Line', bpm: 100 });
    expect(parsed.stringCount).toBe(4);
    expect(parsed.isBass).toBe(true);
    expect(parsed.measureCount).toBe(2);

    const { songData } = loadTabFromInput({
      id: 'bass-1',
      text: bassTab,
      sourceFormat: 'ascii',
      asciiBpm: 100,
    });

    expect(songData.tracks[0].isBass).toBe(true);
    expect(songData.tracks[0].stringCount).toBe(4);
    expect(songData.tracks[0].notes.length).toBe(8);
  });

  it('throws descriptive error when input has no valid tab lines', () => {
    expect(() => asciiTabToAlphaTex('apenas texto comum sem tablatura')).toThrow();
  });
});
