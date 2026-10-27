import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pairKey, unwrap, type BackgroundRequest, type Reply, type Settings, type TabState } from '../src/shared.ts';

test('background migrates settings and manages languages and arbitrary websites', async t => {
  const local: Record<string, unknown> = { ready: true };
  const session: Record<string, unknown> = {};
  const scripts = new Map<string, { id: string; matches: string[] }>();
  const granted = new Set<string>();
  const tabs = new Map([[1, { id: 1, url: 'https://news.example.com/article' }], [2, { id: 2, url: 'https://www.other.test/page' }], [3, { id: 3, url: 'chrome://extensions' }]]);
  let listener!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => unknown;
  let updated!: (id: number, change: { status?: string }) => void;
  let contexts = 0, refreshed = 0, engineRequests = 0;
  const area = (data: Record<string, unknown>) => ({
    get: async (keys: null | string | string[]) => keys === null ? structuredClone(data) : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(data[key])])),
    set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
    remove: async (key: string) => { delete data[key]; }, clear: async () => { for (const key of Object.keys(data)) delete data[key]; },
    setAccessLevel: async () => {},
  });
  const event = { addListener() {} };
  const mock = {
    storage: { local: area(local), session: area(session) },
    runtime: {
      id: 'lens', getURL: (path: string) => 'chrome-extension://lens/' + path,
      onMessage: { addListener(callback: typeof listener) { listener = callback; } },
      onInstalled: event, onStartup: event, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts: async () => contexts ? [{}] : [],
      sendMessage: async (message: { type: string; pair: Settings['pair']; texts: string[] }) => { engineRequests++; return { ok: true, data: message.type === 'detect' ? 'fr' : message.texts.map(text => pairKey(message.pair) + ':' + text) }; },
    },
    tabs: {
      get: async (id: number) => tabs.get(id), query: async () => [...tabs.values()],
      sendMessage: async (_id: number, message: { type: string }) => { if (message.type === 'refresh') refreshed++; return null; },
      onRemoved: event, onUpdated: { addListener(callback: typeof updated) { updated = callback; } },
    },
    scripting: {
      executeScript: async () => [{ result: { sample: 'Bonjour et bienvenue sur notre site. Voici les informations pour votre visite.', pageLanguage: 'fr' } }], getRegisteredContentScripts: async () => [...scripts.values()],
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => { for (const id of ids) scripts.delete(id); },
      registerContentScripts: async (values: { id: string; matches: string[] }[]) => { for (const value of values) scripts.set(value.id, value); },
      updateContentScripts: async (values: { id: string; matches: string[] }[]) => { for (const value of values) scripts.set(value.id, { ...scripts.get(value.id)!, ...value }); },
    },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => granted.has(origin)), onRemoved: event },
    offscreen: { Reason: { WORKERS: 'WORKERS' }, createDocument: async () => { contexts++; } },
  };
  Object.assign(globalThis, { chrome: mock });
  await import('../src/background.ts');
  const controls = { id: 'lens', url: 'chrome-extension://lens/setup.html', tab: { id: 7 } } as chrome.runtime.MessageSender;
  const page = { id: 'lens', url: tabs.get(1)!.url, tab: tabs.get(1) } as chrome.runtime.MessageSender;
  async function send<T>(message: BackgroundRequest, sender = controls): Promise<T> {
    const reply = await new Promise<Reply<T>>(resolve => { listener(message, sender, value => resolve(value as Reply<T>)); });
    return unwrap(reply);
  }
  await t.test('migration preserves the old prepared pair but enables no site implicitly', async () => {
    const config = await send<Settings>({ target: 'background', type: 'state' });
    assert.equal(config.ready, false); assert.equal(config.pair.sourceLanguage, 'auto'); assert.deepEqual(config.preparedPairs, ['pl:en']); assert.deepEqual(config.autoSites, []); assert.equal(local.schemaVersion, 3); assert.equal(scripts.size, 0);
    const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
    assert.equal(manifest.host_permissions, undefined); assert.equal(manifest.content_scripts, undefined);
  });
  const pair = { sourceLanguage: 'fr', targetLanguage: 'de' };
  await t.test('new pairs need setup and stale setup cannot activate a different selection', async () => {
    const config = await send<Settings>({ target: 'background', type: 'languages', pair });
    assert.equal(config.ready, false); assert.ok(refreshed > 0);
    await assert.rejects(send({ target: 'background', type: 'ready', pair: { sourceLanguage: 'pl', targetLanguage: 'en' } }), /another window/);
    assert.equal((await send<Settings>({ target: 'background', type: 'ready', pair })).ready, true);
    await assert.rejects(send({ target: 'background', type: 'languages', pair: { sourceLanguage: 'en', targetLanguage: 'en' } }), /different/);
  });
  await t.test('every website needs its own permission for automatic translation', async () => {
    await assert.rejects(send({ target: 'background', type: 'auto', tabId: 1, enabled: true }), /Allow access/);
    granted.add('https://news.example.com/*');
    await assert.rejects(send({ target: 'background', type: 'auto', tabId: 1, enabled: true }), /Allow access/);
    granted.add('http://news.example.com/*');
    const state = await send<TabState>({ target: 'background', type: 'auto', tabId: 1, enabled: true });
    assert.equal(state.enabled, true); assert.equal(state.site, 'news.example.com');
    assert.deepEqual(scripts.get('site-news.example.com')!.matches, ['http://news.example.com/*', 'https://news.example.com/*']);
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 2 })).enabled, false);
    await assert.rejects(send({ target: 'background', type: 'auto', tabId: 2, enabled: true }), /Allow access/);
  });
  await t.test('repairs saved wildcard registrations without dropping the remembered website', async () => {
    scripts.set('site-news.example.com', { id: 'site-news.example.com', matches: ['*://news.example.com/*'] });
    const state = await send<TabState>({ target: 'background', type: 'auto', tabId: 1, enabled: true });
    assert.equal(state.enabled, true);
    assert.deepEqual(state.autoSites, ['news.example.com']);
    assert.deepEqual(scripts.get('site-news.example.com')!.matches, ['http://news.example.com/*', 'https://news.example.com/*']);
  });
  await t.test('routes the selected pair and rejects content scripts changing preferences', async () => {
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair }, page), ['fr:de:Bonjour']);
    assert.equal(contexts, 1);
    await assert.rejects(send({ target: 'background', type: 'languages', pair }, page), /extension controls/);
    const next = { sourceLanguage: 'de', targetLanguage: 'en' };
    await send({ target: 'background', type: 'languages', pair: next });
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 1 })).enabled, false);
    await send({ target: 'background', type: 'ready', pair: next });
    await assert.rejects(send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair }, page), /languages changed/);
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Hallo'], pair: next }, page), ['de:en:Hallo']);
  });
  await t.test('manual translation works on a different hostname without an automatic registration', async () => {
    const state = await send<TabState>({ target: 'background', type: 'toggle', tabId: 2, enabled: true });
    assert.equal(state.site, 'www.other.test'); assert.equal(state.enabled, true); assert.equal(scripts.size, 1);
    tabs.set(2, { id: 2, url: 'https://different.example/new' });
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 2 })).enabled, false, 'A tab grant must not follow a different hostname');
    updated(2, { status: 'loading' });
    assert.equal(session['tab:2'], undefined);
    await assert.rejects(send({ target: 'background', type: 'toggle', tabId: 3, enabled: true }), /protects this page/);
  });
  await t.test('disabling a remembered site unregisters it and switching back reuses pair readiness', async () => {
    await send({ target: 'background', type: 'auto', tabId: 1, enabled: false });
    assert.equal(scripts.size, 0); assert.deepEqual(local.autoSites, []);
    assert.equal((await send<Settings>({ target: 'background', type: 'languages', pair: { sourceLanguage: 'pl', targetLanguage: 'en' } })).ready, true);
  });
  await t.test('auto mode detects the source, routes a concrete pair, and skips matching target text', async () => {
    const automatic = { sourceLanguage: 'auto', targetLanguage: 'en' };
    assert.equal((await send<Settings>({ target: 'background', type: 'languages', pair: automatic })).ready, false);
    assert.equal((await send<Settings>({ target: 'background', type: 'ready', pair: automatic })).detectorReady, true);
    await send({ target: 'background', type: 'toggle', tabId: 1, enabled: true });
    const context = await send<{ sample: string; pageLanguage: string }>({ target: 'background', type: 'source-context', tabId: 1 });
    assert.equal(context.pageLanguage, 'fr');
    await assert.rejects(send({ target: 'background', type: 'source-context', tabId: 1 }, page), /extension controls/);
    assert.equal(await send({ target: 'background', type: 'detect', context, pair: automatic }, page), 'fr');
    await assert.rejects(send({ target: 'background', type: 'detect', context: { ...context, sample: 'x'.repeat(6001) }, pair: automatic }, page), /Invalid/);
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair: automatic, sourceLanguage: 'fr' }, page), ['fr:en:Bonjour']);
    await assert.rejects(send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair: automatic }, page), /Detect or select/);
    const requests = engineRequests;
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Hello'], pair: automatic, sourceLanguage: 'en' }, page), ['Hello']);
    assert.equal(engineRequests, requests);
    await send({ target: 'background', type: 'ready', pair: automatic, detectedSource: 'en' });
    assert.ok(!(local.preparedPairs as string[]).includes('en:en'));
    await send({ target: 'background', type: 'ready', pair: automatic, detectedSource: 'fr' });
    assert.ok((local.preparedPairs as string[]).includes('fr:en'));
  });
});
