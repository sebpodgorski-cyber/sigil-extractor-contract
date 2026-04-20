/**
 * Normalization + Store tests.
 *
 * End-to-end verification of the Extractor → Normalization → Store path.
 * This is the critical boundary of Layer A and its correctness matters
 * more than any individual module's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, signEvent } from '../src/normalization.js';
import { InMemoryStore } from '../src/store/memory.js';
import { InMemoryKeyProvider } from '../src/signing.js';
import type { ExtractionResult } from '@sovereign/sigil-extractor-contract';

function mockExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    facts: [
      {
        type: 'emotion',
        value: 'lęk',
        context: 'praca',
        confidence: 0.8,
        language: 'pl',
        source_timestamp: '2026-04-20T10:00:00.000Z',
      },
      {
        type: 'topic',
        value: 'work',
        confidence: 0.75,
        language: 'pl',
        source_timestamp: '2026-04-20T10:00:00.000Z',
      },
    ],
    confidence: 0.775,
    extractor_kind: 'cloud',
    latency_ms: 120,
    redactions_applied: [],
    low_confidence_fallback: false,
    ...overrides,
  };
}

test('Normalization produces signed Facts with provenance', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const did = await keys.did();

  const event = await signEvent(
    {
      source: 'mentor',
      action: 'utterance_captured',
      timestamp: '2026-04-20T10:00:00.000Z',
    },
    keys
  );

  const result = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id] },
    keys
  );

  assert.equal(result.facts.length, 2);
  assert.equal(result.rejected.length, 0);

  for (const f of result.facts) {
    assert.equal(f.did, did);
    assert.equal(f.layer, 'observed'); // default
    assert.equal(f.version, 1);
    assert.equal(f.revision_of, null);
    assert.ok(f.signature.startsWith('ed25519:'));
    assert.deepEqual(f.source_events, [event.id]);
  }
});

test('Low-confidence fallback reduces confidence by 0.15', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  const result = await normalize(
    mockExtraction({ low_confidence_fallback: true }),
    { sourceEventIds: [event.id] },
    keys
  );
  // Original: 0.8 and 0.75. After -0.15: 0.65 and 0.60.
  assert.ok(Math.abs(result.facts[0]!.confidence - 0.65) < 1e-9);
  assert.ok(Math.abs(result.facts[1]!.confidence - 0.60) < 1e-9);
});

test('Layer override is respected', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  const result = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id], layerOverride: 'stated' },
    keys
  );
  for (const f of result.facts) assert.equal(f.layer, 'stated');
});

test('Normalization rejects without source events', async () => {
  const keys = await InMemoryKeyProvider.generate();
  await assert.rejects(
    () => normalize(mockExtraction(), { sourceEventIds: [] }, keys),
    /at least one source event/
  );
});

test('Store rejects facts whose signatures do not verify', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const store = new InMemoryStore();

  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  await store.putEvent(event);

  const { facts } = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id] },
    keys
  );
  const tampered = { ...facts[0]!, value: 'tampered_value' };
  await assert.rejects(
    () => store.putFacts([tampered]),
    /signature verification failed/
  );
});

test('Store rejects facts referencing unknown events', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const store = new InMemoryStore();

  // Don't actually persist the event:
  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  const { facts } = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id] },
    keys
  );
  await assert.rejects(
    () => store.putFacts(facts),
    /references unknown event/
  );
});

test('Full happy path: event → facts → query', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const did = await keys.did();
  const store = new InMemoryStore();

  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  await store.putEvent(event);

  const { facts } = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id] },
    keys
  );
  await store.putFacts(facts);

  const counts = await store.count(did);
  assert.equal(counts.events, 1);
  assert.equal(counts.facts, 2);

  const emotions = await store.queryFacts({ did, types: ['emotion'] });
  assert.equal(emotions.length, 1);
  assert.equal(emotions[0]!.value, 'lęk');
});

test('Override flags do not invalidate signatures', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const did = await keys.did();
  const store = new InMemoryStore();

  const event = await signEvent(
    { source: 'mentor', action: 'utterance', timestamp: new Date().toISOString() },
    keys
  );
  await store.putEvent(event);
  const { facts } = await normalize(
    mockExtraction(),
    { sourceEventIds: [event.id] },
    keys
  );
  await store.putFacts(facts);

  // Suppress a fact. Signature must remain valid on the stored object.
  const target = facts[0]!;
  await store.setOverrideFlags(target.id, { suppressed_by_user: true });

  // Default query hides suppressed:
  const defaultResult = await store.queryFacts({ did });
  assert.equal(defaultResult.length, 1);
  assert.notEqual(defaultResult[0]!.id, target.id);

  // Explicit include returns it, with the flag applied:
  const all = await store.queryFacts({ did, includeSuppressed: true });
  const retrieved = all.find((f) => f.id === target.id)!;
  assert.equal(retrieved.suppressed_by_user, true);
});
