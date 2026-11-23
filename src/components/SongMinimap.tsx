import React, { useMemo, useRef, useState } from 'react';
import { Repeat, X } from 'lucide-react';
import type { SongData, SongSection, TrackTimeline } from '../types/music';

interface SongMinimapProps {
  song: SongData | null;
  track: TrackTimeline | null;
  currentTimeMs: number;
  loopEnabled: boolean;
  loopStartMs: number;
  loopEndMs: number;
  onSeek: (ms: number) => void;
  onSetLoop: (enabled: boolean, startMs: number, endMs: number) => void;
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export const SongMinimap: React.FC<SongMinimapProps> = ({
  song,
  track,
  currentTimeMs,
  loopEnabled,
  loopStartMs,
  loopEndMs,
  onSeek,
  onSetLoop,
}) => {
  const trackBarRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'seek' | 'A' | 'B' | null>(null);

  const duration = Math.max(1, song?.durationMs ?? 1);

  // Compute note density per measure for the visual Rocksmith-style density skyline
  const measureDensities = useMemo(() => {
    if (!song || !track || song.measures.length === 0) return [];
    const counts = new Array(song.measures.length).fill(0);
    for (const n of track.notes) {
      if (n.measureIndex >= 0 && n.measureIndex < counts.length) {
        counts[n.measureIndex] += 1;
      }
    }
    const maxCount = Math.max(1, ...counts);
    return song.measures.map((m, idx) => ({
      measure: m,
      ratio: counts[idx] / maxCount,
    }));
  }, [song, track]);

  const msFromClientX = (clientX: number): number => {
    const el = trackBarRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return frac * duration;
  };

  const handlePointerDown = (mode: 'seek' | 'A' | 'B') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingHandle(mode);
    const ms = msFromClientX(e.clientX);
    if (mode === 'seek') {
      onSeek(ms);
    } else if (mode === 'A') {
      const clampedA = Math.min(ms, Math.max(0, loopEndMs - 200));
      onSetLoop(true, clampedA, loopEndMs);
    } else {
      const clampedB = Math.max(ms, Math.min(duration, loopStartMs + 200));
      onSetLoop(true, loopStartMs, clampedB);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingHandle) return;
    const ms = msFromClientX(e.clientX);
    if (draggingHandle === 'seek') {
      onSeek(ms);
    } else if (draggingHandle === 'A') {
      const clampedA = Math.min(ms, Math.max(0, loopEndMs - 200));
      onSetLoop(true, clampedA, loopEndMs);
    } else {
      const clampedB = Math.max(ms, Math.min(duration, loopStartMs + 200));
      onSetLoop(true, loopStartMs, clampedB);
    }
  };

  const handlePointerUp = () => {
    setDraggingHandle(null);
  };

  const handleSectionClick = (sec: SongSection) => {
    const isSameSectionLoop =
      loopEnabled &&
      Math.abs(loopStartMs - sec.startTimeMs) < 50 &&
      Math.abs(loopEndMs - sec.endTimeMs) < 50;

    if (isSameSectionLoop) {
      onSetLoop(false, loopStartMs, loopEndMs);
    } else {
      onSetLoop(true, sec.startTimeMs, sec.endTimeMs);
      onSeek(sec.startTimeMs);
    }
  };

  if (!song) {
    return (
      <div className="h-14 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-center text-xs text-slate-500">
        Carregue uma tablatura para visualizar a linha do tempo
      </div>
    );
  }

  const playheadPct = Math.max(0, Math.min(100, (currentTimeMs / duration) * 100));
  const loopStartPct = Math.max(0, Math.min(100, (loopStartMs / duration) * 100));
  const loopEndPct = Math.max(loopStartPct, Math.min(100, (loopEndMs / duration) * 100));

  return (
    <div className="bg-[#050b16] border-b border-cyan-500/20 px-3 pt-1.5 pb-2 flex flex-col gap-1 select-none shrink-0">
      {/* Section Header Row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative h-5 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {song.sections.map((sec, idx) => {
            const leftPct = (sec.startTimeMs / duration) * 100;
            const widthPct = Math.max(4, ((sec.endTimeMs - sec.startTimeMs) / duration) * 100);
            const isSelected =
              loopEnabled &&
              Math.abs(loopStartMs - sec.startTimeMs) < 50 &&
              Math.abs(loopEndMs - sec.endTimeMs) < 50;

            return (
              <button
                key={`${sec.name}-${idx}`}
                type="button"
                onClick={() => handleSectionClick(sec)}
                title={`Clique para repetir a seção "${sec.name}"`}
                style={{ width: `${widthPct}%`, minWidth: '72px' }}
                data-left={leftPct}
                className={`h-5 px-2 rounded text-[10px] font-semibold truncate transition-colors flex items-center justify-center gap-1 border ${
                  isSelected
                    ? 'bg-amber-500/25 border-amber-400/70 text-amber-200'
                    : 'bg-slate-900/90 border-slate-700/60 text-slate-300 hover:border-cyan-400/60 hover:text-cyan-200'
                }`}
              >
                {isSelected && <Repeat className="w-2.5 h-2.5 shrink-0 text-amber-300" />}
                <span className="truncate">{sec.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono text-slate-300">
          {loopEnabled && (
            <button
              type="button"
              onClick={() => onSetLoop(false, loopStartMs, loopEndMs)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-amber-300 hover:bg-amber-500/25 text-[10px]"
              title="Desativar Loop A-B"
            >
              <span>Loop A-B</span>
              <X className="w-3 h-3" />
            </button>
          )}
          <span>
            {formatMs(currentTimeMs)} <span className="text-slate-500">/</span>{' '}
            {formatMs(duration)}
          </span>
        </div>
      </div>

      {/* Density Minimap & Seek / Loop Handle Track */}
      <div
        ref={trackBarRef}
        onPointerDown={handlePointerDown('seek')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative h-7 rounded-md bg-slate-900/95 border border-slate-800/90 overflow-visible cursor-pointer"
      >
        {/* Note density skyline bars */}
        <div className="absolute inset-0 flex items-end px-0.5 overflow-hidden rounded-md">
          {measureDensities.map(({ measure, ratio }) => {
            const leftPct = (measure.startTimeMs / duration) * 100;
            const widthPct = ((measure.endTimeMs - measure.startTimeMs) / duration) * 100;
            const barH = Math.max(16, Math.round(ratio * 100));
            return (
              <div
                key={measure.unrolledIndex}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                className="absolute bottom-0 top-0 border-r border-slate-800/70 flex items-end px-[1px]"
              >
                <div
                  style={{ height: `${barH}%` }}
                  className="w-full rounded-t-[2px] bg-gradient-to-t from-cyan-600/35 to-cyan-300/65"
                />
              </div>
            );
          })}
        </div>

        {/* Active A-B Loop Highlight Region */}
        {loopEnabled && loopEndMs > loopStartMs && (
          <>
            <div
              style={{
                left: `${loopStartPct}%`,
                width: `${Math.max(0.5, loopEndPct - loopStartPct)}%`,
              }}
              className="pointer-events-none absolute top-0 bottom-0 bg-amber-400/18 border-x border-amber-400/80"
            />
            {/* Handle A */}
            <div
              onPointerDown={handlePointerDown('A')}
              title="Arraste para ajustar início do Loop (A)"
              style={{ left: `${loopStartPct}%` }}
              className="absolute -top-1 -bottom-1 -translate-x-1/2 w-3.5 flex items-center justify-center cursor-ew-resize z-20 group"
            >
              <div className="w-3 h-5 rounded-sm bg-amber-400 text-[#020617] text-[9px] font-black flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                A
              </div>
            </div>
            {/* Handle B */}
            <div
              onPointerDown={handlePointerDown('B')}
              title="Arraste para ajustar fim do Loop (B)"
              style={{ left: `${loopEndPct}%` }}
              className="absolute -top-1 -bottom-1 -translate-x-1/2 w-3.5 flex items-center justify-center cursor-ew-resize z-20 group"
            >
              <div className="w-3 h-5 rounded-sm bg-amber-400 text-[#020617] text-[9px] font-black flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                B
              </div>
            </div>
          </>
        )}

        {/* Live Playhead Needle */}
        <div
          style={{ left: `${playheadPct}%` }}
          className="pointer-events-none absolute top-0 bottom-0 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_8px_#fff] z-10"
        >
          <div className="w-2.5 h-2.5 -translate-x-[4px] -translate-y-1 bg-white rotate-45 rounded-[1px]" />
        </div>
      </div>
    </div>
  );
};
