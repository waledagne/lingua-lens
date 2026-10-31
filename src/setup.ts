import { errorMessage, LANGUAGES, languageName, pairKey, pairLabel, request, sampleText, type LanguagePair, type Settings, type SourceContext, type TabState } from './shared';
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
const finish = document.getElementById('finish-setup') as HTMLButtonElement;
const retry = document.getElementById('check-again') as HTMLButtonElement;
const cancel = document.getElementById('cancel-setup') as HTMLButtonElement;
let setupAbort: AbortController | undefined;
const understood = document.getElementById('understood-languages') as HTMLSelectElement;
let understoodDirty = false;
let siteSetup = false;
function setupTab(): number | undefined { return siteSetup ? contextTab ?? undefined : undefined; }
for (const [code, name] of LANGUAGES) { const option = document.createElement('option'); option.value = code; option.textContent = name; understood.append(option); }
function stage(step: 'languages' | 'models' | 'test' | 'done'): void {
  for (const name of ['languages', 'models', 'test']) {
    const element = document.getElementById('step-' + name)!;
    if (name === step) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
    element.classList.toggle('complete', step === 'done');
  }
}
const issue = new URL(location.href).searchParams.get('issue');
if (issue) { document.getElementById('launch-issue')!.textContent = issue; document.getElementById('launch-issue')!.hidden = false; }
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
    stage('languages'); finish.hidden = true;
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
  document.getElementById('language-hint')!.textContent = invalid ?? (dirty ? (siteSetup ? 'Apply your selection for this website.' : 'Apply your selection as the default for websites.') :
    current?.pair.sourceLanguage === 'auto' ? 'Choose only your target language. The source is detected per page.' : siteSetup ? 'Manual source selection applies to this website.' : 'Manual source selection applies to websites using your defaults.');
  retry.disabled = busy || dirty;
  finish.disabled = busy || dirty;
  cancel.hidden = !busy || !setupAbort;
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
  finish.hidden = true; stage('models');
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
      // A real sample translation makes first-run setup testable without a website.
      const demoSource = selected.targetLanguage === 'es' ? 'fr' : 'es';
      detected = context ? await detectSource(instance, context) : demoSource;
      if (sequence !== checkSequence) return;
      detectedLabel.hidden = false;
      detectedLabel.textContent = (context ? 'Detected page language: ' : 'Practice sample: ') + languageName(detected);
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
    stage(availability === 'available' ? 'test' : 'models');
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
    const config = await request<Settings | TabState>({ target: 'background', type: 'state', tabId: contextTab ?? undefined });
    if (sequence !== syncSequence || busy || dirty) return;
    const changed = !current || pairKey(config.pair) !== pairKey(current.pair);
    siteSetup = 'sitePreference' in config && !!config.sitePreference?.pair;
    document.getElementById('setup-scope')!.textContent = siteSetup && 'site' in config ? 'Setting up languages for ' + config.site + '. Other websites keep their own preferences.' : 'Your default languages. Websites can have their own preferences in the toolbar.';
    current = config; controls.set(config.pair); updateForm();
    if (!understoodDirty) for (const option of understood.options) option.selected = config.understoodLanguages?.includes(option.value) ?? false;
    if (changed) { document.getElementById('sample')!.hidden = true; await checkAvailability(); }
  } catch (error) { showError(error); }
}
controls.apply.addEventListener('click', async () => {
  if (!current || busy) return;
  busy = true; checkSequence++; prepare.disabled = true; errorBox.hidden = true; updateForm();
  try {
    current = await request<Settings>({ target: 'background', type: 'languages', pair: controls.read(), tabId: setupTab() });
    dirty = false; controls.set(current.pair);
  } catch (error) { showError(error); }
  finally { busy = false; updateForm(); if (!dirty) await checkAvailability(); }
});
function monitorDownload(monitor: DownloadMonitor, signal: AbortSignal): void {
  monitor.addEventListener('downloadprogress', event => {
    if (signal.aborted || !busy) return;
    progress.value = event.loaded;
    status.textContent = 'Downloading local model… ' + String(Math.round(event.loaded * 100)) + '%';
  });
}
prepare.addEventListener('click', async () => {
  if (!current || busy || dirty || !plan || plan.key !== pairKey(current.pair)) return;
  const selected = { ...current.pair }, action = plan;
  setupAbort = new AbortController();
  const signal = setupAbort.signal;
  busy = true; checkSequence++; updateForm();
  prepare.disabled = true; errorBox.hidden = true; progress.value = 0; progress.hidden = false;
  status.textContent = 'Preparing ' + pairLabel(selected) + '… Keep this tab open.';
  let detectorStage = false;
  try {
    if (action.type === 'detector') {
      // First-download activation is preserved by creating directly in this click.
      detector?.destroy();
      detector = undefined;
      detector = await detectorAPI().create({ signal, monitor: monitor => monitorDownload(monitor, signal) });
      signal.throwIfAborted();
      current = await request<Settings>({ target: 'background', type: 'ready', pair: selected, tabId: setupTab() });
      detectorStage = true;
    } else if (action.type === 'translation') {
      const actualPair = action.actualPair!;
      const instance = await translatorAPI().create({ ...actualPair, signal, monitor: monitor => monitorDownload(monitor, signal) });
      try {
        const source = sampleText(actualPair.sourceLanguage), sample = await instance.translate(source);
        signal.throwIfAborted();
        if (!sample.trim()) throw new Error('Chrome returned an empty translation. Please try again.');
        current = await request<Settings>({ target: 'background', type: 'ready', pair: selected, detectedSource: selected.sourceLanguage === 'auto' ? actualPair.sourceLanguage : undefined, tabId: setupTab() });
        document.getElementById('sample-source')!.textContent = source;
        document.getElementById('sample-result')!.textContent = sample;
        document.getElementById('sample')!.hidden = false;
      } finally { instance.destroy(); }
    } else current = await request<Settings>({ target: 'background', type: 'ready', pair: selected, detectedSource: action.actualPair?.sourceLanguage, tabId: setupTab() });
    if (!detectorStage) {
      progress.value = 1; prepare.textContent = 'Translation is ready';
      status.textContent = 'All set. Return to your website and choose Translate this page or Retry translation from the toolbar.';
      stage('done'); finish.hidden = contextTab === null;
    }
  } catch (error) {
    prepare.disabled = false; prepare.textContent = 'Try setup again';
    progress.hidden = true; status.textContent = signal.aborted ? 'Setup cancelled. You can retry when ready.' : 'Setup did not finish.';
    if (!signal.aborted) showError(error);
  } finally {
    setupAbort = undefined; busy = false; updateForm();
    if (detectorStage) await checkAvailability();
    void synchronize();
  }
});
retry.addEventListener('click', () => { void checkAvailability(); });
cancel.addEventListener('click', () => setupAbort?.abort());
finish.addEventListener('click', async () => {
  if (contextTab === null || busy || dirty) return;
  busy = true; updateForm();
  try { await request({ target: 'background', type: 'toggle', tabId: contextTab, enabled: true }); await chrome.tabs.update(contextTab, { active: true }); }
  catch (error) { showError(error); }
  finally { busy = false; updateForm(); }
});
understood.addEventListener('change', () => { understoodDirty = true; document.getElementById('understood-status')!.textContent = 'Unsaved changes'; });
document.getElementById('save-understood')!.addEventListener('click', async () => {
  const button = document.getElementById('save-understood') as HTMLButtonElement;
  button.disabled = true;
  try {
    await request({ target: 'background', type: 'understood-languages', languages: Array.from(understood.selectedOptions, option => option.value) });
    understoodDirty = false; document.getElementById('understood-status')!.textContent = 'Saved. Automatic translation keeps these languages in their original form.';
  } catch (error) { document.getElementById('understood-status')!.textContent = errorMessage(error); }
  finally { button.disabled = false; }
});
document.getElementById('configure-shortcuts')!.addEventListener('click', () => { void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
if (chrome.commands?.getAll) void chrome.commands.getAll().then(commands => {
  const list = document.getElementById('shortcut-list')!; list.replaceChildren();
  for (const command of commands) {
    if (!command.description) continue;
    const item = document.createElement('li'); item.textContent = command.description + ': ' + (command.shortcut || 'Not assigned'); list.append(item);
  }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.pair || changes.sitePreferences || changes.understoodLanguages)) void synchronize(); });
window.addEventListener('pagehide', () => { setupAbort?.abort(); detector?.destroy(); });
void synchronize();
