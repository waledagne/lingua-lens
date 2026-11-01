import path from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { prepareBrowser } from './browser-runtime.ts';

// Tests live DOM integration, not translation quality. Mocks affect only this test copy.
const sites = [
  { url: 'https://www.amazon.pl/', source: 'pl' },
  { url: 'https://allegro.pl/', source: 'pl' },
  { url: 'https://pl.wikipedia.org/wiki/T%C5%82umaczenie', source: 'pl' },
  { url: 'https://developer.mozilla.org/fr/docs/Web/JavaScript', source: 'fr' },
  { url: 'https://es.wikipedia.org/wiki/Traducci%C3%B3n', source: 'es' },
  { url: 'https://www.firefox.com/pl/', source: 'pl' },
  { url: 'https://www.firefox.com/es-ES/', source: 'es' },
];
const hosts = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length).split(',');
const selectedSites = hosts ? sites.filter(site => hosts.includes(new URL(site.url).host)) : sites;
if (!selectedSites.length) throw new Error('--only must name a configured test hostname.');
const label = process.argv.find(value => value.startsWith('--label='))?.slice(8);
if (label && !/^[a-z0-9-]+$/u.test(label)) throw new Error('Use a simple --label=name.');
const latency = Number(process.argv.find(value => value.startsWith('--latency-ms='))?.split('=')[1] ?? 0);
if (!Number.isInteger(latency) || latency < 0 || latency > 1000) throw new Error('Use --latency-ms=0 through 1000.');
const sourceExtension = process.argv.find(value => value.startsWith('--extension='))?.slice('--extension='.length) ?? 'dist';
const extension = path.resolve('work/website-extension');
await mkdir(extension, { recursive: true }); await cp(sourceExtension, extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...new Set(sites.map(site => new URL(site.url).origin + '/*'))];
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const engine = path.join(extension, 'engine.js');
await writeFile(engine, `globalThis.Translator={availability:async()=>'available',create:async()=>({translate:async text=>{${latency ? `await new Promise(resolve=>setTimeout(resolve,${latency}));` : ''}return '[EN] '+text},destroy(){}})};\n` + await readFile(engine, 'utf8'));
const context = await chromium.launchPersistentContext('', {
  executablePath: await prepareBrowser(), channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
});
const results: Record<string, unknown>[] = [];
console.log('LIVE WEBSITE DOM CHECKS · SIMULATED TRANSLATOR · no quality claims');
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const control = await context.newPage(); await control.goto('chrome-extension://' + new URL(worker.url()).host + '/setup.html');
  for (const [index, site] of selectedSites.entries()) {
    const page = await context.newPage(), started = Date.now();
    try {
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      const title = await page.title();
      if ([403, 429].includes(response?.status() ?? 0) || /access denied|just a moment|captcha|robot|blocked|verify you are/iu.test(title)) {
        results.push({ ...site, status: 'blocked', httpStatus: response?.status(), title }); continue;
      }
      if (!response?.ok()) throw new Error('HTTP ' + response?.status());
      const heading = page.locator('h1,h2').filter({ visible: true }).first();
      await heading.waitFor({ timeout: 15000 }); const original = await heading.textContent();
      if (!original?.trim()) throw new Error('No readable heading for verification.');
      const tab = (await worker.evaluate(url => chrome.tabs.query({ url }), new URL(page.url()).origin + '/*')).find(tab => tab.url === page.url());
      if (tab?.id === undefined) throw new Error('Website tab could not be resolved.');
      const pair = { sourceLanguage: site.source, targetLanguage: 'en' };
      await worker.evaluate(async pair => { await chrome.storage.local.set({ schemaVersion: 6, pair, preparedPairs: [pair.sourceLanguage + ':en'], autoSites: [], sitePreferences: {}, readingMode: 'translated' }); }, pair);
      await page.bringToFront();
      await page.evaluate(() => {
        const timing = {
          started: performance.now(), firstVisibleMs: null as number | null, visibleReadyMs: null as number | null,
          tracked: 0, frame: 0, observer: new MutationObserver(() => {}),
          sample() {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
          let node: Node | null;
          while (nodes.length < 12 && (node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || !/\p{L}/u.test(node.textContent ?? '') || parent.closest('script,style,noscript,textarea,code,pre,kbd,samp,[contenteditable],[hidden],[aria-hidden="true"],[translate="no"],option:not([value])')) continue;
            const rect = parent.getBoundingClientRect();
            if (rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) nodes.push(node as Text);
          }
          return nodes;
          },
          measure() {
          timing.frame = 0;
          const visible = timing.sample(), translated = visible.filter(node => node.data.trim().startsWith('[EN]')).length;
          if (translated && timing.firstVisibleMs === null) timing.firstVisibleMs = performance.now() - timing.started;
          if (visible.length && translated === visible.length && timing.visibleReadyMs === null) timing.visibleReadyMs = performance.now() - timing.started;
          },
        };
        timing.tracked = timing.sample().length;
        timing.observer = new MutationObserver(() => { if (!timing.frame) timing.frame = requestAnimationFrame(() => timing.measure()); });
        timing.observer.observe(document.body, { subtree: true, characterData: true, childList: true });
        Object.assign(globalThis, { __linguaTiming: timing });
      });
      const request = async (type: 'toggle' | 'state', enabled = false) => control.evaluate(message => chrome.runtime.sendMessage(message), { target: 'background', type, tabId: tab.id!, enabled });
      const activated = await request('toggle', true); if (!activated.ok) throw new Error(activated.error);
      await heading.filter({ hasText: '[EN]' }).waitFor({ timeout: 30000 });
      let allQueuedMs: number | undefined;
      if (latency) {
        const translating = Date.now();
        while (Date.now() - translating < 60000) {
          const state = (await request('state')).data.status;
          if (state?.error) throw new Error(state.error);
          if (state?.pending === 0) { allQueuedMs = Date.now() - translating; break; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        await page.waitForFunction(() => (globalThis as typeof globalThis & { __linguaTiming: { firstVisibleMs: number | null } }).__linguaTiming.firstVisibleMs !== null, undefined, { timeout: 10000 });
      }
      let menuChecked = false;
      const menu = page.locator('#vector-main-menu-dropdown-checkbox').filter({ visible: true });
      if (await menu.count()) {
        await menu.check();
        if (!await menu.isChecked()) throw new Error('Website menu did not open.');
        await menu.uncheck(); menuChecked = true;
      }
      await page.evaluate(() => {
        const dialog = document.createElement('dialog'); dialog.id = 'lingua-test-dialog';
        const p = document.createElement('p'); p.textContent = 'Nowa treść do przetłumaczenia w oknie dialogowym.';
        const input = document.createElement('input'); input.value = 'Private editable draft';
        dialog.append(p, input); document.body.append(dialog); dialog.showModal();
      });
      await page.locator('#lingua-test-dialog p').filter({ hasText: '[EN]' }).waitFor({ timeout: 10000 });
      if (await page.locator('#lingua-test-dialog input').inputValue() !== 'Private editable draft') throw new Error('An editing field changed.');
      await page.evaluate(() => document.querySelector('#lingua-test-dialog')!.remove());
      const translatedItems = (await request('state')).data.status?.translated;
      const timing = await page.evaluate(() => {
        const value = (globalThis as typeof globalThis & { __linguaTiming: { firstVisibleMs: number | null; visibleReadyMs: number | null; tracked: number; frame: number; observer: MutationObserver } }).__linguaTiming;
        value.observer.disconnect(); cancelAnimationFrame(value.frame); return { firstVisibleMs: value.firstVisibleMs, visibleReadyMs: value.visibleReadyMs, tracked: value.tracked };
      });
      await request('toggle', false);
      if (await heading.textContent() !== original) throw new Error('Original heading was not restored.');
      await page.screenshot({ path: 'work/website-' + (label ? label + '-' : '') + index + '.png' });
      results.push({ ...site, status: 'passed', httpStatus: response.status(), title, translatedItems, elapsedMs: Date.now() - started, timing, allQueuedMs, checks: { headingTranslation: true, restoration: true, dynamicDialog: true, protectedInput: true, nativeMenu: menuChecked ? 'passed' : 'not exercised' } });
    } catch (cause) { results.push({ ...site, status: 'failed', error: String(cause), elapsedMs: Date.now() - started }); process.exitCode = 1; }
    finally { await page.close(); console.log(JSON.stringify(results.at(-1))); }
  }
  await writeFile('work/website-verification' + (label ? '-' + label : '') + '.json', JSON.stringify({ checkedAt: new Date().toISOString(), browser: context.browser()?.version(), modelMode: 'simulated: DOM integration only', modelLatencyMs: latency, results }, null, 2) + '\n');
  if (results.some(result => result.status === 'blocked')) process.exitCode ||= 2;
} finally { await context.close(); }
