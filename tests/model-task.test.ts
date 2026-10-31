import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelTask, ModelTimeoutError } from '../src/model-task.ts';

test('model creation starts synchronously and cancellation settles even when Chrome ignores abort', async () => {
  let started = false, destroyed = 0, finish!: (value: { destroy(): void }) => void;
  const abort = new AbortController();
  const task = modelTask<{ destroy(): void }>(() => { started = true; return new Promise(resolve => { finish = resolve; }); }, { signal: abort.signal, dispose: value => value.destroy() });
  assert.equal(started, true); abort.abort();
  await assert.rejects(task, { name: 'AbortError' });
  finish({ destroy() { destroyed++; } }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(destroyed, 1);
});
test('stalled models time out, abort native work, and dispose late creations', async () => {
  let signal!: AbortSignal, finish!: (value: { destroy(): void }) => void, destroyed = 0;
  const task = modelTask<{ destroy(): void }>(inner => { signal = inner; return new Promise(resolve => { finish = resolve; }); }, { timeoutMs: 15, dispose: value => value.destroy() });
  await assert.rejects(task, ModelTimeoutError); assert.equal(signal.aborted, true);
  finish({ destroy() { destroyed++; } }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(destroyed, 1);
});
test('advancing progress extends the idle deadline but repeated progress cannot keep a stalled model alive', async () => {
  let touch!: (value: number) => void;
  const task = modelTask((_signal, progress) => { touch = progress; return new Promise(() => {}); }, { timeoutMs: 45 });
  touch(0); const repeat = setInterval(() => touch(0), 5);
  try { await assert.rejects(task, ModelTimeoutError); } finally { clearInterval(repeat); }
  let complete!: (value: string) => void;
  const moving = modelTask((_signal, progress) => { touch = progress; return new Promise(resolve => { complete = resolve; }); }, { timeoutMs: 100 });
  touch(0.5); complete('ready'); assert.equal(await moving, 'ready');
});
test('absolute deadline bounds a model even with continuing progress; wait notices do not fail it', async () => {
  let touch!: (value: number) => void, notices = 0, progress = 0;
  const task = modelTask((_signal, update) => { touch = update; return new Promise(() => {}); }, { timeoutMs: 200, maxMs: 45, waitMs: 1, onWait: () => { notices++; } });
  const timer = setInterval(() => touch(++progress), 10);
  try { await assert.rejects(task, ModelTimeoutError); assert.ok(notices > 0); } finally { clearInterval(timer); }
});
test('pre-canceled tasks never start; synchronous and native errors retain their cause', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(modelTask(() => { throw new Error('must not start'); }, { signal: abort.signal }), { name: 'AbortError' });
  await assert.rejects(modelTask(() => { throw new Error('native failure'); }), /native failure/);
});
