import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { DEFAULT_PAIR, pairKey, type BackgroundRequest, type PageStatus, type Settings, type SourceContext, type TabState } from '../src/shared.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), 'UI did not reach the expected state');
}
async function ui(t: TestContext, name: 'popup' | 'setup', website = true, options: { context?: SourceContext; detectedSource?: string; detectorReady?: boolean; pageStatus?: PageStatus; permissionGranted?: boolean; autoSite?: boolean } = {}) {
  const window = new Window({ url: 'chrome-extension://lens/' + name + '.html' + (options.context ? '?tabId=1' : ''), settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
  const document = window.document as unknown as Document;
  const html = (await readFile('public/' + name + '.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  document.write(html);
  let config: Settings = { pair: { ...DEFAULT_PAIR }, detectorReady: options.detectorReady ?? false, preparedPairs: ['pl:en'], ready: options.detectorReady ?? false, autoSites: options.autoSite ? ['www.example.com'] : [] };
  const messages: BackgroundRequest[] = [];
  const prepared: string[] = [];
  const permissionRequests: string[][] = [];
  const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8')) as { optional_host_permissions: string[] };
  const mock = {
    tabs: { query: async () => [{ id: 1, url: website ? 'https://www.example.com' : 'chrome://extensions' }] },
    runtime: {
      openOptionsPage: async () => {},
      sendMessage: async (message: BackgroundRequest) => {
        messages.push(message);
        if (message.type === 'languages') config = { ...config, pair: message.pair, ready: message.pair.sourceLanguage === 'auto' ? config.detectorReady : config.preparedPairs.includes(pairKey(message.pair)) };
        if (message.type === 'auto') config = { ...config, autoSites: message.enabled ? ['www.example.com'] : [] };
        if (message.type === 'ready') { config = { ...config, detectorReady: config.detectorReady || message.pair.sourceLanguage === 'auto', ready: true, preparedPairs: [...config.preparedPairs, message.pair.sourceLanguage === 'auto' ? (message.detectedSource ?? '') + ':' + message.pair.targetLanguage : pairKey(message.pair)] }; }
        if (message.type === 'source-context') return { ok: true, data: options.context };
        const state: TabState = { ...config, site: website ? 'www.example.com' : '', status: options.pageStatus ?? null, enabled: options.pageStatus?.enabled ?? false };
        return { ok: true, data: message.type === 'state' && message.tabId !== undefined ? state : config };
      },
    },
    storage: { onChanged: { addListener() {} } },
    permissions: { request: async ({ origins }: { origins: string[] }) => {
      permissionRequests.push([...origins]);
      // Model Chrome's matching-scheme requirement against the actual manifest.
      // The old *:// request is not contained by either explicit scheme declaration.
      if (!origins.every(origin => manifest.optional_host_permissions.some(declared => {
        const [scheme, hostPath] = origin.split('://');
        return declared === scheme + '://*/*' && !!hostPath;
      }))) throw new Error('Only permissions specified in the manifest may be requested.');
      return options.permissionGranted ?? true;
    } },
  };
  Object.assign(window, { chrome: mock, LanguageDetector: { availability: async () => 'available', create: async () => ({ detect: async () => [{ detectedLanguage: options.detectedSource ?? 'fr', confidence: 0.99 }], destroy() {} }) }, Translator: {
    availability: async (pair: Settings['pair']) => pair.sourceLanguage === 'fr' && pair.targetLanguage === 'ja' ? 'unavailable' : 'available',
    create: async (pair: Settings['pair']) => { prepared.push(pairKey(pair)); return { translate: async (text: string) => pairKey(pair) + ':' + text, destroy() {} }; },
  } });
  const bundle = await build({ entryPoints: ['src/' + name + '.ts'], bundle: true, write: false, format: 'iife', target: 'chrome138' });
  window.eval(bundle.outputFiles[0].text);
  t.after(async () => { await window.happyDOM.close(); });
  const select = (id: string, value: string) => {
    const element = document.getElementById(id) as HTMLSelectElement; element.value = value;
    element.dispatchEvent(new window.Event('change') as unknown as Event);
  };
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  await until(() => !(document.getElementById('source-language') as HTMLSelectElement).disabled);
  return { document, select, button, messages, prepared, permissionRequests };
}

test('automatic translation requests declared schemes for only the selected site and enables the switch', async t => {
  const { document, messages, permissionRequests } = await ui(t, 'popup', true, { detectorReady: true });
  const automatic = document.getElementById('auto') as HTMLInputElement;
  automatic.click();
  await until(() => automatic.checked && !automatic.disabled);
  assert.deepEqual(permissionRequests.map(origins => [...origins]), [['http://www.example.com/*', 'https://www.example.com/*']]);
  assert.ok(messages.some(message => message.type === 'auto' && message.enabled));
  assert.equal(document.getElementById('error')!.hidden, true);
});
test('automatic translation stays disabled when the site permission is denied', async t => {
  const { document, messages } = await ui(t, 'popup', true, { detectorReady: true, permissionGranted: false });
  const automatic = document.getElementById('auto') as HTMLInputElement;
  automatic.click();
  await until(() => !document.getElementById('error')!.hidden && !automatic.disabled);
  assert.equal(automatic.checked, false);
  assert.match(document.getElementById('error')!.textContent!, /Website access was not granted/);
  assert.equal(messages.some(message => message.type === 'auto'), false);
});
test('automatic translation can be disabled without requesting site permissions again', async t => {
  const { document, messages, permissionRequests } = await ui(t, 'popup', true, { detectorReady: true, autoSite: true });
  const automatic = document.getElementById('auto') as HTMLInputElement;
  assert.equal(automatic.checked, true); automatic.click();
  await until(() => !automatic.checked && !automatic.disabled);
  assert.deepEqual(permissionRequests, []);
  assert.ok(messages.some(message => message.type === 'auto' && !message.enabled));
});

test('popup saves selected languages explicitly, rejects equal languages, and keeps drafts across polling', async t => {
  const { document, select, button, messages } = await ui(t, 'popup');
  assert.equal(button('toggle').textContent, 'Translate this page');
  select('source-language', 'fr'); select('target-language', 'de');
  assert.equal(button('apply-languages').disabled, false);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal((document.getElementById('source-language') as HTMLSelectElement).value, 'fr');
  assert.equal(messages.some(message => message.type === 'languages'), false);
  button('apply-languages').click();
  await until(() => button('setup').textContent === 'Prepare French → German');
  assert.equal(button('setup').textContent, 'Prepare French → German');
  const saved = messages.find(message => message.type === 'languages');
  assert.deepEqual(saved && 'pair' in saved ? JSON.parse(JSON.stringify(saved.pair)) : null, { sourceLanguage: 'fr', targetLanguage: 'de' });
  select('target-language', 'fr');
  assert.equal(button('apply-languages').disabled, true);
  assert.match(document.getElementById('language-hint')!.textContent!, /different/);
});
test('automatic setup needs only a target and prepares the detected concrete pair in separate user gestures', async t => {
  const { document, select, button, prepared, messages } = await ui(t, 'setup', true, {
    context: { sample: 'Bonjour et bienvenue sur notre site. Voici toutes les informations pour profiter de votre visite et choisir vos options.', pageLanguage: 'fr' },
  });
  assert.equal((document.getElementById('source-language') as HTMLSelectElement).value, 'auto');
  assert.equal(button('swap-languages').disabled, true);
  select('target-language', 'de'); button('apply-languages').click();
  await until(() => button('prepare').textContent === 'Enable automatic detection' && !button('prepare').disabled);
  button('prepare').click();
  await until(() => button('prepare').textContent === 'Enable & test translation' && !button('prepare').disabled);
  assert.match(document.getElementById('detected-language')!.textContent!, /French/); assert.deepEqual(prepared, []);
  button('prepare').click();
  await until(() => document.getElementById('setup-status')!.textContent!.includes('All set'));
  assert.deepEqual(prepared, ['fr:de']);
  assert.equal(document.getElementById('sample-result')!.textContent, 'fr:de:Bonjour.');
  const ready = messages.filter(message => message.type === 'ready');
  assert.equal(ready.length, 2); assert.equal(ready[1].detectedSource, 'fr');
});
test('automatic setup skips translator creation when the page already matches the target', async t => {
  const { document, button, prepared } = await ui(t, 'setup', true, {
    detectorReady: true, detectedSource: 'en',
    context: { sample: 'Welcome to this website. You can find all the information and options you need to continue browsing here.', pageLanguage: 'en' },
  });
  await until(() => button('prepare').textContent === 'Enable on this page');
  assert.match(document.getElementById('setup-status')!.textContent!, /already in English/);
  button('prepare').click(); await until(() => document.getElementById('setup-status')!.textContent!.includes('All set'));
  assert.deepEqual(prepared, []);
});
test('popup reports the detected language and target-language passthrough', async t => {
  const { document } = await ui(t, 'popup', true, { detectorReady: true, pageStatus: { enabled: true, translated: 0, pending: 0, error: null, detectedSource: 'en' } });
  assert.equal(document.getElementById('badge')!.textContent, 'Already translated');
  assert.match(document.getElementById('summary')!.textContent!, /already in English/);
  assert.equal((document.getElementById('target-language') as HTMLSelectElement).querySelector('option[value="auto"]'), null);
});
test('language controls and setup remain available when the active page is protected', async t => {
  const { document, button } = await ui(t, 'popup', false);
  assert.equal(document.getElementById('badge')!.textContent, 'Unavailable');
  assert.equal(button('toggle').disabled, true);
  assert.equal((document.getElementById('source-language') as HTMLSelectElement).disabled, false);
  assert.equal(button('settings').textContent, 'Languages & setup');
});
test('setup creates the selected pair, shows a localized sample, and blocks unsupported pairs', async t => {
  const { document, select, button, prepared } = await ui(t, 'setup');
  select('source-language', 'es'); select('target-language', 'fr'); button('apply-languages').click();
  await until(() => !button('prepare').disabled);
  button('prepare').click();
  await until(() => document.getElementById('setup-status')!.textContent!.includes('All set'));
  assert.deepEqual(prepared, ['es:fr']);
  assert.equal(document.getElementById('sample-source')!.textContent, 'Hola.');
  assert.equal(document.getElementById('sample-result')!.textContent, 'es:fr:Hola.');
  select('source-language', 'fr'); select('target-language', 'ja'); button('apply-languages').click();
  await until(() => !document.getElementById('setup-error')!.hidden);
  assert.match(document.getElementById('setup-error')!.textContent!, /cannot provide French → Japanese/);
  assert.equal(button('prepare').disabled, true);
});
