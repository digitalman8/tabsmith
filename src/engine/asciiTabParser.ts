export interface AsciiParseOptions {
  title?: string;
  artist?: string;
  bpm?: number;
}

export interface AsciiParseResult {
  alphaTex: string;
  measureCount: number;
  noteCount: number;
  stringCount: number;
  isBass: boolean;
}

interface ParsedNoteToken {
  /** 1-based alphaTab string (1 = lowest/thickest, N = highest/thinnest) */
  stringNumber: number;
  fret: number;
  isDead: boolean;
  hammerOrPull: boolean;
  slideOut: boolean;
  bend: boolean;
  vibrato: boolean;
}

interface ParsedColumnBeat {
  col: number;
  notes: ParsedNoteToken[];
}

const STRING_LINE_REGEX = /^\s*([A-Ga-g][#b]?)?\s*\|([0-9A-Za-z\-~\/\\^().*| \[\]]+)\|?\s*$/;

function pickClosestDuration(fractionOfBar: number): { denom: number; dotted: boolean } {
  // Supported AlphaTex beat denominators relative to whole bar (assuming 4/4 = 1.0)
  const candidates: Array<{ value: number; denom: number; dotted: boolean }> = [
    { value: 1.0, denom: 1, dotted: false },
    { value: 0.75, denom: 2, dotted: true },
    { value: 0.5, denom: 2, dotted: false },
    { value: 0.375, denom: 4, dotted: true },
    { value: 0.25, denom: 4, dotted: false },
    { value: 0.1875, denom: 8, dotted: true },
    { value: 0.125, denom: 8, dotted: false },
    { value: 0.0625, denom: 16, dotted: false },
  ];

  let best = candidates[4]; // .4 fallback
  let minDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(fractionOfBar - c.value);
    if (diff < minDiff) {
      minDiff = diff;
      best = c;
    }
  }
  return { denom: best.denom, dotted: best.dotted };
}

function isTabLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return STRING_LINE_REGEX.test(trimmed);
}

/**
 * Parses standard 6-string guitar or 4-string bass ASCII tablature into AlphaTex 1.9.
 * Supports stacked systems, multi-digit frets (10..24), chords, rests, and h/p/\/b/~ /x techniques.
 */
export function asciiTabToAlphaTex(input: string, options: AsciiParseOptions = {}): AsciiParseResult {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const title = (options.title || 'Tablatura Importada').replace(/"/g, "'");
  const artist = (options.artist || 'ASCII Tab').replace(/"/g, "'");
  const bpm = Math.max(30, Math.min(300, Math.round(options.bpm || 110)));

  // Group contiguous tab lines into systems (staves)
  interface TabBlock {
    sectionLabel?: string;
    lines: string[];
  }

  const blocks: TabBlock[] = [];
  let currentLines: string[] = [];
  let pendingSection: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (isTabLine(line)) {
      currentLines.push(line.trim());
    } else {
      if (currentLines.length >= 4) {
        blocks.push({ sectionLabel: pendingSection, lines: currentLines });
        pendingSection = undefined;
      }
      currentLines = [];
      const trimmed = line.trim();
      const secMatch = trimmed.match(/^\[(.+?)\]$/) || trimmed.match(/^([A-Za-z0-9À-ÿ ]{2,24}):$/);
      if (secMatch) {
        pendingSection = secMatch[1].trim();
      }
    }
  }
  if (currentLines.length >= 4) {
    blocks.push({ sectionLabel: pendingSection, lines: currentLines });
  }

  if (blocks.length === 0) {
    throw new Error(
      'Não foi possível detectar linhas de tablatura ASCII válidas (ex: e|---0---2---|).'
    );
  }

  // Determine string count from first valid block (normalize 6 or 4 strings)
  const firstBlockLines = blocks[0].lines;
  const stringCount = firstBlockLines.length >= 6 ? 6 : 4;
  const isBass = stringCount === 4;

  const alphaBars: string[] = [];
  let totalNotes = 0;

  for (const block of blocks) {
    const staffLines = block.lines.slice(0, stringCount);
    if (staffLines.length < stringCount) continue;

    // Strip optional string prefix before first '|'
    const bodies = staffLines.map((ln) => {
      const firstPipe = ln.indexOf('|');
      let body = firstPipe >= 0 ? ln.slice(firstPipe + 1) : ln;
      if (body.endsWith('|')) {
        body = body.slice(0, -1);
      }
      return body;
    });

    // Split into bars by '|' character on top string (or max length)
    const barArrays = bodies.map((b) => b.split('|'));
    const barCount = Math.max(...barArrays.map((arr) => arr.length));

    for (let barIdx = 0; barIdx < barCount; barIdx++) {
      const segs = barArrays.map((arr) => arr[barIdx] ?? '');
      const barWidth = Math.max(...segs.map((s) => s.length));
      if (barWidth === 0) continue;

      // Pad segments to uniform barWidth
      const padded = segs.map((s) => s.padEnd(barWidth, '-'));
      const columnMap = new Map<number, ParsedNoteToken[]>();

      // Scan each string line (row 0 = top line = highest pitch = alphaTab string stringCount)
      for (let row = 0; row < stringCount; row++) {
        const lineStr = padded[row];
        const stringNumber = stringCount - row; // row 0 -> 6 (High e), row 5 -> 1 (Low E)

        let col = 0;
        while (col < barWidth) {
          const ch = lineStr[col];
          if (ch >= '0' && ch <= '9') {
            let numStr = ch;
            let endCol = col + 1;
            if (endCol < barWidth && lineStr[endCol] >= '0' && lineStr[endCol] <= '9') {
              numStr += lineStr[endCol];
              endCol++;
            }
            const fret = Math.min(24, parseInt(numStr, 10));

            // Check following technique marker
            const nextCh = endCol < barWidth ? lineStr[endCol] : '';
            const hammerOrPull = nextCh === 'h' || nextCh === 'p' || nextCh === 'H' || nextCh === 'P';
            const slideOut = nextCh === '/' || nextCh === '\\';
            const bend = nextCh === 'b' || nextCh === '^';
            const vibrato = nextCh === '~' || nextCh === 'v';

            const arr = columnMap.get(col) ?? [];
            arr.push({
              stringNumber,
              fret,
              isDead: false,
              hammerOrPull,
              slideOut,
              bend,
              vibrato,
            });
            columnMap.set(col, arr);
            totalNotes++;
            col = endCol;
          } else if (ch === 'x' || ch === 'X') {
            const arr = columnMap.get(col) ?? [];
            arr.push({
              stringNumber,
              fret: 0,
              isDead: true,
              hammerOrPull: false,
              slideOut: false,
              bend: false,
              vibrato: false,
            });
            columnMap.set(col, arr);
            totalNotes++;
            col++;
          } else {
            col++;
          }
        }
      }

      const beats: ParsedColumnBeat[] = Array.from(columnMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([col, notes]) => ({ col, notes }));

      if (beats.length === 0) {
        const prefix =
          barIdx === 0 && block.sectionLabel
            ? `\\section "${block.sectionLabel.replace(/"/g, "'")}" `
            : '';
        alphaBars.push(`${prefix}r.1`);
        continue;
      }

      const tokens: string[] = [];
      if (barIdx === 0 && block.sectionLabel) {
        tokens.push(`\\section "${block.sectionLabel.replace(/"/g, "'")}"`);
      }

      // Leading rest if first note starts significantly into the bar
      if (beats[0].col >= Math.max(3, Math.floor(barWidth * 0.18))) {
        const leadDur = pickClosestDuration(beats[0].col / barWidth);
        tokens.push(`r.${leadDur.denom}`);
      }

      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        const nextCol = i + 1 < beats.length ? beats[i + 1].col : barWidth;
        const deltaCols = Math.max(1, nextCol - b.col);
        const dur = pickClosestDuration(deltaCols / barWidth);

        const noteTokens = b.notes.map((n) => {
          const fretOrDead = n.isDead ? 'x' : String(n.fret);
          const fx: string[] = [];
          if (n.hammerOrPull) fx.push('h');
          if (n.slideOut) fx.push('sl');
          if (n.bend) fx.push('b (0 0 2 4)');
          if (n.vibrato) fx.push('v');
          const fxStr = fx.length > 0 ? `{${fx.join(' ')}}` : '';
          return `${fretOrDead}.${n.stringNumber}${fxStr}`;
        });

        const body = noteTokens.length > 1 ? `(${noteTokens.join(' ')})` : noteTokens[0];
        const beatFx = dur.dotted ? ' {d}' : '';
        tokens.push(`${body}.${dur.denom}${beatFx}`);
      }

      alphaBars.push(tokens.join(' '));
    }
  }

  if (alphaBars.length === 0 || totalNotes === 0) {
    throw new Error('Nenhuma nota foi encontrada na tablatura ASCII informada.');
  }

  const headerLines = [
    `\\title "${title}"`,
    `\\artist "${artist}"`,
    `\\tempo ${bpm}`,
    `\\track "${isBass ? 'Baixo' : 'Guitarra'}"`,
    `\\instrument ${isBass ? 'electricbassfinger' : 'electricguitarclean'}`,
  ];
  if (isBass) {
    headerLines.push(`\\tuning (G2 D2 A1 E1)`);
  }

  const alphaTex = `${headerLines.join('\n')}\n${alphaBars.join(' |\n')} |`;

  return {
    alphaTex,
    measureCount: alphaBars.length,
    noteCount: totalNotes,
    stringCount,
    isBass,
  };
}
