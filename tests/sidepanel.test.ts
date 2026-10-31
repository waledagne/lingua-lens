import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import type { BackgroundRequest, PanelSelection } from '../src/shared.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), 'panel did not reach expected state');
}
async function panel(t: TestContext, options: { download?: boolean; delayed?: boolean; unavailable?: boolean; source?: string; inbox?: PanelSelection } = {}) {
  const window = new Window({ url: 'chrome-extension://lens/sidepanel.html', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true } });
  const document = window.document as unknown as Document;
  document.write((await readFile('public/sidepanel.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, ''));
  const messages: BackgroundRequest[] = [], created: string[] = [], gestureCreates: string[] = [], clipboard: string[] = [];
  let listener!: (message: unknown) => void, inClick = false, detectorReady = !options.download, translatorReady = !options.download;
  let inbox = options.inbox ?? null;
  let finish: ((text: string) => void) | undefined, destroyed = 0;
  Object.assign(window, {
    chrome: {
      windows: { getCurrent: async () => ({ id: 1 }) },
      runtime: {
        onMessage: { addListener(callback: typeof listener) { listener = callback; } }, openOptionsPage: async () => {},
        sendMessage: async (message: BackgroundRequest) => {
          messages.push(message);
          if (message.type === 'panel-inbox') { const value = inbox; inbox = null; return { ok: true, data: value }; }
          if (message.type === 'panel-capture') return { ok: false, error: 'Open the toolbar on this website to grant access.' };
          return { ok: true, data: { pair: { sourceLanguage: 'pl', targetLanguage: 'en' } } };
        },
      },
    },
    LanguageDetector: {
      availability: async () => detectorReady ? 'available' : 'downloadable',
      create: async () => {
        created.push('detector'); if (inClick) gestureCreates.push('detector'); detectorReady = true;
        return { detect: async () => [{ detectedLanguage: options.source ?? 'fr', confidence: 0.99 }], destroy() { destroyed++; } };
      },
    },
    Translator: {
      availability: async () => options.unavailable ? 'unavailable' : translatorReady ? 'available' : 'downloadable',
      create: async (pair: { sourceLanguage: string; targetLanguage: string }) => {
        created.push(pair.sourceLanguage + ':' + pair.targetLanguage); if (inClick) gestureCreates.push('translator'); translatorReady = true;
        return { translate: async (text: string) => options.delayed ? await new Promise<string>(resolve => { finish = resolve; }) : 'Translated: ' + text, destroy() { destroyed++; } };
      },
    },
  });
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (text: string) => { clipboard.push(text); } } });
  const bundle = await build({ entryPoints: ['src/sidepanel.ts'], bundle: true, write: false, format: 'iife', target: 'chrome138' });
  window.eval(bundle.outputFiles[0].text);
  t.after(async () => { await window.happyDOM.close(); });
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = (id: string) => element<HTMLButtonElement>(id);
  const click = (id: string) => { inClick = true; button(id).click(); inClick = false; };
  const text = (value: string) => { element<HTMLTextAreaElement>('input-text').value = value; element('input-text').dispatchEvent(new window.Event('input') as unknown as Event); };
  const select = (id: string, value: string) => { element<HTMLSelectElement>(id).value = value; element(id).dispatchEvent(new window.Event('change') as unknown as Event); };
  const send = (value: PanelSelection, windowId = 1) => { inbox = value; listener({ target: 'panel', type: 'selection-ready', windowId }); };
  await until(() => !element<HTMLTextAreaElement>('input-text').disabled);
  return { element, button, click, text, select, send, messages, created, gestureCreates, clipboard, finish: (value: string) => finish?.(value), pending: () => !!finish, destroyed: () => destroyed };
}
const passage = 'Bonjour et bienvenue sur notre site. Voici toutes les informations pour votre visite.';

test('panel detects pasted text locally, copies plain output, and clears drafts', async t => {
  const p = await panel(t); p.text(passage); p.click('translate');
  await until(() => !p.element('result-section').hidden);
  assert.equal(p.element('result').textContent, 'Translated: ' + passage);
  assert.deepEqual(p.created, ['detector', 'fr:en']); assert.equal(p.destroyed(), 2);
  p.click('copy'); await until(() => p.clipboard.length === 1);
  assert.equal(p.clipboard[0], 'Translated: ' + passage);
  assert.ok(!JSON.stringify(p.messages).includes(passage), 'pasted text must not leave the panel through messages');
  p.click('clear'); assert.equal((p.element('input-text') as HTMLTextAreaElement).value, ''); assert.equal(p.element('result').textContent, '');
});
test('panel downloads detector and translation pack in separate user gestures', async t => {
  const p = await panel(t, { download: true }); p.text(passage); p.click('translate');
  await until(() => p.button('translate').textContent === 'Enable automatic detection'); assert.deepEqual(p.created, []);
  p.click('translate'); await until(() => p.button('translate').textContent === 'Download & translate');
  assert.deepEqual(p.gestureCreates, ['detector']);
  p.click('translate'); await until(() => !p.element('result-section').hidden);
  assert.deepEqual(p.gestureCreates, ['detector', 'translator']); assert.equal(p.created.length, 2);
});
test('short paste requests a manual source while imported selections use their language hint', async t => {
  const p = await panel(t); p.text('Bonjour'); p.click('translate');
  await until(() => !p.element('error').hidden); assert.match(p.element('error').textContent!, /not enough text/);
  p.click('clear'); p.send({ id: 'a', text: 'Bonjour', pageLanguage: 'fr', site: 'example.com' });
  await until(() => (p.element('input-text') as HTMLTextAreaElement).value === 'Bonjour');
  p.click('translate'); await until(() => !p.element('result-section').hidden);
  assert.ok(p.created.includes('fr:en'));
});
test('incoming selections preserve drafts until explicitly accepted and stay in the right window', async t => {
  const p = await panel(t); p.text('My private draft');
  p.send({ id: 'other', text: 'wrong window' }, 2); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(p.element('incoming').hidden, true);
  p.send({ id: 'a', text: '<script>plain text</script>', pageLanguage: 'fr', site: 'example.com' });
  await until(() => !p.element('incoming').hidden);
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, 'My private draft');
  assert.equal(p.element('incoming-preview').querySelector('script'), null);
  p.click('use-incoming'); assert.equal((p.element('input-text') as HTMLTextAreaElement).value, '<script>plain text</script>');
  p.send({ id: 'b', text: 'Next' }); await until(() => !p.element('incoming').hidden); p.click('dismiss-incoming');
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, '<script>plain text</script>');
});
test('editing during translation discards late output and destroys the model', async t => {
  const p = await panel(t, { delayed: true }); p.select('source-language', 'fr'); p.text('Bonjour'); p.click('translate');
  await until(p.pending); p.text('New draft'); p.finish('Old result');
  await until(() => p.destroyed() > 0); assert.equal(p.element('result-section').hidden, true);
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, 'New draft');
});
test('cancel preserves input and rejects late output', async t => {
  const p = await panel(t, { delayed: true }); p.select('source-language', 'fr'); p.text('Bonjour'); p.click('translate');
  await until(p.pending); p.click('cancel'); p.finish('Canceled result'); await until(() => p.destroyed() > 0);
  assert.equal(p.element('result-section').hidden, true); assert.match(p.element('status').textContent!, /canceled/);
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, 'Bonjour');
});
test('panel language choices are saved separately and a completed translation can be swapped', async t => {
  const p = await panel(t); p.select('source-language', 'fr'); p.select('target-language', 'de'); p.text('Bonjour'); p.click('translate');
  await until(() => !p.element('result-section').hidden); p.click('swap-languages');
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, 'Translated: Bonjour');
  assert.equal((p.element('source-language') as HTMLSelectElement).value, 'de');
  assert.equal((p.element('target-language') as HTMLSelectElement).value, 'fr');
  assert.ok(p.messages.some(message => message.type === 'panel-languages')); assert.ok(!p.messages.some(message => message.type === 'languages'));
});
test('oversized paste is preserved, equal manual languages are disabled, and capture errors preserve drafts', async t => {
  const p = await panel(t); p.text('x'.repeat(12001)); assert.equal(p.button('translate').disabled, true);
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value.length, 12001); assert.match(p.element('error').textContent!, /kept/);
  p.text('draft'); p.select('source-language', 'en'); assert.equal(p.button('translate').disabled, true);
  p.click('capture'); await until(() => p.element('error').textContent!.includes('grant access'));
  assert.equal((p.element('input-text') as HTMLTextAreaElement).value, 'draft');
});
test('already-target text is preserved without translator creation and unavailable pairs report errors', async t => {
  const same = await panel(t, { source: 'en' }); same.text(passage); same.click('translate');
  await until(() => !same.element('result-section').hidden); assert.deepEqual(same.created, ['detector']); assert.equal(same.element('result').textContent, passage);
  const unavailable = await panel(t, { unavailable: true }); unavailable.select('source-language', 'fr'); unavailable.text('Bonjour'); unavailable.click('translate');
  await until(() => !unavailable.element('error').hidden); assert.match(unavailable.element('error').textContent!, /does not support/);
});
