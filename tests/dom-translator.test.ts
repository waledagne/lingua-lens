import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { DomTranslator } from '../src/dom-translator.ts';
import { chunks } from '../src/segment.ts';
import { siteKey, withPadding } from '../src/shared.ts';
import { PassageEngine } from '../src/passage-engine.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5); }
  assert.ok(check(), 'Condition did not become true');
}
function fixture(t: TestContext, html: string, translate: ConstructorParameters<typeof DomTranslator>[1] = async texts => texts.map(text => `EN:${text}`)) {
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

const paragraphResult = (element: Element): string | undefined => element.querySelector('[data-lingua-lens-translation]')?.shadowRoot?.querySelector('.text')?.textContent ?? undefined;

test('bilingual paragraphs translate a complete sentence across inline markup and preserve original links', async t => {
  const calls: string[][] = [];
  const { document, controller } = fixture(t, '<p>To jest <strong>dobry</strong> <a href="#details">produkt</a>.</p>', async texts => { calls.push(texts); return texts.map(text => 'EN:' + text); });
  const paragraph = document.querySelector('p')!, link = document.querySelector('a')!, strong = document.querySelector('strong')!;
  const original = paragraph.innerHTML;
  let clicks = 0; link.addEventListener('click', event => { event.preventDefault(); clicks++; });
  controller.setReadingMode('bilingual', 'en'); controller.start();
  await until(() => paragraphResult(paragraph) === 'EN:To jest dobry produkt.');
  assert.deepEqual(calls, [['To jest dobry produkt.']]);
  assert.equal(paragraph.textContent, 'To jest dobry produkt.');
  assert.equal(document.querySelector('strong'), strong); assert.equal(document.querySelector('a'), link);
  link.click(); assert.equal(clicks, 1);
  controller.stop(); assert.equal(paragraph.innerHTML, original);
});

test('bilingual paragraphs handle inline edits, removed nodes, line breaks, and replacement nodes', async t => {
  const { document, controller } = fixture(t, '<p>Witaj <strong>świecie</strong><br><em>Dzisiaj.</em></p>');
  const paragraph = document.querySelector('p')!;
  controller.setReadingMode('bilingual', 'en'); controller.start();
  await until(() => paragraphResult(paragraph) === 'EN:Witaj świecie\nDzisiaj.');
  paragraph.querySelector('strong')!.firstChild!.textContent = 'przyjacielu';
  await until(() => paragraphResult(paragraph) === 'EN:Witaj przyjacielu\nDzisiaj.');
  paragraph.querySelector('em')!.remove();
  await until(() => paragraphResult(paragraph) === 'EN:Witaj przyjacielu');
  paragraph.innerHTML = 'Nowy <strong>opis.</strong>';
  await until(() => paragraphResult(paragraph) === 'EN:Nowy opis.');
  assert.equal(paragraph.querySelectorAll('[data-lingua-lens-translation]').length, 1);
  controller.stop(); assert.equal(paragraph.innerHTML, 'Nowy <strong>opis.</strong>');
});

test('changing reading modes restores source before translating and removes all bilingual output', async t => {
  const { document, controller } = fixture(t, '<p>Dobry <em>produkt.</em></p><button>Otwórz</button>');
  const paragraph = document.querySelector('p')!;
  controller.start(); await until(() => paragraph.textContent === 'EN:Dobry EN:produkt.');
  controller.setReadingMode('bilingual', 'en');
  await until(() => paragraphResult(paragraph) === 'EN:Dobry produkt.');
  assert.equal(paragraph.textContent, 'Dobry produkt.');
  assert.equal(document.querySelector('button')!.textContent, 'EN:Otwórz');
  controller.setReadingMode('translated', 'en');
  await until(() => paragraph.textContent === 'EN:Dobry EN:produkt.');
  assert.equal(paragraphResult(paragraph), undefined);
  controller.stop(); assert.equal(paragraph.textContent, 'Dobry produkt.');
});

test('a paragraph response cannot overwrite newer source', async t => {
  let finish!: (texts: string[]) => void, started = false;
  const { document, controller } = fixture(t, '<p>Stary <em>opis.</em></p>', async texts => {
    if (!started) { started = true; return new Promise(resolve => { finish = resolve; }); }
    return texts.map(text => 'EN:' + text);
  });
  const paragraph = document.querySelector('p')!;
  controller.setReadingMode('bilingual', 'en'); controller.start(); await until(() => started);
  paragraph.firstChild!.textContent = 'Nowy ';
  await sleep(10); finish(['Old result']);
  await until(() => paragraphResult(paragraph) === 'EN:Nowy opis.');
  assert.equal(document.body.textContent!.includes('Old result'), false);
  controller.stop(); assert.equal(paragraph.textContent, 'Nowy opis.');
});

test('a pending paragraph result cannot survive a mode switch', async t => {
  let finish!: (texts: string[]) => void, started = false;
  const { document, controller } = fixture(t, '<p>Stary<em> opis.</em></p>', async texts => {
    if (!started) { started = true; return new Promise(resolve => { finish = resolve; }); }
    return texts.map(text => 'EN:' + text);
  });
  controller.setReadingMode('bilingual', 'en'); controller.start(); await until(() => started);
  controller.setReadingMode('translated', 'en'); finish(['Stale paragraph']);
  await until(() => document.querySelector('p')!.textContent === 'EN:Stary EN:opis.');
  assert.equal(paragraphResult(document.querySelector('p')!), undefined);
});

test('grouping recovers from embedded controls without translating previous output again', async t => {
  const { document, controller } = fixture(t, '<p>Dobry <em>produkt.</em><button>Otwórz</button></p>');
  const paragraph = document.querySelector('p')!;
  controller.setReadingMode('bilingual', 'en'); controller.start();
  await until(() => paragraph.querySelector('em')!.textContent === 'EN:produkt.');
  paragraph.querySelector('button')!.remove();
  await until(() => paragraphResult(paragraph) === 'EN:Dobry produkt.');
  assert.equal(paragraph.textContent, 'Dobry produkt.');
  controller.stop(); assert.equal(paragraph.innerHTML, 'Dobry <em>produkt.</em>');
});

test('bilingual output handles protected regions, shadow roots, equal-target text, and literal HTML', async t => {
  const { document, controller } = fixture(t, '<p translate="no">Marka</p><div contenteditable="true"><p>Sekret</p></div><div id="host"></div><p id="literal">Opis</p>', async texts => texts.map(text => text === 'To samo' ? text : '<img src=x>'));
  const root = document.getElementById('host')!.attachShadow({ mode: 'open' }); root.innerHTML = '<p>Pomoc</p><p>To samo</p>';
  controller.setReadingMode('bilingual', 'ar'); controller.start();
  await until(() => paragraphResult(document.getElementById('literal')!) === '<img src=x>');
  await until(() => paragraphResult(root.querySelector('p')!) === '<img src=x>');
  assert.equal(root.querySelectorAll('[data-lingua-lens-translation]').length, 1);
  const output = document.querySelector('[data-lingua-lens-translation]')!.shadowRoot!;
  assert.equal(output.querySelector('img'), null); assert.equal(output.querySelector('.text')!.getAttribute('lang'), 'ar');
  assert.equal(document.querySelector('[translate="no"]')!.textContent, 'Marka');
  assert.equal(document.querySelector('[contenteditable]')!.textContent, 'Sekret');
});

test('bilingual output repairs removal, disappears on exclusion, and never queues its own text', async t => {
  let calls = 0;
  const { document, controller } = fixture(t, '<p>Witaj <em>świecie.</em></p>', async texts => { calls++; return texts.map(text => 'EN:' + text); });
  const paragraph = document.querySelector('p')!;
  controller.setReadingMode('bilingual'); controller.start();
  await until(() => !!paragraphResult(paragraph));
  const settled = calls; await sleep(40); assert.equal(calls, settled);
  paragraph.querySelector('[data-lingua-lens-translation]')!.remove();
  await until(() => !!paragraphResult(paragraph));
  paragraph.setAttribute('translate', 'no');
  await until(() => paragraphResult(paragraph) === undefined);
  assert.equal(paragraph.textContent, 'Witaj świecie.');
});

test('reveal original uses saved text for selected translated items and ignores later website edits', async t => {
  const { document, controller } = fixture(t, '<p>Dobry <strong>produkt.</strong></p>');
  controller.start(); await until(() => document.querySelector('strong')!.textContent === 'EN:produkt.');
  const range = document.createRange(); range.selectNodeContents(document.querySelector('strong')!);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  assert.deepEqual(controller.originalForSelection(), { original: 'produkt.', translated: 'EN:produkt.' });
  document.querySelector('strong')!.firstChild!.textContent = 'Website changed this';
  assert.equal(controller.originalForSelection(), null);
  controller.stop(); assert.equal(controller.originalForSelection(), null);
});

test('automatic passages preserve context and language identity for identical labels and inline originals', async t => {
  const contexts: string[] = [];
  const engine = new PassageEngine(async context => { contexts.push(context.sample); return context.pageLanguage; }, async (texts, pair) => texts.map(text => pair.sourceLanguage + ':' + text));
  const { document, controller } = fixture(t, '<p lang="fr">Menu</p><p lang="pl">Menu</p><p lang="en">Menu</p><p lang="fr" id="inline">Bonjour <strong>monde</strong>.</p>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  controller.setAutomaticDetection(true); controller.start();
  await until(() => document.querySelector('p')!.textContent === 'fr:Menu');
  assert.equal(document.querySelectorAll('p')[1].textContent, 'pl:Menu'); assert.equal(document.querySelectorAll('p')[2].textContent, 'Menu');
  await until(() => document.querySelector('strong')!.textContent === 'fr:monde');
  const extra = document.createTextNode(' Salut'); document.getElementById('inline')!.append(extra);
  await until(() => extra.data === ' fr:Salut');
  assert.ok(contexts.includes('Bonjour monde. Salut'));
  assert.ok(contexts.every(sample => !sample.includes('fr:')));
  assert.deepEqual(new Set(controller.status().detectedSources), new Set(['fr', 'pl', 'en']));
});

test('passage failures are visible without retry loops; new content continues and explicit retry recovers', async t => {
  let ready = false, frenchCalls = 0;
  const engine = new PassageEngine(async context => context.pageLanguage, async (texts, pair) => {
    if (pair.sourceLanguage === 'fr') { frenchCalls++; if (!ready) throw new Error('Prepare French → English'); }
    return texts.map(text => pair.sourceLanguage + ':' + text);
  });
  const { document, controller } = fixture(t, '<p lang="fr">Bonjour</p><p lang="pl">Witaj</p>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  controller.setAutomaticDetection(true); controller.start();
  await until(() => controller.status().untranslated === 1);
  assert.equal(controller.status().error, null); assert.equal(document.querySelector('p')!.textContent, 'Bonjour');
  const added = document.createElement('p'); added.lang = 'pl'; added.textContent = 'Nowe'; document.body.append(added);
  await until(() => added.textContent === 'pl:Nowe');
  assert.equal(frenchCalls, 1);
  ready = true; controller.start();
  await until(() => document.querySelector('p')!.textContent === 'fr:Bonjour');
  assert.equal(controller.status().untranslated, 0);
});

test('language metadata changes restore and re-detect existing page and shadow text', async t => {
  const engine = new PassageEngine(async context => context.pageLanguage, async (texts, pair) => texts.map(text => pair.sourceLanguage + ':' + text));
  const { document, controller } = fixture(t, '<p>Menu</p><div id="host"></div>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  document.documentElement.lang = 'en';
  const root = document.getElementById('host')!.attachShadow({ mode: 'open' }); root.innerHTML = '<p>Menu</p>';
  controller.setAutomaticDetection(true); controller.start();
  await until(() => controller.status().detectedSources?.includes('en') ?? false);
  document.documentElement.lang = 'es';
  await until(() => document.querySelector('p')!.textContent === 'es:Menu' && root.querySelector('p')!.textContent === 'es:Menu');
  document.querySelector('p')!.lang = 'fr';
  await until(() => document.querySelector('p')!.textContent === 'fr:Menu');
  controller.stop(); assert.equal(document.querySelector('p')!.textContent, 'Menu'); assert.equal(root.querySelector('p')!.textContent, 'Menu');
});

test('bilingual blocks split at language boundaries and never include protected drafts in detection samples', async t => {
  const samples: string[] = [];
  const engine = new PassageEngine(async context => { samples.push(context.sample); return context.pageLanguage; }, async (texts, pair) => texts.map(text => pair.sourceLanguage + ':' + text));
  const { document, controller } = fixture(t, '<p lang="pl">Witaj <span lang="fr">Bonjour</span></p><div contenteditable="true"><p lang="fr">Private draft</p></div><p lang="en">Already English</p>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  controller.setAutomaticDetection(true); controller.setReadingMode('bilingual', 'en'); controller.start();
  await until(() => document.querySelector('span[lang]')!.textContent === 'fr:Bonjour');
  assert.equal(document.querySelector('p')!.firstChild!.textContent, 'pl:Witaj ');
  assert.equal(document.querySelector('[data-lingua-lens-translation]'), null);
  assert.equal(document.querySelector('[contenteditable]')!.textContent, 'Private draft');
  assert.equal(samples.some(sample => sample.includes('Private') || (sample.includes('Witaj') && sample.includes('Bonjour'))), false);
});

test('a failed passage converted into an editor no longer reports an issue or samples subsequent drafts', async t => {
  let detections = 0;
  const engine = new PassageEngine(async context => { detections++; return context.pageLanguage; }, async () => { throw new Error('Prepare French'); });
  const { document, controller } = fixture(t, '<p lang="fr">Bonjour</p>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  controller.setAutomaticDetection(true); controller.start();
  await until(() => controller.status().untranslated === 1);
  const paragraph = document.querySelector('p')!; paragraph.contentEditable = 'true'; paragraph.firstChild!.textContent = 'Private draft';
  await until(() => controller.status().untranslated === 0);
  await sleep(30); assert.equal(detections, 1);
  controller.stop(); assert.equal(paragraph.textContent, 'Private draft');
});

test('initially hidden passages are re-detected when revealed without requiring a manual retry', async t => {
  let detections = 0;
  const engine = new PassageEngine(async context => {
    detections++; if (!context.sample) throw new Error('Not enough visible context'); return 'fr';
  }, async texts => texts.map(text => 'English:' + text));
  const { document, controller } = fixture(t, '<p hidden>Bonjour et bienvenue dans notre magasin.</p>', (texts, contexts) => engine.run(texts, contexts, 'en', []));
  controller.setAutomaticDetection(true); controller.start();
  await until(() => detections === 1 && controller.status().pending === 0);
  assert.equal(controller.status().untranslated, 0, 'Hidden content should not advertise an issue on the visible page');
  const paragraph = document.querySelector('p')!; paragraph.hidden = false;
  await until(() => paragraph.textContent === 'English:Bonjour et bienvenue dans notre magasin.');
  assert.equal(controller.status().untranslated, 0);
});
