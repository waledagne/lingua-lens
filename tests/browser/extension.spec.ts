import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prepareBrowser } from '../../scripts/browser-runtime.ts';
test.describe.configure({ mode: 'serial' });

// Only the isolated test copy receives a deterministic Translator. dist/ always uses Chrome's real API.
const mock = `globalThis.LanguageDetector = {
  availability: async () => 'available',
  create: async () => ({detect: async () => [{detectedLanguage:'pl',confidence:0.99}],destroy(){}})
};
globalThis.Translator = {
  availability: async pair => pair.sourceLanguage === 'fr' && pair.targetLanguage === 'ja' ? 'unavailable' : 'available',
  create: async pair => ({
    translate: async text => {
      await new Promise(r => setTimeout(r, 8));
      const dictionary = {'Witaj.':'Hello.','Twój koszyk jest pusty.':'Your cart is empty.','Wybierz dostawę':'Choose delivery','Metoda dostawy':'Delivery method','Dostawa jutro':'Delivery tomorrow','Zamknij':'Close','Szukaj produktów':'Search products','Witaj w sklepie':'Welcome to the shop','Pomoc i kontakt':'Help and contact','Treść ramki':'Frame content','Liczba produktów: 1':'Number of products: 1'};
      return pair.sourceLanguage === 'pl' && pair.targetLanguage === 'en' ? dictionary[text] || 'English: ' + text : pair.sourceLanguage + ':' + pair.targetLanguage + ':' + text;
    }, destroy() {}
  })
};\n`;
let context: BrowserContext;
let worker: Worker;
let control: Page;
let shop: Page;
let server: Server;
let origin: string;
let extensionId: string;
let tabId: number;

test.beforeAll(async () => {
  test.setTimeout(90000);
  const executable = await prepareBrowser();
  const extension = path.resolve('work/browser-extension');
  await mkdir(extension, { recursive: true });
  await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://127.0.0.1/*', 'http://localhost/*', 'https://localhost/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['engine.js', 'setup.js']) {
    const source = await readFile(path.join(extension, file), 'utf8');
    await writeFile(path.join(extension, file), mock + source);
  }
  const fixture = await readFile('tests/fixture.html', 'utf8');
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url === '/frame' ? '<!doctype html><html lang="pl"><body><p>Treść ramki</p></body></html>' : fixture);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    executablePath: executable,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1200, height: 900 },
  });
  console.log('Chrome for Testing ' + context.browser()?.version());
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/setup.html`);
  await control.getByLabel('Source language', { exact: true }).selectOption('pl');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await control.getByRole('button', { name: 'Enable & test translation' }).click();
  await expect(control.locator('#sample-result')).toHaveText('Hello.');
  await expect(control.locator('#setup-status')).toContainText('All set');
  shop = await context.newPage(); await shop.goto(origin);
  const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'http://127.0.0.1/*' }));
  tabId = tabs[0].id!;
});
test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function command(type: 'toggle' | 'auto', enabled: boolean) {
  const result = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type, tabId, enabled });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}
test('extension routes actual DOM requests through service worker, offscreen document, and segmentation worker', async () => {
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  expect(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  await command('toggle', true);
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await expect(shop.locator('#cart')).toHaveText('Your cart is empty.');
  await expect(shop.locator('#query')).toHaveAttribute('placeholder', 'Search products');
  await expect(shop.locator('#query')).toHaveValue('Mój tekst');
  await expect(shop.locator('#shadow-host p')).toHaveText('Help and contact');
  await expect(shop.frameLocator('iframe').locator('p')).toHaveText('Frame content');
  const contexts = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }));
  expect(contexts.length).toBe(1);
});
test('language selection restores originals, prepares the chosen pair, and avoids cache mixing', async () => {
  await command('toggle', false);
  const popup = await context.newPage(); await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#preferences > summary').click();
  await popup.getByLabel('Source language', { exact: true }).selectOption('fr');
  await popup.getByLabel('Target language', { exact: true }).selectOption('de');
  await popup.getByRole('button', { name: 'Apply languages' }).click();
  await expect(popup.locator('#badge')).toHaveText('Setup needed');
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(control.getByLabel('Source language', { exact: true })).toHaveValue('fr');
  await control.getByRole('button', { name: 'Enable & test translation' }).click();
  await expect(control.locator('#sample-result')).toHaveText('fr:de:Bonjour.');
  await expect(popup.getByRole('button', { name: 'Translate this page', exact: true })).toBeEnabled();
  await popup.locator('#toggle').click();
  await expect(shop.locator('h1')).toHaveText('fr:de:Witaj w sklepie');
  await popup.getByLabel('Source language', { exact: true }).selectOption('pl');
  await popup.getByLabel('Target language', { exact: true }).selectOption('en');
  await popup.getByRole('button', { name: 'Apply languages' }).click();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await popup.close();
});
test('manual translation also works on another hostname and unsupported pairs stay inactive', async () => {
  const other = await context.newPage();
  await other.goto(origin.replace('127.0.0.1', 'localhost'));
  await expect(other.locator('h1')).toHaveText('Witaj w sklepie');
  const otherTab = (await worker.evaluate(() => chrome.tabs.query({ url: 'http://localhost/*' })))[0].id!;
  const result = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'toggle', tabId: otherTab, enabled: true });
  expect(result).toMatchObject({ ok: true });
  await expect(other.locator('h1')).toHaveText('Welcome to the shop');
  await control.getByLabel('Source language', { exact: true }).selectOption('fr');
  await control.getByLabel('Target language', { exact: true }).selectOption('ja');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await expect(control.locator('#setup-error')).toContainText('cannot provide French → Japanese');
  await expect(control.locator('#prepare')).toBeDisabled();
  await expect(other.locator('h1')).toHaveText('Witaj w sklepie');
  await control.getByLabel('Source language', { exact: true }).selectOption('pl');
  await control.getByLabel('Target language', { exact: true }).selectOption('en');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await other.close();
});
test('late modal content and updates translate; buttons keep working and pause restores originals', async () => {
  await shop.locator('#open').click();
  await expect(shop.locator('dialog h2')).toHaveText('Delivery method');
  await expect(shop.locator('dialog p')).toHaveText('Delivery tomorrow');
  await shop.locator('#close').click();
  await expect(shop.locator('dialog')).toHaveCount(0);
  await shop.locator('#update').click();
  await expect(shop.locator('#cart')).toHaveText('Number of products: 1');
  await command('toggle', false);
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(shop.locator('#cart')).toHaveText('Liczba produktów: 1');
  await expect(shop.locator('#query')).toHaveAttribute('placeholder', 'Szukaj produktów');
  await expect(shop.frameLocator('iframe').locator('p')).toHaveText('Treść ramki');
});
test('remembered sites translate after navigation and popup reflects live state', async () => {
  // Open the popup in its own tab, then focus the website so activeTab lookup uses the website.
  const popup = await context.newPage();
  await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#site')).toHaveText('127.0.0.1');
  await expect(popup.locator('#auto')).not.toBeChecked();
  // Exercise the actual permissions.request() path, rather than bypassing the popup.
  await popup.locator('#auto').check();
  await expect(popup.locator('#error')).toBeHidden();
  await expect(popup.locator('#auto')).toBeChecked();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  expect(scripts[0].matches).toEqual(['http://127.0.0.1/*', 'https://127.0.0.1/*']);
  await shop.reload();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await expect(popup.locator('#badge')).toHaveText('Live');
  await expect(popup.locator('#auto')).toBeChecked();
  await popup.locator('#toggle').click();
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(popup.locator('#badge')).toHaveText('Paused');
  await popup.screenshot({ path: 'work/popup-preview.png' });
  await popup.close();
  await control.screenshot({ path: 'work/setup-preview.png', fullPage: true });
});

test('automatic source mode translates with a concrete source and skips pages matching the target', async () => {
  await control.getByLabel('Source language', { exact: true }).selectOption('auto');
  await control.getByLabel('Target language', { exact: true }).selectOption('de');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await control.getByRole('button', { name: 'Enable automatic detection', exact: true }).click();
  await control.getByRole('button', { name: 'Enable & test translation', exact: true }).click();
  await expect(control.locator('#setup-status')).toContainText('All set');
  await command('toggle', true);
  await expect(shop.locator('h1')).toHaveText('pl:de:Witaj w sklepie');
  const state = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'state', tabId });
  expect(state.data.status.detectedSource).toBe('pl');
  await control.getByLabel('Target language', { exact: true }).selectOption('pl');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  const same = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'state', tabId });
  expect(same.data.status.error).toBeNull();
});

test('website language overrides survive defaults and navigation; exclusion restores all tabs', async () => {
  const custom = { sourceLanguage: 'pl', targetLanguage: 'fr' };
  const popup = await context.newPage(); await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#preferences > summary').click();
  await popup.getByLabel('Save preferences for').selectOption('site');
  await popup.getByLabel('Source language', { exact: true }).selectOption('pl');
  await popup.getByLabel('Target language', { exact: true }).selectOption('fr');
  await popup.getByRole('button', { name: 'Apply languages' }).click();
  await expect(popup.locator('#badge')).toHaveText('Setup needed');
  const siteSetup = await context.newPage();
  await siteSetup.goto(`chrome-extension://${extensionId}/setup.html?tabId=${tabId}`);
  await expect(siteSetup.locator('#setup-scope')).toContainText('127.0.0.1');
  await siteSetup.getByRole('button', { name: 'Enable & test translation' }).click();
  await expect(siteSetup.locator('#sample-result')).toHaveText('pl:fr:Witaj.');
  await siteSetup.getByRole('button', { name: 'Translate & return to website' }).click();
  await expect(shop.locator('h1')).toHaveText('pl:fr:Witaj w sklepie');
  const state = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'state', tabId });
  expect(state.data.pair).toEqual(custom); expect(state.data.defaultPair).toEqual({ sourceLanguage: 'auto', targetLanguage: 'pl' });
  await shop.reload();
  await expect(shop.locator('h1')).toHaveText('pl:fr:Witaj w sklepie');
  const second = await context.newPage(); await second.goto(origin);
  await expect(second.locator('h1')).toHaveText('pl:fr:Witaj w sklepie');
  await popup.locator('#never').check();
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(second.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(popup.locator('#toggle')).toBeDisabled();
  await expect(popup.locator('#auto')).not.toBeChecked();
  expect(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  await popup.locator('#never').uncheck();
  await expect(popup.locator('#toggle')).toBeEnabled();
  await popup.getByRole('button', { name: 'Use default settings on this site' }).click();
  await expect(popup.getByLabel('Target language', { exact: true })).toHaveValue('pl');
  await second.close(); await siteSetup.close(); await popup.close();
});

test('selected text translates independently, supports copy, leaves the page intact, and excludes its panel', async () => {
  await control.getByLabel('Source language', { exact: true }).selectOption('pl');
  await control.getByLabel('Target language', { exact: true }).selectOption('en');
  const apply = control.getByRole('button', { name: 'Apply languages' });
  if (await apply.isEnabled()) await apply.click();
  await command('toggle', false);
  await shop.locator('h1').selectText();
  const popup = await context.newPage(); await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('button', { name: 'Translate selected text', exact: true }).click();
  await expect(shop.getByRole('dialog', { name: 'Selected text translation' })).toBeVisible();
  await expect(shop.locator('[data-lingua-lens-ignore] #selection-result')).toHaveText('Welcome to the shop');
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await shop.getByRole('button', { name: 'Copy translation' }).click();
  expect(await shop.evaluate(() => navigator.clipboard.readText())).toBe('Welcome to the shop');
  await shop.screenshot({ path: 'work/selection-preview.png' });
  await command('toggle', true);
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await expect(shop.locator('[data-lingua-lens-ignore] #selection-result')).toHaveText('Welcome to the shop');
  await shop.getByRole('button', { name: 'Close translation' }).click();
  await expect(shop.locator('[data-lingua-lens-ignore]')).toHaveCount(0);
  await command('toggle', false);
  await shop.evaluate(() => window.getSelection()?.removeAllRanges());
  await popup.getByRole('button', { name: 'Translate selected text', exact: true }).click();
  await expect(shop.locator('[data-lingua-lens-ignore] #selection-result')).toContainText('Select some text');
  const setupOpened = context.waitForEvent('page');
  await shop.getByRole('button', { name: 'Open language setup', exact: true }).click();
  const selectionSetup = await setupOpened;
  await expect(selectionSetup).toHaveURL(`chrome-extension://${extensionId}/setup.html?tabId=${tabId}`);
  await selectionSetup.close();
  await shop.keyboard.press('Escape');
  await expect(shop.locator('[data-lingua-lens-ignore]')).toHaveCount(0);
  await shop.frameLocator('iframe').locator('p').selectText();
  await popup.getByRole('button', { name: 'Translate selected text', exact: true }).click();
  await expect(shop.frameLocator('iframe').locator('[data-lingua-lens-ignore] #selection-result')).toHaveText('Frame content');
  await shop.frameLocator('iframe').getByRole('button', { name: 'Close translation' }).click();
  await popup.close();
});

test('understood languages keep page originals while explicit selections can still translate', async () => {
  await control.getByLabel('Source language', { exact: true }).selectOption('auto');
  await control.getByRole('button', { name: 'Apply languages' }).click();
  await control.getByLabel('Keep original (optional)', { exact: true }).selectOption(['pl']);
  await control.getByRole('button', { name: 'Save understood languages' }).click();
  await expect(control.locator('#understood-status')).toContainText('Saved.');
  await command('toggle', true);
  await expect.poll(async () => (await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'state', tabId })).data.status.detectedSource).toBe('pl');
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await shop.locator('h1').selectText();
  const result = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'selection', tabId });
  expect(result.ok).toBe(true);
  await expect(shop.locator('[data-lingua-lens-ignore] #selection-result')).toHaveText('Welcome to the shop');
  await shop.getByRole('button', { name: 'Close translation' }).click();
  await control.getByLabel('Keep original (optional)', { exact: true }).selectOption([]);
  await control.getByRole('button', { name: 'Save understood languages' }).click();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  const shortcuts = await worker.evaluate(() => chrome.commands.getAll());
  expect(shortcuts.find(command => command.name === 'translate-selection')?.shortcut).toBe('Alt+Shift+Y');
  expect(shortcuts.find(command => command.name === 'toggle-page')?.shortcut).toBe('Alt+Shift+L');
});

test('bilingual mode groups inline paragraphs, preserves links, updates live content, and persists per site', async () => {
  await command('toggle', true);
  const popup = await context.newPage(); await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#preferences > summary').click();
  await popup.getByLabel('Save preferences for').selectOption('site');
  await popup.getByLabel('Reading mode', { exact: true }).selectOption('bilingual');
  await expect(popup.getByLabel('Reading mode', { exact: true })).toBeEnabled();
  await expect.poll(() => shop.locator('h1').evaluate(element => element.textContent)).toBe('Witaj w sklepie');
  await expect(shop.locator('h1 [data-lingua-lens-translation] .text')).toHaveText('Welcome to the shop');
  await expect(shop.frameLocator('iframe').locator('p [data-lingua-lens-translation] .text')).toHaveText('Frame content');
  await shop.evaluate(() => {
    const paragraph = document.createElement('p'); paragraph.id = 'reading-example';
    paragraph.innerHTML = 'To jest <strong>dobry</strong> <a href="#details">produkt</a>.';
    document.body.append(paragraph);
    paragraph.querySelector('a')!.addEventListener('click', event => { event.preventDefault(); paragraph.dataset.clicked = 'yes'; });
  });
  const paragraph = shop.locator('#reading-example');
  await expect(paragraph.locator('[data-lingua-lens-translation] .text')).toHaveText('English: To jest dobry produkt.');
  expect(await paragraph.evaluate(element => element.textContent)).toBe('To jest dobry produkt.');
  await paragraph.getByRole('link', { name: 'produkt', exact: true }).click();
  await expect(paragraph).toHaveAttribute('data-clicked', 'yes');
  await shop.evaluate(() => { document.querySelector('#reading-example strong')!.firstChild!.textContent = 'świetny'; });
  await expect(paragraph.locator('[data-lingua-lens-translation] .text')).toHaveText('English: To jest świetny produkt.');
  await shop.locator('#open').click();
  await expect(shop.locator('dialog p [data-lingua-lens-translation] .text')).toHaveText('Delivery tomorrow');
  await shop.locator('#close').click();
  await shop.screenshot({ path: 'work/bilingual-preview.png', fullPage: true });
  const state = await control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type: 'state', tabId });
  expect(state.data.readingMode).toBe('bilingual'); expect(state.data.defaultReadingMode).toBe('translated');
  await popup.locator('#auto').check();
  await expect(popup.locator('#auto')).toBeEnabled();
  await shop.reload();
  await expect(shop.locator('h1 [data-lingua-lens-translation] .text')).toHaveText('Welcome to the shop');
  await popup.getByRole('button', { name: 'Use default settings on this site' }).click();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await expect(shop.locator('[data-lingua-lens-translation]')).toHaveCount(0);
  await popup.close();
});

test('original reveal shows source text for page and frame selections without replacing the live translation', async () => {
  await command('toggle', true);
  const popup = await context.newPage(); await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await shop.locator('h1').selectText();
  await popup.getByRole('button', { name: 'Reveal original selection', exact: true }).click();
  const panel = shop.getByRole('dialog', { name: 'Selected text translation', exact: true });
  await expect(panel.getByText('Witaj w sklepie', { exact: true })).toBeVisible();
  await expect(panel.locator('#selection-result')).toHaveText('Welcome to the shop');
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  await shop.getByRole('button', { name: 'Close translation' }).click();
  await shop.evaluate(() => window.getSelection()?.removeAllRanges());
  await shop.frameLocator('iframe').locator('p').selectText();
  await popup.getByRole('button', { name: 'Reveal original selection', exact: true }).click();
  const framePanel = shop.frameLocator('iframe').getByRole('dialog', { name: 'Selected text translation', exact: true });
  await expect(framePanel.getByText('Treść ramki', { exact: true })).toBeVisible();
  await expect(framePanel.locator('#selection-result')).toHaveText('Frame content');
  await framePanel.getByRole('button', { name: 'Close translation' }).click();
  const shortcuts = await worker.evaluate(() => chrome.commands.getAll());
  expect(shortcuts.find(command => command.name === 'reveal-original')?.shortcut).toBe('Alt+Shift+O');
  await popup.close();
});
