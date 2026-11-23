import * as alphaTab from '@coderline/alphatab';
import {
  DEFAULT_AUDIO_SYNC_CONFIG,
  type AudioPlaybackSource,
  type AudioSyncConfig,
  type SongData,
  type TrackMixState,
} from '../types/music';
import { audioToTabMs, normalizeSyncConfig, tabToAudioMs } from './syncMap';

export interface CountInStatus {
  active: boolean;
  beat: number;
  totalBeats: number;
  bar: number;
  totalBars: number;
}

export interface AudioControllerCallbacks {
  onReadyStateChange?: (ready: { soundFontLoaded: boolean; playerReady: boolean }) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onTimeSeek?: (timeMs: number) => void;
  onSpeedAutoAdvance?: (newSpeed: number, repCount: number) => void;
  onCountInChange?: (status: CountInStatus | null) => void;
  onLoopRepetitionChange?: (repCount: number) => void;
  onError?: (message: string) => void;
}

export interface LoopTrainerConfig {
  loopEnabled: boolean;
  loopStartMs: number;
  loopEndMs: number;
  speedTrainerEnabled: boolean;
  speedTrainerStart: number;
  speedTrainerTarget: number;
  speedTrainerStep: number;
  speedTrainerRepsPerStep: number;
}

export class AudioController {
  private container: HTMLDivElement | null = null;
  private api: alphaTab.AlphaTabApi | null = null;
  private score: alphaTab.model.Score | null = null;
  private songData: SongData | null = null;

  private soundFontLoaded = false;
  private playerReady = false;
  private initFailed = false;
  private isPlaying = false;
  private isFallbackClock = false;

  private playbackSpeed = 1.0;
  private synthVolume = 1.0;
  private metronomeEnabled = false;
  private studioMetronomeOverride: boolean | null = null;
  private metronomeVolume = 0.65;
  private countInBars: 0 | 1 | 2 = 1;
  private useEmbeddedAudio = true;

  // Master clock source
  private audioSourceMode: AudioPlaybackSource = 'synth';
  private syncConfig: AudioSyncConfig = DEFAULT_AUDIO_SYNC_CONFIG;

  // Synth / fallback clock interpolation state (tab ms)
  private lastAnchorSongMs = 0;
  private lastAnchorPerfMs = 0;
  private lastPlayedBeatKey = '';

  // External audio master clock interpolation state (audio ms)
  private lastExtAudioMs = 0;
  private lastExtPerfMs = 0;
  private lastObservedAudioSec = -1;

  // Count-in pre-roll state
  private countInTimerId: number | null = null;
  private countInActive = false;
  private countInStartPerfMs = 0;
  private countInDurationMs = 0;
  private countInTargetMs = 0;

  // External backing track audio
  private externalAudio: HTMLAudioElement | null = null;
  private externalAudioUrl: string | null = null;
  private externalAudioVolume = 0.9;

  // Track mixes
  private trackMixes = new Map<number, TrackMixState>();

  // Loop & Speed Trainer
  private loopConfig: LoopTrainerConfig = {
    loopEnabled: false,
    loopStartMs: 0,
    loopEndMs: 0,
    speedTrainerEnabled: false,
    speedTrainerStart: 0.6,
    speedTrainerTarget: 1.0,
    speedTrainerStep: 0.05,
    speedTrainerRepsPerStep: 2,
  };
  private loopRepetitionCount = 0;
  private lastLoopWrapPerfMs = 0;

  // Web Audio click synthesizer for count-in & metronome
  private audioCtx: AudioContext | null = null;
  private callbacks: AudioControllerCallbacks;

  constructor(callbacks: AudioControllerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public init(): void {
    if (this.api || typeof document === 'undefined') return;

    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.overflow = 'hidden';
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.contain = 'strict';
    el.style.zIndex = '-1';
    document.body.appendChild(el);
    this.container = el;
    window.scrollTo(0, 0);

    try {
      this.api = new alphaTab.AlphaTabApi(el, {
        core: {
          fontDirectory: '/alphatab/font/',
          useWorkers: true,
        },
        display: {
          layoutMode: alphaTab.LayoutMode.Horizontal,
          scale: 0.5,
        },
        player: {
          enablePlayer: true,
          enableUserInteraction: false,
          enableCursor: false,
          enableAnimatedBeatCursor: false,
          scrollMode: alphaTab.ScrollMode.Off,
          scrollElement: el,
          playerMode: alphaTab.PlayerMode.EnabledAutomatic,
          soundFont: '/alphatab/sonivox.sf2',
        },
      });

      this.api.soundFontLoaded.on(() => {
        this.soundFontLoaded = true;
        this.callbacks.onReadyStateChange?.({
          soundFontLoaded: this.soundFontLoaded,
          playerReady: this.playerReady,
        });
      });

      this.api.playerReady.on(() => {
        this.playerReady = true;
        this.applyApiAudioSettings();
        this.applyAllTrackMixes();

        if (!this.initFailed && this.isFallbackClock && this.audioSourceMode === 'synth') {
          this.isFallbackClock = false;
          if (this.isPlaying && !this.countInActive && this.api) {
            try {
              this.api.timePosition = this.getCurrentTimeMs();
              this.api.play();
            } catch {
              this.isFallbackClock = true;
            }
          }
        }

        this.callbacks.onReadyStateChange?.({
          soundFontLoaded: this.soundFontLoaded,
          playerReady: this.playerReady,
        });
      });

      this.api.playerStateChanged.on((args) => {
        if (this.audioSourceMode === 'external') return;
        const playing = args.state === alphaTab.synth.PlayerState.Playing;
        if (!this.isFallbackClock && !this.countInActive) {
          this.isPlaying = playing;
          if (playing) {
            this.lastAnchorPerfMs = performance.now();
          } else if (args.stopped) {
            const resetPos = this.loopConfig.loopEnabled ? this.loopConfig.loopStartMs : 0;
            this.lastAnchorSongMs = resetPos;
            this.callbacks.onTimeSeek?.(resetPos);
          }
          this.callbacks.onPlayStateChange?.(this.isPlaying);
        }
      });

      this.api.playerPositionChanged.on((args) => {
        if (this.audioSourceMode === 'external' || this.isFallbackClock || this.countInActive) return;
        const now = performance.now();
        if (this.isPlaying) {
          const predicted = this.lastAnchorSongMs + (now - this.lastAnchorPerfMs) * this.playbackSpeed;
          const diff = args.currentTime - predicted;
          if (Math.abs(diff) > 40) {
            this.lastAnchorSongMs = args.currentTime;
          } else {
            this.lastAnchorSongMs = predicted + diff * 0.35;
          }
        } else {
          this.lastAnchorSongMs = args.currentTime;
        }
        this.lastAnchorPerfMs = now;
      });

      this.api.error.on((err) => {
        console.warn('[AlphaTab error]', err);
      });
    } catch (err) {
      console.warn('[AudioController] AlphaTab init fallback:', err);
      this.initFailed = true;
      this.isFallbackClock = true;
    }
  }

  public destroy(): void {
    this.cancelCountIn();
    this.detachExternalAudio();
    try {
      this.api?.destroy();
    } catch {
      // ignore destroy errors
    }
    this.api = null;
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  public loadSong(score: alphaTab.model.Score, songData: SongData): void {
    this.stop();
    this.score = score;
    this.songData = songData;
    this.playerReady = false;
    this.loopRepetitionCount = 0;
    this.lastAnchorSongMs = 0;
    this.lastAnchorPerfMs = performance.now();
    this.lastExtAudioMs = tabToAudioMs(0, this.syncConfig);
    this.lastExtPerfMs = performance.now();
    this.trackMixes.clear();

    for (const track of songData.tracks) {
      this.trackMixes.set(track.trackIndex, {
        volume: 1.0,
        muted: false,
        solo: false,
      });
    }

    if (this.api) {
      try {
        this.api.settings.player.playerMode = this.useEmbeddedAudio
          ? alphaTab.PlayerMode.EnabledAutomatic
          : alphaTab.PlayerMode.EnabledSynthesizer;
        this.api.updateSettings();
        this.api.renderScore(score, [songData.defaultTrackIndex]);
      } catch (err) {
        console.warn('[AudioController] renderScore failed, using fallback clock:', err);
        this.isFallbackClock = true;
      }
    }
  }

  public setUseEmbeddedAudio(useEmbedded: boolean): void {
    this.useEmbeddedAudio = useEmbedded;
    if (!this.api || !this.score) return;
    const wasPlaying = this.isPlaying;
    const pos = this.getCurrentTimeMs();
    if (wasPlaying) this.pause();
    this.api.settings.player.playerMode = useEmbedded
      ? alphaTab.PlayerMode.EnabledAutomatic
      : alphaTab.PlayerMode.EnabledSynthesizer;
    this.api.updateSettings();
    this.api.renderScore(this.score, [this.songData?.defaultTrackIndex ?? 0]);
    this.seekMs(pos);
  }

  public attachExternalAudio(blob: Blob): void {
    this.detachExternalAudio();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.preservesPitch = true;
    (audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    audio.playbackRate = this.playbackSpeed;
    audio.volume = this.externalAudioVolume;
    this.externalAudioUrl = url;
    this.externalAudio = audio;
    this.lastObservedAudioSec = -1;
    this.lastExtAudioMs = Math.max(0, tabToAudioMs(this.lastAnchorSongMs, this.syncConfig));
    this.lastExtPerfMs = performance.now();
  }

  public detachExternalAudio(): void {
    if (this.audioSourceMode === 'external') {
      this.setAudioSourceMode('synth');
    }
    if (this.externalAudio) {
      this.externalAudio.pause();
      this.externalAudio.src = '';
      this.externalAudio = null;
    }
    if (this.externalAudioUrl) {
      URL.revokeObjectURL(this.externalAudioUrl);
      this.externalAudioUrl = null;
    }
    this.lastObservedAudioSec = -1;
  }

  public setAudioSourceMode(mode: AudioPlaybackSource): void {
    if (mode === 'external' && !this.externalAudio) {
      this.audioSourceMode = 'synth';
      return;
    }
    if (this.audioSourceMode === mode) return;

    const wasPlaying = this.isPlaying;
    const currentTabMs = this.getCurrentTimeMs();
    if (wasPlaying || this.countInActive) {
      this.pause();
    }

    this.audioSourceMode = mode;
    this.seekMs(currentTabMs);
  }

  public getAudioSourceMode(): AudioPlaybackSource {
    return this.audioSourceMode;
  }

  public setSyncConfig(config: AudioSyncConfig): void {
    this.syncConfig = normalizeSyncConfig(config);
    if (!this.isPlaying && !this.countInActive && this.audioSourceMode === 'external') {
      // Keep tab position coherent with current external audio position or re-seek if needed
      const tabMs = audioToTabMs(this.lastExtAudioMs, this.syncConfig);
      this.lastAnchorSongMs = Math.max(0, tabMs);
    }
  }

  public setExternalAudioVolume(volume: number): void {
    this.externalAudioVolume = Math.max(0, Math.min(1, volume));
    if (this.externalAudio) {
      this.externalAudio.volume = this.externalAudioVolume;
    }
  }

  public setSynthVolume(volume: number): void {
    this.synthVolume = Math.max(0, Math.min(1, volume));
    this.applyApiAudioSettings();
  }

  public setPlaybackSpeed(speed: number): void {
    const clamped = Math.max(0.25, Math.min(1.5, Math.round(speed * 100) / 100));
    const current = this.getCurrentTimeMs();
    const currentExt = this.getExternalAudioTimeMs();
    this.playbackSpeed = clamped;
    this.lastAnchorSongMs = current;
    this.lastAnchorPerfMs = performance.now();
    this.lastExtAudioMs = currentExt;
    this.lastExtPerfMs = performance.now();

    if (this.api) {
      this.api.playbackSpeed = clamped;
    }
    if (this.externalAudio) {
      this.externalAudio.playbackRate = clamped;
    }
  }

  public setMetronome(enabled: boolean, volume: number): void {
    this.metronomeEnabled = enabled;
    this.metronomeVolume = Math.max(0, Math.min(1, volume));
    this.applyApiAudioSettings();
  }

  public setStudioMetronomeOverride(enabled: boolean | null): void {
    this.studioMetronomeOverride = enabled;
    if (enabled) {
      this.ensureAudioContext().catch(() => {});
    }
  }

  public setCountInBars(bars: 0 | 1 | 2): void {
    this.countInBars = bars;
  }

  public setTrackMix(trackIndex: number, mix: TrackMixState): void {
    this.trackMixes.set(trackIndex, mix);
    this.applyTrackMix(trackIndex, mix);
  }

  public setLoopConfig(config: LoopTrainerConfig): void {
    const prevEnabled = this.loopConfig.loopEnabled;
    this.loopConfig = { ...config };
    if (!prevEnabled && config.loopEnabled) {
      this.loopRepetitionCount = 0;
      this.callbacks.onLoopRepetitionChange?.(0);
    }
  }

  public resetLoopRepetitions(): void {
    this.loopRepetitionCount = 0;
    this.callbacks.onLoopRepetitionChange?.(0);
  }

  public getIsPlaying(): boolean {
    return this.isPlaying || this.countInActive;
  }

  private isExternalMasterActive(): boolean {
    return this.audioSourceMode === 'external' && this.externalAudio !== null;
  }

  public getExternalAudioTimeMs(): number {
    if (this.isPlaying && !this.countInActive && this.isExternalMasterActive()) {
      const elapsed = (performance.now() - this.lastExtPerfMs) * this.playbackSpeed;
      return this.lastExtAudioMs + elapsed;
    }
    return this.lastExtAudioMs;
  }

  public seekExternalAudioMs(audioMs: number): void {
    const maxAudioMs =
      this.externalAudio && Number.isFinite(this.externalAudio.duration) && this.externalAudio.duration > 0
        ? this.externalAudio.duration * 1000
        : Infinity;
    const clampedAudioMs = Math.max(0, Math.min(maxAudioMs, audioMs));
    this.lastExtAudioMs = clampedAudioMs;
    this.lastExtPerfMs = performance.now();
    this.lastPlayedBeatKey = '';

    if (this.externalAudio) {
      const targetSec = clampedAudioMs / 1000;
      this.externalAudio.currentTime = targetSec;
      this.lastObservedAudioSec = targetSec;
    }

    const mappedTabMs = Math.max(0, audioToTabMs(clampedAudioMs, this.syncConfig));
    this.lastAnchorSongMs = mappedTabMs;
    this.lastAnchorPerfMs = performance.now();
    this.callbacks.onTimeSeek?.(mappedTabMs);
  }

  public getCurrentTimeMs(): number {
    if (this.countInActive) {
      const elapsed = (performance.now() - this.countInStartPerfMs) * this.playbackSpeed;
      const remaining = Math.max(0, this.countInDurationMs - elapsed);
      return this.countInTargetMs - remaining;
    }
    if (this.isExternalMasterActive()) {
      return Math.max(0, audioToTabMs(this.getExternalAudioTimeMs(), this.syncConfig));
    }
    if (this.isPlaying) {
      const elapsed = (performance.now() - this.lastAnchorPerfMs) * this.playbackSpeed;
      return Math.max(0, this.lastAnchorSongMs + elapsed);
    }
    return Math.max(0, this.lastAnchorSongMs);
  }

  public async play(skipCountIn = false): Promise<void> {
    if (this.isPlaying || this.countInActive) return;

    await this.ensureAudioContext();

    let startMs = this.getCurrentTimeMs();
    if (this.loopConfig.loopEnabled && this.loopConfig.loopEndMs > this.loopConfig.loopStartMs) {
      if (startMs < this.loopConfig.loopStartMs || startMs >= this.loopConfig.loopEndMs) {
        startMs = this.loopConfig.loopStartMs;
        this.seekMs(startMs);
      }
    } else if (this.songData && startMs >= this.songData.durationMs - 40) {
      startMs = 0;
      this.seekMs(0);
    }

    if (!skipCountIn && this.countInBars > 0 && this.songData) {
      this.startCountIn(startMs);
      return;
    }

    this.beginActualPlayback(startMs);
  }

  public pause(): void {
    this.cancelCountIn();
    const currentTabMs = this.getCurrentTimeMs();
    const currentExtMs = this.getExternalAudioTimeMs();
    this.lastAnchorSongMs = currentTabMs;
    this.lastAnchorPerfMs = performance.now();
    this.lastExtAudioMs = currentExtMs;
    this.lastExtPerfMs = performance.now();
    this.isPlaying = false;

    if (this.api && !this.isFallbackClock) {
      try {
        this.api.pause();
      } catch {
        // ignore
      }
    }
    this.pauseExternalAudio();
    this.callbacks.onPlayStateChange?.(false);
  }

  public async playPause(skipCountIn = false): Promise<void> {
    if (this.isPlaying || this.countInActive) {
      this.pause();
    } else {
      await this.play(skipCountIn);
    }
  }

  public stop(): void {
    this.cancelCountIn();
    const resetMs =
      this.loopConfig.loopEnabled && this.loopConfig.loopEndMs > this.loopConfig.loopStartMs
        ? this.loopConfig.loopStartMs
        : 0;
    this.isPlaying = false;
    this.lastAnchorSongMs = resetMs;
    this.lastAnchorPerfMs = performance.now();
    this.lastPlayedBeatKey = '';

    const resetAudioMs = Math.max(0, tabToAudioMs(resetMs, this.syncConfig));
    this.lastExtAudioMs = resetAudioMs;
    this.lastExtPerfMs = performance.now();

    if (this.api && !this.isFallbackClock) {
      try {
        this.api.pause();
        this.api.timePosition = resetMs;
      } catch {
        // ignore
      }
    }
    this.pauseExternalAudio();
    if (this.externalAudio) {
      const targetSec = resetAudioMs / 1000;
      this.externalAudio.currentTime = targetSec;
      this.lastObservedAudioSec = targetSec;
    }
    this.callbacks.onPlayStateChange?.(false);
    this.callbacks.onTimeSeek?.(resetMs);
  }

  public seekMs(ms: number): void {
    const maxMs = this.songData?.durationMs ?? 0;
    const clamped = Math.max(0, maxMs > 0 ? Math.min(maxMs, ms) : ms);
    if (this.countInActive) {
      this.cancelCountIn();
    }

    this.lastAnchorSongMs = clamped;
    this.lastAnchorPerfMs = performance.now();
    this.lastPlayedBeatKey = '';

    if (this.isExternalMasterActive() && this.externalAudio) {
      const targetAudioMs = tabToAudioMs(clamped, this.syncConfig);
      this.lastExtAudioMs = targetAudioMs;
      this.lastExtPerfMs = performance.now();
      if (targetAudioMs < 0) {
        if (!this.externalAudio.paused) this.externalAudio.pause();
        this.externalAudio.currentTime = 0;
        this.lastObservedAudioSec = 0;
      } else {
        const targetSec = targetAudioMs / 1000;
        this.externalAudio.currentTime = targetSec;
        this.lastObservedAudioSec = targetSec;
        if (this.isPlaying && this.externalAudio.paused) {
          this.externalAudio.playbackRate = this.playbackSpeed;
          this.externalAudio.play().catch(() => {});
        }
      }
    } else if (this.api && this.playerReady && !this.isFallbackClock) {
      try {
        this.api.timePosition = clamped;
      } catch {
        // ignore
      }
    }

    this.callbacks.onTimeSeek?.(clamped);
  }

  /**
   * Called every animation frame from the main renderer loop to enforce A-B loop,
   * Speed Trainer step-ups, external master clock smoothing, and Web Audio metronome.
   */
  public tick(): number {
    const now = performance.now();

    if (this.countInActive) {
      const currentMs = this.getCurrentTimeMs();
      const elapsed = (now - this.countInStartPerfMs) * this.playbackSpeed;
      if (elapsed >= this.countInDurationMs) {
        const target = this.countInTargetMs;
        this.countInActive = false;
        this.callbacks.onCountInChange?.(null);
        this.beginActualPlayback(target);
      }
      return currentMs;
    }

    if (!this.isPlaying) {
      return this.getCurrentTimeMs();
    }

    // Update smooth external audio master clock if active
    if (this.isExternalMasterActive() && this.externalAudio) {
      this.updateExternalMasterClock(now);
    }

    const currentMs = this.getCurrentTimeMs();

    // Metronome click (active for external master clock, studio override, or muted/fallback synth)
    const effectiveMetronome = this.studioMetronomeOverride ?? this.metronomeEnabled;
    if (
      effectiveMetronome &&
      (this.isExternalMasterActive() || this.isFallbackClock || this.synthVolume <= 0.02)
    ) {
      this.checkAndPlayMetronomeBeat(currentMs);
    }

    // A-B Loop check
    if (
      this.loopConfig.loopEnabled &&
      this.loopConfig.loopEndMs > this.loopConfig.loopStartMs + 120 &&
      currentMs >= this.loopConfig.loopEndMs - 15 &&
      now - this.lastLoopWrapPerfMs > 150
    ) {
      this.lastLoopWrapPerfMs = now;
      this.loopRepetitionCount += 1;
      this.callbacks.onLoopRepetitionChange?.(this.loopRepetitionCount);

      if (
        this.loopConfig.speedTrainerEnabled &&
        this.loopRepetitionCount % Math.max(1, this.loopConfig.speedTrainerRepsPerStep) === 0
      ) {
        const nextSpeed = Math.min(
          this.loopConfig.speedTrainerTarget,
          Math.round((this.playbackSpeed + this.loopConfig.speedTrainerStep) * 100) / 100
        );
        if (nextSpeed > this.playbackSpeed) {
          this.setPlaybackSpeed(nextSpeed);
          this.callbacks.onSpeedAutoAdvance?.(nextSpeed, this.loopRepetitionCount);
        }
      }

      this.seekMs(this.loopConfig.loopStartMs);
      return this.loopConfig.loopStartMs;
    }

    // End of song check
    if (this.isExternalMasterActive() && this.externalAudio?.ended) {
      this.pause();
      return currentMs;
    }

    if (
      !this.isExternalMasterActive() &&
      this.songData &&
      this.songData.durationMs > 0 &&
      currentMs >= this.songData.durationMs
    ) {
      this.pause();
      this.seekMs(this.songData.durationMs);
      return this.songData.durationMs;
    }

    return currentMs;
  }

  private updateExternalMasterClock(now: number): void {
    const audio = this.externalAudio;
    if (!audio) return;

    const predicted = this.lastExtAudioMs + (now - this.lastExtPerfMs) * this.playbackSpeed;

    // Handle pre-roll if sync anchor places tab start slightly before 0s of audio
    if (predicted < 0) {
      if (!audio.paused) audio.pause();
      return;
    }

    if (audio.paused && !audio.ended) {
      audio.currentTime = Math.max(0, predicted / 1000);
      audio.playbackRate = this.playbackSpeed;
      audio.play().catch(() => {});
      this.lastExtAudioMs = Math.max(0, predicted);
      this.lastExtPerfMs = now;
      this.lastObservedAudioSec = audio.currentTime;
      return;
    }

    const rawSec = audio.currentTime;
    if (Math.abs(rawSec - this.lastObservedAudioSec) > 0.0005) {
      this.lastObservedAudioSec = rawSec;
      const rawMs = rawSec * 1000;
      const diff = rawMs - predicted;
      if (Math.abs(diff) > 45) {
        this.lastExtAudioMs = rawMs;
      } else {
        this.lastExtAudioMs = predicted + diff * 0.25;
      }
      this.lastExtPerfMs = now;
    }
  }

  private beginActualPlayback(startMs: number): void {
    const now = performance.now();
    this.lastAnchorSongMs = startMs;
    this.lastAnchorPerfMs = now;
    this.isPlaying = true;
    this.lastPlayedBeatKey = '';

    if (this.isExternalMasterActive() && this.externalAudio) {
      // Ensure alphaTab synth stays silent in external master mode
      if (this.api && !this.isFallbackClock) {
        try {
          this.api.pause();
        } catch {
          // ignore
        }
      }
      const targetAudioMs = tabToAudioMs(startMs, this.syncConfig);
      this.lastExtAudioMs = targetAudioMs;
      this.lastExtPerfMs = now;
      this.externalAudio.playbackRate = this.playbackSpeed;
      this.externalAudio.volume = this.externalAudioVolume;

      if (targetAudioMs >= 0) {
        const targetSec = targetAudioMs / 1000;
        this.externalAudio.currentTime = targetSec;
        this.lastObservedAudioSec = targetSec;
        this.externalAudio.play().catch(() => {});
      } else {
        this.externalAudio.currentTime = 0;
        this.lastObservedAudioSec = 0;
      }
      this.callbacks.onPlayStateChange?.(true);
      return;
    }

    const canUseAlphaTab = Boolean(this.api && this.playerReady && !this.isFallbackClock);
    if (canUseAlphaTab && this.api) {
      try {
        this.applyApiAudioSettings();
        this.api.timePosition = startMs;
        const started = this.api.play();
        if (!started) {
          this.isFallbackClock = true;
        }
      } catch {
        this.isFallbackClock = true;
      }
    } else {
      this.isFallbackClock = true;
    }

    this.callbacks.onPlayStateChange?.(true);
  }

  private startCountIn(targetMs: number): void {
    this.cancelCountIn();

    const measure =
      this.songData?.measures.find((m) => targetMs >= m.startTimeMs && targetMs < m.endTimeMs) ??
      this.songData?.measures[0];

    const tempo = measure?.tempo ?? 120;
    const beatsPerBar = measure?.timeSignatureNumerator ?? 4;
    const denom = measure?.timeSignatureDenominator ?? 4;
    const beatMs = (60000 / tempo) * (4 / denom);
    const totalBeats = beatsPerBar * this.countInBars;
    const totalDurationMs = beatMs * totalBeats;

    this.countInActive = true;
    this.countInTargetMs = targetMs;
    this.countInStartPerfMs = performance.now();
    this.countInDurationMs = totalDurationMs;
    this.callbacks.onPlayStateChange?.(true);

    let beatIdx = 0;
    const triggerBeat = () => {
      if (!this.countInActive) return;
      const bar = Math.floor(beatIdx / beatsPerBar) + 1;
      const beatInBar = (beatIdx % beatsPerBar) + 1;
      const isAccent = beatInBar === 1;

      this.playClickSound(isAccent, Math.max(0.45, this.metronomeVolume));
      this.callbacks.onCountInChange?.({
        active: true,
        beat: beatInBar,
        totalBeats: beatsPerBar,
        bar,
        totalBars: this.countInBars,
      });

      beatIdx++;
      if (beatIdx < totalBeats) {
        const delayRealMs = beatMs / this.playbackSpeed;
        this.countInTimerId = window.setTimeout(triggerBeat, delayRealMs);
      }
    };

    triggerBeat();
  }

  private cancelCountIn(): void {
    if (this.countInTimerId !== null) {
      clearTimeout(this.countInTimerId);
      this.countInTimerId = null;
    }
    if (this.countInActive) {
      this.countInActive = false;
      this.callbacks.onCountInChange?.(null);
    }
  }

  private pauseExternalAudio(): void {
    if (this.externalAudio && !this.externalAudio.paused) {
      this.externalAudio.pause();
    }
  }

  private applyApiAudioSettings(): void {
    if (!this.api) return;
    try {
      this.api.playbackSpeed = this.playbackSpeed;
      this.api.masterVolume = this.synthVolume;
      const effectiveMetronome = this.studioMetronomeOverride ?? this.metronomeEnabled;
      this.api.metronomeVolume =
        !this.isExternalMasterActive() && effectiveMetronome && this.synthVolume > 0.02
          ? this.metronomeVolume
          : 0;
      this.api.countInVolume = 0;
    } catch {
      // ignore if player not yet ready
    }
  }

  private applyAllTrackMixes(): void {
    for (const [trackIdx, mix] of this.trackMixes.entries()) {
      this.applyTrackMix(trackIdx, mix);
    }
  }

  private applyTrackMix(trackIndex: number, mix: TrackMixState): void {
    if (!this.api || !this.score) return;
    const track = this.score.tracks[trackIndex];
    if (!track) return;
    try {
      this.api.changeTrackVolume([track], mix.volume);
      this.api.changeTrackMute([track], mix.muted);
      this.api.changeTrackSolo([track], mix.solo);
    } catch {
      // ignore if player not yet ready
    }
  }

  private async ensureAudioContext(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => {});
    }
  }

  private checkAndPlayMetronomeBeat(songMs: number): void {
    if (!this.songData) return;
    for (let mIdx = 0; mIdx < this.songData.measures.length; mIdx++) {
      const m = this.songData.measures[mIdx];
      if (songMs < m.startTimeMs - 20 || songMs > m.endTimeMs + 20) continue;
      for (let bIdx = 0; bIdx < m.beats.length; bIdx++) {
        const bt = m.beats[bIdx];
        if (Math.abs(songMs - bt) < 32) {
          const key = `${mIdx}:${bIdx}`;
          if (this.lastPlayedBeatKey !== key) {
            this.lastPlayedBeatKey = key;
            this.playClickSound(bIdx === 0, this.metronomeVolume);
          }
          return;
        }
      }
    }
  }

  private playClickSound(isAccent: boolean, volume: number): void {
    if (!this.audioCtx || volume <= 0.01) return;
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isAccent ? 1280 : 880, now);
    gain.gain.setValueAtTime(volume * (isAccent ? 0.34 : 0.22), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }
}
