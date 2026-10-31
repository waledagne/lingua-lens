import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnostics } from '../src/diagnostics.ts';
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome test browser', platform: 'Win32' } });

test('diagnostics report native availability without page text, hostnames, or full preferences', async () => {
  Object.assign(globalThis, { chrome: { runtime: { getManifest: () => ({ version: '0.8.0' }) } },
    LanguageDetector: { availability: async () => 'available' }, Translator: { availability: async () => 'downloadable' } });
  const stored = { detectorReady: true, preparedPairs: ['pl:en'], autoSites: ['private-site.test'], sample: 'private passage' };
  const report = await diagnostics({ sourceLanguage: 'pl', targetLanguage: 'en' }, stored);
  assert.doesNotMatch(report, /private-site|private passage|autoSites|sample/);
  const data = JSON.parse(report); assert.equal(data.version, '0.8.0'); assert.equal(data.nativeModels.translator, 'downloadable'); assert.equal(data.prepared.selectedPair, true);
});
test('diagnostics remain available for missing APIs and stalled compatibility checks', async () => {
  Object.assign(globalThis, { chrome: { runtime: { getManifest: () => ({ version: '0.8.0' }) } },
    LanguageDetector: undefined, Translator: { availability: async () => new Promise(() => {}) } });
  const report = JSON.parse(await diagnostics({ sourceLanguage: 'fr', targetLanguage: 'en' }, { detectorReady: false, preparedPairs: [] }, 15));
  assert.match(report.nativeModels.detector, /unavailable/); assert.match(report.nativeModels.translator, /stopped responding/);
  const automatic = JSON.parse(await diagnostics({ sourceLanguage: 'auto', targetLanguage: 'en' }, { detectorReady: false, preparedPairs: [] }, 15));
  assert.match(automatic.nativeModels.translator, /manual source/);
});
