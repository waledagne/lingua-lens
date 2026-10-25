import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { DomTranslator } from '../src/dom-translator.ts';
import { chunks } from '../src/segment.ts';
import { siteKey, withPadding } from '../src/shared.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5); }
  assert.ok(check(), 'Condition did not become true');
}
function fixture(t: TestContext, html: string, translate = async (texts: string[]) => texts.map(text => `EN:${text}`)) {
  const window = new Window({ url: 'https://allegro.pl/' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = html;
  const controller = new DomTranslator(document, translate, 2);
  t.after(async () => { controller.stop(); await window.happyDOM.close(); });
  return { document, controller };
}

test('translates initial text and attributes; restores exact whitespace without replacing buttons', async t => {
  const { document, controller } = fixture(t, '<button title="Kup teraz">  Dodaj do koszyka  </button>');
  const button = document.querySelector('button')!;
  let clicks = 0; button.addEventListener('click', () => clicks++);
  controller.start();
  await until(() => button.textContent === '  EN:Dodaj do koszyka  ');
  assert.equal(button.title, 'EN:Kup teraz');
  button.click(); assert.equal(clicks, 1);
  controller.stop();
  assert.equal(button.textContent, '  Dodaj do koszyka  ');
  assert.equal(button.title, 'Kup teraz');
});
test('translates delayed modals, changed text and placeholders without translating its own output', async t => {
  let calls = 0;
  const { document, controller } = fixture(t, '<p>Witaj</p>', async texts => { calls++; return texts.map(text => `EN:${text}`); });
  controller.start(); await until(() => document.querySelector('p')!.textContent === 'EN:Witaj');
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<h2>Wybierz dostawę</h2><input placeholder="Wpisz miasto">';
  document.body.append(dialog);
  await until(() => dialog.querySelector('h2')!.textContent === 'EN:Wybierz dostawę');
  dialog.querySelector('h2')!.firstChild!.textContent = 'Dostawa jutro';
  dialog.querySelector('input')!.placeholder = 'Kod pocztowy';
  await until(() => dialog.querySelector('h2')!.textContent === 'EN:Dostawa jutro');
  await until(() => dialog.querySelector('input')!.placeholder === 'EN:Kod pocztowy');
  const settled = calls; await sleep(40); assert.equal(calls, settled);
  controller.stop(); assert.equal(dialog.querySelector('h2')!.textContent, 'Dostawa jutro');
});
test('protects user input, passwords, editable areas, scripts, and implicit option values', async t => {
  const { document, controller } = fixture(t, '<input value="Mój tekst" placeholder="Szukaj"><input type="password" title="Hasło"><textarea>Notatka</textarea><div contenteditable="true">Wiadomość</div><script>const tekst="polski"</script><div translate="no">Marka</div><select><option>Domyślna</option><option value="pl">Polska</option></select>');
  controller.start(); await until(() => document.querySelector('input')!.placeholder === 'EN:Szukaj');
  assert.equal(document.querySelector('input')!.value, 'Mój tekst');
  assert.equal(document.querySelector('input[type=password]')!.getAttribute('title'), 'Hasło');
  assert.equal(document.querySelector('textarea')!.textContent, 'Notatka');
  assert.equal(document.querySelector('[contenteditable]')!.textContent, 'Wiadomość');
  assert.equal(document.querySelector('script')!.textContent, 'const tekst="polski"');
  assert.equal(document.querySelector('[translate=no]')!.textContent, 'Marka');
  assert.equal(document.querySelector('option')!.textContent, 'Domyślna');
  assert.equal(document.querySelector('option[value]')!.getAttribute('value'), 'pl');
});
test('handles open shadow roots and observes later additions inside them', async t => {
  const { document, controller } = fixture(t, '<section id="host"></section><div contenteditable="true" id="editor"></div>');
  const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
  root.innerHTML = '<p>Pomoc</p>';
  const protectedRoot = document.getElementById('editor')!.attachShadow({ mode: 'open' });
  protectedRoot.innerHTML = '<p>Mój tekst</p>';
  controller.start(); await until(() => root.querySelector('p')!.textContent === 'EN:Pomoc');
  root.innerHTML = '<button>Zamknij</button>';
  await until(() => root.querySelector('button')!.textContent === 'EN:Zamknij');
  assert.equal(protectedRoot.textContent, 'Mój tekst');
  controller.stop(); assert.equal(root.querySelector('button')!.textContent, 'Zamknij');
});
test('does not apply a late translation after pause', async t => {
  let resolve!: (translations: string[]) => void;
  let received = false;
  const { document, controller } = fixture(t, '<p>Oryginał</p>', texts => { received = true; return new Promise(r => { resolve = r; }); });
  controller.start(); await until(() => received);
  controller.stop(); resolve(['Late English']); await sleep(30);
  assert.equal(document.querySelector('p')!.textContent, 'Oryginał');
});
test('discovers a shadow root attached later to an existing host', async t => {
  const { document, controller } = fixture(t, '<div id="host"></div>');
  controller.start();
  const host = document.getElementById('host')!;
  const root = host.attachShadow({ mode: 'open' }); root.innerHTML = '<p>Nowe menu</p>';
  host.dispatchEvent(new document.defaultView!.Event('click', { bubbles: true }));
  await until(() => root.querySelector('p')!.textContent === 'EN:Nowe menu');
});
test('does not overwrite a website update while translation is in flight', async t => {
  let first!: (translations: string[]) => void;
  let calls = 0;
  const { document, controller } = fixture(t, '<p>Stary tekst</p>', texts => {
    calls++;
    return calls === 1 ? new Promise(r => { first = r; }) : Promise.resolve(texts.map(text => `EN:${text}`));
  });
  controller.start(); await until(() => calls === 1);
  document.querySelector('p')!.firstChild!.textContent = 'Nowy tekst';
  await sleep(10); first(['Stale result']);
  await until(() => document.querySelector('p')!.textContent === 'EN:Nowy tekst');
  controller.stop(); assert.equal(document.querySelector('p')!.textContent, 'Nowy tekst');
});
test('restoration preserves newer website values and translation output cannot inject HTML', async t => {
  const { document, controller } = fixture(t, '<p>Tekst</p><span>Inny</span>', async texts => texts.map(() => '<img src=x onerror=alert(1)>'));
  controller.start(); await until(() => controller.status().translated === 2);
  assert.equal(document.querySelector('img'), null);
  document.querySelector('span')!.textContent = 'Nowsza wiadomość';
  controller.stop();
  assert.equal(document.querySelector('p')!.textContent, 'Tekst');
  assert.equal(document.querySelector('span')!.textContent, 'Nowsza wiadomość');
});
test('deduplicates labels, batches work, and retries explicitly after an engine error', async t => {
  let fail = true;
  const requests: string[][] = [];
  const { document, controller } = fixture(t, '<p>Pomoc</p><p>Pomoc</p>' + Array.from({ length: 70 }, (_, i) => `<p>Produkt ${i}</p>`).join(''), async texts => {
    requests.push(texts); if (fail) throw new Error('Run setup'); return texts.map(text => `EN:${text}`);
  });
  controller.start(); await until(() => controller.status().error !== null);
  await sleep(30); assert.equal(requests.length, 1, 'No retry loop');
  fail = false; controller.start();
  await until(() => controller.status().translated === 72);
  assert.ok(requests.every(texts => texts.length <= 32));
  assert.equal(requests.slice(1).flat().filter(text => text === 'Pomoc').length, 1);
  assert.equal(document.querySelector('p')!.textContent, 'EN:Pomoc');
});
test('splits long descriptions without losing text or breaking emoji', () => {
  const text = 'Długi opis. '.repeat(900) + 'A'.repeat(1900) + '🛒'.repeat(1900);
  const result = chunks(text);
  assert.equal(result.join(''), text);
  assert.ok(result.every(part => part.length <= 1801));
  assert.ok(result.every(part => !/[\uD800-\uDBFF]$/u.test(part)));
  assert.equal(withPadding(' \nTekst\t', ' Text '), ' \nText\t');
  assert.equal(siteKey('https://www.allegro.pl/oferta/a'), 'www.allegro.pl');
  assert.equal(siteKey('https://allegro.pl.example.org/'), 'allegro.pl.example.org');
});
