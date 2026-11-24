import React, { useState } from 'react';
import {
  Anchor,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  FlipHorizontal,
  FolderOpen,
  Gauge,
  LayoutList,
  Loader2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Sliders,
  Sparkles,
  Timer,
  TrendingUp,
  Upload,
  Volume2,
} from 'lucide-react';
import type { AudioSyncConfig, PracticeSettings } from '../types/music';
import type { AutoSyncProgress } from '../engine/autoSyncEngine';

function formatSemitoneLabel(shift: number): string {
  if (shift === -1) return '½ tom abaixo da tab';
  if (shift === 1) return '½ tom acima da tab';
  if (shift === -2) return '1 tom abaixo da tab';
  if (shift === 2) return '1 tom acima da tab';
  return '';
}

interface TransportBarProps {
  isPlaying: boolean;
  hasSong: boolean;
  settings: PracticeSettings;
  speedTrainerRep: number;
  hasExternalAudio: boolean;
  audioSyncConfig: AudioSyncConfig;
  autoSyncProgress: AutoSyncProgress | null;
  onPlayPause: () => void;
  onRestart: () => void;
  onPrevMeasure: () => void;
  onNextMeasure: () => void;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onToggleLoop: () => void;
  onOpenMixer: () => void;
  onRunAutoSync: () => void;
  onChangeFineOffsetMs: (fineOffsetMs: number) => void;
  onOpenSyncStudio: () => void;
  onOpenImport: () => void;
  onOpenLibrary: () => void;
  isMixerOpen: boolean;
  isLibraryOpen: boolean;
}

const SPEED_PRESETS = [0.5, 0.75, 0.85, 1.0];

export const TransportBar: React.FC<TransportBarProps> = ({
  isPlaying,
  hasSong,
  settings,
  speedTrainerRep,
  hasExternalAudio,
  audioSyncConfig,
  autoSyncProgress,
  onPlayPause,
  onRestart,
  onPrevMeasure,
  onNextMeasure,
  onUpdateSettings,
  onToggleLoop,
  onOpenMixer,
  onRunAutoSync,
  onChangeFineOffsetMs,
  onOpenSyncStudio,
  onOpenImport,
  onOpenLibrary,
  isMixerOpen,
  isLibraryOpen,
}) => {
  const [openPopover, setOpenPopover] = useState<'trainer' | 'highway' | 'sync' | null>(null);
  const speedPct = Math.round(settings.playbackSpeed * 100);
  const isAutoSyncing = autoSyncProgress !== null;

  return (
    <div className="relative bg-[#070d1a] border-t border-cyan-500/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 shrink-0 z-30">
      {/* Left: Transport & Measure Navigation */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onRestart}
          disabled={!hasSong}
          title="Voltar ao início (ou início do Loop)"
          className="p-2 rounded-lg bg-slate-900 border border-slate-700/70 text-slate-300 hover:text-white hover:border-cyan-400/50 disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onPrevMeasure}
          disabled={!hasSong}
          title="Compasso anterior (←)"
          className="p-2 rounded-lg bg-slate-900 border border-slate-700/70 text-slate-300 hover:text-white hover:border-cyan-400/50 disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={!hasSong}
          title="Tocar / Pausar (Espaço)"
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg disabled:opacity-40 ${
            isPlaying
              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/25'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/30'
          }`}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span>{isPlaying ? 'Pausar' : 'Tocar'}</span>
        </button>

        <button
          type="button"
          onClick={onNextMeasure}
          disabled={!hasSong}
          title="Próximo compasso (→)"
          className="p-2 rounded-lg bg-slate-900 border border-slate-700/70 text-slate-300 hover:text-white hover:border-cyan-400/50 disabled:opacity-40 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Speed, Speed Trainer, Lookahead, Loop, Count-in, Metronome */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tempo Speed Slider + Presets */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <Gauge className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={settings.playbackSpeed}
              onChange={(e) => onUpdateSettings({ playbackSpeed: parseFloat(e.target.value) })}
              title="Velocidade do tempo (- / +)"
              className="fret-slider w-20 sm:w-24"
            />
            <span className="font-mono text-xs font-bold text-cyan-300 w-10 text-right">
              {speedPct}%
            </span>
          </div>
          <div className="hidden md:flex items-center gap-1 border-l border-slate-800 pl-2">
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onUpdateSettings({ playbackSpeed: preset })}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
                  Math.abs(settings.playbackSpeed - preset) < 0.01
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {Math.round(preset * 100)}%
              </button>
            ))}
          </div>
        </div>

        {/* Loop A-B & Speed Trainer */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleLoop}
            disabled={!hasSong}
            title="Ativar / Desativar Loop A-B (L)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              settings.loopEnabled
                ? 'bg-amber-500/20 border-amber-400/70 text-amber-200'
                : 'bg-slate-900 border-slate-700/70 text-slate-300 hover:text-white'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Loop</span>
          </button>

          <button
            type="button"
            onClick={() => setOpenPopover(openPopover === 'trainer' ? null : 'trainer')}
            title="Acelerador Progressivo (Speed Trainer)"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              settings.speedTrainerEnabled
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                : 'bg-slate-900 border-slate-700/70 text-slate-300 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Acelerador</span>
          </button>

          {openPopover === 'trainer' && (
            <div className="absolute bottom-full mb-2 left-0 w-72 p-3.5 rounded-xl bg-slate-900 border border-cyan-500/30 shadow-2xl z-50">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  Speed Trainer Progressivo
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !settings.speedTrainerEnabled;
                    onUpdateSettings({
                      speedTrainerEnabled: next,
                      ...(next ? { playbackSpeed: settings.speedTrainerStart, loopEnabled: true } : {}),
                    });
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    settings.speedTrainerEnabled
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {settings.speedTrainerEnabled ? 'Ativo' : 'Ativar'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Aumenta a velocidade automaticamente a cada repetição do Loop A–B.
              </p>
              <div className="space-y-2.5 text-xs">
                <label className="flex items-center justify-between">
                  <span className="text-slate-300">Velocidade inicial</span>
                  <span className="font-mono text-cyan-300">
                    {Math.round(settings.speedTrainerStart * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0.3}
                  max={0.95}
                  step={0.05}
                  value={settings.speedTrainerStart}
                  onChange={(e) => onUpdateSettings({ speedTrainerStart: parseFloat(e.target.value) })}
                  className="fret-slider w-full"
                />

                <label className="flex items-center justify-between">
                  <span className="text-slate-300">Velocidade alvo</span>
                  <span className="font-mono text-emerald-300">
                    {Math.round(settings.speedTrainerTarget * 100)}%
                  </span>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1.3}
                  step={0.05}
                  value={settings.speedTrainerTarget}
                  onChange={(e) => onUpdateSettings({ speedTrainerTarget: parseFloat(e.target.value) })}
                  className="fret-slider w-full"
                />

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Incremento</span>
                    <select
                      value={settings.speedTrainerStep}
                      onChange={(e) => onUpdateSettings({ speedTrainerStep: parseFloat(e.target.value) })}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs font-mono text-slate-200"
                    >
                      <option value={0.02}>+2%</option>
                      <option value={0.05}>+5%</option>
                      <option value={0.1}>+10%</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Reps p/ subir</span>
                    <select
                      value={settings.speedTrainerRepsPerStep}
                      onChange={(e) =>
                        onUpdateSettings({ speedTrainerRepsPerStep: parseInt(e.target.value, 10) })
                      }
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs font-mono text-slate-200"
                    >
                      <option value={1}>1 rep</option>
                      <option value={2}>2 reps</option>
                      <option value={4}>4 reps</option>
                    </select>
                  </div>
                </div>
                {settings.speedTrainerEnabled && (
                  <div className="pt-1 text-[11px] text-emerald-300 font-mono">
                    Repetições neste loop: {speedTrainerRep}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Highway Lookahead / Zoom */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPopover(openPopover === 'highway' ? null : 'highway')}
            title="Velocidade visual da esteira (zoom temporal)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/70 text-slate-300 hover:text-white text-xs font-medium"
          >
            <Timer className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono">{settings.highwayLookaheadSec.toFixed(1)}s</span>
          </button>
          {openPopover === 'highway' && (
            <div className="absolute bottom-full mb-2 left-0 w-72 p-3.5 rounded-xl bg-slate-900 border border-cyan-500/30 shadow-2xl z-50 space-y-3">
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-200 mb-1">
                  <span>Antecipação da Esteira</span>
                  <span className="font-mono text-cyan-300">
                    {settings.highwayLookaheadSec.toFixed(1)}s
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  Valores menores espaçam mais as notas em solos rápidos sem alterar o BPM.
                </p>
                <input
                  type="range"
                  min={1.4}
                  max={5.0}
                  step={0.2}
                  value={settings.highwayLookaheadSec}
                  onChange={(e) =>
                    onUpdateSettings({ highwayLookaheadSec: parseFloat(e.target.value) })
                  }
                  className="fret-slider w-full"
                />
              </div>

              <div className="pt-2.5 border-t border-slate-800">
                <div className="text-xs font-bold text-slate-200 mb-1.5">Câmera do Braço 3D</div>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ cameraMode: 'dynamic' })}
                    className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-colors ${
                      settings.cameraMode === 'dynamic'
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Dinâmica (Ampla)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ cameraMode: 'fullNeck' })}
                    className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-colors ${
                      settings.cameraMode === 'fullNeck'
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Braço Fixo (1–22)
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                  {settings.cameraMode === 'dynamic'
                    ? 'Exibe 16–20 casas e abre suavemente em saltos grandes, sem puxões.'
                    : 'Mostra quase o braço inteiro fixo o tempo todo, sem movimento de câmera.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Count-in selector */}
        <button
          type="button"
          onClick={() =>
            onUpdateSettings({
              countInBars: settings.countInBars === 0 ? 1 : settings.countInBars === 1 ? 2 : 0,
            })
          }
          title="Contagem regressiva antes de iniciar"
          className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            settings.countInBars > 0
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
              : 'bg-slate-900 border-slate-700/70 text-slate-400'
          }`}
        >
          {settings.countInBars === 0 ? 'Contagem: Off' : `Contagem: ${settings.countInBars}c`}
        </button>

        {/* Metronome toggle */}
        <button
          type="button"
          onClick={() => onUpdateSettings({ metronomeEnabled: !settings.metronomeEnabled })}
          title="Metrônomo (M)"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            settings.metronomeEnabled
              ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200'
              : 'bg-slate-900 border-slate-700/70 text-slate-400 hover:text-white'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Metrônomo</span>
        </button>
      </div>

      {/* Right: Fretboard Orientation, Mini-Tab, Mixer, Import, Library */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onUpdateSettings({ invertStrings: !settings.invertStrings })}
          title="Inverter orientação das cordas: Padrão Rocksmith (E↑) vs Tab Clássica (e↑) (I)"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            settings.invertStrings
              ? 'bg-purple-500/20 border-purple-400/60 text-purple-200'
              : 'bg-slate-900 border-slate-700/70 text-slate-200 hover:border-cyan-400/50'
          }`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5 rotate-90" />
          <span className="hidden sm:inline">
            {settings.invertStrings ? 'Cordas: Tab (e↑)' : 'Cordas: Rocksmith'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onUpdateSettings({ leftHanded: !settings.leftHanded })}
          title="Modo Canhoto (espelhar braço)"
          className={`p-2 rounded-lg border transition-colors ${
            settings.leftHanded
              ? 'bg-indigo-500/25 border-indigo-400/70 text-indigo-200'
              : 'bg-slate-900 border-slate-700/70 text-slate-400 hover:text-white'
          }`}
        >
          <FlipHorizontal className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onUpdateSettings({ showMiniTab: !settings.showMiniTab })}
          title="Mostrar / Ocultar Mini-Tablatura 2D (T)"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            settings.showMiniTab
              ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
              : 'bg-slate-900 border-slate-700/70 text-slate-400 hover:text-white'
          }`}
        >
          <LayoutList className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Tab 2D</span>
        </button>

        {hasExternalAudio && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenPopover(openPopover === 'sync' ? null : 'sync')}
              title="Sincronia Automática e Ajuste Fino do Áudio"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                isAutoSyncing
                  ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200'
                  : 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/30'
              }`}
            >
              {isAutoSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {isAutoSyncing
                  ? `${autoSyncProgress.percent}%`
                  : audioSyncConfig.mode === 'auto' && audioSyncConfig.confidence !== undefined
                  ? `Auto ${audioSyncConfig.confidence}%`
                  : 'Sincronia'}
              </span>
            </button>

            {openPopover === 'sync' && (
              <div className="absolute bottom-full mb-2 right-0 w-76 p-3.5 rounded-xl bg-slate-900 border border-emerald-500/35 shadow-2xl z-50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    Sincronia Áudio ↔ Tablatura
                  </span>
                  {audioSyncConfig.mode === 'auto' && audioSyncConfig.confidence !== undefined && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                      {audioSyncConfig.confidence}% precisão
                    </span>
                  )}
                </div>

                {audioSyncConfig.detectedSemitoneShift !== undefined &&
                  audioSyncConfig.detectedSemitoneShift !== 0 && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/35 text-[11px] text-amber-200">
                      Afinação detectada:{' '}
                      <strong>{formatSemitoneLabel(audioSyncConfig.detectedSemitoneShift)}</strong>{' '}
                      (compensado automaticamente).
                    </div>
                  )}

                <button
                  type="button"
                  disabled={isAutoSyncing}
                  onClick={() => {
                    onRunAutoSync();
                    setOpenPopover(null);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md"
                >
                  {isAutoSyncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isAutoSyncing
                      ? `Sincronizando (${autoSyncProgress.percent}%)...`
                      : 'Auto-Sincronizar Novamente'}
                  </span>
                </button>

                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">Ajuste Fino Rápido ([ / ])</span>
                    <span className="font-mono text-cyan-300">
                      {audioSyncConfig.fineOffsetMs >= 0
                        ? `+${audioSyncConfig.fineOffsetMs}`
                        : audioSyncConfig.fineOffsetMs}{' '}
                      ms
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeFineOffsetMs(audioSyncConfig.fineOffsetMs - 15)}
                      className="py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-cyan-400 text-[11px] font-semibold text-slate-200"
                    >
                      ⏪ Mais cedo
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeFineOffsetMs(0)}
                      className="py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-cyan-400 text-[11px] font-mono text-slate-400 hover:text-white"
                    >
                      0 ms
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeFineOffsetMs(audioSyncConfig.fineOffsetMs + 15)}
                      className="py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-cyan-400 text-[11px] font-semibold text-slate-200"
                    >
                      Mais tarde ⏩
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOpenPopover(null);
                    onOpenSyncStudio();
                  }}
                  className="w-full py-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300 flex items-center justify-center gap-1.5"
                >
                  <Anchor className="w-3 h-3 text-slate-400" />
                  <span>Ajuste Manual Avançado (Waveform / Tap Sync)</span>
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenMixer}
          title="Mixer de Faixas e Sincronização de Áudio"
          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            isMixerOpen
              ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100'
              : 'bg-slate-900 border-slate-700/70 text-slate-200 hover:border-cyan-400/50'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Mixer</span>
          {hasExternalAudio && (
            <span className="w-2 h-2 rounded-full bg-emerald-400" title="Áudio externo anexado" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenImport}
          title="Importar Guitar Pro, MusicXML, Tab ASCII ou Áudio"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/25 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Importar</span>
        </button>

        <button
          type="button"
          onClick={onOpenLibrary}
          title="Biblioteca e Músicas Demo"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            isLibraryOpen
              ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100'
              : 'bg-slate-900 border-slate-700/70 text-slate-200 hover:border-cyan-400/50'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Músicas</span>
        </button>
      </div>
    </div>
  );
};
