import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassageEngine, validatePassages } from '../src/passage-engine.ts';
import { MAX_PASSAGE_CONTEXT, pairKey, type SourceContext } from '../src/shared.ts';
import { ModelTimeoutError } from '../src/model-task.ts';

const context = (pageLanguage: string, sample = 'A passage for language detection.'): SourceContext => ({ sample, pageLanguage });
test('one detector timeout stops repeated native waits within a batch and retains already detected groups', async () => {
  let calls = 0, failed = true;
  const engine = new PassageEngine(async context => {
    calls++; if (failed && context.pageLanguage === 'es') throw new ModelTimeoutError(); return context.pageLanguage;
  }, async texts => texts.map(text => 'Translated: ' + text));
  const contexts = ['fr', 'es', 'de', 'pl'].map(code => context(code));
  const result = await engine.run(['Bonjour', 'Hola', 'Hallo', 'Witaj'], contexts, 'en', []);
  assert.equal(calls, 2); assert.equal(result.translations[0], 'Translated: Bonjour');
  assert.ok(result.issues.slice(1).every(issue => issue?.message.includes('stopped responding')));
  failed = false; const retry = await engine.run(['Hola'], [context('es')], 'en', []);
  assert.equal(retry.translations[0], 'Translated: Hola'); assert.equal(calls, 3);
});

test('passages route by source, deduplicate detection context, and skip understood and target languages', async () => {
  let detections = 0;
  const calls: string[] = [];
  const engine = new PassageEngine(async context => { detections++; return context.pageLanguage; }, async (texts, pair) => {
    calls.push(pairKey(pair)); return texts.map(text => pairKey(pair) + ':' + text);
  });
  const result = await engine.run(['Bonjour', 'Hola', 'Hello', 'Hallo', 'Bonjour'], ['fr', 'es', 'en', 'de', 'fr'].map(code => context(code)), 'en', ['de']);
  assert.deepEqual(result.translations, ['fr:en:Bonjour', 'es:en:Hola', 'Hello', 'Hallo', 'fr:en:Bonjour']);
  assert.deepEqual(result.sources, ['fr', 'es', 'en', 'de', 'fr']);
  assert.deepEqual(result.issues, [null, null, null, null, null]);
  assert.equal(detections, 4); assert.deepEqual(calls, ['fr:en', 'es:en']);
});

test('missing packs and uncertain passages preserve originals while other sources finish, and retry recovers', async () => {
  let ready = false;
  const engine = new PassageEngine(async context => {
    if (!context.pageLanguage) throw new Error('Choose a source manually.');
    return context.pageLanguage;
  }, async (texts, pair) => {
    if (pair.sourceLanguage === 'fr' && !ready) throw new Error('Prepare French → English first.');
    return texts.map(text => pair.sourceLanguage + ':' + text);
  });
  const texts = ['Bonjour', 'Witaj', 'Ambiguous'];
  const contexts = [context('fr'), context('pl'), context('')];
  const first = await engine.run(texts, contexts, 'en', []);
  assert.deepEqual(first.translations, ['Bonjour', 'pl:Witaj', 'Ambiguous']);
  assert.equal(first.issues[0]?.sourceLanguage, 'fr'); assert.equal(first.issues[1], null);
  assert.equal(first.issues[2]?.sourceLanguage, null);
  ready = true;
  const next = await engine.run(texts, contexts, 'en', []);
  assert.equal(next.translations[0], 'fr:Bonjour'); assert.equal(next.issues[0], null);
});

test('identical labels in different languages retain their source-specific output and order', async () => {
  const engine = new PassageEngine(async context => context.pageLanguage, async (texts, pair) => texts.map(text => pairKey(pair) + ':' + text));
  const result = await engine.run(['Menu', 'Menu', 'Menu'], [context('fr'), context('pl'), context('en')], 'en', []);
  assert.deepEqual(result.translations, ['fr:en:Menu', 'pl:en:Menu', 'Menu']);
});

test('an incomplete language group is reported without applying partial output', async () => {
  const engine = new PassageEngine(async context => context.pageLanguage, async () => ['Only one result']);
  const result = await engine.run(['Bonjour', 'Merci'], [context('fr'), context('fr')], 'en', []);
  assert.deepEqual(result.translations, ['Bonjour', 'Merci']);
  assert.ok(result.issues.every(issue => issue?.sourceLanguage === 'fr'));
});

test('passage IPC validation bounds batch size, text, context, and alignment', () => {
  assert.deepEqual(validatePassages(['Witaj'], [context('pl')]), { texts: ['Witaj'], contexts: [context('pl')] });
  for (const [texts, contexts] of [
    [[], []], [['Witaj'], []], [Array(33).fill('Witaj'), Array(33).fill(context('pl'))],
    [['x'.repeat(12001)], [context('pl')]], [Array(3).fill('x'.repeat(10000)), Array(3).fill(context('pl'))],
    [['Witaj'], [context('pl', 'x'.repeat(MAX_PASSAGE_CONTEXT + 1))]], [['Witaj'], [{ sample: 'Witaj', pageLanguage: 1 }]],
  ]) assert.throws(() => validatePassages(texts, contexts));
});
