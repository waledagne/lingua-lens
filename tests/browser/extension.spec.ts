import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Only the isolated test copy receives a deterministic Translator. dist/ always uses Chrome's real API.
const mock = `globalThis.Translator = {
  availability: async () => 'available',
  create: async () => ({
    translate: async text => {
      await new Promise(r => setTimeout(r, 8));
      const dictionary = {'Twój koszyk jest pusty.':'Your cart is empty.','Wybierz dostawę':'Choose delivery','Metoda dostawy':'Delivery method','Dostawa jutro':'Delivery tomorrow','Zamknij':'Close','Szukaj produktów':'Search products','Witaj w sklepie':'Welcome to the shop','Pomoc i kontakt':'Help and contact','Treść ramki':'Frame content','Liczba produktów: 1':'Number of products: 1'};
      return dictionary[text] || 'English: ' + text;
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
  const extension = path.resolve('work/browser-extension');
  await mkdir(extension, { recursive: true });
  await cp('dist', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
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
    executablePath: process.env.LINGUA_LENS_BROWSER || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1200, height: 900 },
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/setup.html`);
  await control.getByRole('button', { name: 'Enable & test translation' }).click();
  await expect(control.locator('#sample-result')).toHaveText('Your cart is empty.');
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
  await command('auto', true);
  await shop.reload();
  await expect(shop.locator('h1')).toHaveText('Welcome to the shop');
  // Open the popup in its own tab, then focus the website so activeTab lookup uses the website.
  const popup = await context.newPage();
  await shop.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#site')).toHaveText('127.0.0.1');
  await expect(popup.locator('#badge')).toHaveText('Live');
  await expect(popup.locator('#auto')).toBeChecked();
  await popup.locator('#toggle').click();
  await expect(shop.locator('h1')).toHaveText('Witaj w sklepie');
  await expect(popup.locator('#badge')).toHaveText('Paused');
  await popup.screenshot({ path: 'work/popup-preview.png' });
  await popup.close();
  await control.screenshot({ path: 'work/setup-preview.png', fullPage: true });
});
