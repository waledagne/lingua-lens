import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

interface BrowserOptions {
  root?: string;
  sourceExecutable?: string;
  override?: string;
  platform?: NodeJS.Platform;
}

/** Keep the bundled browser intact; Windows launches from a copy inheriting workspace access. */
export async function prepareBrowser(options: BrowserOptions = {}): Promise<string> {
  const override = options.override ?? process.env.LINGUA_LENS_BROWSER;
  if (override) {
    const executable = path.resolve(override);
    await access(executable);
    return executable;
  }
  const executable = options.sourceExecutable ?? chromium.executablePath();
  try { await access(executable); }
  catch { throw new Error('The Playwright browser is missing. Run "npx playwright install chromium", then retry.'); }
  if ((options.platform ?? process.platform) !== 'win32') return executable;

  const source = path.dirname(executable);
  const manifests = (await readdir(source)).filter(name => /^\d+\.\d+\.\d+\.\d+\.manifest$/u.test(name));
  if (!manifests.length) throw new Error('The bundled Chrome version manifest is missing. Run "npx playwright install --force chromium" to repair the download.');
  const requiredFiles = [path.basename(executable), 'chrome_elf.dll', 'chrome.dll', ...manifests];
  for (const name of requiredFiles) await access(path.join(source, name));
  const executableInfo = await stat(executable);
  const hash = createHash('sha256')
    .update(path.resolve(executable)).update(String(executableInfo.size)).update(String(executableInfo.mtimeMs))
    .update(await readFile(executable));
  for (const name of manifests) hash.update(await readFile(path.join(source, name)));
  const fingerprint = hash.digest('hex').slice(0, 16);
  const cacheRoot = path.resolve(options.root ?? path.join('work', 'playwright-browser'));
  const destination = path.join(cacheRoot, fingerprint);
  const localExecutable = path.join(destination, path.basename(executable));
  const marker = path.join(destination, '.lingua-lens-browser.json');
  try {
    const ready = JSON.parse(await readFile(marker, 'utf8')) as { source: string; fingerprint: string };
    if (ready.source === executable && ready.fingerprint === fingerprint) {
      // The side-by-side assembly files must accompany the executable.
      for (const name of requiredFiles) await access(path.join(destination, name));
      return localExecutable;
    }
  } catch { /* First preparation or an interrupted/incomplete copy. */ }

  await mkdir(cacheRoot, { recursive: true });
  const relative = path.relative(cacheRoot, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid local browser cache path.');
  // Copy the entire official distribution, including version manifest and DLLs.
  // No browser files, registry settings, or permissions outside work/ are changed.
  console.log('Preparing a project-local Chrome for Testing runtime…');
  await cp(source, destination, { recursive: true, force: true });
  for (const name of requiredFiles) await access(path.join(destination, name));
  await writeFile(marker, JSON.stringify({ source: executable, fingerprint }, null, 2) + '\n');
  return localExecutable;
}
