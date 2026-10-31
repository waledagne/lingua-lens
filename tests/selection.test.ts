import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { readSelection } from '../src/selection.ts';
import { SelectionPanel } from '../src/selection-panel.ts';
import type { SelectionView } from '../src/shared.ts';

test('selection capture excludes editing fields, ranges spanning fields, and the extension panel', async t => {
  const window = new Window({ url: 'https://example.com', settings: { enableJavaScriptEvaluation: true } });
  t.after(() => window.happyDOM.close());
  window.document.write('<html lang="fr"><body><p>Bonjour le monde.</p><textarea>Private draft</textarea><div contenteditable="true">Private reply</div><div data-lingua-lens-ignore>Our panel</div></body></html>');
  const bundle = await build({ entryPoints: ['src/selection.ts'], bundle: true, write: false, format: 'iife', globalName: 'selectionCapture', target: 'chrome138' });
  const capture = (element: Element) => {
    const range = window.document.createRange(); range.selectNodeContents(element as never);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return window.eval(bundle.outputFiles[0].text + '\nselectionCapture.readSelection()') as ReturnType<typeof readSelection>;
  };
  assert.equal(capture(window.document.querySelector('p') as unknown as Element).text, 'Bonjour le monde.');
  for (const selector of ['textarea', '[contenteditable]', '[data-lingua-lens-ignore]', 'body']) assert.equal(capture(window.document.querySelector(selector) as unknown as Element).text, '');
});

test('selection panel renders text safely and ignores results after dismissal', async t => {
  const window = new Window({ url: 'https://example.com' });
  t.after(() => window.happyDOM.close());
  const document = window.document as unknown as Document;
  const panel = new SelectionPanel(document, async () => {});
  const view: SelectionView = { id: 'first', original: '<img src=x onerror=alert(1)>', label: 'French → English' };
  panel.show(view);
  let root = document.querySelector('[data-lingua-lens-ignore]')!.shadowRoot!;
  assert.equal(root.querySelector('img'), null);
  assert.match(root.textContent!, /<img src=x onerror=alert\(1\)>/);
  assert.equal(root.querySelector('footer button')?.textContent, 'Copy translation');
  panel.show({ ...view, result: 'Hello' });
  root = document.querySelector('[data-lingua-lens-ignore]')!.shadowRoot!;
  assert.equal(root.querySelector('#selection-result')!.textContent, 'Hello');
  const clipboard = window.navigator.clipboard;
  clipboard.writeText = async () => { throw new Error('Clipboard blocked'); };
  (root.querySelector('footer button') as HTMLButtonElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.querySelector('footer button')!.textContent, 'Select the translation to copy it.');
  panel.close();
  panel.show({ ...view, result: 'Late response' });
  assert.equal(document.querySelector('[data-lingua-lens-ignore]'), null);
  panel.show({ ...view, id: 'next' });
  panel.show({ ...view, result: 'Old request' });
  root = document.querySelector('[data-lingua-lens-ignore]')!.shadowRoot!;
  assert.equal(root.querySelector('#selection-result')!.textContent, 'Translating on your device…');
  panel.close();
});
