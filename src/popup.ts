import { errorMessage, languageName, pairLabel, request, siteOrigins, type LanguagePair, type Settings, type TabState } from './shared';
import { LanguageControls } from './language-controls';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = get<HTMLButtonElement>('toggle');
const auto = get<HTMLInputElement>('auto');
const setup = get<HTMLButtonElement>('setup');
const scope = get<HTMLSelectElement>('language-scope');
const never = get<HTMLInputElement>('never');
const selection = get<HTMLButtonElement>('translate-selection');
let scopeChosen = false;
function editingPair(state: TabState): LanguagePair { return scope.value === 'global' ? state.defaultPair ?? state.pair : state.pair; }
let tab: chrome.tabs.Tab | undefined;
let current: TabState | undefined;
let busy = false;
let dirty = false;
let actionError: string | null = null;
let pendingAuto: boolean | null = null;
let pendingNever: boolean | null = null;
const controls = new LanguageControls(() => {
  dirty = current ? controls.changed(editingPair(current)) : true;
  actionError = null;
  if (current) render(current);
});
function render(state: TabState): void {
  current = state;
  if (!scopeChosen) scope.value = state.sitePreference?.pair ? 'site' : 'global';
  scope.disabled = busy;
  (scope.querySelector('option[value="site"]') as HTMLOptionElement).disabled = !state.site;
  if (!dirty) controls.set(editingPair(state));
  controls.disable(busy);
  let invalid: string | null = null;
  try { controls.read(); } catch (error) { invalid = errorMessage(error); }
  controls.apply.disabled = busy || (!dirty && !(scope.value === 'site' && !state.sitePreference?.pair)) || !!invalid;
  get('language-hint').textContent = invalid ?? (scope.value === 'site' ? 'These languages apply only to ' + state.site + '.' : state.sitePreference?.pair ? 'Changes update defaults. This site keeps its own languages.' : 'Defaults apply to websites without their own languages.');
  const running = state.status?.enabled ?? state.enabled;
  const pageError = state.status?.error;
  const error = actionError ?? pageError;
  const detected = state.pair.sourceLanguage === 'auto' ? state.status?.detectedSource : null;
  const alreadyTarget = !!detected && detected === state.pair.targetLanguage;
  get('site').textContent = state.site || 'Open a website';
  get('dot').classList.toggle('active', running && !pageError);
  const blocked = pendingNever ?? !!state.sitePreference?.never;
  const understood = detected && state.understoodLanguages?.includes(detected);
  get('badge').textContent = !state.site ? 'Unavailable' : blocked ? 'Excluded' : !state.ready ? 'Setup needed' : pageError ? 'Needs attention' : running && (alreadyTarget || understood) ? 'Original' : running ? 'Live' : 'Paused';
  if (running && alreadyTarget) get('badge').textContent = 'Already translated';
  get('summary').textContent = !state.site ? 'Open an ordinary website to translate. Chrome protects its settings, Web Store, and PDF viewer.' :
    blocked ? 'This website is excluded. Turn off Never translate this site to translate it.' :
    !state.ready ? 'Prepare ' + pairLabel(state.pair) + ' to start translating.' :
    pageError ? 'Translation stopped. Try again or reopen setup.' :
    running && alreadyTarget ? 'This page is already in ' + languageName(detected!) + '. No translation is needed.' :
    running && understood ? 'Keeping ' + languageName(detected!) + ' because you understand this language.' :
    running && detected ? 'Detected ' + languageName(detected) + '. Watching for new text, menus, and dialogs.' :
    running ? (state.pair.sourceLanguage === 'auto' ? 'Detecting the page language and watching for new content.' : 'Watching for new text, menus, and dialogs.') : 'Translate this page and keep up as it changes.';
  get('translated').textContent = String(state.status?.translated ?? 0);
  get('pending').textContent = state.status?.pending ? String(state.status.pending) + ' queued' : '';
  get('metrics').hidden = !state.ready || !state.site || !running;
  get('error').hidden = !error;
  get('error').textContent = error ?? '';
  toggle.hidden = !state.ready;
  toggle.disabled = busy || dirty || !state.site || blocked;
  selection.disabled = busy || dirty || !state.site || blocked;
  toggle.textContent = pageError ? 'Retry translation' : running ? 'Pause & restore original' : 'Translate this page';
  setup.hidden = state.ready && !pageError;
  setup.disabled = busy || dirty;
  setup.textContent = !state.ready && state.pair.sourceLanguage === 'auto' ? 'Enable automatic detection' : 'Prepare ' + pairLabel(detected ? { sourceLanguage: detected, targetLanguage: state.pair.targetLanguage } : state.pair);
  auto.checked = pendingAuto ?? state.autoSites.includes(state.site);
  auto.disabled = busy || dirty || !state.site || !state.ready || blocked;
  never.checked = blocked; never.disabled = busy || dirty || !state.site;
  get('reset-site-languages').hidden = !state.sitePreference?.pair;
  (get('reset-site-languages') as HTMLButtonElement).disabled = busy || dirty;
}
scope.addEventListener('change', () => { scopeChosen = true; dirty = false; if (current) render(current); });
async function refresh(): Promise<void> {
  if (busy) return;
  try {
    const state = await request<Settings | TabState>({ target: 'background', type: 'state', tabId: tab?.id });
    if (!busy) render('site' in state ? state : { ...state, site: '', enabled: false, status: null });
  } catch (error) {
    actionError = errorMessage(error);
    get('error').textContent = actionError; get('error').hidden = false;
  }
}
controls.apply.addEventListener('click', async () => {
  if (!current || busy) return;
  busy = true; actionError = null; render(current);
  try {
    await request<Settings>({ target: 'background', type: 'languages', pair: controls.read(), tabId: scope.value === 'site' ? tab?.id : undefined });
    dirty = false;
  } catch (error) { actionError = errorMessage(error); }
  finally { busy = false; await refresh(); }
});
never.addEventListener('change', async () => {
  if (busy || dirty || tab?.id === undefined || !current) return;
  pendingNever = never.checked; busy = true; actionError = null; render(current);
  try { await request({ target: 'background', type: 'site-preference', tabId: tab.id, never: pendingNever }); }
  catch (error) { actionError = errorMessage(error); }
  finally { pendingNever = null; busy = false; await refresh(); }
});
get('reset-site-languages').addEventListener('click', async () => {
  if (busy || dirty || tab?.id === undefined || !current) return;
  busy = true; actionError = null; render(current);
  try { await request({ target: 'background', type: 'site-preference', tabId: tab.id, resetPair: true }); scope.value = 'global'; }
  catch (error) { actionError = errorMessage(error); }
  finally { busy = false; await refresh(); }
});
selection.addEventListener('click', async () => {
  if (tab?.id === undefined || busy || dirty || !current) return;
  busy = true; actionError = null; render(current);
  try { await request({ target: 'background', type: 'selection', tabId: tab.id }); }
  catch (error) { actionError = errorMessage(error); }
  finally { busy = false; await refresh(); }
});
get('shortcuts').addEventListener('click', () => { void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
toggle.addEventListener('click', async () => {
  if (tab?.id === undefined || !current || busy || dirty) return;
  busy = true; actionError = null; render(current);
  try {
    const enabled = current.status?.error ? true : !(current.status?.enabled ?? current.enabled);
    await request<TabState>({ target: 'background', type: 'toggle', tabId: tab.id, enabled });
  } catch (error) { actionError = errorMessage(error); }
  finally { busy = false; await refresh(); }
});
auto.addEventListener('change', async () => {
  if (tab?.id === undefined || !current?.site || busy || dirty) return;
  const enabled = auto.checked;
  pendingAuto = enabled;
  busy = true; actionError = null;
  const site = current.site;
  render(current);
  try {
    // Keep the permission request inside the click/change gesture for every hostname.
    if (enabled && !await chrome.permissions.request({ origins: siteOrigins(site) })) throw new Error('Website access was not granted. You can still translate this page manually.');
    await request<TabState>({ target: 'background', type: 'auto', tabId: tab.id, enabled });
  } catch (error) { actionError = errorMessage(error); }
  finally { pendingAuto = null; busy = false; await refresh(); }
});
function openSetup(): void {
  if (tab?.id !== undefined && current?.site) void chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') + '?tabId=' + String(tab.id) });
  else void chrome.runtime.openOptionsPage();
}
setup.addEventListener('click', openSetup);
get('settings').addEventListener('click', openSetup);
void (async () => {
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch (error) { actionError = errorMessage(error); }
  await refresh();
  setInterval(() => { void refresh(); }, 1000);
})();
