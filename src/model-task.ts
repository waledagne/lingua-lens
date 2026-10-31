export const MODEL_CALL_MS = 45000;
export const MODEL_CHECK_MS = 15000;
export const MODEL_DOWNLOAD_IDLE_MS = 120000;
export const MODEL_DOWNLOAD_MAX_MS = 600000;
export class ModelTimeoutError extends Error {
  constructor() { super('Chrome’s local model stopped responding. Check your connection for downloads, keep this tab open, then retry. If it continues, restart Chrome and check Languages & setup.'); this.name = 'ModelTimeoutError'; }
}
interface TaskOptions<T> {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxMs?: number;
  waitMs?: number;
  onWait?: () => void;
  dispose?: (lateResult: T) => void;
}
/** Invokes start synchronously to preserve the user's first-download gesture.
 * Cancellation also settles when Chrome ignores AbortSignal; late resources are disposed. */
export function modelTask<T>(start: (signal: AbortSignal, progress: (loaded: number) => void) => Promise<T>, options: TaskOptions<T> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false, lastProgress = -1;
    let idle: ReturnType<typeof setTimeout>, total: ReturnType<typeof setTimeout> | undefined, waiting: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(idle); clearTimeout(total); clearTimeout(waiting); options.signal?.removeEventListener('abort', cancel); };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true; cleanup(); controller.abort(cause); reject(cause);
    };
    const cancel = () => fail(new DOMException('Operation canceled.', 'AbortError'));
    const refresh = () => {
      clearTimeout(idle); clearTimeout(waiting);
      idle = setTimeout(() => fail(new ModelTimeoutError()), options.timeoutMs ?? MODEL_CALL_MS);
      if (options.onWait) waiting = setTimeout(() => { if (!settled) options.onWait!(); }, options.waitMs ?? 20000);
    };
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener('abort', cancel, { once: true });
    refresh();
    if (options.maxMs) total = setTimeout(() => fail(new ModelTimeoutError()), options.maxMs);
    try {
      start(controller.signal, loaded => {
        if (!settled && Number.isFinite(loaded) && loaded > lastProgress) { lastProgress = loaded; refresh(); }
      }).then(value => {
        if (settled) { options.dispose?.(value); return; }
        settled = true; cleanup(); resolve(value);
      }, fail).catch(() => { /* Late resource disposal must not create an unhandled rejection. */ });
    } catch (cause) { fail(cause); }
  });
}
