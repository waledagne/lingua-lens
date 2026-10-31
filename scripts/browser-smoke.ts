import path from 'node:path';
import { nativeBrowser } from './native-browser.ts';

// Uses production code and real Chrome models. Model downloads require internet and disk space.
const context = await nativeBrowser(path.resolve('work/native-model-profile'));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  // Reset only this isolated profile's extension preferences, retaining Chrome's model downloads.
  await worker.evaluate(() => chrome.storage.local.clear());
  const page = await context.newPage();
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/setup.html');
  const results: Record<string, unknown>[] = [];
  await page.locator('#source-language:not([disabled])').waitFor();
  const detector = await page.evaluate(async () => {
    const scope = globalThis as typeof globalThis & { LanguageDetector?: { availability(): Promise<string> } };
    return scope.LanguageDetector ? scope.LanguageDetector.availability() : 'API missing';
  });
  console.log('Native Language Detector: ' + detector);
  console.log('Smoke mode: ' + (process.argv.includes('--translation-only') ? 'translation only' : 'detection and translation'));
  if (!process.argv.includes('--translation-only') && (detector === 'unavailable' || detector === 'API missing')) process.exitCode = 1;
  else if (!process.argv.includes('--translation-only')) {
    await page.locator('#prepare:not([disabled])').waitFor();
    if ((await page.locator('#prepare').textContent())?.includes('automatic detection')) await page.locator('#prepare').click();
    try {
      await page.waitForFunction(() => document.getElementById('detected-language')!.textContent?.includes('Practice sample') || !document.getElementById('setup-error')!.hidden, undefined, { timeout: 90000 });
      if (await page.locator('#setup-error').isVisible()) throw new Error(await page.locator('#setup-error').innerText());
      console.log('Native detector prepared successfully.');
    } catch (error) {
      console.log(String(error)); process.exitCode = 1;
      if (await page.locator('#cancel-setup').isVisible()) await page.locator('#cancel-setup').click();
      if (await page.locator('#source-language').isDisabled()) await page.reload();
    }
  }
  for (const [source, target] of [['pl', 'en'], ['es', 'fr']]) {
    try {
      await page.getByLabel('Source language', { exact: true }).selectOption(source);
      await page.getByLabel('Target language', { exact: true }).selectOption(target);
      const apply = page.getByRole('button', { name: 'Apply languages' });
      if (await apply.isEnabled()) await apply.click();
      else await page.getByRole('button', { name: 'Check compatibility again' }).click();
      await page.waitForFunction(() => !(document.getElementById('prepare') as HTMLButtonElement).disabled || !document.getElementById('setup-error')!.hidden);
      if (await page.locator('#setup-error').isVisible()) throw new Error(await page.locator('#setup-error').innerText());
      console.log('Preparing native ' + source + ' → ' + target + '…');
      await page.locator('#prepare').click();
      await page.waitForFunction(() => !document.getElementById('sample')!.hidden || !document.getElementById('setup-error')!.hidden, undefined, { timeout: 90000 });
      if (await page.locator('#setup-error').isVisible()) throw new Error(await page.locator('#setup-error').innerText());
      results.push({ source, target, original: await page.locator('#sample-source').innerText(), translated: await page.locator('#sample-result').innerText() });
    } catch (error) {
      results.push({ source, target, error: String(error), status: await page.locator('#setup-status').innerText() });
      process.exitCode = 1;
      // A native download still running cannot safely share this setup tab with another pair.
      if (await page.locator('#source-language').isDisabled()) break;
    }
  }
  await page.screenshot({ path: 'work/native-smoke-preview.png', fullPage: true });
  console.log(JSON.stringify({ browser: context.browser()?.version(), detector, translations: results }, null, 2));
} finally { await context.close(); }
