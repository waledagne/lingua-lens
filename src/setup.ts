import { errorMessage, languageName, pairKey, pairLabel, request, sampleText, type LanguagePair, type Settings, type SourceContext } from './shared';
import { detectorAPI, translatorAPI, type DownloadMonitor, type LocalLanguageDetector } from './translator-api';
import { detectSource } from './source-detector';
import { LanguageControls } from './language-controls';

const prepare = document.getElementById('prepare') as HTMLButtonElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('setup-status')!;
const errorBox = document.getElementById('setup-error')!;
const detectedLabel = document.getElementById('detected-language')!;
const tabParameter = new URL(location.href).searchParams.get('tabId');
const contextTab = tabParameter && /^\d+$/u.test(tabParameter) ? Number(tabParameter) : null;
type Plan = { type: 'detector' | 'translation' | 'already-target'; key: string; actualPair?: LanguagePair };
let current: Settings | undefined;
let busy = false, dirty = false;
let checkSequence = 0, syncSequence = 0;
let detector: LocalLanguageDetector | undefined;
let plan: Plan | undefined;
const controls = new LanguageControls(() => {
  dirty = current ? controls.changed(current.pair) : true;
  document.getElementById('sample')!.hidden = true;
  updateForm();
  if (dirty) {
    checkSequence++; plan = undefined;
    prepare.disabled = true; errorBox.hidden = true; detectedLabel.hidden = true;
    status.textContent = 'Apply languages to check your selection.';
  } else void checkAvailability();
});
function showError(error: unknown): void { errorBox.textContent = errorMessage(error); errorBox.hidden = false; }
function updateForm(): void {
  controls.disable(busy || !current);
  let invalid: string | null = null;
  try { controls.read(); } catch (error) { invalid = errorMessage(error); }
  controls.apply.disabled = busy || !current || !dirty || !!invalid;
  document.getElementById('language-hint')!.textContent = invalid ?? (dirty ? 'Apply your selection to use it in all translated tabs.' :
    current?.pair.sourceLanguage === 'auto' ? 'Choose only your target language. The source is detected per page.' : 'Manual source selection applies to all translated tabs.');
}
async function pageContext(): Promise<SourceContext | null> {
  if (contextTab === null) return null;
  return request<SourceContext>({ target: 'background', type: 'source-context', tabId: contextTab });
}
async function checkAvailability(): Promise<void> {
  if (!current || busy || dirty) return;
  const sequence = ++checkSequence, selected = { ...current.pair };
  let detected: string | undefined;
  plan = undefined;
  prepare.disabled = true; errorBox.hidden = true; progress.hidden = true; detectedLabel.hidden = true;
  status.textContent = 'Checking ' + pairLabel(selected) + '…';
  try {
    let actualPair = selected;
    if (selected.sourceLanguage === 'auto') {
      const factory = detectorAPI(), availability = await factory.availability();
      if (sequence !== checkSequence) return;
      if (availability === 'unavailable') throw new Error('Chrome cannot provide automatic language detection on this device. Update Chrome or choose a source manually.');
      if (availability !== 'available' || !current.detectorReady) {
        plan = { type: 'detector', key: pairKey(selected) };
        prepare.textContent = 'Enable automatic detection'; prepare.disabled = false;
        status.textContent = 'First, prepare the local language detector. A detected source may need a separate language-pack download.';
        return;
      }
      const instance = detector ?? await factory.create();
      if (sequence !== checkSequence) { if (instance !== detector) instance.destroy(); return; }
      detector = instance;
      const context = await pageContext();
      if (sequence !== checkSequence) return;
      if (!context) {
        prepare.textContent = 'Automatic detection is ready';
        status.textContent = 'All set. Open a website and choose Translate this page. A new source language may need a one-time pack download.';
        return;
      }
      detected = await detectSource(instance, context);
      if (sequence !== checkSequence) return;
      detectedLabel.hidden = false;
      detectedLabel.textContent = 'Detected page language: ' + languageName(detected);
      if (detected === selected.targetLanguage) {
        plan = { type: 'already-target', key: pairKey(selected), actualPair: { sourceLanguage: detected, targetLanguage: selected.targetLanguage } };
        prepare.textContent = 'Enable on this page'; prepare.disabled = false;
        status.textContent = 'This page is already in ' + languageName(detected) + '. No translation pack is needed.';
        return;
      }
      actualPair = { sourceLanguage: detected, targetLanguage: selected.targetLanguage };
    }
    const availability = await translatorAPI().availability(actualPair);
    if (sequence !== checkSequence) return;
    if (availability === 'unavailable') throw new Error('Chrome cannot provide ' + pairLabel(actualPair) + ' on this device. Choose another target, or choose a source manually if detection is wrong.');
    plan = { type: 'translation', key: pairKey(selected), actualPair };
    prepare.disabled = false;
    prepare.textContent = availability === 'available' ? 'Enable & test translation' : 'Download & enable translation';
    status.textContent = availability === 'available' ? 'Language packs are available for ' + pairLabel(actualPair) + '. Run a quick translation to finish setup.' :
      'Prepare ' + pairLabel(actualPair) + '. Keep this tab open during the download.';
  } catch (error) {
    if (sequence !== checkSequence) return;
    status.textContent = 'Local translation is not ready.'; showError(error);
  }
}
async function synchronize(): Promise<void> {
  if (busy || dirty) return;
  const sequence = ++syncSequence;
  try {
    const config = await request<Settings>({ target: 'background', type: 'state' });
    if (sequence !== syncSequence || busy || dirty) return;
    const changed = !current || pairKey(config.pair) !== pairKey(current.pair);
    current = config; controls.set(config.pair); updateForm();
    if (changed) { document.getElementById('sample')!.hidden = true; await checkAvailability(); }
  } catch (error) { showError(error); }
}
controls.apply.addEventListener('click', async () => {
  if (!current || busy) return;
  busy = true; checkSequence++; prepare.disabled = true; errorBox.hidden = true; updateForm();
  try {
    current = await request<Settings>({ target: 'background', type: 'languages', pair: controls.read() });
    dirty = false; controls.set(current.pair);
  } catch (error) { showError(error); }
  finally { busy = false; updateForm(); if (!dirty) await checkAvailability(); }
});
function monitorDownload(monitor: DownloadMonitor): void {
  monitor.addEventListener('downloadprogress', event => {
    progress.value = event.loaded;
    status.textContent = 'Downloading local model… ' + String(Math.round(event.loaded * 100)) + '%';
  });
}
prepare.addEventListener('click', async () => {
  if (!current || busy || dirty || !plan || plan.key !== pairKey(current.pair)) return;
  const selected = { ...current.pair }, action = plan;
  busy = true; checkSequence++; updateForm();
  prepare.disabled = true; errorBox.hidden = true; progress.value = 0; progress.hidden = false;
  status.textContent = 'Preparing ' + pairLabel(selected) + '… Keep this tab open.';
  let detectorStage = false;
  try {
    if (action.type === 'detector') {
      // First-download activation is preserved by creating directly in this click.
      detector?.destroy();
      detector = undefined;
      detector = await detectorAPI().create({ monitor: monitorDownload });
      current = await request<Settings>({ target: 'background', type: 'ready', pair: selected });
      detectorStage = true;
    } else if (action.type === 'translation') {
      const actualPair = action.actualPair!;
      const instance = await translatorAPI().create({ ...actualPair, monitor: monitorDownload });
      try {
        const source = sampleText(actualPair.sourceLanguage), sample = await instance.translate(source);
        if (!sample.trim()) throw new Error('Chrome returned an empty translation. Please try again.');
        current = await request<Settings>({ target: 'background', type: 'ready', pair: selected, detectedSource: selected.sourceLanguage === 'auto' ? actualPair.sourceLanguage : undefined });
        document.getElementById('sample-source')!.textContent = source;
        document.getElementById('sample-result')!.textContent = sample;
        document.getElementById('sample')!.hidden = false;
      } finally { instance.destroy(); }
    } else current = await request<Settings>({ target: 'background', type: 'ready', pair: selected, detectedSource: action.actualPair?.sourceLanguage });
    if (!detectorStage) {
      progress.value = 1; prepare.textContent = 'Translation is ready';
      status.textContent = 'All set. Return to your website and choose Translate this page or Retry translation from the toolbar.';
    }
  } catch (error) {
    prepare.disabled = false; prepare.textContent = 'Try setup again';
    progress.hidden = true; status.textContent = 'Setup did not finish.'; showError(error);
  } finally {
    busy = false; updateForm();
    if (detectorStage) await checkAvailability();
    void synchronize();
  }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.pair) void synchronize(); });
window.addEventListener('pagehide', () => detector?.destroy());
void synchronize();
