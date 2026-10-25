import { errorMessage, request, siteKey, type TabState } from './shared';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = get<HTMLButtonElement>('toggle');
const auto = get<HTMLInputElement>('auto');
const setup = get<HTMLButtonElement>('setup');
let tab: chrome.tabs.Tab | undefined;
let current: TabState | undefined;
let busy = false;
function showError(error: unknown): void {
  const element = get('error'); element.textContent = errorMessage(error); element.hidden = false;
}
function render(state: TabState): void {
  current = state;
  const running = state.status?.enabled ?? state.enabled;
  const error = state.status?.error;
  get('site').textContent = state.site || 'Open a website';
  get('dot').classList.toggle('active', running && !error);
  get('badge').textContent = !state.ready ? 'Setup needed' : error ? 'Needs attention' : running ? 'Live' : 'Paused';
  get('summary').textContent = !state.ready ? 'Prepare Polish → English once to start translating.' : error ? 'Translation stopped. Try again or reopen setup.' : running ? 'Watching for new text, menus, and dialogs.' : 'Translate this page and keep up as it changes.';
  get('translated').textContent = String(state.status?.translated ?? 0);
  get('pending').textContent = state.status?.pending ? `${state.status.pending} queued` : '';
  get('metrics').hidden = !state.ready;
  get('error').hidden = !error;
  if (error) get('error').textContent = error;
  toggle.hidden = !state.ready;
  toggle.disabled = busy || !state.site;
  toggle.textContent = error ? 'Retry translation' : running ? 'Pause & restore Polish' : 'Translate this page';
  setup.hidden = state.ready && !error;
  auto.checked = state.autoSites.includes(state.site);
  auto.disabled = busy || !state.site || !state.ready;
}
async function refresh(): Promise<void> {
  if (busy || tab?.id === undefined) return;
  try { render(await request<TabState>({ target: 'background', type: 'state', tabId: tab.id })); } catch (error) { showError(error); }
}
toggle.addEventListener('click', async () => {
  if (tab?.id === undefined || !current || busy) return;
  busy = true; toggle.disabled = true; auto.disabled = true;
  try {
    const enabled = current.status?.error ? true : !(current.status?.enabled ?? current.enabled);
    const state = await request<TabState>({ target: 'background', type: 'toggle', tabId: tab.id, enabled });
    busy = false; render(state);
  } catch (error) { busy = false; if (current) render(current); showError(error); }
});
auto.addEventListener('change', async () => {
  if (tab?.id === undefined || !tab.url || !current || busy) return;
  busy = true; auto.disabled = true; toggle.disabled = true;
  const enabled = auto.checked;
  try {
    // Request directly in the user gesture; never ask for all websites at once.
    if (enabled && siteKey(tab.url) !== 'allegro.pl') {
      const host = new URL(tab.url).hostname;
      if (!await chrome.permissions.request({ origins: [`http://${host}/*`, `https://${host}/*`] })) throw new Error('Website access was not granted. You can still translate this page manually.');
    }
    const state = await request<TabState>({ target: 'background', type: 'auto', tabId: tab.id, enabled });
    busy = false; render(state);
  } catch (error) { busy = false; if (current) render(current); showError(error); }
});
function openSetup(): void { void chrome.runtime.openOptionsPage(); }
setup.addEventListener('click', openSetup);
get('settings').addEventListener('click', openSetup);
void (async () => {
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/u.test(tab.url)) {
      get('site').textContent = 'Open a website'; get('summary').textContent = 'Chrome settings, the Web Store, and PDF viewer cannot be translated here.';
      get('badge').textContent = 'Unavailable'; return;
    }
    await refresh();
    setInterval(() => { void refresh(); }, 1000);
  } catch (error) { showError(error); }
})();
