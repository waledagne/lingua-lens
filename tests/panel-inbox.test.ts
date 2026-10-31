import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PanelInbox } from '../src/panel-inbox.ts';
import { readSettings, storedSettings } from '../src/settings.ts';

test('selection inbox is one-shot, window-scoped, replaceable, and expires after a minute', () => {
  const inbox = new PanelInbox(), value = { id: 'a', text: 'private selection' };
  inbox.put(1, value, 100); assert.equal(inbox.take(2, 100), null);
  assert.deepEqual(inbox.take(1, 200), value); assert.equal(inbox.take(1, 200), null);
  inbox.put(1, value, 100); assert.equal(inbox.take(1, 60101), null);
  inbox.put(1, value); inbox.clear(1); assert.equal(inbox.take(1), null);
  inbox.put(1, value); inbox.put(1, { id: 'b', text: 'new' }); assert.equal(inbox.take(1)?.id, 'b');
});
test('migration leaves panel defaults derived until selected and validates stored panel languages', () => {
  const old = { schemaVersion: 5, pair: { sourceLanguage: 'fr', targetLanguage: 'de' }, preparedPairs: ['fr:de'], readingMode: 'bilingual' };
  const migrated = readSettings(old);
  assert.deepEqual(migrated.pair, old.pair); assert.equal(migrated.readingMode, 'bilingual');
  assert.equal('panelPair' in storedSettings(migrated), false);
  const panelPair = { sourceLanguage: 'auto', targetLanguage: 'ja' };
  assert.deepEqual(readSettings({ ...old, panelPair }).panelPair, panelPair);
  assert.equal(readSettings({ ...old, panelPair: { sourceLanguage: 'zz', targetLanguage: 'de' } }).panelPair, undefined);
});
