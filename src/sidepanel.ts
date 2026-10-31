import { MAX_TEXT, errorMessage, languageName, pairLabel, parsePair, request, withPadding, type LanguagePair, type PanelSelection, type Settings } from './shared';
import { fillLanguages } from './language-controls';
import { detectSource } from './source-detector';
import { chunks } from './segment';
import { detectorAPI, translatorAPI, type DownloadMonitor, type LocalLanguageDetector, type LocalTranslator } from './translator-api';
import { MODEL_CHECK_MS, MODEL_DOWNLOAD_IDLE_MS, MODEL_DOWNLOAD_MAX_MS, modelTask } from './model-task';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = get<HTMLTextAreaElement>('input-text');
const source = get<HTMLSelectElement>('source-language'), target = get<HTMLSelectElement>('target-language');
const translate = get<HTMLButtonElement>('translate');
type Plan = { kind: 'detector' } | { kind: 'translator'; pair: LanguagePair };
let plan: Plan | null = null;
let controller: AbortController | undefined;
let generation = 0, windowId: number | undefined;
let hint = '', detected = '', resultText = '';
let incoming: PanelSelection | null = null;
let ready = false;
fillLanguages(source, true); fillLanguages(target);
function pair(): LanguagePair { return parsePair({ sourceLanguage: source.value, targetLanguage: target.value }); }
function status(text: string): void { get('status').textContent = text; }
function error(text = ''): void { get('error').textContent = text; get('error').hidden = !text; }
function render(): void {
  let valid = true;
  try { pair(); } catch { valid = false; }
  translate.disabled = !ready || !!controller || !input.value.trim() || input.value.length > MAX_TEXT || !valid;
  translate.textContent = plan?.kind === 'detector' ? 'Enable automatic detection' : plan?.kind === 'translator' ? 'Download & translate' : 'Translate';
  get('cancel').hidden = !controller;
  get('count').textContent = input.value.length.toLocaleString('en') + ' / 12,000 characters';
  get<HTMLButtonElement>('swap-languages').disabled = !ready || (source.value === 'auto' && (!detected || detected === target.value));
  get<HTMLButtonElement>('clear').disabled = !ready || (!input.value && !resultText && !controller);
}
function invalidate(): void {
  generation++; controller?.abort(); controller = undefined; plan = null; detected = ''; resultText = '';
  get('result').textContent = ''; get('result-section').hidden = true; error(); render();
}
function changed(): void {
  invalidate();
  if (input.value.length > MAX_TEXT) error('Use up to 12,000 characters. Your text has been kept so you can shorten it.');
  status('Ready to translate.');
}
function loadSelection(value: PanelSelection): void {
  invalidate(); input.value = value.text ?? ''; hint = value.pageLanguage ?? '';
  status('Selection from ' + (value.site ?? 'your website') + '. Review it, then translate.'); render();
}
function receive(value: PanelSelection | null): void {
  if (!value) return;
  if (value.error) { error(value.error); return; }
  if (!value.text) return;
  if (!input.value.trim() && !controller) { loadSelection(value); return; }
  incoming = value; get('incoming').hidden = false;
  get('incoming-title').textContent = 'New selection from ' + (value.site ?? 'your website');
  get('incoming-preview').textContent = value.text.slice(0, 240);
}
async function inbox(): Promise<void> {
  if (windowId === undefined) return;
  try { receive(await request<PanelSelection | null>({ target: 'background', type: 'panel-inbox', windowId })); }
  catch (cause) { error(errorMessage(cause)); }
}
chrome.runtime.onMessage.addListener(message => {
  if (message.target === 'panel' && message.type === 'selection-ready' && message.windowId === windowId) void inbox();
});
input.addEventListener('input', () => { hint = ''; changed(); });
function saveLanguages(): void {
  changed();
  try { void request({ target: 'background', type: 'panel-languages', pair: pair() }).catch(cause => error(errorMessage(cause))); }
  catch (cause) { error(errorMessage(cause)); }
}
source.addEventListener('change', saveLanguages); target.addEventListener('change', saveLanguages);
get('swap-languages').addEventListener('click', () => {
  const previous = source.value === 'auto' ? detected : source.value;
  if (!previous) return;
  const text = resultText;
  source.value = target.value; target.value = previous;
  if (text) { input.value = text; hint = ''; }
  saveLanguages();
});
get('clear').addEventListener('click', () => { input.value = ''; hint = ''; changed(); input.focus(); });
get('cancel').addEventListener('click', () => { invalidate(); status('Translation canceled. Your original text is kept.'); });
get('use-incoming').addEventListener('click', () => { if (incoming) loadSelection(incoming); incoming = null; get('incoming').hidden = true; });
get('dismiss-incoming').addEventListener('click', () => { incoming = null; get('incoming').hidden = true; });
get('capture').addEventListener('click', () => {
  if (windowId === undefined) return;
  void request<PanelSelection>({ target: 'background', type: 'panel-capture', windowId }).then(receive).catch(cause => error(errorMessage(cause)));
});
get('copy').addEventListener('click', () => {
  if (!resultText) return;
  void navigator.clipboard.writeText(resultText).then(() => status('Translation copied.')).catch(() => error('Chrome could not copy the translation. Select the result and copy it manually.'));
});
get('settings').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });

translate.addEventListener('click', () => {
  if (translate.disabled) return;
  const selected = pair(), text = input.value, languageHint = hint, action = plan;
  const run = ++generation, abort = new AbortController(); controller = abort;
  error(); status('Preparing translation…'); render();
  const check = () => { if (generation !== run || abort.signal.aborted) throw new DOMException('Canceled', 'AbortError'); };
  const monitor = (progress: DownloadMonitor, touch: (loaded: number) => void) => progress.addEventListener('downloadprogress', event => {
    touch(event.loaded);
    if (generation === run) status(event.loaded >= 1 ? 'Download complete. Chrome is preparing the local model…' : 'Downloading local language model… ' + Math.round(Math.max(0, Math.min(1, event.loaded)) * 100) + '%');
  });
  void (async () => {
    let detector: LocalLanguageDetector | undefined, translator: LocalTranslator | undefined;
    const download = { signal: abort.signal, timeoutMs: MODEL_DOWNLOAD_IDLE_MS, maxMs: MODEL_DOWNLOAD_MAX_MS,
      onWait: () => { if (generation === run) status('Still waiting for Chrome’s local model. The first download needs internet. You can cancel and retry.'); } };
    try {
      // A staged download starts here, in the click gesture, before any await.
      if (action?.kind === 'detector') detector = await modelTask((signal, touch) => detectorAPI().create({ signal, monitor: progress => monitor(progress, touch) }), { ...download, dispose: value => value.destroy() });
      else if (action?.kind === 'translator') translator = await modelTask((signal, touch) => translatorAPI().create({ ...action.pair, signal, monitor: progress => monitor(progress, touch) }), { ...download, dispose: value => value.destroy() });
      check();
      let actual = action?.kind === 'translator' ? action.pair.sourceLanguage : selected.sourceLanguage;
      if (actual === 'auto') {
        const api = detectorAPI();
        if (!detector) {
          const available = await modelTask(() => api.availability(), { signal: abort.signal, timeoutMs: MODEL_CHECK_MS }); check();
          if (available === 'unavailable') throw new Error('Automatic detection is unavailable. Choose a source language manually.');
          if (available !== 'available') { plan = { kind: 'detector' }; status('Enable automatic detection to download its local model.'); return; }
          detector = await modelTask(signal => api.create({ signal }), { signal: abort.signal, dispose: value => value.destroy() }); check();
        }
        const activeDetector = detector;
        actual = await modelTask(() => detectSource(activeDetector, { sample: text.slice(0, 6000), pageLanguage: languageHint }), { signal: abort.signal }); check();
        void request({ target: 'background', type: 'panel-models-ready', detector: true }).catch(() => {});
      }
      detected = actual;
      input.lang = actual;
      const concrete = { sourceLanguage: actual, targetLanguage: selected.targetLanguage };
      if (actual === selected.targetLanguage) { resultText = text; status('Already in ' + languageName(actual) + '. Original text kept.'); }
      else {
        if (!translator) {
          const api = translatorAPI(), available = await modelTask(() => api.availability(concrete), { signal: abort.signal, timeoutMs: MODEL_CHECK_MS }); check();
          if (available === 'unavailable') throw new Error('Chrome does not support ' + pairLabel(concrete) + ' on this device. Choose another language pair.');
          if (available !== 'available') { plan = { kind: 'translator', pair: concrete }; status('Download ' + pairLabel(concrete) + ' to translate locally.'); return; }
          translator = await modelTask(signal => api.create({ ...concrete, signal }), { signal: abort.signal, dispose: value => value.destroy() }); check();
        }
        const pieces = chunks(text, 1800, actual), output: string[] = [];
        for (const [index, piece] of pieces.entries()) {
          check(); status('Translating… ' + (index + 1) + ' / ' + pieces.length);
          if (!piece.trim()) { output.push(piece); continue; }
          const instance = translator;
          const translated = await modelTask(() => instance.translate(piece.trim()), { signal: abort.signal }); check();
          if (!translated?.trim()) throw new Error('Chrome returned an empty translation. Try again.');
          output.push(withPadding(piece, translated));
        }
        resultText = output.join(''); status('Translation ready.');
        void request({ target: 'background', type: 'panel-models-ready', pair: concrete }).catch(() => {});
      }
      check(); plan = null;
      get('result').textContent = resultText; get('result').lang = selected.targetLanguage;
      get('result-label').textContent = pairLabel(concrete); get('result-section').hidden = false;
    } catch (cause) {
      if (generation === run) { plan = null; error(errorMessage(cause).replace(/page language/gu, 'source language').replace('Wait for the page to load and retry', 'Paste a longer passage')); status('Translation needs attention.'); }
    } finally {
      detector?.destroy(); translator?.destroy();
      if (generation === run) { controller = undefined; render(); }
    }
  })();
});
void (async () => {
  try {
    const [settings, window] = await Promise.all([request<Settings>({ target: 'background', type: 'state' }), chrome.windows.getCurrent()]);
    windowId = window.id;
    const initial = settings.panelPair ?? { sourceLanguage: 'auto', targetLanguage: settings.pair.targetLanguage };
    source.value = initial.sourceLanguage; target.value = initial.targetLanguage;
    ready = true; source.disabled = false; target.disabled = false; input.disabled = false;
    get<HTMLButtonElement>('capture').disabled = windowId === undefined;
    status('Paste text or send a selection from a website.'); render(); await inbox();
  } catch (cause) { error(errorMessage(cause)); status('Reload the extension and reopen this panel.'); }
})();
window.addEventListener('pagehide', () => { generation++; controller?.abort(); });
