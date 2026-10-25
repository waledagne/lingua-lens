import { errorMessage, MAX_BATCH, MAX_TEXT, parsePair } from './shared';
import { detectorAPI, translatorAPI } from './translator-api';
import { TranslationEngine } from './translation-engine';
import { SourceDetector, validateContext } from './source-detector';

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
function split(texts: string[], sourceLanguage: string): Promise<string[][]> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Text preparation timed out. Reload the extension.')); }, 15000);
    waiting.set(id, { resolve, reject, timer });
    segmenter.postMessage({ id, texts, sourceLanguage });
  });
}
const engine = new TranslationEngine(translatorAPI, split);
const detector = new SourceDetector(detectorAPI);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'engine') return;
  if (message.type === 'detect') {
    try {
      void detector.detect(validateContext(message.context)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: errorMessage(error) }));
    } catch (error) { respond({ ok: false, error: errorMessage(error) }); return; }
    return true;
  }
  if (message.type !== 'translate' || !Array.isArray(message.texts) || message.texts.length > MAX_BATCH ||
      !message.texts.every((text: unknown) => typeof text === 'string' && text.length <= MAX_TEXT)) {
    respond({ ok: false, error: 'Invalid translation request.' }); return;
  }
  try {
    const pair = parsePair(message.pair);
    if (pair.sourceLanguage === 'auto') throw new Error('A detected source language is required by the translator.');
    void engine.translate(message.texts, pair).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: errorMessage(error) }));
  } catch (error) { respond({ ok: false, error: errorMessage(error) }); return; }
  return true;
});
