import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BatchPacer } from '../src/batch-pacer.ts';
import { MAX_BATCH } from '../src/shared.ts';

test('batch pacing starts small, shrinks for slow models, and fills cached requests', () => {
  const pacer = new BatchPacer(); assert.ok(pacer.limit < MAX_BATCH);
  pacer.complete(pacer.limit, 1000); assert.equal(pacer.limit, 1);
  pacer.complete(4, 1); assert.equal(pacer.limit, MAX_BATCH);
  pacer.complete(32, Infinity); assert.equal(pacer.limit, MAX_BATCH);
  pacer.complete(0, 0); assert.equal(pacer.limit, MAX_BATCH);
  pacer.reset(); assert.ok(pacer.limit < MAX_BATCH);
});
