import { errorMessage, pairKey, pairLabel, request, sampleText, type Settings } from './shared';
import { translatorAPI } from './translator-api';
import { LanguageControls } from './language-controls';

const prepare = document.getElementById('prepare') as HTMLButtonElement;
const progress = document.getElementById('progress') as HTMLProgressElement;
const status = document.getElementById('setup-status')!;
const errorBox = document.getElementById('setup-error')!;
let current: Settings | undefined;
let busy = false;
let dirty = false;
let checkSequence = 0;
let syncSequence = 0;
const controls = new LanguageControls(() => {
  dirty = current ? controls.changed(current.pair) : true;
  document.getElementById('sample')!.hidden = true;
  updateForm();
  if (dirty) {
    checkSequence++;
    prepare.disabled = true; errorBox.hidden = true;
    status.textContent = 'Apply languages to check this pair.';
  } else void checkAvailability();
});
function showError(error: unknown): void { errorBox.textContent = errorMessage(error); errorBox.hidden = false; }
function updateForm(): void {
  controls.disable(busy || !current);
  let invalid: string | null = null;
  try { controls.read(); } catch (error) { invalid = errorMessage(error); }
  controls.apply.disabled = busy || !current || !dirty || !!invalid;
  document.getElementById('language-hint')!.textContent = invalid ?? (dirty ? 'Apply your selection to use it in all translated tabs.' : 'Languages apply to all translated tabs.');
}
async function checkAvailability(): Promise<void> {
  if (!current || busy || dirty) return;
  const sequence = ++checkSequence;
  const pair = { ...current.pair };
  prepare.disabled = true; errorBox.hidden = true; progress.hidden = true;
  status.textContent = 'Checking ' + pairLabel(pair) + '…';
  try {
    const availability = await translatorAPI().availability(pair);
    if (sequence !== checkSequence) return;
    if (availability === 'unavailable') throw new Error('Chrome cannot provide ' + pairLabel(pair) + ' on this device. Choose another pair, or update Chrome and check available disk space.');
    prepare.disabled = false;
    prepare.textContent = availability === 'available' ? 'Enable & test translation' : 'Download & enable translation';
    status.textContent = availability === 'available' ? 'Language packs are available for ' + pairLabel(pair) + '. Run a quick translation to finish setup.' : 'Chrome supports this pair. Keep this tab open during the download.';
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
prepare.addEventListener('click', async () => {
  if (!current || busy || dirty) return;
  const pair = controls.read();
  busy = true; checkSequence++; updateForm();
  prepare.disabled = true; errorBox.hidden = true; progress.value = 0; progress.hidden = false;
  status.textContent = 'Preparing ' + pairLabel(pair) + '… Keep this tab open.';
  try {
    // Call create() directly from the click to authorize this pair's first download.
    const instance = await translatorAPI().create({ ...pair, monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => {
        progress.value = event.loaded;
        status.textContent = 'Downloading language packs… ' + String(Math.round(event.loaded * 100)) + '%';
      });
    } });
    try {
      const source = sampleText(pair.sourceLanguage);
      const sample = await instance.translate(source);
      if (!sample.trim()) throw new Error('Chrome returned an empty translation. Please try again.');
      current = await request<Settings>({ target: 'background', type: 'ready', pair });
      document.getElementById('sample-source')!.textContent = source;
      document.getElementById('sample-result')!.textContent = sample;
      document.getElementById('sample')!.hidden = false;
    } finally { instance.destroy(); }
    progress.value = 1; prepare.textContent = 'Translation is ready';
    status.textContent = 'All set for ' + pairLabel(pair) + '. Open a website and choose Translate this page from the toolbar.';
  } catch (error) {
    prepare.disabled = false; prepare.textContent = 'Try setup again';
    progress.hidden = true; status.textContent = 'Setup did not finish.'; showError(error);
  } finally { busy = false; updateForm(); void synchronize(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pair) void synchronize();
});
void synchronize();
