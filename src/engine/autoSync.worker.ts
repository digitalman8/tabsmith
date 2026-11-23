import {
  runAutoSync,
  type AutoSyncProgress,
  type AutoSyncResult,
  type AutoSyncTabPayload,
} from './autoSyncEngine';

export interface AutoSyncWorkerRequest {
  jobId: number;
  samples: Float32Array;
  sampleRate: number;
  payload: AutoSyncTabPayload;
}

export type AutoSyncWorkerResponse =
  | { type: 'progress'; jobId: number; progress: AutoSyncProgress }
  | { type: 'done'; jobId: number; result: AutoSyncResult }
  | { type: 'error'; jobId: number; message: string };

interface MinimalWorkerScope {
  onmessage: ((event: MessageEvent<AutoSyncWorkerRequest>) => void) | null;
  postMessage: (message: AutoSyncWorkerResponse) => void;
}

const ctx = self as unknown as MinimalWorkerScope;

ctx.onmessage = (event: MessageEvent<AutoSyncWorkerRequest>) => {
  const { jobId, samples, sampleRate, payload } = event.data;
  try {
    const result = runAutoSync(samples, sampleRate, payload, (progress) => {
      const msg: AutoSyncWorkerResponse = { type: 'progress', jobId, progress };
      ctx.postMessage(msg);
    });
    const doneMsg: AutoSyncWorkerResponse = { type: 'done', jobId, result };
    ctx.postMessage(doneMsg);
  } catch (err) {
    const errMsg: AutoSyncWorkerResponse = {
      type: 'error',
      jobId,
      message: err instanceof Error ? err.message : 'Falha ao executar sincronia automática.',
    };
    ctx.postMessage(errMsg);
  }
};
