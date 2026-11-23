import * as alphaTab from '@coderline/alphatab';
import { asciiTabToAlphaTex } from './asciiTabParser';
import { buildSongData } from './timelineBuilder';
import type { SongData, SourceFormat } from '../types/music';

export interface LoadedTabResult {
  score: alphaTab.model.Score;
  songData: SongData;
}

export interface LoadTabInput {
  id: string;
  fileName?: string;
  title?: string;
  artist?: string;
  bytes?: Uint8Array;
  text?: string;
  sourceFormat?: SourceFormat;
  asciiBpm?: number;
}

function detectFormatFromFileName(fileName: string): 'binary' | 'alphatex' | 'ascii' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.atex') || lower.endsWith('.alphatex')) {
    return 'alphatex';
  }
  if (lower.endsWith('.txt') || lower.endsWith('.tab')) {
    return 'ascii';
  }
  return 'binary';
}

function looksLikeAlphaTex(text: string): boolean {
  return /^\s*\\(title|tempo|track|instrument|tuning|ts|section|ro|rc|clef|capo)\b/m.test(text);
}

export function loadTabFromAlphaTex(
  alphaTex: string,
  meta: { id: string; title?: string; artist?: string; sourceFormat: SourceFormat }
): LoadedTabResult {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(alphaTex, settings);
  const songData = buildSongData(score, {
    id: meta.id,
    title: meta.title || score.title,
    artist: meta.artist || score.artist,
    sourceFormat: meta.sourceFormat,
    alphaTex,
  });
  return { score, songData };
}

export function loadTabFromInput(input: LoadTabInput): LoadedTabResult {
  const settings = new alphaTab.Settings();

  if (input.text !== undefined) {
    const trimmed = input.text.trim();
    if (!trimmed) {
      throw new Error('O texto da tablatura está vazio.');
    }

    const isAlphaTex =
      input.sourceFormat === 'alphatex' ||
      input.sourceFormat === 'demo' ||
      (input.fileName ? detectFormatFromFileName(input.fileName) === 'alphatex' : false) ||
      looksLikeAlphaTex(trimmed);

    if (isAlphaTex) {
      return loadTabFromAlphaTex(trimmed, {
        id: input.id,
        title: input.title,
        artist: input.artist,
        sourceFormat: input.sourceFormat ?? 'alphatex',
      });
    }

    // Parse as ASCII tab -> AlphaTex -> Score
    const parsed = asciiTabToAlphaTex(trimmed, {
      title: input.title || input.fileName?.replace(/\.[^.]+$/, ''),
      artist: input.artist,
      bpm: input.asciiBpm,
    });
    return loadTabFromAlphaTex(parsed.alphaTex, {
      id: input.id,
      title: input.title,
      artist: input.artist,
      sourceFormat: 'ascii',
    });
  }

  if (input.bytes) {
    const extKind = input.fileName ? detectFormatFromFileName(input.fileName) : 'binary';

    if (extKind === 'alphatex' || extKind === 'ascii') {
      const decoded = new TextDecoder('utf-8').decode(input.bytes);
      return loadTabFromInput({
        ...input,
        bytes: undefined,
        text: decoded,
        sourceFormat: extKind === 'alphatex' ? 'alphatex' : 'ascii',
      });
    }

    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(input.bytes, settings);
    const lowerName = (input.fileName || '').toLowerCase();
    const detectedFormat: SourceFormat =
      input.sourceFormat ??
      (lowerName.endsWith('.xml') || lowerName.endsWith('.musicxml') || lowerName.endsWith('.mxl')
        ? 'musicxml'
        : 'gp');

    // Keep a standalone copy of raw bytes for IndexedDB & AlphaTabApi
    const bufferCopy = input.bytes.slice().buffer;
    const fallbackTitle = input.fileName ? input.fileName.replace(/\.[^.]+$/, '') : undefined;

    const songData = buildSongData(score, {
      id: input.id,
      title: input.title || score.title || fallbackTitle,
      artist: input.artist || score.artist,
      sourceFormat: detectedFormat,
      rawBytes: bufferCopy,
    });
    return { score, songData };
  }

  throw new Error('Nenhum arquivo ou texto foi fornecido para carregar a tablatura.');
}
