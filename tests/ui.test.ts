import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { DEFAULT_PAIR, pairKey, type BackgroundRequest, type Settings, type TabState } from '../src/shared.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), 'UI did not reach the expected state');
}
async function ui(t: TestContext, name: 'popup' | 'setup', website = true) {
  const window = new Window({ url: 'chrome-extension://lens/' + name + '.html', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
  const document = window.document as unknown as Document;
  const html = (await readFile('public/' + name + '.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  document.write(html);
  let config: Settings = { pair: { ...DEFAULT_PAIR }, preparedPairs: ['pl:en'], ready: true, autoSites: [] };
  const messages: BackgroundRequest[] = [];
  const prepared: string[] = [];
  const mock = {
    tabs: { query: async () => [{ id: 1, url: website ? 'https://www.example.com' : 'chrome://extensions' }] },
    runtime: {
      openOptionsPage: async () => {},
      sendMessage: async (message: BackgroundRequest) => {
        messages.push(message);
        if (message.type === 'languages') config = { ...config, pair: message.pair, ready: config.preparedPairs.includes(pairKey(message.pair)) };
        if (message.type === 'ready') { config = { ...config, ready: true, preparedPairs: [...config.preparedPairs, pairKey(message.pair)] }; }
        const state: TabState = { ...config, site: website ? 'www.example.com' : '', status: null, enabled: false };
        return { ok: true, data: message.type === 'state' && message.tabId !== undefined ? state : config };
      },
    },
    storage: { onChanged: { addListener() {} } },
    permissions: { request: async () => true },
  };
  Object.assign(window, { chrome: mock, Translator: {
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
  return { document, select, button, messages, prepared };
}

test('popup saves selected languages explicitly, rejects equal languages, and keeps drafts across polling', async t => {
  const { document, select, button, messages } = await ui(t, 'popup');
  assert.equal(button('toggle').textContent, 'Translate this page');
  select('source-language', 'fr'); select('target-language', 'de');
  assert.equal(button('apply-languages').disabled, false);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal((document.getElementById('source-language') as HTMLSelectElement).value, 'fr');
  assert.equal(messages.some(message => message.type === 'languages'), false);
  button('apply-languages').click();
  await until(() => document.getElementById('badge')!.textContent === 'Setup needed');
  assert.equal(button('setup').textContent, 'Prepare French → German');
  const saved = messages.find(message => message.type === 'languages');
  assert.deepEqual(saved && 'pair' in saved ? JSON.parse(JSON.stringify(saved.pair)) : null, { sourceLanguage: 'fr', targetLanguage: 'de' });
  select('target-language', 'fr');
  assert.equal(button('apply-languages').disabled, true);
  assert.match(document.getElementById('language-hint')!.textContent!, /different/);
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
