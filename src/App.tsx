import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Upload, X } from 'lucide-react';
import { DEMO_SONGS, type DemoSongDefinition } from './data/demoSongs';
import { deleteLibrarySong, listLibrarySongs, saveLibrarySong } from './data/libraryStore';
import { AudioController, type CountInStatus } from './engine/audioController';
import { AutoSyncRunner } from './engine/autoSyncClient';
import type { AutoSyncProgress } from './engine/autoSyncEngine';
import { loadTabFromAlphaTex, loadTabFromInput } from './engine/tabLoader';
import {
  buildAutoInitialSync,
  decodeAudioToWaveform,
  type WaveformData,
} from './engine/waveformAnalyzer';
import {
  DEFAULT_AUDIO_SYNC_CONFIG,
  DEFAULT_PRACTICE_SETTINGS,
  type AudioPlaybackSource,
  type AudioSyncConfig,
  type LibrarySongRecord,
  type PracticeSettings,
  type SongData,
  type TrackMixState,
} from './types/music';
import { SongMinimap } from './components/SongMinimap';
import { HighwayCanvas } from './components/HighwayCanvas';
import { MiniTabStrip } from './components/MiniTabStrip';
import { TransportBar } from './components/TransportBar';
import { TrackMixerDrawer } from './components/TrackMixerDrawer';
import { ImportModal } from './components/ImportModal';
import { LibraryDrawer } from './components/LibraryDrawer';
import { AudioSyncStudioModal } from './components/AudioSyncStudioModal';

const TAB_EXTS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.xml', '.musicxml', '.mxl', '.atex', '.txt', '.tab'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

function matchesExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function App() {
  const [song, setSong] = useState<SongData | null>(null);
  const [activeTrackIndex, setActiveTrackIndex] = useState<number>(0);
  const [settings, setSettings] = useState<PracticeSettings>(DEFAULT_PRACTICE_SETTINGS);
  const [trackMixes, setTrackMixes] = useState<Record<number, TrackMixState>>({});

  const [isPlaying, setIsPlaying] = useState(false);
  const [countInStatus, setCountInStatus] = useState<CountInStatus | null>(null);
  const [speedTrainerRep, setSpeedTrainerRep] = useState(0);

  const [synthVolume, setSynthVolume] = useState(1.0);
  const [useEmbeddedAudio, setUseEmbeddedAudio] = useState(true);
  const [externalAudioName, setExternalAudioName] = useState<string | null>(null);
  const [externalAudioBlob, setExternalAudioBlob] = useState<Blob | null>(null);
  const [externalAudioVolume, setExternalAudioVolume] = useState(0.9);
  const [audioSourceMode, setAudioSourceMode] = useState<AudioPlaybackSource>('synth');
  const [audioSyncConfig, setAudioSyncConfig] = useState<AudioSyncConfig>(DEFAULT_AUDIO_SYNC_CONFIG);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [autoSyncProgress, setAutoSyncProgress] = useState<AutoSyncProgress | null>(null);

  const [savedSongs, setSavedSongs] = useState<LibrarySongRecord[]>([]);
  const [isMixerOpen, setIsMixerOpen] = useState(false);
  const [isSyncStudioOpen, setIsSyncStudioOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false);
  const [toast, setToast] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const [hudSnapshot, setHudSnapshot] = useState({
    currentTimeMs: 0,
    measureNumber: 1,
    totalMeasures: 1,
    baseTempo: 120,
    activeChord: '',
  });

  const controllerRef = useRef<AudioController | null>(null);
  const autoSyncRunnerRef = useRef<AutoSyncRunner | null>(null);
  const lastHudSyncRef = useRef(0);
  const waveformJobRef = useRef(0);
  const songRef = useRef<SongData | null>(null);
  const activeTrackIdxRef = useRef(0);
  songRef.current = song;
  activeTrackIdxRef.current = activeTrackIndex;

  const showToast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToast({ text, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const computeHudSnapshot = useCallback((timeMs: number) => {
    const s = songRef.current;
    if (!s) return;
    const track = s.tracks.find((t) => t.trackIndex === activeTrackIdxRef.current) ?? s.tracks[0];
    const mIdx = s.measures.findIndex((m) => timeMs >= m.startTimeMs && timeMs < m.endTimeMs);
    const measure = mIdx >= 0 ? s.measures[mIdx] : s.measures[s.measures.length - 1];

    let activeChord = '';
    if (track) {
      for (let i = track.chords.length - 1; i >= 0; i--) {
        const ch = track.chords[i];
        if (ch.startTimeMs <= timeMs + 40 && ch.endTimeMs >= timeMs - 80) {
          activeChord = ch.name;
          break;
        }
      }
    }

    setHudSnapshot({
      currentTimeMs: timeMs,
      measureNumber: (mIdx >= 0 ? mIdx : s.measures.length - 1) + 1,
      totalMeasures: s.measures.length,
      baseTempo: Math.round(measure?.tempo ?? 120),
      activeChord,
    });
  }, []);

  // Initialize AudioController once
  useEffect(() => {
    const ctrl = new AudioController({
      onPlayStateChange: (playing) => setIsPlaying(playing),
      onCountInChange: (status) => setCountInStatus(status),
      onTimeSeek: (ms) => computeHudSnapshot(ms),
      onLoopRepetitionChange: (rep) => setSpeedTrainerRep(rep),
      onSpeedAutoAdvance: (newSpeed, rep) => {
        setSettings((prev) => ({ ...prev, playbackSpeed: newSpeed }));
        setSpeedTrainerRep(rep);
        showToast(`Speed Trainer: velocidade aumentada para ${Math.round(newSpeed * 100)}%`);
      },
      onError: (msg) => showToast(msg, 'error'),
    });
    ctrl.init();
    controllerRef.current = ctrl;
    autoSyncRunnerRef.current = new AutoSyncRunner();

    return () => {
      autoSyncRunnerRef.current?.cancel();
      autoSyncRunnerRef.current = null;
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, [computeHudSnapshot, showToast]);

  const persistSongSync = useCallback(
    async (
      targetSongId: string,
      audioBlob: Blob | undefined,
      audioFileName: string | undefined,
      sync: AudioSyncConfig
    ) => {
      const existing = (await listLibrarySongs()).find((s) => s.id === targetSongId);
      if (!existing) return;
      const updated: LibrarySongRecord = {
        ...existing,
        audioBlob,
        audioFileName,
        audioOffsetMs: sync.fineOffsetMs,
        audioSync: sync,
        lastPlayedAt: Date.now(),
      };
      await saveLibrarySong(updated);
      setSavedSongs(await listLibrarySongs());
    },
    []
  );

  const executeAutoSyncOnWaveform = useCallback(
    async (wf: WaveformData, blob: Blob, targetSong: SongData, audioFileName: string) => {
      const runner = autoSyncRunnerRef.current;
      if (!runner) return;

      setAutoSyncProgress({
        stage: 'audio',
        label: 'Sincronizando música automaticamente...',
        percent: 5,
      });

      try {
        const result = await runner.run(wf.analysisMono, wf.analysisSampleRate, targetSong, (p) => {
          setAutoSyncProgress(p);
        });

        // Verify this song is still active
        if (songRef.current?.id !== targetSong.id) return;

        setAudioSyncConfig(result.syncConfig);
        controllerRef.current?.setSyncConfig(result.syncConfig);
        controllerRef.current?.setAudioSourceMode('external');
        setAudioSourceMode('external');

        if (targetSong.sourceFormat !== 'demo') {
          await persistSongSync(targetSong.id, blob, audioFileName, result.syncConfig);
        }

        const shiftNote =
          result.detectedSemitoneShift === -1
            ? ' · áudio ½ tom abaixo'
            : result.detectedSemitoneShift === 1
            ? ' · áudio ½ tom acima'
            : result.detectedSemitoneShift === -2
            ? ' · áudio 1 tom abaixo'
            : result.detectedSemitoneShift === 2
            ? ' · áudio 1 tom acima'
            : '';

        showToast(
          `Sincronia automática concluída (${result.confidence}% precisão${shiftNote}) — pode apertar Tocar!`
        );
      } catch (err) {
        console.warn('[AutoSync] Fallback para detecção simples de início:', err);
        const fallback = buildAutoInitialSync(targetSong, activeTrackIdxRef.current, wf.firstOnsetMs);
        setAudioSyncConfig(fallback);
        controllerRef.current?.setSyncConfig(fallback);
        if (targetSong.sourceFormat !== 'demo') {
          await persistSongSync(targetSong.id, blob, audioFileName, fallback);
        }
        showToast('Alinhamento inicial aplicado — você pode refinar em "Sincronia".');
      } finally {
        setAutoSyncProgress(null);
      }
    },
    [persistSongSync, showToast]
  );

  const runWaveformAnalysis = useCallback(
    async (
      blob: Blob,
      targetSong: SongData,
      autoSyncAfterDecode: boolean,
      audioFileName: string
    ) => {
      const jobId = ++waveformJobRef.current;
      autoSyncRunnerRef.current?.cancel();
      setIsWaveformLoading(true);
      setWaveformData(null);
      if (autoSyncAfterDecode) {
        setAutoSyncProgress({
          stage: 'audio',
          label: 'Decodificando áudio para sincronia automática...',
          percent: 3,
        });
      }
      try {
        const wf = await decodeAudioToWaveform(blob);
        if (waveformJobRef.current !== jobId) return;
        setWaveformData(wf);

        if (autoSyncAfterDecode) {
          await executeAutoSyncOnWaveform(wf, blob, targetSong, audioFileName);
        }
      } catch (err) {
        console.warn('[Waveform] Falha ao decodificar forma de onda:', err);
        setAutoSyncProgress(null);
      } finally {
        if (waveformJobRef.current === jobId) {
          setIsWaveformLoading(false);
        }
      }
    },
    [executeAutoSyncOnWaveform]
  );

  const applyLoadedSong = useCallback(
    (
      result: ReturnType<typeof loadTabFromInput>,
      extras?: {
        audioBlob?: Blob;
        audioFileName?: string;
        audioSync?: AudioSyncConfig;
        legacyOffsetMs?: number;
        openSyncStudio?: boolean;
        savedLoop?: { startMs: number; endMs: number };
      }
    ) => {
      const { score, songData } = result;
      setSong(songData);
      setActiveTrackIndex(songData.defaultTrackIndex);

      const initialMixes: Record<number, TrackMixState> = {};
      for (const tr of songData.tracks) {
        initialMixes[tr.trackIndex] = { volume: 1.0, muted: false, solo: false };
      }
      setTrackMixes(initialMixes);

      const firstSection = songData.sections[0];
      const defaultLoopStart = extras?.savedLoop?.startMs ?? firstSection?.startTimeMs ?? 0;
      const defaultLoopEnd =
        extras?.savedLoop?.endMs ?? firstSection?.endTimeMs ?? songData.durationMs;

      setSettings((prev) => ({
        ...prev,
        loopEnabled: false,
        loopStartMs: defaultLoopStart,
        loopEndMs: defaultLoopEnd,
        speedTrainerEnabled: false,
      }));
      setSpeedTrainerRep(0);

      const ctrl = controllerRef.current;
      if (ctrl) {
        ctrl.loadSong(score, songData);
        if (extras?.audioBlob) {
          const resolvedSync: AudioSyncConfig = extras.audioSync
            ? extras.audioSync
            : extras.legacyOffsetMs
            ? { anchors: [], fineOffsetMs: extras.legacyOffsetMs, tempoScale: 1.0 }
            : DEFAULT_AUDIO_SYNC_CONFIG;

          ctrl.attachExternalAudio(extras.audioBlob);
          ctrl.setSyncConfig(resolvedSync);
          ctrl.setAudioSourceMode('external');
          setAudioSourceMode('external');
          setAudioSyncConfig(resolvedSync);
          setExternalAudioBlob(extras.audioBlob);
          const name = extras.audioFileName ?? 'Áudio anexado';
          setExternalAudioName(name);

          const hasExistingSync = Boolean(
            extras.audioSync &&
              (extras.audioSync.anchors.length > 0 || extras.audioSync.fineOffsetMs !== 0)
          );
          void runWaveformAnalysis(
            extras.audioBlob,
            songData,
            !hasExistingSync && !extras.legacyOffsetMs,
            name
          );
        } else {
          waveformJobRef.current++;
          autoSyncRunnerRef.current?.cancel();
          setAutoSyncProgress(null);
          ctrl.detachExternalAudio();
          ctrl.setAudioSourceMode('synth');
          ctrl.setSyncConfig(DEFAULT_AUDIO_SYNC_CONFIG);
          setAudioSourceMode('synth');
          setAudioSyncConfig(DEFAULT_AUDIO_SYNC_CONFIG);
          setExternalAudioBlob(null);
          setExternalAudioName(null);
          setWaveformData(null);
          setIsWaveformLoading(false);
          setIsSyncStudioOpen(false);
        }
      }

      songRef.current = songData;
      activeTrackIdxRef.current = songData.defaultTrackIndex;
      computeHudSnapshot(0);
    },
    [computeHudSnapshot, runWaveformAnalysis]
  );

  // Load initial demo song & IndexedDB saved library
  useEffect(() => {
    const firstDemo = DEMO_SONGS[0];
    if (firstDemo) {
      const loaded = loadTabFromAlphaTex(firstDemo.alphaTex, {
        id: firstDemo.id,
        title: firstDemo.title,
        artist: firstDemo.artist,
        sourceFormat: 'demo',
      });
      applyLoadedSong(loaded);
    }

    listLibrarySongs().then(setSavedSongs);
  }, [applyLoadedSong]);

  // Keep AudioController synced with PracticeSettings
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    ctrl.setPlaybackSpeed(settings.playbackSpeed);
    ctrl.setMetronome(settings.metronomeEnabled, settings.metronomeVolume);
    ctrl.setCountInBars(settings.countInBars);
    ctrl.setLoopConfig({
      loopEnabled: settings.loopEnabled,
      loopStartMs: settings.loopStartMs,
      loopEndMs: settings.loopEndMs,
      speedTrainerEnabled: settings.speedTrainerEnabled,
      speedTrainerStart: settings.speedTrainerStart,
      speedTrainerTarget: settings.speedTrainerTarget,
      speedTrainerStep: settings.speedTrainerStep,
      speedTrainerRepsPerStep: settings.speedTrainerRepsPerStep,
    });
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<PracticeSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const getCurrentTimeMs = useCallback(() => {
    return controllerRef.current?.getCurrentTimeMs() ?? 0;
  }, []);

  const handleFrameTick = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const ms = ctrl.tick();
    const nowPerf = performance.now();
    if (nowPerf - lastHudSyncRef.current >= 65) {
      lastHudSyncRef.current = nowPerf;
      computeHudSnapshot(ms);
    }
  }, [computeHudSnapshot]);

  const handleSeek = useCallback(
    (ms: number) => {
      controllerRef.current?.seekMs(ms);
      computeHudSnapshot(ms);
    },
    [computeHudSnapshot]
  );

  const handlePlayPause = useCallback(() => {
    controllerRef.current?.playPause();
  }, []);

  const handleRestart = useCallback(() => {
    controllerRef.current?.stop();
    computeHudSnapshot(settings.loopEnabled ? settings.loopStartMs : 0);
  }, [computeHudSnapshot, settings.loopEnabled, settings.loopStartMs]);

  const handleStepMeasure = useCallback(
    (delta: -1 | 1) => {
      if (!song || song.measures.length === 0) return;
      const currentMs = getCurrentTimeMs();
      let idx = song.measures.findIndex((m) => currentMs >= m.startTimeMs && currentMs < m.endTimeMs);
      if (idx < 0) idx = 0;
      const targetIdx = Math.max(0, Math.min(song.measures.length - 1, idx + delta));
      handleSeek(song.measures[targetIdx].startTimeMs);
    },
    [getCurrentTimeMs, handleSeek, song]
  );

  const handleSetLoop = useCallback((enabled: boolean, startMs: number, endMs: number) => {
    setSettings((prev) => ({
      ...prev,
      loopEnabled: enabled,
      loopStartMs: startMs,
      loopEndMs: endMs,
    }));
  }, []);

  const handleToggleLoop = useCallback(() => {
    if (!song) return;
    setSettings((prev) => {
      if (prev.loopEnabled) {
        return { ...prev, loopEnabled: false };
      }
      const hasRange = prev.loopEndMs > prev.loopStartMs + 150;
      const start = hasRange ? prev.loopStartMs : 0;
      const end = hasRange ? prev.loopEndMs : song.durationMs;
      return { ...prev, loopEnabled: true, loopStartMs: start, loopEndMs: end };
    });
  }, [song]);

  const handleUpdateTrackMix = useCallback((trackIndex: number, patch: Partial<TrackMixState>) => {
    setTrackMixes((prev) => {
      const current = prev[trackIndex] ?? { volume: 1.0, muted: false, solo: false };
      const updated = { ...current, ...patch };
      controllerRef.current?.setTrackMix(trackIndex, updated);
      return { ...prev, [trackIndex]: updated };
    });
  }, []);

  const handleChangeSyncConfig = useCallback(
    (nextSync: AudioSyncConfig) => {
      setAudioSyncConfig(nextSync);
      controllerRef.current?.setSyncConfig(nextSync);
      if (song && externalAudioBlob && externalAudioName && song.sourceFormat !== 'demo') {
        void persistSongSync(song.id, externalAudioBlob, externalAudioName, nextSync);
      }
    },
    [externalAudioBlob, externalAudioName, persistSongSync, song]
  );

  const handleChangeAudioSourceMode = useCallback((mode: AudioPlaybackSource) => {
    setAudioSourceMode(mode);
    controllerRef.current?.setAudioSourceMode(mode);
  }, []);

  const handleRunAutoSync = useCallback(async () => {
    if (!song || !externalAudioBlob || !externalAudioName) return;
    if (waveformData) {
      await executeAutoSyncOnWaveform(waveformData, externalAudioBlob, song, externalAudioName);
    } else {
      await runWaveformAnalysis(externalAudioBlob, song, true, externalAudioName);
    }
  }, [executeAutoSyncOnWaveform, externalAudioBlob, externalAudioName, runWaveformAnalysis, song, waveformData]);

  const handleAttachExternalAudio = useCallback(
    async (file: File) => {
      const ctrl = controllerRef.current;
      if (!ctrl) return;
      ctrl.attachExternalAudio(file);
      ctrl.setSyncConfig(DEFAULT_AUDIO_SYNC_CONFIG);
      ctrl.setAudioSourceMode('external');
      setAudioSourceMode('external');
      setAudioSyncConfig(DEFAULT_AUDIO_SYNC_CONFIG);
      setExternalAudioBlob(file);
      setExternalAudioName(file.name);

      if (song) {
        if (song.sourceFormat !== 'demo') {
          await persistSongSync(song.id, file, file.name, DEFAULT_AUDIO_SYNC_CONFIG);
        }
        void runWaveformAnalysis(file, song, true, file.name);
      }
      setIsMixerOpen(false);
    },
    [persistSongSync, runWaveformAnalysis, song]
  );

  const handleDetachExternalAudio = useCallback(async () => {
    waveformJobRef.current++;
    autoSyncRunnerRef.current?.cancel();
    setAutoSyncProgress(null);
    controllerRef.current?.detachExternalAudio();
    setAudioSourceMode('synth');
    setAudioSyncConfig(DEFAULT_AUDIO_SYNC_CONFIG);
    setExternalAudioBlob(null);
    setExternalAudioName(null);
    setWaveformData(null);
    setIsWaveformLoading(false);
    setIsSyncStudioOpen(false);
    if (song && song.sourceFormat !== 'demo') {
      await persistSongSync(song.id, undefined, undefined, DEFAULT_AUDIO_SYNC_CONFIG);
    }
    showToast('Áudio externo removido — voltando para Synth MIDI.');
  }, [persistSongSync, showToast, song]);

  const handleImportFiles = useCallback(
    async (tabFile: File | null, audioFile: File | null) => {
      if (!tabFile && audioFile) {
        await handleAttachExternalAudio(audioFile);
        return;
      }
      if (!tabFile) return;

      const bytes = new Uint8Array(await tabFile.arrayBuffer());
      const id = `song-${Date.now()}`;
      const loaded = loadTabFromInput({
        id,
        fileName: tabFile.name,
        bytes,
      });

      const record: LibrarySongRecord = {
        id,
        title: loaded.songData.title,
        artist: loaded.songData.artist,
        sourceFormat: loaded.songData.sourceFormat,
        createdAt: Date.now(),
        lastPlayedAt: Date.now(),
        rawBytes: loaded.songData.rawBytes,
        alphaTex: loaded.songData.alphaTex,
        audioBlob: audioFile ?? undefined,
        audioFileName: audioFile?.name,
        audioOffsetMs: 0,
        audioSync: DEFAULT_AUDIO_SYNC_CONFIG,
      };

      await saveLibrarySong(record);
      setSavedSongs(await listLibrarySongs());
      applyLoadedSong(loaded, {
        audioBlob: audioFile ?? undefined,
        audioFileName: audioFile?.name,
        openSyncStudio: Boolean(audioFile),
      });
      showToast(`"${loaded.songData.title}" carregada com sucesso!`);
    },
    [applyLoadedSong, handleAttachExternalAudio, showToast]
  );

  const handleImportAscii = useCallback(
    async ({ text, title, bpm }: { text: string; title: string; bpm: number }) => {
      const id = `ascii-${Date.now()}`;
      const loaded = loadTabFromInput({
        id,
        title,
        artist: 'Tablatura ASCII',
        text,
        sourceFormat: 'ascii',
        asciiBpm: bpm,
      });

      const record: LibrarySongRecord = {
        id,
        title: loaded.songData.title,
        artist: loaded.songData.artist,
        sourceFormat: 'ascii',
        createdAt: Date.now(),
        lastPlayedAt: Date.now(),
        alphaTex: loaded.songData.alphaTex,
        audioOffsetMs: 0,
      };
      await saveLibrarySong(record);
      setSavedSongs(await listLibrarySongs());
      applyLoadedSong(loaded);
      showToast(`Tablatura "${loaded.songData.title}" carregada!`);
    },
    [applyLoadedSong, showToast]
  );

  const handleSelectDemo = useCallback(
    (demo: DemoSongDefinition) => {
      const loaded = loadTabFromAlphaTex(demo.alphaTex, {
        id: demo.id,
        title: demo.title,
        artist: demo.artist,
        sourceFormat: 'demo',
      });
      applyLoadedSong(loaded);
      setIsLibraryOpen(false);
      showToast(`Demo carregada: ${demo.title}`);
    },
    [applyLoadedSong, showToast]
  );

  const handleSelectSaved = useCallback(
    async (record: LibrarySongRecord) => {
      try {
        const loaded = record.alphaTex
          ? loadTabFromAlphaTex(record.alphaTex, {
              id: record.id,
              title: record.title,
              artist: record.artist,
              sourceFormat: record.sourceFormat,
            })
          : loadTabFromInput({
              id: record.id,
              title: record.title,
              artist: record.artist,
              bytes: record.rawBytes ? new Uint8Array(record.rawBytes) : undefined,
              sourceFormat: record.sourceFormat,
            });

        await saveLibrarySong({ ...record, lastPlayedAt: Date.now() });
        setSavedSongs(await listLibrarySongs());
        applyLoadedSong(loaded, {
          audioBlob: record.audioBlob,
          audioFileName: record.audioFileName,
          audioSync: record.audioSync,
          legacyOffsetMs: record.audioOffsetMs,
          savedLoop: record.savedLoop,
        });
        setIsLibraryOpen(false);
        showToast(`"${record.title}" carregada!`);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : 'Não foi possível reabrir esta tablatura.',
          'error'
        );
      }
    },
    [applyLoadedSong, showToast]
  );

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      await deleteLibrarySong(id);
      setSavedSongs(await listLibrarySongs());
      showToast('Tablatura removida da biblioteca.');
    },
    [showToast]
  );

  // Global Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSyncStudioOpen || isImportOpen) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setSettings((p) => ({
          ...p,
          playbackSpeed: Math.max(0.25, Math.round((p.playbackSpeed - 0.05) * 100) / 100),
        }));
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setSettings((p) => ({
          ...p,
          playbackSpeed: Math.min(1.5, Math.round((p.playbackSpeed + 0.05) * 100) / 100),
        }));
      } else if (e.key === '[' && externalAudioName) {
        e.preventDefault();
        const nextSync = { ...audioSyncConfig, fineOffsetMs: audioSyncConfig.fineOffsetMs - 15 };
        handleChangeSyncConfig(nextSync);
        showToast(`Sincronia: Tab 15ms mais cedo (${nextSync.fineOffsetMs}ms)`);
      } else if (e.key === ']' && externalAudioName) {
        e.preventDefault();
        const nextSync = { ...audioSyncConfig, fineOffsetMs: audioSyncConfig.fineOffsetMs + 15 };
        handleChangeSyncConfig(nextSync);
        showToast(`Sincronia: Tab 15ms mais tarde (+${nextSync.fineOffsetMs}ms)`);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStepMeasure(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleStepMeasure(1);
      } else if (e.key === 'l' || e.key === 'L') {
        handleToggleLoop();
      } else if (e.key === 'm' || e.key === 'M') {
        updateSettings({ metronomeEnabled: !settings.metronomeEnabled });
      } else if (e.key === 'i' || e.key === 'I') {
        updateSettings({ invertStrings: !settings.invertStrings });
      } else if (e.key === 't' || e.key === 'T') {
        updateSettings({ showMiniTab: !settings.showMiniTab });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    audioSyncConfig,
    externalAudioName,
    handleChangeSyncConfig,
    handlePlayPause,
    handleStepMeasure,
    handleToggleLoop,
    isImportOpen,
    isSyncStudioOpen,
    settings.invertStrings,
    settings.metronomeEnabled,
    settings.showMiniTab,
    showToast,
    updateSettings,
  ]);

  const activeTrack = useMemo(() => {
    if (!song) return null;
    return song.tracks.find((t) => t.trackIndex === activeTrackIndex) ?? song.tracks[0] ?? null;
  }, [song, activeTrackIndex]);

  // Global Drag & Drop
  const handleGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsGlobalDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const tabFile = files.find((f) => matchesExt(f.name, TAB_EXTS)) ?? null;
    const audioFile =
      files.find((f) => matchesExt(f.name, AUDIO_EXTS) || f.type.startsWith('audio/')) ?? null;

    if (!tabFile && !audioFile) {
      showToast('Formato não suportado. Use .gp, .gp3–.gpx, .xml, .txt ou áudio (.mp3/.wav).', 'error');
      return;
    }

    try {
      await handleImportFiles(tabFile, audioFile);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao importar arquivo.', 'error');
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isImportOpen) setIsGlobalDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsGlobalDragOver(false);
      }}
      onDrop={handleGlobalDrop}
      className="h-screen w-screen flex flex-col bg-[#030710] text-slate-100 overflow-hidden relative"
    >
      {/* Top Minimap & Section Loop Strip */}
      <SongMinimap
        song={song}
        track={activeTrack}
        currentTimeMs={hudSnapshot.currentTimeMs}
        loopEnabled={settings.loopEnabled}
        loopStartMs={settings.loopStartMs}
        loopEndMs={settings.loopEndMs}
        onSeek={handleSeek}
        onSetLoop={handleSetLoop}
      />

      {/* Main 3D Rocksmith Highway Viewport */}
      <HighwayCanvas
        song={song}
        track={activeTrack}
        settings={settings}
        isPlaying={isPlaying}
        countInStatus={countInStatus}
        speedTrainerRep={speedTrainerRep}
        getCurrentTimeMs={getCurrentTimeMs}
        onFrameTick={handleFrameTick}
        hudSnapshot={hudSnapshot}
      />

      {/* Collapsible Synchronized 2D Mini-Tab */}
      {settings.showMiniTab && (
        <MiniTabStrip
          song={song}
          track={activeTrack}
          getCurrentTimeMs={getCurrentTimeMs}
          onSeek={handleSeek}
        />
      )}

      {/* Bottom Transport & Learning Controls */}
      <TransportBar
        isPlaying={isPlaying}
        hasSong={Boolean(song)}
        settings={settings}
        speedTrainerRep={speedTrainerRep}
        hasExternalAudio={Boolean(externalAudioName)}
        audioSyncConfig={audioSyncConfig}
        autoSyncProgress={autoSyncProgress}
        onPlayPause={handlePlayPause}
        onRestart={handleRestart}
        onPrevMeasure={() => handleStepMeasure(-1)}
        onNextMeasure={() => handleStepMeasure(1)}
        onUpdateSettings={updateSettings}
        onToggleLoop={handleToggleLoop}
        onOpenMixer={() => {
          setIsMixerOpen((v) => !v);
          setIsLibraryOpen(false);
        }}
        onRunAutoSync={() => void handleRunAutoSync()}
        onChangeFineOffsetMs={(fineOffsetMs) =>
          handleChangeSyncConfig({ ...audioSyncConfig, fineOffsetMs })
        }
        onOpenSyncStudio={() => {
          handleChangeAudioSourceMode('external');
          setIsSyncStudioOpen(true);
          setIsMixerOpen(false);
        }}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenLibrary={() => {
          setIsLibraryOpen((v) => !v);
          setIsMixerOpen(false);
        }}
        isMixerOpen={isMixerOpen}
        isLibraryOpen={isLibraryOpen}
      />

      {/* Drawers & Modals */}
      <TrackMixerDrawer
        isOpen={isMixerOpen}
        song={song}
        activeTrackIndex={activeTrackIndex}
        trackMixes={trackMixes}
        synthVolume={synthVolume}
        useEmbeddedAudio={useEmbeddedAudio}
        externalAudioName={externalAudioName}
        externalAudioVolume={externalAudioVolume}
        audioSourceMode={audioSourceMode}
        audioSyncConfig={audioSyncConfig}
        autoSyncProgress={autoSyncProgress}
        onClose={() => setIsMixerOpen(false)}
        onSelectActiveTrack={(idx) => setActiveTrackIndex(idx)}
        onUpdateTrackMix={handleUpdateTrackMix}
        onChangeSynthVolume={(vol) => {
          setSynthVolume(vol);
          controllerRef.current?.setSynthVolume(vol);
        }}
        onToggleEmbeddedAudio={(use) => {
          setUseEmbeddedAudio(use);
          controllerRef.current?.setUseEmbeddedAudio(use);
        }}
        onAttachExternalAudio={handleAttachExternalAudio}
        onDetachExternalAudio={handleDetachExternalAudio}
        onChangeExternalAudioVolume={(vol) => {
          setExternalAudioVolume(vol);
          controllerRef.current?.setExternalAudioVolume(vol);
        }}
        onChangeAudioSourceMode={handleChangeAudioSourceMode}
        onChangeFineOffsetMs={(fineOffsetMs) =>
          handleChangeSyncConfig({ ...audioSyncConfig, fineOffsetMs })
        }
        onRunAutoSync={() => void handleRunAutoSync()}
        onOpenSyncStudio={() => {
          handleChangeAudioSourceMode('external');
          setIsSyncStudioOpen(true);
          setIsMixerOpen(false);
        }}
      />

      <AudioSyncStudioModal
        isOpen={isSyncStudioOpen}
        song={song}
        track={activeTrack}
        audioFileName={externalAudioName}
        waveform={waveformData}
        isWaveformLoading={isWaveformLoading}
        syncConfig={audioSyncConfig}
        isPlaying={isPlaying}
        playbackSpeed={settings.playbackSpeed}
        getExternalAudioTimeMs={() => controllerRef.current?.getExternalAudioTimeMs() ?? 0}
        onClose={() => setIsSyncStudioOpen(false)}
        onChangeSyncConfig={(next) => handleChangeSyncConfig({ ...next, mode: 'manual' })}
        onSeekAudioMs={(audioMs) => {
          handleChangeAudioSourceMode('external');
          controllerRef.current?.seekExternalAudioMs(audioMs);
        }}
        onPlayPause={(skipCountIn) => {
          handleChangeAudioSourceMode('external');
          void controllerRef.current?.playPause(skipCountIn);
        }}
        onSetSpeed={(speed) => updateSettings({ playbackSpeed: speed })}
        onSetStudioMetronome={(enabled) =>
          controllerRef.current?.setStudioMetronomeOverride(enabled)
        }
      />

      <LibraryDrawer
        isOpen={isLibraryOpen}
        activeSongId={song?.id ?? null}
        savedSongs={savedSongs}
        onClose={() => setIsLibraryOpen(false)}
        onSelectDemo={handleSelectDemo}
        onSelectSaved={handleSelectSaved}
        onDeleteSaved={handleDeleteSaved}
        onOpenImport={() => {
          setIsLibraryOpen(false);
          setIsImportOpen(true);
        }}
      />

      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportFiles={handleImportFiles}
        onImportAsciiText={handleImportAscii}
      />

      {/* Global Drag-Over Drop Overlay */}
      {isGlobalDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 bg-cyan-950/75 backdrop-blur-sm border-4 border-dashed border-cyan-400 flex items-center justify-center">
          <div className="text-center px-8 py-6 rounded-2xl bg-slate-950/90 border border-cyan-400/50 shadow-2xl">
            <Upload className="w-12 h-12 text-cyan-400 mx-auto mb-2" />
            <div className="text-lg font-bold text-white">
              Solte aqui para importar Tablatura ou Áudio
            </div>
            <div className="text-xs text-cyan-200/80 mt-1">
              Suporta Guitar Pro (.gp / .gpx / .gp5), MusicXML, ASCII (.txt) e Áudio (.mp3 / .wav)
            </div>
          </div>
        </div>
      )}

      {/* Non-blocking Auto-Sync Progress Banner */}
      {autoSyncProgress && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[92vw] max-w-md px-4 py-3 rounded-2xl bg-slate-950/92 border border-emerald-400/50 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                Auto-Sincronia em andamento ({autoSyncProgress.percent}%)
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                autoSyncRunnerRef.current?.cancel();
                setAutoSyncProgress(null);
              }}
              title="Cancelar sincronia automática"
              className="p-0.5 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-slate-300 mb-2">{autoSyncProgress.label}</div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              style={{ width: `${Math.max(5, Math.min(100, autoSyncProgress.percent))}%` }}
              className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-150"
            />
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-semibold shadow-xl border backdrop-blur-md ${
            toast.kind === 'error'
              ? 'bg-rose-950/90 border-rose-500/60 text-rose-100'
              : 'bg-slate-900/90 border-cyan-500/50 text-cyan-100'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default App;
