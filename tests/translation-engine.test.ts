import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TranslationEngine } from '../src/translation-engine.ts';
import { pairKey, type LanguagePair } from '../src/shared.ts';
import type { TranslatorFactory } from '../src/translator-api.ts';

test('isolates cached output by source and target, deduplicates requests, and reuses sessions', async () => {
  const created: string[] = [], translated: string[] = [], segmented: string[] = [];
  const api: TranslatorFactory = {
    availability: async () => 'available',
    create: async pair => {
      const key = pairKey(pair); created.push(key);
      return { translate: async text => { translated.push(key); return key + ':' + text; }, destroy() {} };
    },
  };
  const engine = new TranslationEngine(() => api, async (texts, source) => { segmented.push(source); return texts.map(text => [text]); });
  const first = { sourceLanguage: 'en', targetLanguage: 'de' };
  assert.deepEqual(await engine.translate(['Hello', 'Hello'], first), ['en:de:Hello', 'en:de:Hello']);
  assert.deepEqual(await engine.translate(['Hello'], { ...first, targetLanguage: 'fr' }), ['en:fr:Hello']);
  assert.deepEqual(await engine.translate(['Hello'], { sourceLanguage: 'es', targetLanguage: 'fr' }), ['es:fr:Hello']);
  assert.deepEqual(await engine.translate(['Hello'], first), ['en:de:Hello']);
  assert.deepEqual(await engine.translate(['Other'], first), ['en:de:Other']);
  assert.deepEqual(created, ['en:de', 'en:fr', 'es:fr']);
  assert.equal(translated.length, 4);
  assert.deepEqual(segmented, ['en', 'en', 'es', 'en']);
});
test('snapshots pair settings, serializes concurrent requests, and recovers after a failure', async () => {
  let fail = true, active = 0, peak = 0;
  const engine = new TranslationEngine(() => ({
    availability: async () => 'available',
    create: async pair => ({
      translate: async text => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5)); active--;
        if (fail) { fail = false; throw new Error('Temporary failure'); }
        return pairKey(pair) + ':' + text;
      }, destroy() {},
    }),
  }), async texts => texts.map(text => [text]));
  await assert.rejects(engine.translate(['Hello'], { sourceLanguage: 'en', targetLanguage: 'fr' }), /Temporary/);
  const pair = { sourceLanguage: 'en', targetLanguage: 'de' };
  const first = engine.translate(['Hello'], pair); pair.targetLanguage = 'es';
  const second = engine.translate(['Other'], pair);
  assert.deepEqual(await first, ['en:de:Hello']); assert.deepEqual(await second, ['en:es:Other']);
  assert.equal(peak, 1);
});
test('reports an unprepared pair and bounds live translator sessions', async () => {
  let available = false, destroyed = 0;
  const engine = new TranslationEngine(() => ({
    availability: async () => available ? 'available' : 'downloadable',
    create: async () => ({ translate: async text => text, destroy() { destroyed++; } }),
  }), async texts => texts.map(text => [text]));
  const pair: LanguagePair = { sourceLanguage: 'en', targetLanguage: 'fr' };
  await assert.rejects(engine.translate(['Hello'], pair), /prepare English → French/);
  available = true;
  for (const targetLanguage of ['fr', 'de', 'es', 'ja']) await engine.translate(['Hello'], { ...pair, targetLanguage });
  assert.equal(destroyed, 1);
});
