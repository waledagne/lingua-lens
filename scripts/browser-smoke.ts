import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { nativeBrowser } from './native-browser.ts';

// Production extension and real models, in an isolated profile. Never alters personal Chrome.
const timeoutArgument = process.argv.find(value => value.startsWith('--timeout-ms='))?.split('=')[1];
const timeout = timeoutArgument === undefined ? 150000 : Number(timeoutArgument);
if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000) throw new Error('Use --timeout-ms=1000 through 900000.');
const reportPath = path.resolve('work/native-verification.json');
const results: Record<string, unknown>[] = [];
const context = await nativeBrowser(path.resolve('work/native-model-profile'));
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
let page: Page | undefined;
async function setup(): Promise<Page> {
  await page?.close(); page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/setup.html');
  await page.locator('#source-language:not([disabled])').waitFor();
  await page.bringToFront(); await page.waitForFunction(() => document.visibilityState === 'visible');
  return page;
}
async function attempt(name: string, operation: (page: Page) => Promise<Record<string, unknown>>): Promise<void> {
  const started = Date.now(), current = await setup();
  let lastStatus = '';
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const progress = setInterval(() => {
    void current.locator('#setup-status').innerText({ timeout: 2000 }).then(value => {
      if (value !== lastStatus) { lastStatus = value; console.log(name + ': ' + value); }
    }).catch(() => {});
  }, 10000);
  try {
    const result = await Promise.race([operation(current), new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Native verification deadline exceeded.')), timeout + 10000); })]);
    results.push({ name, status: 'passed', ...result, elapsedMs: Date.now() - started });
  }
  catch (cause) {
    process.exitCode = 1;
    const status = await current.locator('#setup-status').innerText().catch(() => 'Page closed');
    results.push({ name, status: 'failed', error: String(cause), setupStatus: status, elapsedMs: Date.now() - started });
    if (await current.locator('#cancel-setup').isVisible()) await current.locator('#cancel-setup').click();
  } finally { clearInterval(progress); clearTimeout(deadline); }
  console.log(JSON.stringify(results.at(-1)));
}
try {
  await worker.evaluate(() => chrome.storage.local.clear());
  if (!process.argv.includes('--translation-only')) await attempt('detector', async current => {
    await current.locator('#prepare:not([disabled])').waitFor(); await current.locator('#prepare').click();
    await current.waitForFunction(() => document.getElementById('detected-language')!.textContent?.includes('Practice sample') || !document.getElementById('setup-error')!.hidden, undefined, { timeout });
    if (await current.locator('#setup-error').isVisible()) throw new Error(await current.locator('#setup-error').innerText());
    // The practice-sample plan does not call detect(); verify actual inference too.
    const detected = await current.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { LanguageDetector: { create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>; destroy(): void }> } }).LanguageDetector;
      const detector = await api.create();
      try { return (await detector.detect('Bonjour et bienvenue. Voici toutes les informations pour préparer votre prochaine visite.'))[0]; }
      finally { detector.destroy(); }
    });
    if (detected?.detectedLanguage !== 'fr') throw new Error('Expected French detection: ' + JSON.stringify(detected));
    return { detected };
  });
  for (const [source, target] of [['pl', 'en'], ['es', 'fr']]) await attempt(source + ':' + target, async current => {
    await current.getByLabel('Source language', { exact: true }).selectOption(source);
    await current.getByLabel('Target language', { exact: true }).selectOption(target);
    const apply = current.getByRole('button', { name: 'Apply languages' });
    if (await apply.isEnabled()) await apply.click(); else await current.getByRole('button', { name: 'Check compatibility again' }).click();
    await current.waitForFunction(() => !(document.getElementById('prepare') as HTMLButtonElement).disabled || !document.getElementById('setup-error')!.hidden);
    if (await current.locator('#setup-error').isVisible()) throw new Error(await current.locator('#setup-error').innerText());
    await current.locator('#prepare').click();
    await current.waitForFunction(() => !document.getElementById('sample')!.hidden || !document.getElementById('setup-error')!.hidden, undefined, { timeout });
    if (await current.locator('#setup-error').isVisible()) throw new Error(await current.locator('#setup-error').innerText());
    const original = await current.locator('#sample-source').innerText(), translated = await current.locator('#sample-result').innerText();
    if (!translated.trim() || translated === original) throw new Error('Expected a nonempty changed translation for this practice sample.');
    return { original, translated };
  });
  await page?.screenshot({ path: 'work/native-smoke-preview.png', fullPage: true });
  const cdp = await context.newCDPSession(page!);
  const histograms = (await cdp.send('Browser.getHistograms', { query: 'TranslateKit' })).histograms;
  const report = { checkedAt: new Date().toISOString(), browser: context.browser()?.version(), extensionVersion: await worker.evaluate(() => chrome.runtime.getManifest().version), realModels: true, timeoutMs: timeout, results, componentMetrics: histograms };
  await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log('Native verification report: ' + reportPath);
} finally { await context.close(); }
