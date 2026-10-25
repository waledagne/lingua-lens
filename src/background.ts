import { DEFAULT_AUTO_SITES, errorMessage, MAX_BATCH, MAX_TEXT, originPattern, siteKey, unwrap, type BackgroundRequest, type PageStatus, type Settings, type TabState } from './shared';

async function settings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['ready', 'autoSites']);
  const autoSites = Array.isArray(stored.autoSites) && stored.autoSites.every(site => typeof site === 'string') ? stored.autoSites as string[] : DEFAULT_AUTO_SITES;
  return { ready: stored.ready === true, autoSites };
}
async function tabState(tabId: number): Promise<TabState> {
  const [config, tab, session] = await Promise.all([
    settings(), chrome.tabs.get(tabId), chrome.storage.session.get(`tab:${tabId}`),
  ]);
  const url = tab.url ?? '';
  const site = /^https?:/u.test(url) ? siteKey(url) : '';
  const override = session[`tab:${tabId}`] as boolean | undefined;
  let status: PageStatus | null = null;
  try { status = await chrome.tabs.sendMessage(tabId, { target: 'page', type: 'status' }, { frameId: 0 }); } catch { /* Not injected yet. */ }
  return { ...config, site, status, enabled: config.ready && (override ?? config.autoSites.includes(site)) };
}
let creating: Promise<void> | undefined;
async function engine(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('engine.html')],
    });
    if (!existing.length) await chrome.offscreen.createDocument({
      url: 'engine.html', reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run a sentence segmentation worker for long descriptions and host the local Translator API, which is unavailable in service workers.',
    });
  })().finally(() => { creating = undefined; });
  return creating;
}
async function inject(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    // A frame on a different origin may lack permission; still translate the top document.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}
async function notify(tabId: number, type: 'start' | 'stop' | 'refresh'): Promise<void> {
  try { await chrome.tabs.sendMessage(tabId, { target: 'page', type }); } catch { /* Page navigated or has no script. */ }
}
async function refreshTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id === undefined ? undefined : notify(tab.id, 'refresh')));
}
// Serialize settings changes so rapid popup actions cannot overwrite one another.
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const task = mutations.then(operation);
  mutations = task.catch(() => {});
  return task;
}
async function handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'state') {
    const tabId = sender.url?.startsWith(chrome.runtime.getURL('')) ? message.tabId : sender.tab?.id;
    if (tabId === undefined) return settings();
    return tabState(tabId);
  }
  if (message.type === 'translate') {
    if (sender.tab?.id === undefined) throw new Error('Translation requests must come from a webpage.');
    if (!Array.isArray(message.texts) || message.texts.length > MAX_BATCH ||
        !message.texts.every(text => typeof text === 'string' && text.length <= MAX_TEXT) ||
        message.texts.reduce((total, text) => total + text.length, 0) > 24000) throw new Error('Invalid translation batch.');
    const state = await tabState(sender.tab.id);
    if (!state.enabled) throw new Error('Translation is paused.');
    await engine();
    return unwrap<string[]>(await chrome.runtime.sendMessage({ target: 'engine', type: 'translate', texts: message.texts }));
  }
  // Only extension controls may change settings. Content scripts receive configuration through messages.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Use the extension controls to change translation settings.');
  if (message.type === 'ready') {
    await chrome.storage.local.set({ ready: true });
    await refreshTabs();
    return null;
  }
  if (message.type === 'toggle') return mutate(async () => {
    const config = await settings();
    if (message.enabled && !config.ready) throw new Error('Complete local translation setup first.');
    const tab = await chrome.tabs.get(message.tabId);
    originPattern(tab.url ?? '');
    await chrome.storage.session.set({ [`tab:${message.tabId}`]: message.enabled });
    if (message.enabled) await inject(message.tabId);
    await notify(message.tabId, message.enabled ? 'start' : 'stop');
    return tabState(message.tabId);
  });
  if (message.type === 'auto') return mutate(async () => {
    const tab = await chrome.tabs.get(message.tabId);
    const pattern = originPattern(tab.url ?? '');
    const site = siteKey(tab.url!);
    const config = await settings();
    if (message.enabled && !await chrome.permissions.contains({ origins: [pattern] })) throw new Error('Allow access to this website to enable automatic translation.');
    const sites = new Set(config.autoSites);
    if (message.enabled) sites.add(site); else sites.delete(site);
    const id = `site-${site}`;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (site !== 'allegro.pl') {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
      if (message.enabled) await chrome.scripting.registerContentScripts([{
        id, matches: [`http://${site}/*`, `https://${site}/*`], js: ['content.js'],
        allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle', persistAcrossSessions: true,
      }]);
    }
    await chrome.storage.local.set({ autoSites: [...sites] });
    // The checkbox also applies to the current tab; turning it off restores originals.
    await chrome.storage.session.set({ [`tab:${message.tabId}`]: message.enabled });
    if (message.enabled && config.ready) await inject(message.tabId);
    await refreshTabs();
    return tabState(message.tabId);
  });
  throw new Error('Unknown extension request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background') return;
  void handle(message as BackgroundRequest, sender).then(
    data => respond({ ok: true, data }), error => respond({ ok: false, error: errorMessage(error) }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.session.remove(`tab:${tabId}`); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void chrome.storage.session.remove(`tab:${tabId}`);
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
