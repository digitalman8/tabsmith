import {
  getStringPalette,
  type ActiveLaneSpan,
  type ChordEvent,
  type HighwayNote,
  type MeasureMarker,
  type PracticeSettings,
  type StringVisualStyle,
  type TrackTimeline,
} from '../types/music';

interface HitFlare {
  fret: number;
  stringIndex: number;
  color: string;
  createdPerfMs: number;
  isOpen: boolean;
}

interface BgParticle {
  u: number; // 0..1 normalized horizontal
  v: number; // 0..1 normalized vertical
  phase: number;
  side: -1 | 1;
}

const INLAY_SINGLE_FRETS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const INLAY_DOUBLE_FRETS = new Set([12, 24]);

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Maps normalized linear time ahead (0 = hit line, 1 = horizon)
 * to perspective depth (0..1) so approaching notes accelerate naturally.
 */
function perspectiveDepth(zNorm: number): number {
  const k = 1.75;
  const z = clamp(zNorm, -0.08, 1.05);
  return (z * (1 + k)) / (1 + z * k);
}

export class HighwayRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Smoothly animated camera state
  private cameraCenterFret = 5.0;
  private cameraLaneAnchor = 1.0;
  private cameraLaneSpan = 5.0;
  private lastFramePerfMs = 0;

  // Hit feedback state
  private stringEnergies: number[] = new Array(8).fill(0);
  private hitFlares: HitFlare[] = [];
  private triggeredNoteIds = new Set<string>();
  private lastEvalSongMs = -1;

  // Decorative background particles echoing the reference screenshot's cyan dot-waves
  private bgParticles: BgParticle[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Falha ao inicializar contexto 2D do Canvas.');
    }
    this.ctx = context;
    this.initBackgroundParticles();
  }

  private initBackgroundParticles(): void {
    const particles: BgParticle[] = [];
    for (const side of [-1, 1] as const) {
      for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 18; col++) {
          particles.push({
            u: col / 17,
            v: row / 11,
            phase: col * 0.38 + row * 0.52,
            side,
          });
        }
      }
    }
    this.bgParticles = particles;
  }

  public resetCamera(track: TrackTimeline | null, songTimeMs: number): void {
    this.triggeredNoteIds.clear();
    this.hitFlares = [];
    this.stringEnergies.fill(0);
    this.lastEvalSongMs = songTimeMs;

    if (!track) {
      this.cameraCenterFret = 5;
      this.cameraLaneAnchor = 1;
      this.cameraLaneSpan = 5;
      return;
    }

    const span = this.findActiveLane(track.lanes, songTimeMs);
    this.cameraLaneAnchor = span.anchorFret;
    this.cameraLaneSpan = span.spanWidth;
    this.cameraCenterFret = clamp(span.anchorFret + (span.spanWidth - 1) * 0.5, 4.5, 19.5);
  }

  private findActiveLane(lanes: ActiveLaneSpan[], timeMs: number): ActiveLaneSpan {
    if (lanes.length === 0) {
      return { startTimeMs: 0, endTimeMs: 60000, anchorFret: 1, spanWidth: 5 };
    }
    // Look slightly ahead (350ms) so the camera anticipates hand shifts gracefully
    const lookMs = Math.max(0, timeMs + 350);
    for (let i = 0; i < lanes.length; i++) {
      if (lookMs >= lanes[i].startTimeMs && lookMs <= lanes[i].endTimeMs) {
        return lanes[i];
      }
    }
    return lanes[lanes.length - 1];
  }

  public render(params: {
    width: number;
    height: number;
    dpr: number;
    songTimeMs: number;
    isPlaying: boolean;
    track: TrackTimeline | null;
    measures: MeasureMarker[];
    settings: PracticeSettings;
  }): void {
    const { width, height, dpr, songTimeMs, isPlaying, track, measures, settings } = params;
    const ctx = this.ctx;
    const nowPerf = performance.now();
    const dt = this.lastFramePerfMs > 0 ? Math.min(0.05, (nowPerf - this.lastFramePerfMs) / 1000) : 0.016;
    this.lastFramePerfMs = nowPerf;

    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Background sky + subtle animated cyan dot-wave field
    this.drawBackground(ctx, width, height, nowPerf);

    if (!track) {
      this.drawEmptyState(ctx, width, height);
      ctx.restore();
      return;
    }

    // Update smooth camera & active lane interpolation
    const targetLane = this.findActiveLane(track.lanes, songTimeMs);
    const smoothRate = 1 - Math.exp(-dt * 5.2);
    this.cameraLaneAnchor = lerp(this.cameraLaneAnchor, targetLane.anchorFret, smoothRate);
    this.cameraLaneSpan = lerp(this.cameraLaneSpan, targetLane.spanWidth, smoothRate);

    const targetCenter = clamp(
      targetLane.anchorFret + (targetLane.spanWidth - 1) * 0.5,
      5.2,
      19.2
    );
    this.cameraCenterFret = lerp(this.cameraCenterFret, targetCenter, smoothRate);

    // Decay string vibrations & detect new note hits
    for (let i = 0; i < this.stringEnergies.length; i++) {
      this.stringEnergies[i] *= Math.exp(-dt * 8.5);
    }

    const palette = getStringPalette(track.stringCount, track.isBass);
    this.updateHitDetection(track.notes, palette, songTimeMs, isPlaying, nowPerf);

    // Layout geometry
    const horizonY = height * 0.14;
    const hitY = height * 0.77;
    const fretboardBottomY = height * 0.92;
    const vanishX = width * 0.5;
    const boardWidth = width * 0.88;
    const visibleFrets = 12.5;
    const lookaheadMs = settings.highwayLookaheadSec * 1000;
    const viewMinFret = this.cameraCenterFret - visibleFrets * 0.5;
    const viewMaxFret = this.cameraCenterFret + visibleFrets * 0.5;

    const projectX = (fretPos: number, depth: number): number => {
      const scale = 1 - depth * 0.75;
      let rel = (fretPos - this.cameraCenterFret) / visibleFrets;
      if (settings.leftHanded) rel = -rel;
      return vanishX + rel * boardWidth * scale;
    };

    const projectY = (depth: number): number => hitY - depth * (hitY - horizonY);
    const projectScale = (depth: number): number => 1 - depth * 0.75;

    const getVisualStringRow = (stringIndex: number): number => {
      if (settings.invertStrings) {
        return track.stringCount - 1 - stringIndex;
      }
      return stringIndex;
    };

    // 2. Highway floor + Active Fret Lane + Fret Rails
    this.drawHighwayFloorAndLanes({
      ctx,
      width,
      horizonY,
      hitY,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      leftHanded: settings.leftHanded,
    });

    // 3. Measure & Beat grid lines receding into depth
    this.drawMeasureAndBeatLines({
      ctx,
      measures,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      leftHanded: settings.leftHanded,
    });

    // 4. Notes, Sustain Tails & Chord Panes (back-to-front painter's order)
    this.drawHighwayNotesAndChords({
      ctx,
      notes: track.notes,
      chords: track.chords,
      palette,
      stringCount: track.stringCount,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      projectScale,
      getVisualStringRow,
      showFretNumbers: settings.showFretNumbersOnNotes,
    });

    // 5. Foreground 3D Fretboard, Nut, Inlays, Colored Strings & Fret Numbers
    this.drawForegroundFretboard({
      ctx,
      width,
      height,
      hitY,
      fretboardBottomY,
      viewMinFret,
      viewMaxFret,
      stringCount: track.stringCount,
      palette,
      projectX,
      getVisualStringRow,
      leftHanded: settings.leftHanded,
      nowPerf,
    });

    // 6. Hit Flares & Sustaining String Glow at Hit Line
    this.drawHitFlares({
      ctx,
      hitY,
      fretboardBottomY,
      stringCount: track.stringCount,
      notes: track.notes,
      palette,
      songTimeMs,
      projectX,
      getVisualStringRow,
      nowPerf,
    });

    // 7. Horizon subtle fog vignette
    const fogGrad = ctx.createLinearGradient(0, horizonY - 12, 0, horizonY + 58);
    fogGrad.addColorStop(0, 'rgba(3, 8, 18, 0.96)');
    fogGrad.addColorStop(1, 'rgba(3, 8, 18, 0)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, horizonY - 12, width, 70);

    ctx.restore();
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    nowPerf: number
  ): void {
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.22,
      width * 0.04,
      width * 0.5,
      height * 0.55,
      width * 0.85
    );
    bgGrad.addColorStop(0, '#0a2033');
    bgGrad.addColorStop(0.45, '#050d1a');
    bgGrad.addColorStop(1, '#02040a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle dual-wing cyan particle wave field inspired by the reference screenshot
    const t = nowPerf * 0.0011;
    for (const p of this.bgParticles) {
      const wave = Math.sin(p.phase + t) * 14 + Math.cos(p.phase * 0.7 - t * 0.8) * 9;
      const spreadX = 0.14 + p.u * 0.34;
      const px = width * (0.5 + p.side * spreadX);
      const archY = height * (0.14 + p.v * 0.34 + Math.sin(p.u * Math.PI) * 0.06);
      const py = archY + wave;
      const alpha = (1 - Math.abs(p.v - 0.5) * 1.4) * (0.07 + 0.09 * (1 - p.u));
      if (alpha <= 0.01) continue;

      ctx.fillStyle = `rgba(34, 211, 238, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEmptyState(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nenhuma faixa de instrumento selecionada', width / 2, height / 2);
  }

  private updateHitDetection(
    notes: HighwayNote[],
    palette: StringVisualStyle[],
    songTimeMs: number,
    isPlaying: boolean,
    nowPerf: number
  ): void {
    // If user jumped backwards / scrubbed, reset triggered set
    if (this.lastEvalSongMs > songTimeMs + 120 || Math.abs(songTimeMs - this.lastEvalSongMs) > 600) {
      this.triggeredNoteIds.clear();
    }

    if (isPlaying) {
      for (const note of notes) {
        if (note.startTimeMs > songTimeMs + 20) break;
        if (
          note.startTimeMs <= songTimeMs &&
          songTimeMs - note.startTimeMs < 95 &&
          !this.triggeredNoteIds.has(note.id)
        ) {
          this.triggeredNoteIds.add(note.id);
          this.stringEnergies[note.stringIndex] = 1.0;
          const style = palette[note.stringIndex] ?? palette[0];
          this.hitFlares.push({
            fret: note.fret,
            stringIndex: note.stringIndex,
            color: style.color,
            createdPerfMs: nowPerf,
            isOpen: note.isOpen,
          });
        }
      }
    }

    this.lastEvalSongMs = songTimeMs;
    this.hitFlares = this.hitFlares.filter((f) => nowPerf - f.createdPerfMs < 320);
  }

  private drawHighwayFloorAndLanes(params: {
    ctx: CanvasRenderingContext2D;
    width: number;
    horizonY: number;
    hitY: number;
    viewMinFret: number;
    viewMaxFret: number;
    projectX: (f: number, d: number) => number;
    projectY: (d: number) => number;
    leftHanded: boolean;
  }): void {
    const { ctx, horizonY, hitY, viewMinFret, viewMaxFret, projectX } = params;

    const firstEdge = Math.max(0.5, Math.floor(viewMinFret - 0.5) + 0.5);
    const lastEdge = Math.min(24.5, Math.ceil(viewMaxFret + 0.5) - 0.5);

    // Base highway dark translucent deck
    const leftNear = projectX(firstEdge, 0);
    const rightNear = projectX(lastEdge, 0);
    const leftFar = projectX(firstEdge, 1);
    const rightFar = projectX(lastEdge, 1);

    const floorGrad = ctx.createLinearGradient(0, horizonY, 0, hitY);
    floorGrad.addColorStop(0, 'rgba(6, 13, 26, 0.45)');
    floorGrad.addColorStop(1, 'rgba(8, 17, 34, 0.92)');

    ctx.beginPath();
    ctx.moveTo(leftNear, hitY);
    ctx.lineTo(leftFar, horizonY);
    ctx.lineTo(rightFar, horizonY);
    ctx.lineTo(rightNear, hitY);
    ctx.closePath();
    ctx.fillStyle = floorGrad;
    ctx.fill();

    // Active Fret Lane illuminated translucent strip
    const laneLeft = Math.max(0.5, this.cameraLaneAnchor - 0.5);
    const laneRight = Math.min(24.5, laneLeft + this.cameraLaneSpan);

    const lNear = projectX(laneLeft, 0);
    const rNear = projectX(laneRight, 0);
    const lFar = projectX(laneLeft, 1);
    const rFar = projectX(laneRight, 1);

    const laneGrad = ctx.createLinearGradient(0, horizonY, 0, hitY);
    laneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.05)');
    laneGrad.addColorStop(0.55, 'rgba(59, 130, 246, 0.16)');
    laneGrad.addColorStop(1, 'rgba(99, 102, 241, 0.25)');

    ctx.beginPath();
    ctx.moveTo(lNear, hitY);
    ctx.lineTo(lFar, horizonY);
    ctx.lineTo(rFar, horizonY);
    ctx.lineTo(rNear, hitY);
    ctx.closePath();
    ctx.fillStyle = laneGrad;
    ctx.fill();

    // Vertical receding fret rails
    for (let f = firstEdge; f <= lastEdge + 0.01; f += 1) {
      const xN = projectX(f, 0);
      const xF = projectX(f, 1);
      const isLaneBorder = Math.abs(f - laneLeft) < 0.25 || Math.abs(f - laneRight) < 0.25;
      const inLane = f > laneLeft + 0.1 && f < laneRight - 0.1;

      ctx.beginPath();
      ctx.moveTo(xN, hitY);
      ctx.lineTo(xF, horizonY);
      if (isLaneBorder) {
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.65)';
        ctx.lineWidth = 2;
      } else if (inLane) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1.1;
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    }
  }

  private drawMeasureAndBeatLines(params: {
    ctx: CanvasRenderingContext2D;
    measures: MeasureMarker[];
    songTimeMs: number;
    lookaheadMs: number;
    viewMinFret: number;
    viewMaxFret: number;
    projectX: (f: number, d: number) => number;
    projectY: (d: number) => number;
    leftHanded: boolean;
  }): void {
    const { ctx, measures, songTimeMs, lookaheadMs, viewMinFret, viewMaxFret, projectX, projectY, leftHanded } =
      params;

    const firstEdge = Math.max(0.5, Math.floor(viewMinFret - 0.5) + 0.5);
    const lastEdge = Math.min(24.5, Math.ceil(viewMaxFret + 0.5) - 0.5);
    const laneLeft = Math.max(0.5, this.cameraLaneAnchor - 0.5);
    const laneRight = Math.min(24.5, laneLeft + this.cameraLaneSpan);

    for (const m of measures) {
      if (m.endTimeMs < songTimeMs - 150) continue;
      if (m.startTimeMs > songTimeMs + lookaheadMs) break;

      // Measure start line
      const dtMeasure = m.startTimeMs - songTimeMs;
      if (dtMeasure >= -80 && dtMeasure <= lookaheadMs) {
        const d = perspectiveDepth(dtMeasure / lookaheadMs);
        const y = projectY(d);
        const x1 = projectX(firstEdge, d);
        const x2 = projectX(lastEdge, d);
        const lx1 = projectX(laneLeft, d);
        const lx2 = projectX(laneRight, d);
        const alpha = clamp(1 - d * 0.82, 0.08, 0.72);

        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.strokeStyle = `rgba(148, 163, 184, ${(alpha * 0.35).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Brighter bar line inside Active Lane
        ctx.beginPath();
        ctx.moveTo(lx1, y);
        ctx.lineTo(lx2, y);
        ctx.strokeStyle = `rgba(226, 232, 240, ${(alpha * 0.85).toFixed(3)})`;
        ctx.lineWidth = 1.6 * (1 - d * 0.5);
        ctx.stroke();

        // Measure number badge
        const scale = 1 - d * 0.75;
        if (scale > 0.36) {
          const labelX = leftHanded ? Math.max(lx1, lx2) + 8 : Math.min(lx1, lx2) - 8;
          ctx.fillStyle = `rgba(186, 230, 253, ${(alpha * 0.85).toFixed(3)})`;
          ctx.font = `700 ${Math.max(9, Math.round(12 * scale))}px "JetBrains Mono", monospace`;
          ctx.textAlign = leftHanded ? 'left' : 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(m.unrolledIndex + 1), labelX, y);
        }
      }

      // Beat subdivisions inside active lane
      for (let bIdx = 1; bIdx < m.beats.length; bIdx++) {
        const bt = m.beats[bIdx];
        const dtBeat = bt - songTimeMs;
        if (dtBeat < 0 || dtBeat > lookaheadMs) continue;
        const d = perspectiveDepth(dtBeat / lookaheadMs);
        const y = projectY(d);
        const lx1 = projectX(laneLeft, d);
        const lx2 = projectX(laneRight, d);
        const alpha = clamp((1 - d) * 0.32, 0.03, 0.32);

        ctx.beginPath();
        ctx.moveTo(lx1, y);
        ctx.lineTo(lx2, y);
        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private drawHighwayNotesAndChords(params: {
    ctx: CanvasRenderingContext2D;
    notes: HighwayNote[];
    chords: ChordEvent[];
    palette: StringVisualStyle[];
    stringCount: number;
    songTimeMs: number;
    lookaheadMs: number;
    viewMinFret: number;
    viewMaxFret: number;
    projectX: (f: number, d: number) => number;
    projectY: (d: number) => number;
    projectScale: (d: number) => number;
    getVisualStringRow: (s: number) => number;
    showFretNumbers: boolean;
  }): void {
    const {
      ctx,
      notes,
      chords,
      palette,
      stringCount,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      projectScale,
      getVisualStringRow,
      showFretNumbers,
    } = params;

    // Collect visible notes & chords
    const visibleNotes: HighwayNote[] = [];
    for (const n of notes) {
      if (n.endTimeMs < songTimeMs - 140) continue;
      if (n.startTimeMs > songTimeMs + lookaheadMs) break;
      visibleNotes.push(n);
    }

    const visibleChords: ChordEvent[] = [];
    for (const c of chords) {
      if (c.startTimeMs < songTimeMs - 100) continue;
      if (c.startTimeMs > songTimeMs + lookaheadMs) break;
      visibleChords.push(c);
    }

    // 1. Draw Sustain Tails & Slides (furthest to closest)
    for (let i = visibleNotes.length - 1; i >= 0; i--) {
      const n = visibleNotes[i];
      const hasLongTail = n.durationMs > 230 || n.techniques.slideType !== 'none' || n.techniques.vibrato;
      if (!hasLongTail || n.isOpen || n.techniques.deadNote) continue;

      const startClampedMs = Math.max(songTimeMs, n.startTimeMs);
      const endClampedMs = Math.min(songTimeMs + lookaheadMs, n.endTimeMs);
      if (endClampedMs <= startClampedMs + 20) continue;

      const style = palette[n.stringIndex] ?? palette[0];
      const visualRow = getVisualStringRow(n.stringIndex);
      const liftRatio = (stringCount - 1 - visualRow) / Math.max(1, stringCount - 1);

      const startFret = n.fret;
      let endFret = n.fret;
      if (n.techniques.slideTargetFret !== null && n.techniques.slideTargetFret > 0) {
        endFret = n.techniques.slideTargetFret;
      } else if (n.techniques.slideType === 'outUp') {
        endFret = Math.min(24, n.fret + 3);
      } else if (n.techniques.slideType === 'outDown') {
        endFret = Math.max(1, n.fret - 3);
      }

      const steps = n.techniques.vibrato ? 14 : 8;
      const totalSpan = Math.max(1, n.endTimeMs - n.startTimeMs);

      ctx.save();
      ctx.beginPath();
      for (let sIdx = 0; sIdx <= steps; sIdx++) {
        const frac = sIdx / steps;
        const sampleMs = lerp(startClampedMs, endClampedMs, frac);
        const noteFrac = clamp((sampleMs - n.startTimeMs) / totalSpan, 0, 1);
        const d = perspectiveDepth((sampleMs - songTimeMs) / lookaheadMs);
        const sc = projectScale(d);
        const yPlane = projectY(d);
        const y = yPlane - liftRatio * 14 * sc;

        let fPos = lerp(startFret, endFret, noteFrac);
        if (n.techniques.vibrato) {
          fPos += Math.sin(noteFrac * Math.PI * 6) * 0.16;
        }
        const x = projectX(fPos, d);
        if (sIdx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const dStart = perspectiveDepth((startClampedMs - songTimeMs) / lookaheadMs);
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = clamp(0.75 - dStart * 0.45, 0.2, 0.78);
      ctx.lineWidth = Math.max(3, 12 * projectScale(dStart));
      ctx.lineCap = 'round';
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Inner bright core
      ctx.globalAlpha *= 0.65;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.2, 4 * projectScale(dStart));
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw Chord Panes (back-to-front)
    const laneLeft = Math.max(0.5, this.cameraLaneAnchor - 0.5);
    const laneRight = Math.min(24.5, laneLeft + this.cameraLaneSpan);

    for (let i = visibleChords.length - 1; i >= 0; i--) {
      const ch = visibleChords[i];
      const dtMs = ch.startTimeMs - songTimeMs;
      const d = perspectiveDepth(dtMs / lookaheadMs);
      const sc = projectScale(d);
      const y = projectY(d);

      const leftF = ch.minFret > 0 ? Math.max(0.5, ch.minFret - 0.45) : laneLeft;
      const rightF = ch.maxFret > 0 ? Math.min(24.5, ch.maxFret + 0.45) : laneRight;
      const xA = projectX(leftF, d);
      const xB = projectX(rightF, d);
      const xMin = Math.min(xA, xB);
      const xMax = Math.max(xA, xB);
      const paneW = Math.max(16, xMax - xMin);
      const paneH = (ch.isRepeatStrum ? 18 : 54) * sc;
      const alpha = clamp(1 - d * 0.78, 0.14, 0.92);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ch.isRepeatStrum
        ? 'rgba(56, 189, 248, 0.10)'
        : 'rgba(15, 35, 66, 0.34)';
      ctx.strokeStyle = ch.isRepeatStrum
        ? 'rgba(125, 211, 252, 0.55)'
        : 'rgba(56, 189, 248, 0.72)';
      ctx.lineWidth = ch.isRepeatStrum ? 1.4 : 2 * sc;

      this.roundRectPath(ctx, xMin, y - paneH, paneW, paneH, 6 * sc);
      ctx.fill();
      ctx.stroke();

      if (!ch.isRepeatStrum && ch.name && sc > 0.35) {
        const fontSize = Math.max(10, Math.round(14 * sc));
        ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
        const textW = ctx.measureText(ch.name).width;
        const badgeW = textW + 14 * sc;
        const badgeH = (fontSize + 6) * sc;
        const bx = xMin;
        const by = y - paneH - badgeH - 2 * sc;

        ctx.fillStyle = 'rgba(14, 116, 144, 0.92)';
        this.roundRectPath(ctx, bx, by, badgeW, badgeH, 4 * sc);
        ctx.fill();

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.name, bx + 7 * sc, by + badgeH * 0.5);
      }
      ctx.restore();
    }

    // 3. Draw Note Gems back-to-front (farther notes first, closer notes last)
    visibleNotes.sort((a, b) => b.startTimeMs - a.startTimeMs);

    for (const n of visibleNotes) {
      if (n.startTimeMs < songTimeMs - 55) continue;
      const dtMs = n.startTimeMs - songTimeMs;
      const d = perspectiveDepth(dtMs / lookaheadMs);
      const sc = projectScale(d);
      const yPlane = projectY(d);
      const style = palette[n.stringIndex] ?? palette[0];
      const visualRow = getVisualStringRow(n.stringIndex);
      const liftRatio = (stringCount - 1 - visualRow) / Math.max(1, stringCount - 1);
      const alpha = clamp(1 - d * 0.72, 0.15, 1.0);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (n.isOpen) {
        // Open string note: wide glowing horizontal bar spanning the Active Fret Lane
        const lx1 = projectX(laneLeft + 0.08, d);
        const lx2 = projectX(laneRight - 0.08, d);
        const barX = Math.min(lx1, lx2);
        const barW = Math.abs(lx2 - lx1);
        const barH = Math.max(5, 13 * sc);
        const barY = yPlane - barH * 0.5 - liftRatio * 8 * sc;

        ctx.shadowColor = style.color;
        ctx.shadowBlur = 14 * sc;
        ctx.fillStyle = style.color;
        this.roundRectPath(ctx, barX, barY, barW, barH, 4 * sc);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        this.roundRectPath(ctx, barX + 2, barY + 1.5 * sc, Math.max(2, barW - 4), barH * 0.34, 2 * sc);
        ctx.fill();

        if (n.techniques.palmMute && sc > 0.38) {
          this.drawPalmMuteCross(ctx, barX + barW * 0.5, barY + barH * 0.5, 10 * sc, '#ffffff');
        }
        ctx.restore();
        continue;
      }

      // Skip off-screen frets cleanly (clamp with arrow hint if outside camera view)
      const clampedFret = clamp(n.fret, viewMinFret + 0.3, viewMaxFret - 0.3);
      const x = projectX(clampedFret, d);
      const noteLift = (10 + liftRatio * 22) * sc;
      const gemY = yPlane - noteLift;
      const gemW = Math.max(12, 34 * sc);
      const gemH = Math.max(9, 22 * sc);

      // Vertical drop-line stem to highway plane (Rocksmith signature cue)
      ctx.beginPath();
      ctx.moveTo(x, gemY + gemH * 0.35);
      ctx.lineTo(x, yPlane);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(1.2, 2.6 * sc);
      ctx.stroke();

      // Foot dot on highway plane
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, yPlane, Math.max(1.5, 3 * sc), 0, Math.PI * 2);
      ctx.fill();

      if (n.techniques.palmMute || n.techniques.deadNote) {
        // Framed Palm Mute / Dead Note X (matching screenshot)
        const boxW = gemW * 0.92;
        const boxH = gemH * 0.96;
        ctx.fillStyle = 'rgba(10, 15, 28, 0.88)';
        ctx.strokeStyle = style.color;
        ctx.lineWidth = Math.max(1.5, 2.5 * sc);
        ctx.shadowColor = style.color;
        ctx.shadowBlur = 10 * sc;
        this.roundRectPath(ctx, x - boxW * 0.5, gemY - boxH * 0.5, boxW, boxH, 4 * sc);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        this.drawPalmMuteCross(
          ctx,
          x,
          gemY,
          Math.min(boxW, boxH) * 0.34,
          n.techniques.deadNote ? '#94a3b8' : '#ffffff'
        );
      } else if (n.techniques.harmonic !== 'none') {
        // Diamond gem for harmonics
        const rx = gemW * 0.52;
        const ry = gemH * 0.68;
        ctx.shadowColor = style.color;
        ctx.shadowBlur = 14 * sc;
        ctx.fillStyle = style.color;
        ctx.beginPath();
        ctx.moveTo(x, gemY - ry);
        ctx.lineTo(x + rx, gemY);
        ctx.lineTo(x, gemY + ry);
        ctx.lineTo(x - rx, gemY);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2 * sc);
        ctx.stroke();
      } else {
        // Standard 3D beveled Rocksmith Note Gem
        const gx = x - gemW * 0.5;
        const gy = gemY - gemH * 0.5;

        ctx.shadowColor = style.color;
        ctx.shadowBlur = 12 * sc;

        // 3D base body
        const grad = ctx.createLinearGradient(gx, gy, gx, gy + gemH);
        grad.addColorStop(0, style.color);
        grad.addColorStop(1, style.dark);
        ctx.fillStyle = grad;
        this.roundRectPath(ctx, gx, gy, gemW, gemH, 5 * sc);
        ctx.fill();

        // Top specular bevel
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
        this.roundRectPath(ctx, gx + 2 * sc, gy + 1.5 * sc, Math.max(2, gemW - 4 * sc), gemH * 0.36, 3 * sc);
        ctx.fill();

        // Outer crisp rim (extra bright white halo for Hammer-On / Pull-Off)
        const isHP = n.techniques.hammerOn || n.techniques.pullOff;
        ctx.strokeStyle = isHP ? '#f8fafc' : 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = isHP ? Math.max(1.8, 2.8 * sc) : Math.max(1, 1.5 * sc);
        this.roundRectPath(ctx, gx, gy, gemW, gemH, 5 * sc);
        ctx.stroke();

        // Fret number inside gem
        if (showFretNumbers && sc > 0.34) {
          const fSize = Math.max(9, Math.round(12 * sc));
          ctx.font = `800 ${fSize}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#020617';
          ctx.fillText(String(n.fret), x + 0.6, gemY + 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(n.fret), x, gemY + 0.4);
        }
      }

      // Technique indicators (H/P badge, Bend upward arrow)
      if (sc > 0.38) {
        if (n.techniques.hammerOn || n.techniques.pullOff) {
          const label = n.techniques.hammerOn ? 'H' : 'P';
          const bx = x + gemW * 0.42;
          const by = gemY - gemH * 0.55;
          const r = Math.max(5.5, 7.5 * sc);
          ctx.fillStyle = '#0ea5e9';
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = `800 ${Math.max(8, Math.round(9 * sc))}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, bx, by + 0.5);
        }

        if (n.techniques.bendSemitones > 0) {
          // Curved upward bend arrow
          const ax = x + gemW * 0.48;
          const ay = gemY;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = Math.max(1.5, 2.2 * sc);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(ax + 8 * sc, ay - 4 * sc, ax + 6 * sc, ay - 18 * sc);
          ctx.stroke();

          // Arrowhead
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.moveTo(ax + 6 * sc, ay - 22 * sc);
          ctx.lineTo(ax + 2 * sc, ay - 14 * sc);
          ctx.lineTo(ax + 10 * sc, ay - 15 * sc);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.restore();
    }
  }

  private drawForegroundFretboard(params: {
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    hitY: number;
    fretboardBottomY: number;
    viewMinFret: number;
    viewMaxFret: number;
    stringCount: number;
    palette: StringVisualStyle[];
    projectX: (f: number, d: number) => number;
    getVisualStringRow: (s: number) => number;
    leftHanded: boolean;
    nowPerf: number;
  }): void {
    const {
      ctx,
      width,
      hitY,
      fretboardBottomY,
      viewMinFret,
      viewMaxFret,
      stringCount,
      palette,
      projectX,
      getVisualStringRow,
      leftHanded,
      nowPerf,
    } = params;

    const boardH = fretboardBottomY - hitY;
    const nutX = projectX(0.5, 0);
    const boardMinX = leftHanded ? 0 : Math.max(0, viewMinFret <= 0.5 ? nutX : 0);
    const boardMaxX = leftHanded ? Math.min(width, viewMinFret <= 0.5 ? nutX : width) : width;

    // Rosewood fretboard base
    const woodGrad = ctx.createLinearGradient(0, hitY, 0, fretboardBottomY);
    woodGrad.addColorStop(0, '#131722');
    woodGrad.addColorStop(0.5, '#0b0e16');
    woodGrad.addColorStop(1, '#05070c');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(boardMinX, hitY, boardMaxX - boardMinX, boardH);

    // Top hit-line metallic bevel
    ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.fillRect(boardMinX, hitY - 1.5, boardMaxX - boardMinX, 2.5);

    // Fret wires & inlays & numbers
    const firstFret = Math.max(1, Math.floor(viewMinFret));
    const lastFret = Math.min(24, Math.ceil(viewMaxFret));
    const activeStart = this.cameraLaneAnchor - 0.35;
    const activeEnd = this.cameraLaneAnchor + this.cameraLaneSpan - 0.65;

    // Active fret lane glow on foreground fretboard
    const actLeft = projectX(Math.max(0.5, this.cameraLaneAnchor - 0.5), 0);
    const actRight = projectX(Math.min(24.5, this.cameraLaneAnchor - 0.5 + this.cameraLaneSpan), 0);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.fillRect(Math.min(actLeft, actRight), hitY, Math.abs(actRight - actLeft), boardH);

    for (let f = firstFret; f <= lastFret; f++) {
      const wireX = projectX(f + 0.5, 0);
      const centerX = projectX(f, 0);
      const isInActive = f >= activeStart && f <= activeEnd;

      // Fret inlay dots
      if (INLAY_SINGLE_FRETS.has(f)) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.16)';
        ctx.beginPath();
        ctx.arc(centerX, hitY + boardH * 0.5, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (INLAY_DOUBLE_FRETS.has(f)) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.18)';
        ctx.beginPath();
        ctx.arc(centerX, hitY + boardH * 0.3, 5.5, 0, Math.PI * 2);
        ctx.arc(centerX, hitY + boardH * 0.7, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fret wire
      if (wireX > boardMinX && wireX < boardMaxX) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.42)';
        ctx.fillRect(wireX - 1, hitY + 2, 2, boardH - 4);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(wireX - 1, hitY + 2, 0.8, boardH - 4);
      }

      // Bottom fret number
      if (centerX > 18 && centerX < width - 18) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (isInActive) {
          ctx.font = '800 16px "JetBrains Mono", monospace';
          ctx.fillStyle = '#fde047';
          ctx.shadowColor = 'rgba(245, 158, 11, 0.85)';
          ctx.shadowBlur = 10;
        } else {
          ctx.font = '600 13px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(45, 212, 191, 0.45)';
        }
        ctx.fillText(String(f), centerX, fretboardBottomY + 8);
        ctx.restore();
      }
    }

    // Wooden headstock + Ivory Nut when fret 1 is in view
    if (viewMinFret <= 1.2) {
      const headWidth = 52;
      const nutW = 11;
      const drawX = leftHanded ? nutX : nutX - nutW;

      // Headstock wood corner
      ctx.save();
      const woodHeadGrad = ctx.createLinearGradient(0, hitY, 0, fretboardBottomY);
      woodHeadGrad.addColorStop(0, '#d6b08c');
      woodHeadGrad.addColorStop(0.5, '#b68962');
      woodHeadGrad.addColorStop(1, '#7c5536');
      ctx.fillStyle = woodHeadGrad;

      if (leftHanded) {
        this.roundRectPath(ctx, nutX + nutW - 2, hitY - 4, headWidth, boardH + 8, 8);
      } else {
        this.roundRectPath(ctx, drawX - headWidth + 2, hitY - 4, headWidth, boardH + 8, 8);
      }
      ctx.fill();

      // Ivory nut bar
      const nutGrad = ctx.createLinearGradient(drawX, 0, drawX + nutW, 0);
      nutGrad.addColorStop(0, '#e2e8f0');
      nutGrad.addColorStop(0.5, '#ffffff');
      nutGrad.addColorStop(1, '#cbd5e1');
      ctx.fillStyle = nutGrad;
      this.roundRectPath(ctx, drawX, hitY - 2, nutW, boardH + 4, 3);
      ctx.fill();
      ctx.restore();
    }

    // Draw Horizontal Colored Neon Strings with vibration physics
    const padY = boardH * 0.12;
    const usableH = boardH - padY * 2;

    for (let s = 0; s < stringCount; s++) {
      const style = palette[s] ?? palette[0];
      const row = getVisualStringRow(s);
      const baseY = hitY + padY + (row / Math.max(1, stringCount - 1)) * usableH;
      const energy = this.stringEnergies[s] ?? 0;
      // Lower strings (smaller index) are slightly thicker
      const thickness = lerp(3.1, 1.5, s / Math.max(1, stringCount - 1));

      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = thickness + energy * 1.4;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 8 + energy * 14;

      ctx.beginPath();
      if (energy > 0.02) {
        const segs = 36;
        const amp = energy * 4.5;
        const freq = nowPerf * 0.095;
        for (let i = 0; i <= segs; i++) {
          const frac = i / segs;
          const sx = lerp(boardMinX, boardMaxX, frac);
          const env = Math.sin(frac * Math.PI);
          const sy = baseY + Math.sin(frac * Math.PI * 5 + freq) * amp * env;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
      } else {
        ctx.moveTo(boardMinX, baseY);
        ctx.lineTo(boardMaxX, baseY);
      }
      ctx.stroke();

      // Thin white glowing inner filament
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.28 + energy * 0.55).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.7, thickness * 0.35);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHitFlares(params: {
    ctx: CanvasRenderingContext2D;
    hitY: number;
    fretboardBottomY: number;
    stringCount: number;
    notes: HighwayNote[];
    palette: StringVisualStyle[];
    songTimeMs: number;
    projectX: (f: number, d: number) => number;
    getVisualStringRow: (s: number) => number;
    nowPerf: number;
  }): void {
    const {
      ctx,
      hitY,
      fretboardBottomY,
      stringCount,
      notes,
      palette,
      songTimeMs,
      projectX,
      getVisualStringRow,
      nowPerf,
    } = params;

    const boardH = fretboardBottomY - hitY;
    const padY = boardH * 0.12;
    const usableH = boardH - padY * 2;

    // Sustained active notes glowing on the fretboard
    for (const n of notes) {
      if (n.startTimeMs > songTimeMs) break;
      if (n.endTimeMs < songTimeMs) continue;

      const style = palette[n.stringIndex] ?? palette[0];
      const row = getVisualStringRow(n.stringIndex);
      const sy = hitY + padY + (row / Math.max(1, stringCount - 1)) * usableH;

      ctx.save();
      if (n.isOpen) {
        const lx1 = projectX(this.cameraLaneAnchor - 0.5, 0);
        const lx2 = projectX(this.cameraLaneAnchor - 0.5 + this.cameraLaneSpan, 0);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.shadowColor = style.color;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(lx1, sy);
        ctx.lineTo(lx2, sy);
        ctx.stroke();
      } else {
        const sx = projectX(n.fret, 0);
        ctx.fillStyle = style.color;
        ctx.shadowColor = style.color;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Transient impact rings
    for (const f of this.hitFlares) {
      const age = (nowPerf - f.createdPerfMs) / 320;
      const alpha = clamp(1 - age, 0, 1);
      const row = getVisualStringRow(f.stringIndex);
      const sy = hitY + padY + (row / Math.max(1, stringCount - 1)) * usableH;
      const sx = f.isOpen
        ? projectX(this.cameraLaneAnchor + (this.cameraLaneSpan - 1) * 0.5, 0)
        : projectX(f.fret, 0);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 8 + age * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawPalmMuteCross(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string
  ): void {
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.8, r * 0.38);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
