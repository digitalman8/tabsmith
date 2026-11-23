import React, { useEffect, useRef } from 'react';
import { getStringPalette, type PracticeSettings, type SongData, type TrackTimeline } from '../types/music';
import { HighwayRenderer } from '../engine/highwayRenderer';
import type { CountInStatus } from '../engine/audioController';

interface HighwayCanvasProps {
  song: SongData | null;
  track: TrackTimeline | null;
  settings: PracticeSettings;
  isPlaying: boolean;
  countInStatus: CountInStatus | null;
  speedTrainerRep: number;
  getCurrentTimeMs: () => number;
  onFrameTick: () => void;
  hudSnapshot: {
    currentTimeMs: number;
    measureNumber: number;
    totalMeasures: number;
    baseTempo: number;
    activeChord: string;
  };
}

export const HighwayCanvas: React.FC<HighwayCanvasProps> = ({
  song,
  track,
  settings,
  isPlaying,
  countInStatus,
  speedTrainerRep,
  getCurrentTimeMs,
  onFrameTick,
  hudSnapshot,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<HighwayRenderer | null>(null);
  const sizeRef = useRef({ width: 1200, height: 600, dpr: 1 });

  // Latest props kept in refs so RAF loop runs continuously without tearing down on every state change
  const latestRef = useRef({
    song,
    track,
    settings,
    isPlaying,
    getCurrentTimeMs,
    onFrameTick,
  });
  latestRef.current = { song, track, settings, isPlaying, getCurrentTimeMs, onFrameTick };

  // Reset camera cleanly when switching song or track
  useEffect(() => {
    rendererRef.current?.resetCamera(track, getCurrentTimeMs());
  }, [song?.id, track?.trackIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = new HighwayRenderer(canvas);
    rendererRef.current = renderer;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = {
        width: Math.max(320, rect.width),
        height: Math.max(240, rect.height),
        dpr: Math.min(2, window.devicePixelRatio || 1),
      };
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    let rafId = 0;
    const loop = () => {
      const { song: s, track: t, settings: st, isPlaying: playing, getCurrentTimeMs: getMs, onFrameTick: tick } =
        latestRef.current;
      tick();
      const nowMs = getMs();
      const { width, height, dpr } = sizeRef.current;
      renderer.render({
        width,
        height,
        dpr,
        songTimeMs: nowMs,
        isPlaying: playing,
        track: t,
        measures: s?.measures ?? [],
        settings: st,
      });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      rendererRef.current = null;
    };
  }, []);

  const palette = track ? getStringPalette(track.stringCount, track.isBass) : [];
  const orderedStrings = palette.map((style, idx) => ({
    ...style,
    stringIndex: idx,
    visualRow: settings.invertStrings ? palette.length - 1 - idx : idx,
  }));
  orderedStrings.sort((a, b) => a.visualRow - b.visualRow);

  const effectiveBpm = Math.round(hudSnapshot.baseTempo * settings.playbackSpeed);
  const speedPct = Math.round(settings.playbackSpeed * 100);

  return (
    <div ref={containerRef} className="relative flex-1 w-full h-full min-h-0 overflow-hidden bg-[#02050c]">
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Top-Left Song & Tuning HUD */}
      {song && track && (
        <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-1.5 max-w-[55%]">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-950/75 backdrop-blur-md border border-cyan-500/20 shadow-lg">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100 truncate">{song.title}</span>
                <span className="text-xs text-slate-400 truncate hidden sm:inline">• {song.artist}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-slate-300">
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-medium">
                  {track.name}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-mono">
                  {track.tuningName}
                </span>
                {track.capo > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                    Capo {track.capo}ª
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
                  {settings.invertStrings ? 'Tab Clássica (e↑)' : 'Rocksmith (E↑)'}
                  {settings.leftHanded ? ' · Canhoto' : ''}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-Right Tempo, Measure, Chord & Speed Trainer HUD */}
      {song && (
        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2">
          {hudSnapshot.activeChord && (
            <div className="px-3 py-1.5 rounded-xl bg-cyan-950/80 backdrop-blur-md border border-cyan-400/35 shadow-lg text-center">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300/80 font-semibold">
                Acorde
              </div>
              <div className="text-base font-extrabold text-white font-mono leading-tight">
                {hudSnapshot.activeChord}
              </div>
            </div>
          )}

          {settings.speedTrainerEnabled && settings.loopEnabled && (
            <div className="px-3 py-1.5 rounded-xl bg-amber-950/80 backdrop-blur-md border border-amber-400/35 shadow-lg text-center">
              <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold">
                Speed Trainer
              </div>
              <div className="text-xs font-bold text-amber-200 font-mono leading-tight mt-0.5">
                Rep {speedTrainerRep} · {speedPct}% → {Math.round(settings.speedTrainerTarget * 100)}%
              </div>
            </div>
          )}

          <div className="px-3 py-1.5 rounded-xl bg-slate-950/75 backdrop-blur-md border border-slate-700/60 shadow-lg flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Andamento
              </div>
              <div className="text-sm font-bold text-slate-100 font-mono">
                {effectiveBpm} <span className="text-[11px] text-slate-400">BPM</span>
                {speedPct !== 100 && (
                  <span className="ml-1 text-[11px] text-cyan-400">({speedPct}%)</span>
                )}
              </div>
            </div>
            <div className="w-px h-6 bg-slate-700/70" />
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Compasso
              </div>
              <div className="text-sm font-bold text-slate-100 font-mono">
                {hudSnapshot.measureNumber}
                <span className="text-slate-500">/{hudSnapshot.totalMeasures || 1}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* String Legend Strip aligned beside foreground fretboard */}
      {track && orderedStrings.length > 0 && (
        <div
          className={`pointer-events-none absolute bottom-[10%] ${
            settings.leftHanded ? 'left-2.5' : 'right-2.5'
          } flex flex-col gap-1 px-1.5 py-1.5 rounded-lg bg-slate-950/75 border border-slate-800/80 backdrop-blur-sm`}
        >
          {orderedStrings.map((st) => (
            <div key={st.stringIndex} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: st.color, boxShadow: `0 0 6px ${st.glow}` }}
              />
              <span className="text-[10px] font-mono font-bold text-slate-200 w-3 text-center">
                {st.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Count-In Visual Overlay */}
      {countInStatus && countInStatus.active && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="px-8 py-5 rounded-2xl bg-slate-950/85 border border-cyan-400/40 backdrop-blur-md shadow-2xl text-center animate-pulse">
            <div className="text-xs uppercase tracking-widest text-cyan-300 font-semibold">
              Contagem · Compasso {countInStatus.bar}/{countInStatus.totalBars}
            </div>
            <div className="text-6xl font-black font-mono text-white mt-1 drop-shadow-[0_0_20px_rgba(34,211,238,0.8)]">
              {countInStatus.beat}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
