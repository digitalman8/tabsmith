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
  const sizeRef = useRef({ width: 1000, height: 144, dpr: 1 });
  const pxPerSec = 175;

  const latestRef = useRef({ song, track, getCurrentTimeMs });
  latestRef.current = { song, track, getCurrentTimeMs };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
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
    };

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = {
        width: Math.max(300, rect.width),
        height: Math.max(120, rect.height),
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
        ctx.font = '500 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mini-Tablatura 2D', width / 2, height / 2);
        ctx.restore();
        rafId = requestAnimationFrame(renderStrip);
        return;
      }

      const nowMs = getMs();
      const leftGutter = 34;
      const playheadX = width * 0.22;
      const msToX = (ms: number) => playheadX + ((ms - nowMs) / 1000) * pxPerSec;

      const stringCount = t.stringCount;
      const palette = getStringPalette(stringCount, t.isBass);
      // Dedicated two-row header (measures on row 1, chords on row 2) so labels never collide
      const topPad = 42;
      const botPad = 14;
      const staffH = height - topPad - botPad;
      const stringY = (stringIndex: number) => {
        // Traditional 2D tablature puts highest-pitched string at top (row 0), lowest string at bottom
        const row = stringCount - 1 - stringIndex;
        return topPad + (row / Math.max(1, stringCount - 1)) * staffH;
      };

      // Subtle header divider backdrop
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(leftGutter, 0, width - leftGutter, topPad - 8);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftGutter, topPad - 8);
      ctx.lineTo(width, topPad - 8);
      ctx.stroke();

      // Draw string lines
      for (let i = 0; i < stringCount; i++) {
        const y = stringY(i);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftGutter, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Row 1: Measure vertical bars & measure number pills (y = 3..16)
      for (const m of s.measures) {
        const x = msToX(m.startTimeMs);
        if (x < leftGutter) continue;
        if (x > width + 40) break;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.36)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(x, topPad - 8);
        ctx.lineTo(x, height - botPad + 4);
        ctx.stroke();

        const mLabel = String(m.unrolledIndex + 1);
        ctx.font = '700 10.5px "JetBrains Mono", monospace';
        const mw = ctx.measureText(mLabel).width;
        const pillW = mw + 8;
        ctx.fillStyle = 'rgba(30, 41, 59, 0.92)';
        drawRoundRect(x + 3, 3, pillW, 13, 3);
        ctx.fill();

        ctx.fillStyle = '#cbd5e1';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(mLabel, x + 7, 9.8);
      }

      // Row 2: Chord badges on their own dedicated row (y = 18..33) with horizontal collision guard
      let lastChordRightX = leftGutter;
      for (const c of t.chords) {
        const x = msToX(c.startTimeMs);
        if (x < leftGutter + 8) continue;
        if (x > width + 40) break;
        if (c.name && !c.isRepeatStrum) {
          ctx.font = '800 11.5px Inter, system-ui, sans-serif';
          const cw = ctx.measureText(c.name).width;
          const badgeW = cw + 12;
          const bx = Math.max(x - badgeW * 0.5, lastChordRightX + 4);
          if (bx > width - 12) continue;

          ctx.fillStyle = 'rgba(8, 145, 178, 0.28)';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
          ctx.lineWidth = 1;
          drawRoundRect(bx, 18, badgeW, 15, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#7dd3fc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(c.name, bx + badgeW * 0.5, 25.8);

          lastChordRightX = bx + badgeW;
        }
      }

      // Draw notes with larger, crisp high-contrast pills
      for (const n of t.notes) {
        const x = msToX(n.startTimeMs);
        if (x < leftGutter - 6) continue;
        if (x > width + 30) break;

        const y = stringY(n.stringIndex);
        const style = palette[n.stringIndex] ?? palette[0];
        const isPassed = n.startTimeMs < nowMs - 45;
        const isCurrent = Math.abs(n.startTimeMs - nowMs) < 95;

        let label = n.techniques.deadNote ? 'X' : String(n.fret);
        if (n.techniques.hammerOn) label += 'h';
        else if (n.techniques.pullOff) label += 'p';
        else if (n.techniques.bendSemitones > 0) label += 'b';
        else if (n.techniques.slideType !== 'none') label += '/';

        ctx.font = isCurrent
          ? '800 16px "JetBrains Mono", monospace'
          : '800 14px "JetBrains Mono", monospace';
        const tw = ctx.measureText(label).width;
        const pillW = Math.max(18, tw + 8);
        const pillH = isCurrent ? 19 : 16;

        ctx.fillStyle = isCurrent ? 'rgba(15, 23, 42, 0.98)' : '#060c18';
        drawRoundRect(x - pillW * 0.5, y - pillH * 0.5, pillW, pillH, 4);
        ctx.fill();

        if (isCurrent) {
          ctx.strokeStyle = style.color;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.fillStyle = isCurrent ? '#ffffff' : style.color;
        ctx.globalAlpha = isPassed ? 0.45 : 1.0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5);
        ctx.globalAlpha = 1;
      }

      // Left gutter mask so scrolling notes slide cleanly behind bold string names
      ctx.fillStyle = '#060c18';
      ctx.fillRect(0, 0, leftGutter - 1, height);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftGutter - 0.5, 0);
      ctx.lineTo(leftGutter - 0.5, height);
      ctx.stroke();

      for (let i = 0; i < stringCount; i++) {
        const y = stringY(i);
        const style = palette[i] ?? palette[0];
        ctx.fillStyle = style.color;
        ctx.font = '800 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(style.name, leftGutter * 0.5, y + 0.5);
      }

      // Playhead bar
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.92)';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.moveTo(playheadX, topPad - 8);
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
      className="h-36 w-full border-t border-cyan-500/25 bg-[#060c18] cursor-pointer shrink-0 relative"
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div className="pointer-events-none absolute bottom-1 right-2.5 px-1.5 py-0.5 rounded bg-[#060c18]/85 text-[10px] text-slate-400 font-medium">
        Tablatura 2D Sincronizada (clique para navegar)
      </div>
    </div>
  );
};
