import path from 'node:path';
import { chromium } from '@playwright/test';
import { prepareBrowser } from './browser-runtime.ts';

const executable = await prepareBrowser();
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', executablePath: executable, headless: true,
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/setup.html');
  const models = await page.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      LanguageDetector?: { availability(): Promise<string> };
      Translator?: { availability(pair: { sourceLanguage: string; targetLanguage: string }): Promise<string> };
    };
    return {
      languageDetector: scope.LanguageDetector ? await scope.LanguageDetector.availability() : 'API missing',
      polishToEnglish: scope.Translator ? await scope.Translator.availability({ sourceLanguage: 'pl', targetLanguage: 'en' }) : 'API missing',
    };
  });
  console.log(JSON.stringify({ browser: context.browser()?.version(), extensionLoaded: true, nativeModels: models }, null, 2));
} finally { await context.close(); }
