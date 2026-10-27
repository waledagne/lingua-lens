import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PAIR, LANGUAGES, isWebsite, originPattern, pairKey, parsePair, siteKey, siteOrigins } from '../src/shared.ts';
import { readSettings, storedSettings } from '../src/settings.ts';
import { chunks } from '../src/segment.ts';

test('validates language pairs and rejects identity/unknown pairs', () => {
  assert.deepEqual(parsePair({ sourceLanguage: 'ja', targetLanguage: 'fr' }), { sourceLanguage: 'ja', targetLanguage: 'fr' });
  assert.deepEqual(parsePair({ sourceLanguage: 'auto', targetLanguage: 'fr' }), { sourceLanguage: 'auto', targetLanguage: 'fr' });
  assert.throws(() => parsePair({ sourceLanguage: 'en', targetLanguage: 'auto' }));
  assert.throws(() => parsePair({ sourceLanguage: 'en', targetLanguage: 'en' }), /different/);
  for (const value of [null, {}, 'en', { sourceLanguage: 'xx', targetLanguage: 'en' }]) assert.throws(() => parsePair(value));
  assert.equal(new Set(LANGUAGES.map(([code]) => code)).size, LANGUAGES.length);
});
test('new installations have no preselected site and readiness is specific to a pair', () => {
  const defaults = readSettings({});
  assert.deepEqual(defaults.autoSites, []); assert.equal(defaults.ready, false);
  const saved = storedSettings({ ...defaults, preparedPairs: ['pl:en'], pair: { sourceLanguage: 'de', targetLanguage: 'en' } });
  assert.equal(readSettings(saved).ready, false);
  assert.equal(readSettings({ ...saved, pair: { sourceLanguage: 'pl', targetLanguage: 'en' } }).ready, true);
  assert.equal(readSettings({ ...saved, pair: DEFAULT_PAIR }).ready, false);
  assert.equal(readSettings({ ...saved, pair: DEFAULT_PAIR, detectorReady: true }).ready, true);
});
test('migrates previous setup without inventing a remembered website', () => {
  const config = readSettings({ ready: true });
  assert.deepEqual(config.preparedPairs, ['pl:en']);
  assert.deepEqual(config.autoSites, []);
  assert.equal(config.ready, false);
  assert.deepEqual(readSettings({ schemaVersion: 2, pair: { sourceLanguage: 'de', targetLanguage: 'fr' }, preparedPairs: ['de:fr'] }).pair, { sourceLanguage: 'auto', targetLanguage: 'fr' });
  assert.deepEqual(readSettings({ autoSites: ['news.example.com'] }).autoSites, ['news.example.com']);
  assert.equal(readSettings({ schemaVersion: 2, ready: true }).ready, false);
});
test('filters invalid persisted settings and keeps exact hostnames without special cases', () => {
  const config = readSettings({ pair: { sourceLanguage: 'en', targetLanguage: 'en' }, preparedPairs: ['en:en', 'bad', 'fr:ja', 'fr:ja'], autoSites: ['example.com', 'example.com', '*.example.com', 'evil.com/path', 'user@evil.com', 'evil.com:80', null] });
  assert.deepEqual(config.pair, DEFAULT_PAIR);
  assert.deepEqual(config.preparedPairs, ['fr:ja']);
  assert.deepEqual(config.autoSites, ['example.com']);
  for (const host of ['www.allegro.pl', 'allegro.pl', 'news.example.com', 'localhost']) assert.equal(siteKey('https://' + host + '/path'), host);
  assert.equal(originPattern('https://example.com/page'), '*://example.com/*');
  assert.deepEqual(siteOrigins('www.example.com'), ['http://www.example.com/*', 'https://www.example.com/*']);
  assert.deepEqual(siteOrigins('localhost'), ['http://localhost/*', 'https://localhost/*']);
  for (const host of ['*', '*.example.com', 'user@example.com', 'example.com/path', 'example.com:8080', '']) assert.throws(() => siteOrigins(host));
  for (const url of ['chrome://extensions', 'file:///test.html', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x']) { assert.equal(isWebsite(url), false); assert.throws(() => originPattern(url)); }
});
test('segments several source languages without losing Unicode or whitespace', () => {
  for (const [locale, text] of [['ja', 'こんにちは。次のページです。'.repeat(300)], ['ar', 'مرحبًا. كيف حالك؟ '.repeat(300)], ['fr', 'Bonjour. Comment allez-vous ? '.repeat(300)]]) {
    const result = chunks(text, 100, locale);
    assert.equal(result.join(''), text); assert.ok(result.every(part => part.length <= 101));
  }
});
