import { MAX_BATCH } from './shared';

/** Keep time-to-paint short with slow models, and fill batches when cached/fast. */
export class BatchPacer {
  limit = 4;
  reset(): void { this.limit = 4; }
  complete(items: number, elapsedMs: number): void {
    if (items < 1 || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    this.limit = Math.max(1, Math.min(MAX_BATCH, Math.floor(items * 200 / Math.max(1, elapsedMs))));
  }
}
