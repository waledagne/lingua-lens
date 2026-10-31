import path from 'node:path';
import { chromium } from '@playwright/test';
import { prepareBrowser } from './browser-runtime.ts';

/** Keep Playwright's unrelated defaults, but allow Chrome's native model services. */
export async function nativeBrowser(profile = '') {
  const executablePath = await prepareBrowser();
  const probe = await chromium.launchPersistentContext('', { executablePath, channel: 'chromium', headless: true, args: ['--enable-automation'] });
  let disabledFeatures: string | undefined;
  try {
    const page = probe.pages()[0] ?? await probe.newPage();
    const session = await probe.newCDPSession(page);
    const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
    disabledFeatures = args.find(argument => argument.startsWith('--disable-features='));
  } finally { await probe.close(); }
  const extension = path.resolve('dist');
  return chromium.launchPersistentContext(profile, {
    executablePath, channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-component-update', '--disable-background-networking', '--disable-component-extensions-with-background-pages', ...(disabledFeatures ? [disabledFeatures] : [])],
    args: [
      ...(disabledFeatures ? ['--disable-features=' + disabledFeatures.slice('--disable-features='.length).split(',').filter(feature => feature !== 'Translate' && feature !== 'OptimizationHints').join(',')] : []),
      '--disable-extensions-except=' + extension, '--load-extension=' + extension,
    ],
  });
}
