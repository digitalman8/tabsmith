import React, { useEffect, useRef } from 'react';
import { getStringPalette, type SongData, type TrackTimeline } from '../types/music';

interface MiniTabStripProps {
  song: SongData | null;
  track: TrackTimeline | null;
  getCurrentTimeMs: () => number;
  onSeek: (ms: number) => void;
}

export const MiniTabStrip: React.FC<MiniTabStripProps> = ({
  song,
  track,
  getCurrentTimeMs,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 1000, height: 112, dpr: 1 });
  const pxPerSec = 140;

  const latestRef = useRef({ song, track, getCurrentTimeMs });
  latestRef.current = { song, track, getCurrentTimeMs };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = {
        width: Math.max(300, rect.width),
        height: Math.max(96, rect.height),
        dpr: Math.min(2, window.devicePixelRatio || 1),
      };
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    let rafId = 0;
    const renderStrip = () => {
      const { song: s, track: t, getCurrentTimeMs: getMs } = latestRef.current;
      const { width, height, dpr } = sizeRef.current;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#060c18';
      ctx.fillRect(0, 0, width, height);

      if (!s || !t) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.font = '500 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mini-Tablatura 2D', width / 2, height / 2);
        ctx.restore();
        rafId = requestAnimationFrame(renderStrip);
        return;
      }

      const nowMs = getMs();
      const playheadX = width * 0.22;
      const msToX = (ms: number) => playheadX + ((ms - nowMs) / 1000) * pxPerSec;

      const stringCount = t.stringCount;
      const palette = getStringPalette(stringCount, t.isBass);
      const topPad = 20;
      const botPad = 12;
      const staffH = height - topPad - botPad;
      const stringY = (stringIndex: number) => {
        // Traditional 2D tablature puts highest-pitched string at top (row 0), lowest string at bottom
        const row = stringCount - 1 - stringIndex;
        return topPad + (row / Math.max(1, stringCount - 1)) * staffH;
      };

      // Draw string lines
      for (let i = 0; i < stringCount; i++) {
        const y = stringY(i);
        const style = palette[i] ?? palette[0];
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(28, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        // String name tag at left
        ctx.fillStyle = style.color;
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(style.name, 14, y);
      }

      // Draw measure bars
      for (const m of s.measures) {
        const x = msToX(m.startTimeMs);
        if (x < 28) continue;
        if (x > width + 40) break;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, topPad - 2);
        ctx.lineTo(x, height - botPad + 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(m.unrolledIndex + 1), x + 4, 3);
      }

      // Draw chord labels above staff
      for (const c of t.chords) {
        const x = msToX(c.startTimeMs);
        if (x < 28) continue;
        if (x > width + 40) break;
        if (c.name && !c.isRepeatStrum) {
          ctx.fillStyle = '#38bdf8';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(c.name, x, 3);
        }
      }

      // Draw notes
      for (const n of t.notes) {
        const x = msToX(n.startTimeMs);
        if (x < 24) continue;
        if (x > width + 30) break;

        const y = stringY(n.stringIndex);
        const style = palette[n.stringIndex] ?? palette[0];
        const isPassed = n.startTimeMs < nowMs - 40;
        const isCurrent = Math.abs(n.startTimeMs - nowMs) < 90;

        let label = n.techniques.deadNote ? 'X' : String(n.fret);
        if (n.techniques.hammerOn) label += 'h';
        else if (n.techniques.pullOff) label += 'p';
        else if (n.techniques.bendSemitones > 0) label += 'b';
        else if (n.techniques.slideType !== 'none') label += '/';

        ctx.font = isCurrent
          ? '800 12px "JetBrains Mono", monospace'
          : '700 11px "JetBrains Mono", monospace';
        const tw = ctx.measureText(label).width;

        ctx.fillStyle = '#060c18';
        ctx.fillRect(x - tw * 0.5 - 3, y - 7, tw + 6, 14);

        ctx.fillStyle = isCurrent ? '#ffffff' : style.color;
        ctx.globalAlpha = isPassed ? 0.42 : 1.0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y);
        ctx.globalAlpha = 1;
      }

      // Left gutter mask so notes slide cleanly behind string names
      ctx.fillStyle = '#060c18';
      ctx.fillRect(0, 0, 26, height);
      for (let i = 0; i < stringCount; i++) {
        const y = stringY(i);
        const style = palette[i] ?? palette[0];
        ctx.fillStyle = style.color;
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(style.name, 14, y);
      }

      // Playhead bar
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(playheadX, 14);
      ctx.lineTo(playheadX, height - 4);
      ctx.stroke();

      ctx.restore();
      rafId = requestAnimationFrame(renderStrip);
    };

    rafId = requestAnimationFrame(renderStrip);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!song || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const playheadX = rect.width * 0.22;
    const deltaMs = ((clickX - playheadX) / pxPerSec) * 1000;
    onSeek(getCurrentTimeMs() + deltaMs);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      title="Clique na mini-tablatura para navegar"
      className="h-28 w-full border-t border-cyan-500/20 bg-[#060c18] cursor-pointer shrink-0 relative"
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div className="pointer-events-none absolute top-1 right-2.5 text-[10px] text-slate-500 font-medium">
        Tablatura 2D Sincronizada (clique para navegar)
      </div>
    </div>
  );
};
