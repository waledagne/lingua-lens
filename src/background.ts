import { errorMessage, isWebsite, MAX_BATCH, MAX_TEXT, originPattern, pairKey, parsePair, siteKey, unwrap, type BackgroundRequest, type PageStatus, type Settings, type TabState } from './shared';
import { readSettings, storedSettings } from './settings';

async function settings(): Promise<Settings> {
  return readSettings(await chrome.storage.local.get(null));
}
async function tabState(tabId: number, includeStatus = true): Promise<TabState> {
  const [config, tab, session] = await Promise.all([
    settings(), chrome.tabs.get(tabId), chrome.storage.session.get(`tab:${tabId}`),
  ]);
  const url = tab.url ?? '';
  const site = isWebsite(url) ? siteKey(url) : '';
  const storedOverride = session[`tab:${tabId}`] as { site?: string; enabled?: boolean } | undefined;
  const override = storedOverride?.site === site && typeof storedOverride.enabled === 'boolean' ? storedOverride.enabled : undefined;
  let status: PageStatus | null = null;
  if (includeStatus) try { status = await chrome.tabs.sendMessage(tabId, { target: 'page', type: 'status' }, { frameId: 0 }); } catch { /* Not injected yet. */ }
  return { ...config, site, status, enabled: !!site && config.ready && (override ?? config.autoSites.includes(site)) };
}
async function reconcileSites(): Promise<void> {
  const config = await settings();
  const permitted: string[] = [];
  for (const site of config.autoSites) if (await chrome.permissions.contains({ origins: [`*://${site}/*`] })) permitted.push(site);
  const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith('site-'));
  const desired = new Set(permitted.map(site => `site-${site}`));
  const stale = registered.filter(script => !desired.has(script.id)).map(script => script.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  const existing = new Set(registered.map(script => script.id));
  const missing = permitted.filter(site => !existing.has(`site-${site}`));
  if (missing.length) await chrome.scripting.registerContentScripts(missing.map(site => ({
    id: `site-${site}`, matches: [`*://${site}/*`], js: ['content.js'],
    allFrames: true, matchOriginAsFallback: true, runAt: 'document_idle', persistAcrossSessions: true,
  })));
  if (permitted.length !== config.autoSites.length) await chrome.storage.local.set({ autoSites: permitted });
}
let initializing: Promise<void> | undefined;
function initialize(): Promise<void> {
  if (!initializing) initializing = (async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set(storedSettings(await settings()));
    await reconcileSites();
  })().catch(error => { initializing = undefined; throw error; });
  return initializing;
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
async function notify(tabId: number): Promise<void> {
  try { await chrome.tabs.sendMessage(tabId, { target: 'page', type: 'refresh' }); } catch { /* Page navigated or has no script. */ }
}
async function refreshTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => tab.id === undefined ? undefined : notify(tab.id)));
}
// Serialize settings changes so rapid popup actions cannot overwrite one another.
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const task = mutations.then(operation);
  mutations = task.catch(() => {});
  return task;
}
async function handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await initialize();
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
    const pair = parsePair(message.pair);
    const state = await tabState(sender.tab.id, false);
    if (!state.enabled) throw new Error('Translation is paused.');
    if (pairKey(pair) !== pairKey(state.pair)) throw new Error('The selected languages changed. Retry translation.');
    await engine();
    return unwrap<string[]>(await chrome.runtime.sendMessage({ target: 'engine', type: 'translate', texts: message.texts, pair }));
  }
  // Only extension controls may change settings. Content scripts receive configuration through messages.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Use the extension controls to change translation settings.');
  if (message.type === 'languages') return mutate(async () => {
    const pair = parsePair(message.pair);
    await chrome.storage.local.set({ pair });
    await refreshTabs();
    return settings();
  });
  if (message.type === 'ready') return mutate(async () => {
    const pair = parsePair(message.pair);
    const config = await settings();
    if (pairKey(pair) !== pairKey(config.pair)) throw new Error('Languages changed in another window. Select the current pair and try setup again.');
    await chrome.storage.local.set({ preparedPairs: [...new Set([...config.preparedPairs, pairKey(pair)])] });
    await refreshTabs();
    return settings();
  });
  if (message.type === 'toggle') return mutate(async () => {
    const config = await settings();
    if (message.enabled && !config.ready) throw new Error('Complete local translation setup first.');
    const tab = await chrome.tabs.get(message.tabId);
    originPattern(tab.url ?? '');
    if (message.enabled) await inject(message.tabId);
    await chrome.storage.session.set({ [`tab:${message.tabId}`]: { site: siteKey(tab.url!), enabled: message.enabled } });
    await notify(message.tabId);
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
    await chrome.storage.local.set({ autoSites: [...sites] });
    await reconcileSites();
    // The checkbox also applies to the current tab; turning it off restores originals.
    await chrome.storage.session.set({ [`tab:${message.tabId}`]: { site, enabled: message.enabled } });
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
  void initialize().catch(error => console.warn('Lingua Lens initialization:', errorMessage(error)));
});
chrome.runtime.onStartup.addListener(() => { void initialize().catch(error => console.warn('Lingua Lens startup:', errorMessage(error))); });
chrome.permissions.onRemoved.addListener(() => {
  void mutate(async () => { await initialize(); await reconcileSites(); await chrome.storage.session.clear(); await refreshTabs(); })
    .catch(error => console.warn('Lingua Lens site access:', errorMessage(error)));
});
