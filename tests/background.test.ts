import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pairKey, unwrap, type BackgroundRequest, type Reply, type SelectionView, type Settings, type TabState } from '../src/shared.ts';

test('background migrates settings and manages languages and arbitrary websites', async t => {
  const local: Record<string, unknown> = { ready: true };
  const session: Record<string, unknown> = {};
  const scripts = new Map<string, { id: string; matches: string[] }>();
  const granted = new Set<string>();
  const tabs = new Map([[1, { id: 1, url: 'https://news.example.com/article' }], [2, { id: 2, url: 'https://www.other.test/page' }], [3, { id: 3, url: 'chrome://extensions' }]]);
  let listener!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => unknown;
  let updated!: (id: number, change: { status?: string }) => void;
  let command!: (name: string, tab?: chrome.tabs.Tab) => void;
  let menuClick!: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void;
  let installed!: (details: chrome.runtime.InstalledDetails) => void;
  const views: SelectionView[] = [], opened: string[] = [];
  let selectedText = 'Bonjour', selectionFrame = 0, menusCreated = 0, revealAvailable = true;
  let finishSelection: ((texts: string[]) => void) | undefined;
  const until = async (check: () => boolean) => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.ok(check()); };
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
      onInstalled: { addListener(callback: typeof installed) { installed = callback; } }, onStartup: event, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts: async () => contexts ? [{}] : [],
      sendMessage: async (message: { type: string; pair: Settings['pair']; texts: string[] }) => {
        engineRequests++;
        if (message.type === 'translate' && message.texts[0] === 'Delayed selection') return { ok: true, data: await new Promise<string[]>(resolve => { finishSelection = resolve; }) };
        return { ok: true, data: message.type === 'detect' ? 'fr' : message.texts.map(text => pairKey(message.pair) + ':' + text) };
      },
    },
    tabs: {
      get: async (id: number) => tabs.get(id), query: async () => [...tabs.values()],
      create: async ({ url }: { url: string }) => { opened.push(url); },
      sendMessage: async (_id: number, message: { type: string; view: SelectionView }) => {
        if (message.type === 'refresh') refreshed++;
        if (message.type === 'selection-view') views.push(structuredClone(message.view));
        if (message.type === 'original-selection' && revealAvailable) return { original: 'Bonjour', translated: 'Hello' };
        return null;
      },
      onRemoved: event, onUpdated: { addListener(callback: typeof updated) { updated = callback; } },
    },
    scripting: {
      executeScript: async (options: { func?: { name: string }; target: { frameIds?: number[] } }) => options.func?.name === 'readSelection' ? [{ frameId: options.target.frameIds?.[0] ?? selectionFrame, result: { text: selectedText, pageLanguage: 'fr', focused: true } }] : [{ result: { sample: 'Bonjour et bienvenue sur notre site. Voici les informations pour votre visite.', pageLanguage: 'fr' } }], getRegisteredContentScripts: async () => [...scripts.values()],
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => { for (const id of ids) scripts.delete(id); },
      registerContentScripts: async (values: { id: string; matches: string[] }[]) => { for (const value of values) scripts.set(value.id, value); },
      updateContentScripts: async (values: { id: string; matches: string[] }[]) => { for (const value of values) scripts.set(value.id, { ...scripts.get(value.id)!, ...value }); },
    },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => granted.has(origin)), onRemoved: event },
    contextMenus: { onClicked: { addListener(callback: typeof menuClick) { menuClick = callback; } }, removeAll: async () => {}, create: () => { menusCreated++; } },
    commands: { onCommand: { addListener(callback: typeof command) { command = callback; } } },
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
    assert.equal(config.ready, false); assert.equal(config.pair.sourceLanguage, 'auto'); assert.deepEqual(config.preparedPairs, ['pl:en']); assert.deepEqual(config.autoSites, []); assert.equal(local.schemaVersion, 5); assert.equal(scripts.size, 0);
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
  await t.test('site languages are independent, setup prepares the effective pair, and defaults remain intact', async () => {
    const custom = { sourceLanguage: 'es', targetLanguage: 'de' };
    const state = await send<TabState>({ target: 'background', type: 'languages', tabId: 1, pair: custom });
    assert.deepEqual(state.pair, custom); assert.equal(state.ready, false);
    assert.equal((await send<Settings>({ target: 'background', type: 'state' })).pair.sourceLanguage, 'auto');
    await assert.rejects(send({ target: 'background', type: 'ready', pair: custom }), /another window/);
    assert.equal((await send<TabState>({ target: 'background', type: 'ready', tabId: 1, pair: custom })).ready, true);
    await send({ target: 'background', type: 'languages', pair: { sourceLanguage: 'pl', targetLanguage: 'en' } });
    assert.deepEqual((await send<TabState>({ target: 'background', type: 'state', tabId: 1 })).pair, custom);
    await send({ target: 'background', type: 'toggle', tabId: 1, enabled: true });
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Hola'], pair: custom }, page), ['es:de:Hola']);
    const reset = await send<TabState>({ target: 'background', type: 'site-preference', tabId: 1, resetPair: true });
    assert.deepEqual(reset.pair, { sourceLanguage: 'pl', targetLanguage: 'en' });
  });
  await t.test('never translate removes automatic registration, blocks activation, and requires an explicit opt-in again', async () => {
    await send({ target: 'background', type: 'auto', tabId: 1, enabled: true });
    const blocked = await send<TabState>({ target: 'background', type: 'site-preference', tabId: 1, never: true });
    assert.equal(blocked.enabled, false); assert.deepEqual(blocked.autoSites, []); assert.equal(scripts.size, 0);
    await assert.rejects(send({ target: 'background', type: 'toggle', tabId: 1, enabled: true }), /Never translate/);
    await assert.rejects(send({ target: 'background', type: 'auto', tabId: 1, enabled: true }), /Never translate/);
    const allowed = await send<TabState>({ target: 'background', type: 'site-preference', tabId: 1, never: false });
    assert.equal(allowed.enabled, false); assert.deepEqual(allowed.autoSites, []);
  });
  await t.test('understood languages skip automatic page translation but a manual source still translates', async () => {
    await send({ target: 'background', type: 'understood-languages', languages: ['fr', 'fr'] });
    await assert.rejects(send({ target: 'background', type: 'understood-languages', languages: ['xx'] }), /supported/);
    const pair = { sourceLanguage: 'auto', targetLanguage: 'en' };
    await send({ target: 'background', type: 'languages', pair });
    await send({ target: 'background', type: 'toggle', tabId: 1, enabled: true });
    const before = engineRequests;
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair, sourceLanguage: 'fr' }, page), ['Bonjour']);
    assert.equal(engineRequests, before);
    const manual = { sourceLanguage: 'fr', targetLanguage: 'en' };
    await send({ target: 'background', type: 'languages', pair: manual });
    assert.deepEqual(await send({ target: 'background', type: 'translate', texts: ['Bonjour'], pair: manual }, page), ['fr:en:Bonjour']);
  });
  await t.test('selected text translates while the page is paused and cannot be invoked by content scripts', async () => {
    await send({ target: 'background', type: 'toggle', tabId: 1, enabled: false });
    await assert.rejects(send({ target: 'background', type: 'selection', tabId: 1 }, page), /extension controls/);
    await send({ target: 'background', type: 'selection', tabId: 1 });
    assert.equal(views.at(-1)?.result, 'fr:en:Bonjour');
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 1 })).enabled, false);
    assert.equal(local.selectedText, undefined);
    selectedText = '';
    await send({ target: 'background', type: 'selection', tabId: 1 });
    assert.match(views.at(-1)?.error ?? '', /Select some text/);
    selectedText = 'x'.repeat(12001);
    await send({ target: 'background', type: 'selection', tabId: 1 });
    assert.match(views.at(-1)?.error ?? '', /shorter/); assert.equal(views.at(-1)?.original, '');
    selectedText = 'Bonjour';
  });
  await t.test('context-menu and keyboard actions route selections and page toggle correctly', async () => {
    const before = views.length;
    selectionFrame = 2;
    menuClick({ menuItemId: 'translate-selection', frameId: 2 } as chrome.contextMenus.OnClickData, tabs.get(1) as chrome.tabs.Tab);
    await until(() => views.length >= before + 2);
    assert.equal(views.at(-1)?.result, 'fr:en:Bonjour');
    const next = views.length;
    command('translate-selection', tabs.get(1) as chrome.tabs.Tab);
    await until(() => views.length >= next + 2);
    command('toggle-page', tabs.get(1) as chrome.tabs.Tab);
    await until(() => (session['tab:1'] as { enabled?: boolean })?.enabled === true);
    command('toggle-page', tabs.get(1) as chrome.tabs.Tab);
    await until(() => (session['tab:1'] as { enabled?: boolean })?.enabled === false);
  });
  await t.test('only first installation opens onboarding; updates preserve manual languages', async () => {
    installed({ reason: 'update' } as chrome.runtime.InstalledDetails);
    await until(() => menusCreated === 2); assert.equal(opened.length, 0);
    installed({ reason: 'install' } as chrome.runtime.InstalledDetails);
    await until(() => opened.length === 1);
    assert.equal(opened[0], 'chrome-extension://lens/setup.html');
    assert.deepEqual((await send<Settings>({ target: 'background', type: 'state' })).pair, { sourceLanguage: 'fr', targetLanguage: 'en' });
  });
  await t.test('selection results from old settings cannot appear after the language changes', async () => {
    selectedText = 'Delayed selection';
    const pending = send({ target: 'background', type: 'selection', tabId: 1 });
    await until(() => !!finishSelection);
    await send({ target: 'background', type: 'languages', pair: { sourceLanguage: 'pl', targetLanguage: 'en' } });
    finishSelection!(['Old translation']);
    await pending;
    assert.equal(views.at(-1)?.result, undefined);
    assert.match(views.at(-1)?.error ?? '', /settings changed/);
  });
  await t.test('reading-mode defaults and website overrides stay independent and reset safely', async () => {
    await send({ target: 'background', type: 'reading-mode', mode: 'bilingual' });
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 1 })).readingMode, 'bilingual');
    await send({ target: 'background', type: 'reading-mode', tabId: 1, mode: 'translated' });
    const state = await send<TabState>({ target: 'background', type: 'state', tabId: 1 });
    assert.equal(state.readingMode, 'translated'); assert.equal(state.defaultReadingMode, 'bilingual');
    assert.equal((await send<TabState>({ target: 'background', type: 'state', tabId: 2 })).readingMode, 'bilingual');
    await assert.rejects(send({ target: 'background', type: 'reading-mode', mode: 'bilingual' }, page), /extension controls/);
    const reset = await send<TabState>({ target: 'background', type: 'site-preference', tabId: 1, resetReadingMode: true });
    assert.equal(reset.readingMode, 'bilingual');
  });
  await t.test('original reveal reads stored page entries and never invokes a model, including menu and shortcut routing', async () => {
    selectedText = 'Hello';
    const before = engineRequests;
    await send({ target: 'background', type: 'reveal-original', tabId: 1 });
    assert.equal(views.at(-1)?.original, 'Bonjour'); assert.equal(views.at(-1)?.result, 'Hello');
    assert.equal(engineRequests, before);
    let count = views.length;
    command('reveal-original', tabs.get(1) as chrome.tabs.Tab);
    await until(() => views.length >= count + 2);
    count = views.length;
    menuClick({ menuItemId: 'reveal-original', frameId: 2 } as chrome.contextMenus.OnClickData, tabs.get(1) as chrome.tabs.Tab);
    await until(() => views.length >= count + 2);
    assert.equal(engineRequests, before);
    revealAvailable = false;
    await send({ target: 'background', type: 'reveal-original', tabId: 1 });
    assert.match(views.at(-1)?.error ?? '', /Select translated page text/);
    assert.equal(views.at(-1)?.result, undefined);
  });
});
