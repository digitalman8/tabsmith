import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  Check,
  Hand,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AudioSyncConfig, SongData, TrackTimeline } from '../types/music';
import {
  getSegmentTempoRatio,
  removeAnchorById,
  tabToAudioMs,
  upsertMeasureAnchor,
} from '../engine/syncMap';
import { buildAutoInitialSync, type WaveformData } from '../engine/waveformAnalyzer';

interface AudioSyncStudioModalProps {
  isOpen: boolean;
  song: SongData | null;
  track: TrackTimeline | null;
  audioFileName: string | null;
  waveform: WaveformData | null;
  isWaveformLoading: boolean;
  syncConfig: AudioSyncConfig;
  isPlaying: boolean;
  playbackSpeed: number;
  getExternalAudioTimeMs: () => number;
  onClose: () => void;
  onChangeSyncConfig: (next: AudioSyncConfig) => void;
  onSeekAudioMs: (audioMs: number) => void;
  onPlayPause: (skipCountIn: boolean) => void;
  onSetSpeed: (speed: number) => void;
  onSetStudioMetronome: (enabled: boolean | null) => void;
}

type TapStepMode = '1' | '2' | '4' | 'section';

function formatAudioTime(ms: number): string {
  const safe = Math.max(0, ms);
  const min = Math.floor(safe / 60000);
  const sec = Math.floor((safe % 60000) / 1000);
  const hundredths = Math.floor((safe % 1000) / 10);
  return `${min}:${String(sec).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const AudioSyncStudioModal: React.FC<AudioSyncStudioModalProps> = ({
  isOpen,
  song,
  track,
  audioFileName,
  waveform,
  isWaveformLoading,
  syncConfig,
  isPlaying,
  playbackSpeed,
  getExternalAudioTimeMs,
  onClose,
  onChangeSyncConfig,
  onSeekAudioMs,
  onPlayPause,
  onSetSpeed,
  onSetStudioMetronome,
}) => {
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState(3);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [followCursor, setFollowCursor] = useState(true);
  const [studioMetronome, setStudioMetronome] = useState(true);

  const [hoveredMeasureIdx, setHoveredMeasureIdx] = useState<number | null>(null);
  const [draggingMeasureIdx, setDraggingMeasureIdx] = useState<number | null>(null);

  // Tap Sync state
  const [tapSyncActive, setTapSyncActive] = useState(false);
  const [tapStepMode, setTapStepMode] = useState<TapStepMode>('4');
  const [tapTargetMeasureIdx, setTapTargetMeasureIdx] = useState(0);
  const [tapFlashPerf, setTapFlashPerf] = useState(0);

  const totalAudioMs = useMemo(() => {
    const wfDur = waveform?.durationMs ?? 0;
    const songDur = song?.durationMs ?? 0;
    return Math.max(wfDur, songDur, 10000);
  }, [song?.durationMs, waveform?.durationMs]);

  const viewSpanMs = Math.max(2500, totalAudioMs / zoom);
  const maxViewStartMs = Math.max(0, totalAudioMs - viewSpanMs);

  // Auto-enable guide metronome while studio modal is open
  useEffect(() => {
    if (!isOpen) return;
    onSetStudioMetronome(studioMetronome);
    return () => {
      onSetStudioMetronome(null);
    };
  }, [isOpen, onSetStudioMetronome, studioMetronome]);

  // Reset Tap Sync when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTapSyncActive(false);
      setDraggingMeasureIdx(null);
    }
  }, [isOpen]);

  // Precompute measure audio timestamps from current syncConfig
  const measurePositions = useMemo(() => {
    if (!song) return [];
    const anchorSet = new Set(syncConfig.anchors.map((a) => a.measureIndex));
    return song.measures.map((m) => ({
      measureIndex: m.unrolledIndex,
      tabTimeMs: m.startTimeMs,
      audioTimeMs: tabToAudioMs(m.startTimeMs, syncConfig),
      sectionName: m.sectionName,
      isAnchored: anchorSet.has(m.unrolledIndex),
    }));
  }, [song, syncConfig]);

  const latestRef = useRef({
    waveform,
    song,
    track,
    syncConfig,
    measurePositions,
    viewStartMs,
    viewSpanMs,
    totalAudioMs,
    maxViewStartMs,
    followCursor,
    isPlaying,
    hoveredMeasureIdx,
    draggingMeasureIdx,
    getExternalAudioTimeMs,
  });
  latestRef.current = {
    waveform,
    song,
    track,
    syncConfig,
    measurePositions,
    viewStartMs,
    viewSpanMs,
    totalAudioMs,
    maxViewStartMs,
    followCursor,
    isPlaying,
    hoveredMeasureIdx,
    draggingMeasureIdx,
    getExternalAudioTimeMs,
  };

  // Draw 60fps interactive Waveform + Measure grid + Note markers + Playhead
  useEffect(() => {
    if (!isOpen) return;
    const wrap = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let size = { w: 900, h: 220, dpr: 1 };
    const updateSize = () => {
      const rect = wrap.getBoundingClientRect();
      size = {
        w: Math.max(320, rect.width),
        h: Math.max(160, rect.height),
        dpr: Math.min(2, window.devicePixelRatio || 1),
      };
    };
    updateSize();
    const obs = new ResizeObserver(updateSize);
    obs.observe(wrap);

    let rafId = 0;
    const draw = () => {
      const {
        waveform: wf,
        track: tr,
        syncConfig: cfg,
        measurePositions: mPos,
        viewStartMs: vStart,
        viewSpanMs: vSpan,
        maxViewStartMs: maxStart,
        followCursor: follow,
        isPlaying: playing,
        hoveredMeasureIdx: hovIdx,
        draggingMeasureIdx: dragIdx,
        getExternalAudioTimeMs: getExtMs,
      } = latestRef.current;

      const curAudioMs = getExtMs();

      // Auto-follow playhead if enabled
      if (playing && follow && dragIdx === null) {
        if (curAudioMs > vStart + vSpan * 0.82 || curAudioMs < vStart) {
          const targetStart = Math.max(0, Math.min(maxStart, curAudioMs - vSpan * 0.22));
          setViewStartMs(targetStart);
        }
      }

      const { w, h, dpr } = size;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = '#040914';
      ctx.fillRect(0, 0, w, h);

      const headerH = 26;
      const rulerH = 20;
      const waveTop = headerH;
      const waveBot = h - rulerH;
      const waveMid = (waveTop + waveBot) * 0.5;
      const waveHalfH = (waveBot - waveTop) * 0.44;

      // Top note/section strip
      ctx.fillStyle = '#081224';
      ctx.fillRect(0, 0, w, headerH);
      ctx.fillStyle = '#060c18';
      ctx.fillRect(0, waveBot, w, rulerH);

      const msToX = (ms: number) => ((ms - vStart) / vSpan) * w;

      // Waveform envelope
      if (wf && wf.peaksMax.length > 0) {
        const totalBuckets = wf.peaksMax.length;
        const pxStep = 2;
        ctx.fillStyle = 'rgba(16, 185, 129, 0.34)';
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.72)';
        ctx.lineWidth = 1;

        for (let px = 0; px < w; px += pxStep) {
          const msA = vStart + (px / w) * vSpan;
          const msB = vStart + ((px + pxStep) / w) * vSpan;
          if (msB < 0 || msA > wf.durationMs) continue;

          const bStart = Math.max(0, Math.floor((msA / wf.durationMs) * totalBuckets));
          const bEnd = Math.min(totalBuckets - 1, Math.ceil((msB / wf.durationMs) * totalBuckets));
          let minP = 0;
          let maxP = 0;
          for (let b = bStart; b <= bEnd; b++) {
            if (wf.peaksMin[b] < minP) minP = wf.peaksMin[b];
            if (wf.peaksMax[b] > maxP) maxP = wf.peaksMax[b];
          }
          const yTop = waveMid - maxP * waveHalfH;
          const yBot = waveMid - minP * waveHalfH;
          const barH = Math.max(1.5, yBot - yTop);
          ctx.fillRect(px, yTop, pxStep, barH);
        }

        // First onset marker
        if (wf.firstOnsetMs >= vStart && wf.firstOnsetMs <= vStart + vSpan) {
          const ox = msToX(wf.firstOnsetMs);
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(ox, waveTop);
          ctx.lineTo(ox, waveBot);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Center zero line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, waveMid);
      ctx.lineTo(w, waveMid);
      ctx.stroke();

      // Active track guitar notes along top strip
      if (tr) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
        for (const n of tr.notes) {
          const audioMs = tabToAudioMs(n.startTimeMs, cfg);
          if (audioMs < vStart - 50) continue;
          if (audioMs > vStart + vSpan + 50) break;
          const nx = msToX(audioMs);
          ctx.fillRect(nx - 1, headerH - 7, 2, 5);
        }
      }

      // Time ruler ticks at bottom
      const approxTicks = Math.max(4, Math.floor(w / 95));
      const rawStep = vSpan / approxTicks;
      const niceSteps = [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
      const stepMs = niceSteps.find((s) => s >= rawStep) ?? 60000;
      const firstTick = Math.ceil(vStart / stepMs) * stepMs;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let t = firstTick; t <= vStart + vSpan; t += stepMs) {
        const tx = msToX(t);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.beginPath();
        ctx.moveTo(tx, waveBot);
        ctx.lineTo(tx, waveBot + 4);
        ctx.stroke();
        ctx.fillText(formatAudioTime(t), tx, waveBot + 12);
      }

      // Measure lines & Anchor Pins
      const avgMeasurePx =
        mPos.length > 1
          ? Math.abs(msToX(mPos[1].audioTimeMs) - msToX(mPos[0].audioTimeMs))
          : 60;
      const labelEvery = avgMeasurePx < 24 ? 4 : avgMeasurePx < 42 ? 2 : 1;

      for (const mp of mPos) {
        if (mp.audioTimeMs < vStart - 40 || mp.audioTimeMs > vStart + vSpan + 40) continue;
        const mx = msToX(mp.audioTimeMs);
        const isActiveHover = dragIdx === mp.measureIndex || hovIdx === mp.measureIndex;

        ctx.save();
        if (mp.isAnchored || isActiveHover) {
          ctx.strokeStyle = isActiveHover ? '#fde047' : '#f59e0b';
          ctx.lineWidth = isActiveHover ? 2.6 : 2;
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.moveTo(mx, waveTop);
        ctx.lineTo(mx, waveBot);
        ctx.stroke();

        // Anchor diamond badge at top
        if (mp.isAnchored) {
          ctx.fillStyle = isActiveHover ? '#fde047' : '#f59e0b';
          ctx.beginPath();
          ctx.moveTo(mx, 4);
          ctx.lineTo(mx + 6, 10);
          ctx.lineTo(mx, 16);
          ctx.lineTo(mx - 6, 10);
          ctx.closePath();
          ctx.fill();
        }

        if (mp.isAnchored || isActiveHover || mp.measureIndex % labelEvery === 0) {
          const tag = `C${mp.measureIndex + 1}`;
          ctx.font = mp.isAnchored
            ? '800 10px "JetBrains Mono", monospace'
            : '600 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillStyle = mp.isAnchored
            ? '#fde047'
            : isActiveHover
            ? '#ffffff'
            : 'rgba(203, 213, 225, 0.78)';
          ctx.fillText(tag, mx + 4, mp.isAnchored ? 3 : 4);
        }

        if (mp.sectionName) {
          ctx.font = '700 9px Inter, sans-serif';
          ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
          ctx.textAlign = 'left';
          ctx.fillText(mp.sectionName, mx + 4, waveTop + 4);
        }
        ctx.restore();
      }

      // Live Playhead Cursor
      if (curAudioMs >= vStart - 10 && curAudioMs <= vStart + vSpan + 10) {
        const px = msToX(curAudioMs);
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, waveBot);
        ctx.stroke();

        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.moveTo(px - 6, 0);
        ctx.lineTo(px + 6, 0);
        ctx.lineTo(px, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      obs.disconnect();
    };
  }, [isOpen]);

  const audioMsFromClientX = useCallback(
    (clientX: number): number => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return 0;
      const rect = wrap.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      return viewStartMs + frac * viewSpanMs;
    },
    [viewSpanMs, viewStartMs]
  );

  const findNearestMeasure = useCallback(
    (clientX: number): number | null => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return null;
      const rect = wrap.getBoundingClientRect();
      const pxPerMs = rect.width / viewSpanMs;
      const targetAudioMs = audioMsFromClientX(clientX);

      let bestIdx: number | null = null;
      let bestDistPx = 11; // 11px hit tolerance
      for (const mp of measurePositions) {
        const distPx = Math.abs(mp.audioTimeMs - targetAudioMs) * pxPerMs;
        if (distPx < bestDistPx) {
          bestDistPx = distPx;
          bestIdx = mp.measureIndex;
        }
      }
      return bestIdx;
    },
    [audioMsFromClientX, measurePositions, viewSpanMs]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const nearMeasure = findNearestMeasure(e.clientX);
    if (nearMeasure !== null) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingMeasureIdx(nearMeasure);
      return;
    }
    const clickedAudioMs = audioMsFromClientX(e.clientX);
    onSeekAudioMs(clickedAudioMs);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingMeasureIdx !== null && song) {
      const targetMeasure = song.measures[draggingMeasureIdx];
      if (!targetMeasure) return;
      const newAudioMs = Math.max(0, audioMsFromClientX(e.clientX));
      onChangeSyncConfig(
        upsertMeasureAnchor(syncConfig, draggingMeasureIdx, targetMeasure.startTimeMs, newAudioMs)
      );
      return;
    }
    setHoveredMeasureIdx(findNearestMeasure(e.clientX));
  };

  const handlePointerUp = () => {
    setDraggingMeasureIdx(null);
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const cursorAudioMs = viewStartMs + frac * viewSpanMs;

    const nextZoom = Math.max(1, Math.min(12, zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    const nextSpan = Math.max(2500, totalAudioMs / nextZoom);
    const nextMaxStart = Math.max(0, totalAudioMs - nextSpan);
    const nextStart = Math.max(0, Math.min(nextMaxStart, cursorAudioMs - frac * nextSpan));
    setZoom(nextZoom);
    setViewStartMs(nextStart);
  };

  // Tap Sync action
  const recordTapSync = useCallback(() => {
    if (!song || song.measures.length === 0) return;
    const m = song.measures[tapTargetMeasureIdx];
    if (!m) return;

    const nowAudioMs = getExternalAudioTimeMs();
    onChangeSyncConfig(upsertMeasureAnchor(syncConfig, m.unrolledIndex, m.startTimeMs, nowAudioMs));
    setTapFlashPerf(performance.now());

    // Advance target measure
    let nextIdx = tapTargetMeasureIdx + 1;
    if (tapStepMode === '1') nextIdx = tapTargetMeasureIdx + 1;
    else if (tapStepMode === '2') nextIdx = tapTargetMeasureIdx + 2;
    else if (tapStepMode === '4') nextIdx = tapTargetMeasureIdx + 4;
    else {
      const nextSec = song.sections.find((s) => s.startMeasure > tapTargetMeasureIdx);
      nextIdx = nextSec ? nextSec.startMeasure : song.measures.length;
    }

    if (nextIdx >= song.measures.length) {
      setTapSyncActive(false);
    } else {
      setTapTargetMeasureIdx(nextIdx);
    }
  }, [getExternalAudioTimeMs, onChangeSyncConfig, song, syncConfig, tapStepMode, tapTargetMeasureIdx]);

  // Modal keyboard shortcuts: Space = Play/Pause, S / Enter = Tap Sync
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        onPlayPause(true);
        return;
      }
      if (tapSyncActive && (e.key === 's' || e.key === 'S' || e.code === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        recordTapSync();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose, onPlayPause, recordTapSync, tapSyncActive]);

  const handleToggleTapSync = () => {
    if (!tapSyncActive && song) {
      const curTabMs = tabToAudioMs(0, syncConfig);
      // Determine nearest upcoming measure or start at measure 0
      const audioNow = getExternalAudioTimeMs();
      let startMeasure = 0;
      if (audioNow > curTabMs + 200) {
        const found = measurePositions.find((mp) => mp.audioTimeMs >= audioNow - 150);
        startMeasure = found ? found.measureIndex : 0;
      }
      setTapTargetMeasureIdx(startMeasure);
      setTapSyncActive(true);
      if (!isPlaying) {
        onPlayPause(true);
      }
    } else {
      setTapSyncActive(false);
    }
  };

  if (!isOpen || !song) return null;

  const tempoRatio = getSegmentTempoRatio(syncConfig, 0);
  const tempoDiffPct = Math.round((tempoRatio - 1) * 1000) / 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-5xl rounded-2xl bg-[#070f1e] border border-cyan-500/35 shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center shrink-0">
              <Anchor className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-100 truncate">
                Estúdio de Sincronia Visual de Áudio
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                {song.title} · <span className="text-emerald-300">{audioFileName}</span>
                {syncConfig.anchors.length >= 2 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono">
                    {tempoDiffPct === 0
                      ? 'Andamento igual à tab'
                      : `Gravação ${tempoDiffPct > 0 ? `+${tempoDiffPct}%` : `${tempoDiffPct}%`} vs tab`}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {waveform && (
              <button
                type="button"
                onClick={() =>
                  onChangeSyncConfig(
                    buildAutoInitialSync(song, track?.trackIndex ?? 0, waveform.firstOnsetMs)
                  )
                }
                title="Detectar o primeiro som do MP3 e alinhar com a 1ª nota da tablatura"
                className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-400/45 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Detectar Início</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onChangeSyncConfig({ anchors: [], fineOffsetMs: 0, tempoScale: 1.0 })}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-rose-300 hover:border-rose-500/40"
            >
              Limpar Âncoras
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Concluir</span>
            </button>
          </div>
        </div>

        {/* Helpful quick-guide bar */}
        <div className="px-5 py-2 bg-cyan-950/25 border-b border-cyan-500/15 text-[11px] text-cyan-100/90 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>Dica rápida:</strong> Arraste qualquer linha de compasso (<strong>C1</strong>,{' '}
            <strong>C2</strong>...) para cima do pico na onda, ou ligue o <strong>Tap Sync</strong>{' '}
            e aperte <kbd className="px-1.5 py-0.5 rounded bg-slate-800 font-mono">S</kbd> no tempo
            enquanto ouve a música.
          </span>
          <span className="text-slate-400">
            {hoveredMeasureIdx !== null
              ? `Arraste C${hoveredMeasureIdx + 1} para alinhar`
              : 'Clique na onda para ouvir • Roda do mouse dá zoom'}
          </span>
        </div>

        {/* Interactive Waveform Canvas Area */}
        <div className="p-4 pb-2 space-y-2">
          <div
            ref={canvasWrapRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              setHoveredMeasureIdx(null);
              setDraggingMeasureIdx(null);
            }}
            onWheel={handleWheelZoom}
            style={{
              cursor:
                draggingMeasureIdx !== null || hoveredMeasureIdx !== null ? 'ew-resize' : 'pointer',
            }}
            className="relative h-52 sm:h-60 w-full rounded-xl overflow-hidden border border-slate-800 bg-[#040914] select-none"
          >
            <canvas ref={canvasRef} className="block w-full h-full" />

            {isWaveformLoading && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center gap-2 text-xs text-cyan-200 font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analisando forma de onda do áudio...</span>
              </div>
            )}
          </div>

          {/* Horizontal Scroll & Zoom Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[10px] font-semibold uppercase text-slate-500">Navegar</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, maxViewStartMs)}
                step={50}
                value={Math.min(viewStartMs, maxViewStartMs)}
                disabled={zoom <= 1.05}
                onChange={(e) => {
                  setFollowCursor(false);
                  setViewStartMs(Number(e.target.value));
                }}
                className="fret-slider flex-1"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={followCursor}
                  onChange={(e) => setFollowCursor(e.target.checked)}
                  className="accent-cyan-400"
                />
                Seguir agulha
              </label>

              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
                  className="p-1 text-slate-300 hover:text-white"
                  title="Diminuir zoom"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                {[1, 3, 6, 10].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      const nextSpan = Math.max(2500, totalAudioMs / preset);
                      const cur = getExternalAudioTimeMs();
                      setZoom(preset);
                      setViewStartMs(
                        Math.max(0, Math.min(totalAudioMs - nextSpan, cur - nextSpan * 0.3))
                      );
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                      Math.abs(zoom - preset) < 0.7
                        ? 'bg-cyan-500/25 text-cyan-200'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(12, z * 1.5))}
                  className="p-1 text-slate-300 hover:text-white"
                  title="Aumentar zoom"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Grid: Playback Verification | Live Tap Sync | Humanized Fine Nudge */}
        <div className="px-4 py-3 border-t border-slate-800/80 grid md:grid-cols-3 gap-3 bg-slate-950/40">
          {/* 1. Playback & Verification Metronome */}
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              1. Ouvir e Conferir Tempo
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSeekAudioMs(0)}
                title="Voltar para 0:00"
                className="p-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-300 hover:text-white"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onPlayPause(true)}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 ${
                  isPlaying
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                }`}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                <span>{isPlaying ? 'Pausar (Espaço)' : 'Tocar (Espaço)'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {[0.5, 0.75, 1.0].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => onSetSpeed(sp)}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-bold border ${
                      Math.abs(playbackSpeed - sp) < 0.02
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {Math.round(sp * 100)}%
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setStudioMetronome((v) => !v)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 ${
                  studioMetronome
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-slate-950 border-slate-700 text-slate-400'
                }`}
                title="Metrônomo nos tempos da tablatura para comparar com a bateria da música"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Metrônomo</span>
              </button>
            </div>
          </div>

          {/* 2. Live Keyboard Tap Sync */}
          <div
            className={`p-3 rounded-xl border flex flex-col justify-between gap-2 transition-colors ${
              tapSyncActive
                ? 'bg-amber-950/30 border-amber-400/70'
                : 'bg-slate-900/80 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                <Hand className="w-3.5 h-3.5" />
                2. Tap Sync ao Vivo
              </span>
              <select
                value={tapStepMode}
                onChange={(e) => setTapStepMode(e.target.value as TapStepMode)}
                className="rounded bg-slate-950 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200"
              >
                <option value="1">A cada 1 compasso</option>
                <option value="2">A cada 2 compassos</option>
                <option value="4">A cada 4 compassos</option>
                <option value="section">Por seção</option>
              </select>
            </div>

            {tapSyncActive ? (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-amber-100 flex items-center justify-between">
                  <span>
                    Marcar início do <strong>Compasso {tapTargetMeasureIdx + 1}</strong>
                  </span>
                  {performance.now() - tapFlashPerf < 300 && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-black">
                      GRAVADO!
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={recordTapSync}
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold"
                  >
                    MARCAR AGORA (S / Enter)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTapSyncActive(false)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold"
                  >
                    Parar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Aperte <strong>S</strong> ou <strong>Enter</strong> no primeiro tempo de cada
                  compasso para compensar variações reais de andamento.
                </p>
                <button
                  type="button"
                  onClick={handleToggleTapSync}
                  className="w-full py-1.5 px-3 rounded-lg bg-amber-500/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/30 text-xs font-bold"
                >
                  Iniciar Tap Sync
                </button>
              </>
            )}
          </div>

          {/* 3. Humanized Fine Adjustment */}
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                3. Ajuste Fino Global
              </span>
              <span className="font-mono text-xs font-bold text-cyan-300">
                {syncConfig.fineOffsetMs >= 0
                  ? `+${syncConfig.fineOffsetMs}`
                  : syncConfig.fineOffsetMs}{' '}
                ms
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1">
              {[
                { label: '⏪ -50', delta: -50, title: 'Mover tab 50ms mais cedo no áudio' },
                { label: '-10', delta: -10, title: 'Mover tab 10ms mais cedo no áudio' },
                { label: '0', delta: 0, title: 'Zerar ajuste fino' },
                { label: '+10', delta: 10, title: 'Mover tab 10ms mais tarde no áudio' },
                { label: '+50 ⏩', delta: 50, title: 'Mover tab 50ms mais tarde no áudio' },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  title={btn.title}
                  onClick={() =>
                    onChangeSyncConfig({
                      ...syncConfig,
                      fineOffsetMs: btn.delta === 0 ? 0 : syncConfig.fineOffsetMs + btn.delta,
                    })
                  }
                  className="py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-cyan-400 text-[11px] font-mono font-bold text-slate-200"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="flex justify-between text-[10px] text-slate-400">
              <span>⏪ Notas chegam mais cedo</span>
              <span>Notas chegam mais tarde ⏩</span>
            </div>
          </div>
        </div>

        {/* Anchors Strip */}
        <div className="px-4 py-2.5 border-t border-slate-800/80 bg-slate-950/70 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-semibold text-slate-400 shrink-0">
            Âncoras ({syncConfig.anchors.length}):
          </span>
          {syncConfig.anchors.length === 0 ? (
            <span className="text-[11px] text-slate-500">
              Nenhuma âncora fixa — arraste um compasso na onda ou clique em &quot;Detectar Início&quot;.
            </span>
          ) : (
            syncConfig.anchors.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-xs shrink-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    onSeekAudioMs(Math.max(0, a.audioTimeMs + syncConfig.fineOffsetMs - 1200))
                  }
                  className="font-mono font-semibold text-amber-200 hover:text-white"
                  title="Ouvir 1.2s antes desta âncora"
                >
                  Comp. {a.measureIndex + 1} → {formatAudioTime(a.audioTimeMs + syncConfig.fineOffsetMs)}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSyncConfig(removeAnchorById(syncConfig, a.id))}
                  title="Remover âncora"
                  className="text-amber-300/70 hover:text-rose-300"
                >
                  {syncConfig.anchors.length > 1 ? (
                    <X className="w-3 h-3" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
