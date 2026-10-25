import { errorMessage, MAX_BATCH, MAX_TEXT, PAIR, withPadding } from './shared';
import { translatorAPI, type LocalTranslator } from './translator-api';

const segmenter = new Worker('segment-worker.js');
let sequence = 0;
const waiting = new Map<number, { resolve: (parts: string[][]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
segmenter.onmessage = (event: MessageEvent<{ id: number; parts: string[][] }>) => {
  const task = waiting.get(event.data.id);
  if (task) { clearTimeout(task.timer); waiting.delete(event.data.id); task.resolve(event.data.parts); }
};
segmenter.onerror = () => {
  for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error('Text preparation failed. Reload the extension.')); }
  waiting.clear();
};
function split(texts: string[]): Promise<string[][]> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Text preparation timed out. Reload the extension.')); }, 15000);
    waiting.set(id, { resolve, reject, timer });
    segmenter.postMessage({ id, texts });
  });
}
let translator: Promise<LocalTranslator> | undefined;
async function getTranslator(): Promise<LocalTranslator> {
  if (!translator) {
    translator = (async () => {
      const api = translatorAPI();
      const available = await api.availability(PAIR);
      if (available !== 'available') throw new Error('Open Lingua Lens setup to download or activate Polish → English first.');
      return api.create(PAIR);
    })().catch(error => { translator = undefined; throw error; });
  }
  return translator;
}
const cache = new Map<string, string>();
async function translate(texts: string[]): Promise<string[]> {
  const missing = [...new Set(texts)].filter(text => !cache.has(text));
  if (missing.length) {
    const instance = await getTranslator();
    const groups = await split(missing);
    for (let i = 0; i < missing.length; i++) {
      const output: string[] = [];
      for (const part of groups[i]) {
        output.push(part.trim() ? withPadding(part, await instance.translate(part.trim())) : part);
      }
      const translated = output.join('');
      if (!translated.trim()) throw new Error('The translation engine returned empty text. Try again.');
      cache.set(missing[i], translated);
    }
  }
  const result = texts.map(text => cache.get(text)!);
  while (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return result;
}
// One engine queue for all tabs; deduplication prevents translating repeated menu labels.
let queue: Promise<unknown> = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'engine') return;
  if (message.type !== 'translate' || !Array.isArray(message.texts) || message.texts.length > MAX_BATCH ||
      !message.texts.every((text: unknown) => typeof text === 'string' && text.length <= MAX_TEXT)) {
    respond({ ok: false, error: 'Invalid translation request.' }); return;
  }
  const task = queue.then(() => translate(message.texts));
  queue = task.catch(() => {});
  void task.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: errorMessage(error) }));
  return true;
});
