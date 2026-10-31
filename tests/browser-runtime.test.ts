import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, mkdtemp, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareBrowser } from '../scripts/browser-runtime.ts';

test('Windows browser preparation keeps the source intact, reuses its copy, and repairs missing assemblies', async () => {
  await mkdir('work', { recursive: true });
  const fixture = await mkdtemp(path.resolve('work', 'browser-runtime-test-'));
  const source = path.join(fixture, 'download');
  const root = path.join(fixture, 'cache');
  await mkdir(source);
  const files = { 'chrome.exe': 'test-executable', 'chrome_elf.dll': 'test-assembly', 'chrome.dll': 'test-browser', '156.0.0.0.manifest': '<assembly />' };
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(source, name), content);
  const executable = path.join(source, 'chrome.exe');
  const options = { root, sourceExecutable: executable, platform: 'win32' as const, override: '' };
  const first = await prepareBrowser(options);
  assert.notEqual(first, executable);
  assert.ok(!path.relative(root, first).startsWith('..'));
  for (const [name, content] of Object.entries(files)) {
    assert.equal(await readFile(path.join(path.dirname(first), name), 'utf8'), content);
    assert.equal(await readFile(path.join(source, name), 'utf8'), content);
  }
  const oldTime = new Date('2020-01-01T00:00:00Z');
  await utimes(first, oldTime, oldTime);
  assert.equal(await prepareBrowser(options), first);
  assert.equal((await stat(first)).mtimeMs, oldTime.getTime(), 'Do not recopy an already prepared runtime');

  const manifest = path.join(path.dirname(first), '156.0.0.0.manifest');
  await unlink(manifest);
  assert.equal(await prepareBrowser(options), first);
  assert.equal(await readFile(manifest, 'utf8'), files['156.0.0.0.manifest']);

  await writeFile(executable, 'new-test-executable');
  const updated = await prepareBrowser(options);
  assert.notEqual(updated, first, 'Do not replace a runtime potentially in use by an older test run');
  assert.equal(await readFile(first, 'utf8'), files['chrome.exe']);

  const unusedRoot = path.join(fixture, 'unused-cache');
  assert.equal(await prepareBrowser({ ...options, root: unusedRoot, override: executable }), executable);
  assert.equal(await prepareBrowser({ ...options, root: unusedRoot, platform: 'linux' }), executable);
  await assert.rejects(access(unusedRoot), { code: 'ENOENT' });
});
