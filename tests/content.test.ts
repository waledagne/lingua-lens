import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { pairKey, type BackgroundRequest, type LanguagePair, type TabState } from '../src/shared.ts';
import type { DomTranslator } from '../src/dom-translator.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), 'Content script did not reach the expected state');
}
async function content(t: TestContext, translate: (texts: string[], pair: LanguagePair) => Promise<string[]>) {
  const window = new Window({ url: 'https://example.com', settings: { enableJavaScriptEvaluation: true } });
  const document = window.document as unknown as Document;
  document.body.innerHTML = '<p>Witaj</p>';
  const config: TabState = { pair: { sourceLanguage: 'pl', targetLanguage: 'en' }, ready: true, preparedPairs: ['pl:en'], autoSites: [], enabled: true, site: 'example.com', status: null };
  let listener!: (message: unknown, sender: unknown, respond: (value: unknown) => void) => void;
  Object.assign(window, { chrome: { runtime: {
    id: 'lens', onMessage: { addListener(callback: typeof listener) { listener = callback; } },
    sendMessage: async (message: BackgroundRequest) => ({ ok: true, data: message.type === 'translate' ? await translate(message.texts, message.pair) : structuredClone(config) }),
  } } });
  t.after(async () => { (window as unknown as { __linguaLens?: DomTranslator }).__linguaLens?.stop(); await window.happyDOM.close(); });
  const bundle = await build({ entryPoints: ['src/content.ts'], bundle: true, write: false, format: 'iife', target: 'chrome138' });
  window.eval(bundle.outputFiles[0].text);
  const refresh = () => new Promise<void>(resolve => { listener({ target: 'page', type: 'refresh' }, { id: 'lens' }, () => resolve()); });
  return { document, config, refresh };
}
test('actual content script restores source text and changes the pair on all following requests', async t => {
  const calls: string[] = [];
  const { document, config, refresh } = await content(t, async (texts, pair) => { calls.push(pairKey(pair)); return texts.map(text => pairKey(pair) + ':' + text); });
  await until(() => document.querySelector('p')!.textContent === 'pl:en:Witaj');
  config.pair = { sourceLanguage: 'fr', targetLanguage: 'de' };
  await refresh();
  await until(() => document.querySelector('p')!.textContent === 'fr:de:Witaj');
  assert.deepEqual(calls, ['pl:en', 'fr:de']);
  config.pair = { sourceLanguage: 'es', targetLanguage: 'fr' }; config.ready = false; config.enabled = false;
  await refresh();
  assert.equal(document.querySelector('p')!.textContent, 'Witaj');
  config.ready = true; config.enabled = true;
  await refresh();
  await until(() => document.querySelector('p')!.textContent === 'es:fr:Witaj');
  config.enabled = false; await refresh();
  assert.equal(document.querySelector('p')!.textContent, 'Witaj');
});
test('actual content script discards an old pair response that arrives after switching languages', async t => {
  let resolveOld!: (texts: string[]) => void;
  let started = false;
  const { document, config, refresh } = await content(t, async (texts, pair) => {
    if (pairKey(pair) === 'pl:en') { started = true; return new Promise(resolve => { resolveOld = resolve; }); }
    return texts.map(text => pairKey(pair) + ':' + text);
  });
  await until(() => started);
  config.pair = { sourceLanguage: 'ja', targetLanguage: 'en' };
  await refresh();
  assert.equal(document.querySelector('p')!.textContent, 'Witaj');
  resolveOld(['Old pair output']);
  await until(() => document.querySelector('p')!.textContent === 'ja:en:Witaj');
  assert.equal(document.body.textContent!.includes('Old pair output'), false);
});
