import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { collectSourceContext } from '../src/source-context.ts';
import { detectSource, normalizeLanguage, SourceDetector, validateContext } from '../src/source-detector.ts';
import type { LocalLanguageDetector } from '../src/translator-api.ts';

const sample = 'Bonjour et bienvenue sur notre site. Voici les informations et les différentes options disponibles pour votre visite.';
const detector = (results: { detectedLanguage: string; confidence: number }[]): LocalLanguageDetector => ({ detect: async () => results, destroy() {} });
test('confident page detection wins over incorrect markup and normalizes regional codes', async () => {
  assert.equal(await detectSource(detector([{ detectedLanguage: 'fr-CA', confidence: 0.98 }]), { sample, pageLanguage: 'en' }), 'fr');
  assert.equal(normalizeLanguage('zh-Hans-CN'), 'zh'); assert.equal(normalizeLanguage('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLanguage('zh-Hant-HK'), 'zh-Hant'); assert.equal(normalizeLanguage('pt_BR'), 'pt');
  assert.equal(normalizeLanguage('nb-NO'), 'no'); assert.equal(normalizeLanguage('und'), null);
});
test('short or ambiguous content uses a valid page language and otherwise asks for a manual source', async () => {
  const uncertain = detector([{ detectedLanguage: 'fr', confidence: 0.52 }, { detectedLanguage: 'en', confidence: 0.48 }]);
  assert.equal(await detectSource(uncertain, { sample: 'Koszyk', pageLanguage: 'pl-PL' }), 'pl');
  assert.equal(await detectSource(uncertain, { sample, pageLanguage: 'fr' }), 'fr');
  await assert.rejects(detectSource(uncertain, { sample, pageLanguage: '' }), /confidently/);
  await assert.rejects(detectSource(detector([{ detectedLanguage: 'fr', confidence: 0.99 }]), { sample: 'Bonjour', pageLanguage: '' }), /not enough text/);
  await assert.rejects(detectSource(detector([{ detectedLanguage: 'am', confidence: 0.99 }]), { sample, pageLanguage: '' }), /not supported/);
});
test('ignores invalid confidences and validates source-context bounds', async () => {
  assert.equal(await detectSource(detector([{ detectedLanguage: 'en', confidence: NaN }, { detectedLanguage: 'fr', confidence: 0.99 }]), { sample, pageLanguage: '' }), 'fr');
  for (const value of [null, {}, { sample: 'a'.repeat(6001), pageLanguage: '' }, { sample, pageLanguage: 'x'.repeat(101) }]) assert.throws(() => validateContext(value));
});
test('local detector is shared and successful page detections are cached', async () => {
  let created = 0, detected = 0, available = false;
  const source = new SourceDetector(() => ({
    availability: async () => available ? 'available' : 'downloadable',
    create: async () => { created++; return { detect: async () => { detected++; return [{ detectedLanguage: 'fr', confidence: 0.99 }]; }, destroy() {} }; },
  }));
  await assert.rejects(source.detect({ sample, pageLanguage: '' }), /setup/);
  available = true;
  assert.equal(await source.detect({ sample, pageLanguage: '' }), 'fr');
  assert.equal(await source.detect({ sample, pageLanguage: '' }), 'fr');
  assert.equal(created, 1); assert.equal(detected, 1);
});
test('page samples exclude editable content and are safe to serialize into Chrome scripting', async () => {
  const window = new Window({ url: 'https://example.com' });
  try {
    const document = window.document as unknown as Document;
    document.documentElement.lang = 'fr';
    document.body.innerHTML = '<h1>Bonjour</h1><p>' + sample + '</p><textarea>Private draft</textarea><input value="secret"><div contenteditable="true">Private message</div><script>privateCode</script><div hidden>Hidden text</div>';
    const context = collectSourceContext(document);
    assert.equal(context.pageLanguage, 'fr'); assert.ok(context.sample.includes(sample));
    assert.doesNotMatch(context.sample, /Private|secret|privateCode|Hidden/);
    assert.deepEqual(JSON.parse(JSON.stringify(runInNewContext('(' + collectSourceContext.toString() + ')()', { document }))), context);
    document.body.append('x'.repeat(10000)); assert.ok(collectSourceContext(document).sample.length <= 6000);
  } finally { await window.happyDOM.close(); }
});
