import React, { useRef } from 'react';
import { Anchor, Guitar, Loader2, Music2, Sparkles, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import type { AudioPlaybackSource, AudioSyncConfig, SongData, TrackMixState } from '../types/music';
import type { AutoSyncProgress } from '../engine/autoSyncEngine';

interface TrackMixerDrawerProps {
  isOpen: boolean;
  song: SongData | null;
  activeTrackIndex: number;
  trackMixes: Record<number, TrackMixState>;
  synthVolume: number;
  useEmbeddedAudio: boolean;
  externalAudioName: string | null;
  externalAudioVolume: number;
  audioSourceMode: AudioPlaybackSource;
  audioSyncConfig: AudioSyncConfig;
  autoSyncProgress: AutoSyncProgress | null;
  onClose: () => void;
  onSelectActiveTrack: (trackIndex: number) => void;
  onUpdateTrackMix: (trackIndex: number, patch: Partial<TrackMixState>) => void;
  onChangeSynthVolume: (vol: number) => void;
  onToggleEmbeddedAudio: (use: boolean) => void;
  onAttachExternalAudio: (file: File) => void;
  onDetachExternalAudio: () => void;
  onChangeExternalAudioVolume: (vol: number) => void;
  onChangeAudioSourceMode: (mode: AudioPlaybackSource) => void;
  onChangeFineOffsetMs: (fineOffsetMs: number) => void;
  onRunAutoSync: () => void;
  onOpenSyncStudio: () => void;
}

export const TrackMixerDrawer: React.FC<TrackMixerDrawerProps> = ({
  isOpen,
  song,
  activeTrackIndex,
  trackMixes,
  synthVolume,
  useEmbeddedAudio,
  externalAudioName,
  externalAudioVolume,
  audioSourceMode,
  audioSyncConfig,
  autoSyncProgress,
  onClose,
  onSelectActiveTrack,
  onUpdateTrackMix,
  onChangeSynthVolume,
  onToggleEmbeddedAudio,
  onAttachExternalAudio,
  onDetachExternalAudio,
  onChangeExternalAudioVolume,
  onChangeAudioSourceMode,
  onChangeFineOffsetMs,
  onRunAutoSync,
  onOpenSyncStudio,
}) => {
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen || !song) return null;

  return (
    <aside className="fixed right-3 top-16 bottom-16 w-80 sm:w-96 rounded-2xl bg-[#070f1e]/95 backdrop-blur-xl border border-cyan-500/30 shadow-2xl z-40 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Guitar className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100">Faixas, Mixer & Áudio</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Track Selector & Mix */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Instrumentos da Tablatura
            </h3>
            <span className="text-[11px] text-slate-500">Clique para exibir no braço</span>
          </div>

          <div className="space-y-2">
            {song.tracks.map((track) => {
              const mix = trackMixes[track.trackIndex] ?? { volume: 1, muted: false, solo: false };
              const isSelected = track.trackIndex === activeTrackIndex;

              return (
                <div
                  key={track.trackIndex}
                  className={`p-2.5 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-cyan-500/12 border-cyan-400/60'
                      : 'bg-slate-900/80 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <button
                      type="button"
                      disabled={track.isPercussion}
                      onClick={() => onSelectActiveTrack(track.trackIndex)}
                      className={`text-left min-w-0 flex-1 ${
                        track.isPercussion ? 'cursor-default opacity-80' : 'cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-100 truncate">
                          {track.name}
                        </span>
                        {isSelected && (
                          <span className="px-1.5 py-0.2 rounded bg-cyan-500/25 text-cyan-200 text-[10px] font-semibold">
                            No Braço
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {track.isPercussion
                          ? 'Percussão / Bateria'
                          : `${track.stringCount} cordas · ${track.tuningName} · ${track.notes.length} notas`}
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onUpdateTrackMix(track.trackIndex, { muted: !mix.muted })}
                        title="Silenciar faixa (Mute)"
                        className={`w-6 h-6 rounded text-[11px] font-bold border ${
                          mix.muted
                            ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateTrackMix(track.trackIndex, { solo: !mix.solo })}
                        title="Isolar faixa (Solo)"
                        className={`w-6 h-6 rounded text-[11px] font-bold border ${
                          mix.solo
                            ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {mix.muted ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={mix.volume}
                      onChange={(e) =>
                        onUpdateTrackMix(track.trackIndex, { volume: parseFloat(e.target.value) })
                      }
                      className="fret-slider flex-1"
                    />
                    <span className="font-mono text-[10px] text-slate-400 w-8 text-right">
                      {Math.round(mix.volume * 100)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Synth Master & Embedded Audio */}
        <section className="pt-3 border-t border-slate-800/80 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Sintetizador & Áudio da Tablatura
          </h3>

          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-medium">Volume Geral do Synth</span>
              <span className="font-mono text-cyan-300">{Math.round(synthVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={synthVolume}
              onChange={(e) => onChangeSynthVolume(parseFloat(e.target.value))}
              className="fret-slider w-full"
            />
          </div>

          {song.hasEmbeddedAudio && (
            <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 cursor-pointer">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Usar áudio embutido (GP8)
                </div>
                <div className="text-[10px] text-slate-400">
                  Alterna entre a faixa de áudio do arquivo e o sintetizador
                </div>
              </div>
              <input
                type="checkbox"
                checked={useEmbeddedAudio}
                onChange={(e) => onToggleEmbeddedAudio(e.target.checked)}
                className="accent-cyan-400 w-4 h-4"
              />
            </label>
          )}
        </section>

        {/* External Backing Track Audio & Sync */}
        <section className="pt-3 border-t border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Music2 className="w-3.5 h-3.5 text-emerald-400" />
              Áudio Externo (MP3 / WAV)
            </h3>
          </div>

          <input
            ref={audioInputRef}
            type="file"
            accept=".mp3,.wav,.ogg,.m4a,.flac,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttachExternalAudio(file);
              e.target.value = '';
            }}
          />

          {!externalAudioName ? (
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              className="w-full py-2.5 px-3 rounded-xl border border-dashed border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/15 text-xs font-semibold text-cyan-200 flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Anexar Música / Backing Track
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-emerald-950/25 border border-emerald-500/35 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-200 truncate">
                  {externalAudioName}
                </span>
                <button
                  type="button"
                  onClick={onDetachExternalAudio}
                  title="Remover áudio externo"
                  className="p-1 rounded text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Audio Source Mode Selector */}
              <div>
                <div className="text-[11px] text-slate-400 mb-1.5 font-semibold">
                  Fonte de Reprodução Ativa
                </div>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-950/90 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => onChangeAudioSourceMode('external')}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      audioSourceMode === 'external'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Áudio Original
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeAudioSourceMode('synth')}
                    className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      audioSourceMode === 'synth'
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Synth MIDI
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-300">Volume do Áudio</span>
                  <span className="font-mono text-emerald-300">
                    {Math.round(externalAudioVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={externalAudioVolume}
                  onChange={(e) => onChangeExternalAudioVolume(parseFloat(e.target.value))}
                  className="fret-slider w-full"
                />
              </div>

              {/* Auto-Sync & Manual Studio Buttons + Fine Nudge */}
              <div className="space-y-2 pt-2 border-t border-emerald-500/20">
                <button
                  type="button"
                  disabled={autoSyncProgress !== null}
                  onClick={onRunAutoSync}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md"
                >
                  {autoSyncProgress !== null ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {autoSyncProgress !== null
                      ? `Auto-Sincronizando (${autoSyncProgress.percent}%)...`
                      : 'Auto-Sincronizar Agora'}
                  </span>
                </button>

                {audioSyncConfig.mode === 'auto' && audioSyncConfig.confidence !== undefined && (
                  <div className="flex items-center justify-between text-[11px] px-1">
                    <span className="text-emerald-300 font-semibold">
                      Sincronia Automática ({audioSyncConfig.confidence}%)
                    </span>
                    <span className="text-slate-400 font-mono">
                      {audioSyncConfig.anchors.length} âncoras
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-300">Ajuste Fino</span>
                  <span className="font-mono text-cyan-300">
                    {audioSyncConfig.fineOffsetMs >= 0
                      ? `+${audioSyncConfig.fineOffsetMs}`
                      : audioSyncConfig.fineOffsetMs}{' '}
                    ms
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { label: '⏪ -50', delta: -50, title: 'Tab 50ms mais cedo' },
                    { label: '-10', delta: -10, title: 'Tab 10ms mais cedo' },
                    { label: '+10', delta: 10, title: 'Tab 10ms mais tarde' },
                    { label: '+50 ⏩', delta: 50, title: 'Tab 50ms mais tarde' },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      title={btn.title}
                      onClick={() => onChangeFineOffsetMs(audioSyncConfig.fineOffsetMs + btn.delta)}
                      className="py-1 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-200 hover:border-cyan-400"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onOpenSyncStudio}
                  className="w-full py-1.5 px-3 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300 flex items-center justify-center gap-1.5"
                >
                  <Anchor className="w-3 h-3 text-slate-400" />
                  <span>Ajuste Manual Avançado (Waveform)</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
