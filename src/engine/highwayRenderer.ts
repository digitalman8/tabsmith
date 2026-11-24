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
  const k = 1.9;
  const z = clamp(zNorm, -0.08, 1.05);
  return (z * (1 + k)) / (1 + z * k);
}

const BASE_VISIBLE_FRETS = 16.5;
const MAX_DYNAMIC_VISIBLE_FRETS = 21.5;
const FULL_NECK_VISIBLE_FRETS = 22.5;
const FULL_NECK_CENTER_FRET = 11.75;

export class HighwayRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Smoothly animated camera state
  private cameraCenterFret = 8.4;
  private cameraVisibleFrets = BASE_VISIBLE_FRETS;
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

    this.cameraVisibleFrets = BASE_VISIBLE_FRETS;

    if (!track) {
      this.cameraCenterFret = BASE_VISIBLE_FRETS * 0.5 + 0.1;
      this.cameraLaneAnchor = 1;
      this.cameraLaneSpan = 5;
      return;
    }

    const span = this.findActiveLane(track.lanes, songTimeMs);
    this.cameraLaneAnchor = span.anchorFret;
    this.cameraLaneSpan = span.spanWidth;
    const minCenter = this.cameraVisibleFrets * 0.5 + 0.1;
    const maxCenter = 24.5 - this.cameraVisibleFrets * 0.5;
    this.cameraCenterFret = clamp(span.anchorFret + (span.spanWidth - 1) * 0.5, minCenter, maxCenter);
  }

  private findLaneAtExactTime(lanes: ActiveLaneSpan[], timeMs: number): ActiveLaneSpan {
    if (lanes.length === 0) {
      return { startTimeMs: 0, endTimeMs: 60000, anchorFret: 1, spanWidth: 5 };
    }
    const t = Math.max(0, timeMs);
    for (let i = 0; i < lanes.length; i++) {
      if (t >= lanes[i].startTimeMs && t <= lanes[i].endTimeMs) {
        return lanes[i];
      }
    }
    if (t < lanes[0].startTimeMs) return lanes[0];
    return lanes[lanes.length - 1];
  }

  private findActiveLane(lanes: ActiveLaneSpan[], timeMs: number): ActiveLaneSpan {
    // Look slightly ahead (240ms) for foreground fretboard active-lane highlight anticipation
    return this.findLaneAtExactTime(lanes, timeMs + 240);
  }

  /**
   * Computes smooth predictive camera framing (Rocksmith-style wide view):
   * - Shows ~16.5 frets by default, smoothly zooming out up to 21.5 frets during wide jumps
   * - Applies a horizontal deadzone so nearby fret movements never yank the camera
   * - In 'fullNeck' mode, keeps the entire neck (1–22) locked with zero movement
   */
  private computeCameraTargets(
    track: TrackTimeline,
    currentLane: ActiveLaneSpan,
    songTimeMs: number,
    lookaheadMs: number,
    cameraMode: PracticeSettings['cameraMode']
  ): { visibleFrets: number; centerFret: number } {
    if (cameraMode === 'fullNeck') {
      return { visibleFrets: FULL_NECK_VISIBLE_FRETS, centerFret: FULL_NECK_CENTER_FRET };
    }

    const windowStart = songTimeMs - 140;
    const windowEnd = songTimeMs + lookaheadMs * 1.12;

    let minFret = currentLane.anchorFret;
    let maxFret = currentLane.anchorFret + currentLane.spanWidth - 1;
    let foundNotes = false;
    let noteMin = Infinity;
    let noteMax = -Infinity;

    for (const n of track.notes) {
      if (n.endTimeMs < windowStart) continue;
      if (n.startTimeMs > windowEnd) break;
      if (n.isOpen || n.fret <= 0) continue;
      foundNotes = true;
      if (n.fret < noteMin) noteMin = n.fret;
      if (n.fret > noteMax) noteMax = n.fret;
      if (n.techniques.slideTargetFret !== null && n.techniques.slideTargetFret > 0) {
        if (n.techniques.slideTargetFret < noteMin) noteMin = n.techniques.slideTargetFret;
        if (n.techniques.slideTargetFret > noteMax) noteMax = n.techniques.slideTargetFret;
      }
    }

    if (foundNotes) {
      minFret = Math.min(minFret, noteMin);
      maxFret = Math.max(maxFret, noteMax);
    }

    const spread = maxFret - minFret;
    const targetVisibleFrets = clamp(
      Math.max(BASE_VISIBLE_FRETS, spread + 4.8),
      BASE_VISIBLE_FRETS,
      MAX_DYNAMIC_VISIBLE_FRETS
    );

    const minAllowedCenter = targetVisibleFrets * 0.5 + 0.1;
    const maxAllowedCenter = 24.5 - targetVisibleFrets * 0.5;

    // Deadzone check against current camera framing so small movements never pan
    const safeMargin = 2.0;
    const currentSafeMin = this.cameraCenterFret - targetVisibleFrets * 0.5 + safeMargin;
    const currentSafeMax = this.cameraCenterFret + targetVisibleFrets * 0.5 - safeMargin;

    let targetCenter = this.cameraCenterFret;
    const needsLeft = minFret < currentSafeMin;
    const needsRight = maxFret > currentSafeMax;

    if (needsLeft && needsRight) {
      targetCenter = (minFret + maxFret) * 0.5;
    } else if (needsLeft) {
      // Shift just enough to bring minFret comfortably inside the left margin
      targetCenter = minFret + targetVisibleFrets * 0.5 - (safeMargin + 0.6);
    } else if (needsRight) {
      // Shift just enough to bring maxFret comfortably inside the right margin
      targetCenter = maxFret - targetVisibleFrets * 0.5 + (safeMargin + 0.6);
    }

    return {
      visibleFrets: targetVisibleFrets,
      centerFret: clamp(targetCenter, minAllowedCenter, maxAllowedCenter),
    };
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

    // Update smooth camera & foreground active lane interpolation
    const lookaheadMs = settings.highwayLookaheadSec * 1000;
    const targetLane = this.findActiveLane(track.lanes, songTimeMs);
    const laneSmoothRate = 1 - Math.exp(-dt * 6.0);
    this.cameraLaneAnchor = lerp(this.cameraLaneAnchor, targetLane.anchorFret, laneSmoothRate);
    this.cameraLaneSpan = lerp(this.cameraLaneSpan, targetLane.spanWidth, laneSmoothRate);

    const camTargets = this.computeCameraTargets(
      track,
      targetLane,
      songTimeMs,
      lookaheadMs,
      settings.cameraMode
    );
    const cameraSmoothRate = 1 - Math.exp(-dt * 2.2);
    this.cameraVisibleFrets = lerp(this.cameraVisibleFrets, camTargets.visibleFrets, cameraSmoothRate);
    this.cameraCenterFret = lerp(this.cameraCenterFret, camTargets.centerFret, cameraSmoothRate);

    // Decay string vibrations & detect new note hits
    for (let i = 0; i < this.stringEnergies.length; i++) {
      this.stringEnergies[i] *= Math.exp(-dt * 8.5);
    }

    const palette = getStringPalette(track.stringCount, track.isBass);
    this.updateHitDetection(track.notes, palette, songTimeMs, isPlaying, nowPerf);

    // Layout geometry (Rocksmith-style deep wide perspective)
    const horizonY = height * 0.13;
    const hitY = height * 0.75;
    const fretboardBottomY = height * 0.90;
    const vanishX = width * 0.5;
    const boardWidth = width * 0.92;
    const visibleFrets = this.cameraVisibleFrets;
    const viewMinFret = this.cameraCenterFret - visibleFrets * 0.5;
    const viewMaxFret = this.cameraCenterFret + visibleFrets * 0.5;

    const projectScale = (depth: number): number => 1 - depth * 0.80;
    const projectX = (fretPos: number, depth: number): number => {
      const scale = projectScale(depth);
      let rel = (fretPos - this.cameraCenterFret) / visibleFrets;
      if (settings.leftHanded) rel = -rel;
      return vanishX + rel * boardWidth * scale;
    };

    const projectY = (depth: number): number => hitY - depth * (hitY - horizonY);

    const getVisualStringRow = (stringIndex: number): number => {
      if (settings.invertStrings) {
        return track.stringCount - 1 - stringIndex;
      }
      return stringIndex;
    };

    // 2. Highway floor + Time-Segmented Active Fret Lanes + Fret Rails
    this.drawHighwayFloorAndLanes({
      ctx,
      width,
      horizonY,
      hitY,
      lanes: track.lanes,
      songTimeMs,
      lookaheadMs,
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
      lanes: track.lanes,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      projectScale,
      leftHanded: settings.leftHanded,
    });

    // 4. Notes, Sustain Tails & Chord Panes (back-to-front painter's order)
    this.drawHighwayNotesAndChords({
      ctx,
      notes: track.notes,
      chords: track.chords,
      lanes: track.lanes,
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
    lanes: ActiveLaneSpan[];
    songTimeMs: number;
    lookaheadMs: number;
    viewMinFret: number;
    viewMaxFret: number;
    projectX: (f: number, d: number) => number;
    projectY: (d: number) => number;
    leftHanded: boolean;
  }): void {
    const {
      ctx,
      horizonY,
      hitY,
      lanes,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
    } = params;

    const firstEdge = Math.max(0.5, Math.floor(viewMinFret - 0.5) + 0.5);
    const lastEdge = Math.min(24.5, Math.ceil(viewMaxFret + 0.5) - 0.5);

    // Base highway dark translucent deck
    const leftNear = projectX(firstEdge, 0);
    const rightNear = projectX(lastEdge, 0);
    const leftFar = projectX(firstEdge, 1);
    const rightFar = projectX(lastEdge, 1);

    const floorGrad = ctx.createLinearGradient(0, horizonY, 0, hitY);
    floorGrad.addColorStop(0, 'rgba(6, 13, 26, 0.42)');
    floorGrad.addColorStop(1, 'rgba(8, 17, 34, 0.92)');

    ctx.beginPath();
    ctx.moveTo(leftNear, hitY);
    ctx.lineTo(leftFar, horizonY);
    ctx.lineTo(rightFar, horizonY);
    ctx.lineTo(rightNear, hitY);
    ctx.closePath();
    ctx.fillStyle = floorGrad;
    ctx.fill();

    // Base receding fret rails across entire visible neck
    for (let f = firstEdge; f <= lastEdge + 0.01; f += 1) {
      const xN = projectX(f, 0);
      const xF = projectX(f, 1);
      ctx.beginPath();
      ctx.moveTo(xN, hitY);
      ctx.lineTo(xF, horizonY);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Time-segmented Active Fret Lanes (Rocksmith-style receding blue carpet showing upcoming hand shifts)
    const effectiveLanes: ActiveLaneSpan[] =
      lanes.length > 0
        ? lanes
        : [
            {
              startTimeMs: 0,
              endTimeMs: songTimeMs + lookaheadMs + 60000,
              anchorFret: Math.round(this.cameraLaneAnchor),
              spanWidth: Math.round(this.cameraLaneSpan),
            },
          ];

    const windowEnd = songTimeMs + lookaheadMs;
    for (let i = 0; i < effectiveLanes.length; i++) {
      const span = effectiveLanes[i];
      if (span.endTimeMs <= songTimeMs) continue;
      if (span.startTimeMs >= windowEnd) break;

      const segStartMs = Math.max(songTimeMs, span.startTimeMs);
      const segEndMs = Math.min(windowEnd, span.endTimeMs);
      if (segEndMs <= segStartMs + 4) continue;

      const dNear = perspectiveDepth((segStartMs - songTimeMs) / lookaheadMs);
      const dFar = perspectiveDepth((segEndMs - songTimeMs) / lookaheadMs);
      const yNear = projectY(dNear);
      const yFar = projectY(dFar);

      const laneLeft = Math.max(0.5, span.anchorFret - 0.5);
      const laneRight = Math.min(24.5, laneLeft + span.spanWidth);

      const lNear = projectX(laneLeft, dNear);
      const rNear = projectX(laneRight, dNear);
      const lFar = projectX(laneLeft, dFar);
      const rFar = projectX(laneRight, dFar);

      const segGrad = ctx.createLinearGradient(0, yFar, 0, yNear);
      const farAlpha = clamp(0.10 + (1 - dFar) * 0.14, 0.06, 0.24);
      const nearAlpha = clamp(0.16 + (1 - dNear) * 0.14, 0.12, 0.30);
      segGrad.addColorStop(0, `rgba(37, 99, 235, ${farAlpha.toFixed(3)})`);
      segGrad.addColorStop(1, `rgba(59, 130, 246, ${nearAlpha.toFixed(3)})`);

      ctx.beginPath();
      ctx.moveTo(lNear, yNear);
      ctx.lineTo(lFar, yFar);
      ctx.lineTo(rFar, yFar);
      ctx.lineTo(rNear, yNear);
      ctx.closePath();
      ctx.fillStyle = segGrad;
      ctx.fill();

      // Internal fret lines inside this lane segment
      const firstInner = Math.ceil(laneLeft + 0.5) - 0.5;
      for (let f = firstInner; f < laneRight - 0.1; f += 1) {
        if (f <= laneLeft + 0.1) continue;
        ctx.beginPath();
        ctx.moveTo(projectX(f, dNear), yNear);
        ctx.lineTo(projectX(f, dFar), yFar);
        ctx.strokeStyle = `rgba(148, 163, 184, ${(0.30 * (1 - dNear * 0.45)).toFixed(3)})`;
        ctx.lineWidth = 1.15;
        ctx.stroke();
      }

      // Glowing cyan side rails for this lane segment
      const railAlpha = clamp(0.76 * (1 - dNear * 0.4), 0.25, 0.78);
      ctx.strokeStyle = `rgba(103, 232, 249, ${railAlpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, 2.2 * (1 - dNear * 0.45));
      ctx.beginPath();
      ctx.moveTo(lNear, yNear);
      ctx.lineTo(lFar, yFar);
      ctx.moveTo(rNear, yNear);
      ctx.lineTo(rFar, yFar);
      ctx.stroke();

      // Highlighted leading edge when a new hand-position shift is approaching
      if (span.startTimeMs > songTimeMs + 12) {
        ctx.beginPath();
        ctx.moveTo(lNear, yNear);
        ctx.lineTo(rNear, yNear);
        ctx.strokeStyle = `rgba(125, 211, 252, ${(railAlpha * 0.95).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.3, 2.4 * (1 - dNear * 0.5));
        ctx.stroke();
      }
    }
  }

  private drawMeasureAndBeatLines(params: {
    ctx: CanvasRenderingContext2D;
    measures: MeasureMarker[];
    lanes: ActiveLaneSpan[];
    songTimeMs: number;
    lookaheadMs: number;
    viewMinFret: number;
    viewMaxFret: number;
    projectX: (f: number, d: number) => number;
    projectY: (d: number) => number;
    projectScale: (d: number) => number;
    leftHanded: boolean;
  }): void {
    const {
      ctx,
      measures,
      lanes,
      songTimeMs,
      lookaheadMs,
      viewMinFret,
      viewMaxFret,
      projectX,
      projectY,
      projectScale,
      leftHanded,
    } = params;

    const firstEdge = Math.max(0.5, Math.floor(viewMinFret - 0.5) + 0.5);
    const lastEdge = Math.min(24.5, Math.ceil(viewMaxFret + 0.5) - 0.5);

    for (const m of measures) {
      if (m.endTimeMs < songTimeMs - 150) continue;
      if (m.startTimeMs > songTimeMs + lookaheadMs) break;

      const laneAtMeasure = this.findLaneAtExactTime(lanes, m.startTimeMs + 5);
      const laneLeft = Math.max(0.5, laneAtMeasure.anchorFret - 0.5);
      const laneRight = Math.min(24.5, laneLeft + laneAtMeasure.spanWidth);

      // Measure start line
      const dtMeasure = m.startTimeMs - songTimeMs;
      if (dtMeasure >= -80 && dtMeasure <= lookaheadMs) {
        const d = perspectiveDepth(dtMeasure / lookaheadMs);
        const y = projectY(d);
        const x1 = projectX(firstEdge, d);
        const x2 = projectX(lastEdge, d);
        const lx1 = projectX(laneLeft, d);
        const lx2 = projectX(laneRight, d);
        const alpha = clamp(1 - d * 0.80, 0.08, 0.78);

        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.strokeStyle = `rgba(148, 163, 184, ${(alpha * 0.30).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Brighter bar line inside this measure's Active Lane
        ctx.beginPath();
        ctx.moveTo(lx1, y);
        ctx.lineTo(lx2, y);
        ctx.strokeStyle = `rgba(226, 232, 240, ${(alpha * 0.90).toFixed(3)})`;
        ctx.lineWidth = 1.7 * (1 - d * 0.45);
        ctx.stroke();

        // Measure number badge
        const scale = projectScale(d);
        if (scale > 0.30) {
          const labelX = leftHanded ? Math.max(lx1, lx2) + 8 : Math.min(lx1, lx2) - 8;
          ctx.fillStyle = `rgba(186, 230, 253, ${(alpha * 0.92).toFixed(3)})`;
          ctx.font = `700 ${Math.max(10, Math.round(13 * scale))}px "JetBrains Mono", monospace`;
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
        const beatLane = this.findLaneAtExactTime(lanes, bt + 5);
        const bLeft = Math.max(0.5, beatLane.anchorFret - 0.5);
        const bRight = Math.min(24.5, bLeft + beatLane.spanWidth);
        const d = perspectiveDepth(dtBeat / lookaheadMs);
        const y = projectY(d);
        const lx1 = projectX(bLeft, d);
        const lx2 = projectX(bRight, d);
        const alpha = clamp((1 - d) * 0.34, 0.03, 0.34);

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
    lanes: ActiveLaneSpan[];
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
      lanes,
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

    // Precompute same-fret sub-offsets for simultaneous sustains so multi-string chords
    // on the same fret (e.g., E5 Yellow + Blue on fret 2) never swallow each other
    const sustainingNotes = visibleNotes.filter((n) => {
      const hasLongTail = n.durationMs > 230 || n.techniques.slideType !== 'none' || n.techniques.vibrato;
      return hasLongTail && !n.isOpen && !n.techniques.deadNote;
    });

    const sustainSlotMap = new Map<string, { offsetFret: number; groupSize: number }>();
    for (const n of sustainingNotes) {
      const overlapping = sustainingNotes
        .filter(
          (o) =>
            o.fret === n.fret &&
            o.startTimeMs < n.endTimeMs - 20 &&
            o.endTimeMs > n.startTimeMs + 20
        )
        .sort((a, b) => {
          const rowDiff = getVisualStringRow(a.stringIndex) - getVisualStringRow(b.stringIndex);
          return rowDiff !== 0 ? rowDiff : a.id.localeCompare(b.id);
        });

      const groupSize = overlapping.length;
      if (groupSize <= 1) {
        sustainSlotMap.set(n.id, { offsetFret: 0, groupSize: 1 });
      } else {
        const rank = overlapping.findIndex((o) => o.id === n.id);
        const step = groupSize === 2 ? 0.34 : Math.min(0.24, 0.64 / (groupSize - 1));
        const offsetFret = clamp((rank - (groupSize - 1) * 0.5) * step, -0.34, 0.34);
        sustainSlotMap.set(n.id, { offsetFret, groupSize });
      }
    }

    // Precompute same-fret sub-offsets for simultaneous note gems
    const gemSlotMap = new Map<string, { offsetFret: number; groupSize: number }>();
    for (const n of visibleNotes) {
      if (n.isOpen) continue;
      const sameFretSimultaneous = visibleNotes
        .filter(
          (o) =>
            !o.isOpen &&
            o.fret === n.fret &&
            Math.abs(o.startTimeMs - n.startTimeMs) < 45
        )
        .sort((a, b) => {
          const rowDiff = getVisualStringRow(a.stringIndex) - getVisualStringRow(b.stringIndex);
          return rowDiff !== 0 ? rowDiff : a.id.localeCompare(b.id);
        });

      const groupSize = sameFretSimultaneous.length;
      if (groupSize <= 1) {
        gemSlotMap.set(n.id, { offsetFret: 0, groupSize: 1 });
      } else {
        const rank = sameFretSimultaneous.findIndex((o) => o.id === n.id);
        const step = groupSize === 2 ? 0.32 : Math.min(0.22, 0.58 / (groupSize - 1));
        const offsetFret = clamp((rank - (groupSize - 1) * 0.5) * step, -0.32, 0.32);
        gemSlotMap.set(n.id, { offsetFret, groupSize });
      }
    }

    // 1. Draw Sustain Tails & Slides (furthest to closest, higher strings behind lower visual rows)
    const sortedSustains = [...sustainingNotes].sort((a, b) => {
      const timeDiff = Math.round(b.startTimeMs / 20) - Math.round(a.startTimeMs / 20);
      if (timeDiff !== 0) return timeDiff;
      return getVisualStringRow(a.stringIndex) - getVisualStringRow(b.stringIndex);
    });

    for (const n of sortedSustains) {
      const startClampedMs = Math.max(songTimeMs, n.startTimeMs);
      const endClampedMs = Math.min(songTimeMs + lookaheadMs, n.endTimeMs);
      if (endClampedMs <= startClampedMs + 20) continue;

      const style = palette[n.stringIndex] ?? palette[0];
      const visualRow = getVisualStringRow(n.stringIndex);
      const liftRatio = (stringCount - 1 - visualRow) / Math.max(1, stringCount - 1);
      const slot = sustainSlotMap.get(n.id) ?? { offsetFret: 0, groupSize: 1 };

      const startFret = n.fret + slot.offsetFret;
      let endFret = n.fret + slot.offsetFret;
      if (n.techniques.slideTargetFret !== null && n.techniques.slideTargetFret > 0) {
        endFret = n.techniques.slideTargetFret + slot.offsetFret;
      } else if (n.techniques.slideType === 'outUp') {
        endFret = Math.min(24, n.fret + 3) + slot.offsetFret;
      } else if (n.techniques.slideType === 'outDown') {
        endFret = Math.max(1, n.fret - 3) + slot.offsetFret;
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
        // Stronger per-string vertical lift so layered sustains remain clearly distinct
        const y = yPlane - (8 + liftRatio * 42) * sc;

        let fPos = lerp(startFret, endFret, noteFrac);
        if (n.techniques.vibrato) {
          fPos += Math.sin(noteFrac * Math.PI * 6) * 0.16;
        }
        const x = projectX(fPos, d);
        if (sIdx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      const dStart = perspectiveDepth((startClampedMs - songTimeMs) / lookaheadMs);
      const scStart = projectScale(dStart);
      const baseAlpha = clamp(0.84 - dStart * 0.44, 0.24, 0.88);
      const tailWidth =
        slot.groupSize > 1
          ? Math.max(2.8, 7.6 * scStart)
          : Math.max(3.2, 11.2 * scStart);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Dark outer separator stroke so parallel multi-string sustains stay crisp
      ctx.globalAlpha = baseAlpha * 0.92;
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.86)';
      ctx.lineWidth = tailWidth + Math.max(1.8, 3.0 * scStart);
      ctx.shadowBlur = 0;
      ctx.stroke();

      // Main neon ribbon
      ctx.globalAlpha = baseAlpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = tailWidth;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = slot.groupSize > 1 ? 6 : 10;
      ctx.stroke();

      // Inner bright core
      ctx.globalAlpha = baseAlpha * 0.68;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.1, tailWidth * 0.30);
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw Chord Panes (back-to-front)
    for (let i = visibleChords.length - 1; i >= 0; i--) {
      const ch = visibleChords[i];
      const dtMs = ch.startTimeMs - songTimeMs;
      const d = perspectiveDepth(dtMs / lookaheadMs);
      const sc = projectScale(d);
      const y = projectY(d);

      const chLane = this.findLaneAtExactTime(lanes, ch.startTimeMs + 5);
      const chLaneLeft = Math.max(0.5, chLane.anchorFret - 0.5);
      const chLaneRight = Math.min(24.5, chLaneLeft + chLane.spanWidth);

      const padFret = ch.minFret === ch.maxFret ? 0.52 : 0.46;
      const leftF = ch.minFret > 0 ? Math.max(0.5, ch.minFret - padFret) : chLaneLeft;
      const rightF = ch.maxFret > 0 ? Math.min(24.5, ch.maxFret + padFret) : chLaneRight;
      const xA = projectX(leftF, d);
      const xB = projectX(rightF, d);
      const xMin = Math.min(xA, xB);
      const xMax = Math.max(xA, xB);
      const paneW = Math.max(20, xMax - xMin);
      const paneH = (ch.isRepeatStrum ? 20 : 78) * sc;
      const alpha = clamp(1 - d * 0.76, 0.16, 0.94);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ch.isRepeatStrum
        ? 'rgba(56, 189, 248, 0.10)'
        : 'rgba(15, 35, 66, 0.36)';
      ctx.strokeStyle = ch.isRepeatStrum
        ? 'rgba(125, 211, 252, 0.55)'
        : 'rgba(56, 189, 248, 0.78)';
      ctx.lineWidth = ch.isRepeatStrum ? 1.4 : 2.1 * sc;

      this.roundRectPath(ctx, xMin, y - paneH, paneW, paneH, 6 * sc);
      ctx.fill();
      ctx.stroke();

      if (!ch.isRepeatStrum && ch.name && sc > 0.30) {
        const fontSize = Math.max(11, Math.round(15 * sc));
        ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
        const textW = ctx.measureText(ch.name).width;
        const badgeW = textW + 16 * sc;
        const badgeH = Math.max(18, (fontSize + 8) * Math.max(0.75, sc));
        const bx = xMin;
        const by = y - paneH - badgeH - 3 * sc;

        ctx.fillStyle = 'rgba(8, 145, 178, 0.95)';
        this.roundRectPath(ctx, bx, by, badgeW, badgeH, 5 * sc);
        ctx.fill();
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.65)';
        ctx.lineWidth = Math.max(1, 1.2 * sc);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.name, bx + 8 * sc, by + badgeH * 0.5 + 0.5);
      }
      ctx.restore();
    }

    // 3. Draw Note Gems back-to-front (farther beats first; within same beat, top visual row behind bottom row)
    visibleNotes.sort((a, b) => {
      const timeDiff = Math.round(b.startTimeMs / 15) - Math.round(a.startTimeMs / 15);
      if (timeDiff !== 0) return timeDiff;
      return getVisualStringRow(a.stringIndex) - getVisualStringRow(b.stringIndex);
    });

    for (const n of visibleNotes) {
      if (n.startTimeMs < songTimeMs - 55) continue;
      const dtMs = n.startTimeMs - songTimeMs;
      const d = perspectiveDepth(dtMs / lookaheadMs);
      const sc = projectScale(d);
      const yPlane = projectY(d);
      const style = palette[n.stringIndex] ?? palette[0];
      const visualRow = getVisualStringRow(n.stringIndex);
      const liftRatio = (stringCount - 1 - visualRow) / Math.max(1, stringCount - 1);
      const alpha = clamp(1 - d * 0.68, 0.18, 1.0);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (n.isOpen) {
        // Open string note: wide glowing horizontal bar spanning the Active Fret Lane at this note's time
        const noteLane = this.findLaneAtExactTime(lanes, n.startTimeMs + 5);
        const nLaneLeft = Math.max(0.5, noteLane.anchorFret - 0.5);
        const nLaneRight = Math.min(24.5, nLaneLeft + noteLane.spanWidth);
        const lx1 = projectX(nLaneLeft + 0.08, d);
        const lx2 = projectX(nLaneRight - 0.08, d);
        const barX = Math.min(lx1, lx2);
        const barW = Math.abs(lx2 - lx1);
        const barH = Math.max(5.5, 13.5 * sc);
        const barY = yPlane - barH * 0.5 - liftRatio * 10 * sc;

        ctx.shadowColor = style.color;
        ctx.shadowBlur = 14 * sc;
        ctx.fillStyle = style.color;
        this.roundRectPath(ctx, barX, barY, barW, barH, 4 * sc);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        this.roundRectPath(ctx, barX + 2, barY + 1.5 * sc, Math.max(2, barW - 4), barH * 0.34, 2 * sc);
        ctx.fill();

        if (n.techniques.palmMute && sc > 0.34) {
          this.drawPalmMuteCross(ctx, barX + barW * 0.5, barY + barH * 0.5, 10 * sc, '#ffffff');
        }
        ctx.restore();
        continue;
      }

      const gemSlot = gemSlotMap.get(n.id) ?? { offsetFret: 0, groupSize: 1 };
      const targetFretPos = n.fret + gemSlot.offsetFret;
      const clampedFret = clamp(targetFretPos, viewMinFret + 0.3, viewMaxFret - 0.3);
      const x = projectX(clampedFret, d);
      const noteLift = (10 + liftRatio * 52) * sc;
      const gemY = yPlane - noteLift;
      const gemW =
        gemSlot.groupSize > 1
          ? Math.max(16, 36 * sc)
          : Math.max(18, 42 * sc);
      const gemH =
        gemSlot.groupSize > 1
          ? Math.max(13, 24 * sc)
          : Math.max(14, 26 * sc);

      // Vertical drop-line stem to highway plane (Rocksmith signature cue)
      ctx.beginPath();
      ctx.moveTo(x, gemY + gemH * 0.42);
      ctx.lineTo(x, yPlane);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(1.3, 2.6 * sc);
      ctx.stroke();

      // Foot dot on highway plane
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, yPlane, Math.max(1.5, 3 * sc), 0, Math.PI * 2);
      ctx.fill();

      if (n.techniques.palmMute || n.techniques.deadNote) {
        // Framed Palm Mute / Dead Note X
        const boxW = gemW * 0.92;
        const boxH = gemH * 0.96;
        ctx.fillStyle = 'rgba(10, 15, 28, 0.92)';
        ctx.strokeStyle = style.color;
        ctx.lineWidth = Math.max(1.6, 2.6 * sc);
        ctx.shadowColor = style.color;
        ctx.shadowBlur = 10 * sc;
        this.roundRectPath(ctx, x - boxW * 0.5, gemY - boxH * 0.5, boxW, boxH, 5 * sc);
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
        ctx.lineWidth = Math.max(1.2, 2.2 * sc);
        ctx.stroke();
      } else {
        // Standard 3D beveled Rocksmith Note Gem
        const gx = x - gemW * 0.5;
        const gy = gemY - gemH * 0.5;

        // Crisp dark outer separator halo (keeps stacked/adjacent chord gems cleanly separated)
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.lineWidth = Math.max(2.2, 3.6 * sc);
        this.roundRectPath(ctx, gx, gy, gemW, gemH, 6 * sc);
        ctx.stroke();

        ctx.shadowColor = style.color;
        ctx.shadowBlur = gemSlot.groupSize > 1 ? 8 * sc : 12 * sc;

        // 3D base body
        const grad = ctx.createLinearGradient(gx, gy, gx, gy + gemH);
        grad.addColorStop(0, style.color);
        grad.addColorStop(1, style.dark);
        ctx.fillStyle = grad;
        this.roundRectPath(ctx, gx, gy, gemW, gemH, 6 * sc);
        ctx.fill();

        // Top specular bevel
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
        this.roundRectPath(ctx, gx + 2 * sc, gy + 1.5 * sc, Math.max(2, gemW - 4 * sc), gemH * 0.36, 3.5 * sc);
        ctx.fill();

        // Outer crisp rim (extra bright white halo for Hammer-On / Pull-Off)
        const isHP = n.techniques.hammerOn || n.techniques.pullOff;
        ctx.strokeStyle = isHP ? '#f8fafc' : 'rgba(255, 255, 255, 0.80)';
        ctx.lineWidth = isHP ? Math.max(1.8, 2.8 * sc) : Math.max(1.1, 1.6 * sc);
        this.roundRectPath(ctx, gx, gy, gemW, gemH, 6 * sc);
        ctx.stroke();

        // High-contrast larger fret number inside gem
        if (showFretNumbers && sc > 0.28) {
          const fretStr = String(n.fret);
          const basePx = fretStr.length >= 2 ? 15.5 : 17.5;
          const groupScale = gemSlot.groupSize > 1 ? 0.9 : 1.0;
          const fSize = Math.max(11, Math.round(basePx * groupScale * sc));
          ctx.font = `900 ${fSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(2, 6, 23, 0.95)';
          ctx.lineWidth = Math.max(2.2, 3.2 * sc);
          ctx.strokeText(fretStr, x, gemY + 0.6);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(fretStr, x, gemY + 0.6);
        }
      }

      // Technique indicators (H/P badge, Bend upward arrow)
      if (sc > 0.34) {
        if (n.techniques.hammerOn || n.techniques.pullOff) {
          const label = n.techniques.hammerOn ? 'H' : 'P';
          const bx = x + gemW * 0.42;
          const by = gemY - gemH * 0.55;
          const r = Math.max(6, 8 * sc);
          ctx.fillStyle = '#0ea5e9';
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = `800 ${Math.max(8, Math.round(10 * sc))}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, bx, by + 0.5);
        }

        if (n.techniques.bendSemitones > 0) {
          // Curved upward bend arrow
          const ax = x + gemW * 0.48;
          const ay = gemY;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = Math.max(1.6, 2.4 * sc);
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
      if (centerX > 16 && centerX < width - 16) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (isInActive) {
          ctx.font = '800 20px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#fde047';
          ctx.shadowColor = 'rgba(245, 158, 11, 0.92)';
          ctx.shadowBlur = 12;
        } else {
          ctx.font = '700 15px Inter, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(103, 232, 249, 0.58)';
        }
        ctx.fillText(String(f), centerX, fretboardBottomY + 7);
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
