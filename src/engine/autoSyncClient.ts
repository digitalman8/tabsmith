import {
  buildTabPayload,
  runAutoSync,
  type AutoSyncProgress,
  type AutoSyncResult,
} from './autoSyncEngine';
import type { AutoSyncWorkerRequest, AutoSyncWorkerResponse } from './autoSync.worker';
import type { SongData } from '../types/music';

export class AutoSyncRunner {
  private worker: Worker | null = null;
  private activeJobId = 0;

  public cancel(): void {
    this.activeJobId++;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public run(
    samples: Float32Array,
    sampleRate: number,
    song: SongData,
    onProgress?: (progress: AutoSyncProgress) => void
  ): Promise<AutoSyncResult> {
    this.cancel();
    const jobId = ++this.activeJobId;
    const payload = buildTabPayload(song);

    if (typeof Worker === 'undefined') {
      return Promise.resolve(runAutoSync(samples, sampleRate, payload, onProgress));
    }

    return new Promise<AutoSyncResult>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('./autoSync.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;

        worker.onmessage = (event: MessageEvent<AutoSyncWorkerResponse>) => {
          const data = event.data;
          if (data.jobId !== this.activeJobId) return;

          if (data.type === 'progress') {
            onProgress?.(data.progress);
          } else if (data.type === 'done') {
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            resolve(data.result);
          } else if (data.type === 'error') {
            worker.terminate();
            if (this.worker === worker) this.worker = null;
            reject(new Error(data.message));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          // Graceful main-thread fallback if Worker failed to initialize
          try {
            const fallback = runAutoSync(samples, sampleRate, payload, onProgress);
            resolve(fallback);
          } catch (fallbackErr) {
            reject(
              fallbackErr instanceof Error
                ? fallbackErr
                : new Error(err.message || 'Erro no Worker de sincronia.')
            );
          }
        };

        // Transfer a cloned buffer so WaveformData.analysisMono remains usable on main thread
        const clonedSamples = samples.slice();
        const req: AutoSyncWorkerRequest = {
          jobId,
          samples: clonedSamples,
          sampleRate,
          payload,
        };
        worker.postMessage(req, [clonedSamples.buffer]);
      } catch {
        // Fallback if Worker URL cannot be instantiated
        try {
          resolve(runAutoSync(samples, sampleRate, payload, onProgress));
        } catch (err) {
          reject(err);
        }
      }
    });
  }
}
