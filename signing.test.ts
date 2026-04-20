/**
 * Signing tests.
 *
 * Cryptographic correctness is non-negotiable. These tests verify:
 *   - Sign/verify round-trip succeeds for well-formed objects
 *   - Signature mismatch detection on tampered content
 *   - DID mismatch refusal in signObject
 *   - Canonicalization determinism
 *   - Key-mismatch verification failure
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalize,
  signObject,
  verifyObject,
  InMemoryKeyProvider,
} from '../src/signing.js';
import type { Event, Fact, Unsigned } from '../src/types.js';

async function makeFact(keys: InMemoryKeyProvider): Promise<Fact> {
  const did = await keys.did();
  const unsigned: Unsigned<Fact> = {
    id: 'fact_01HTEST',
    did,
    type: 'emotion',
    value: 'lęk',
    context: 'praca',
    confidence: 0.8,
    layer: 'observed',
    source_events: ['evt_01HSOURCE'],
    version: 1,
    revision_of: null,
    disputed_by_user: false,
    suppressed_by_user: false,
    pinned_by_user: false,
    alternative_interpretations: [],
    created_at: '2026-04-20T10:00:00.000Z',
  };
  return signObject<Fact>(unsigned, keys);
}

test('Sign/verify round-trip succeeds', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const fact = await makeFact(keys);
  assert.equal(await verifyObject(fact), true);
});

test('Tampered value fails verification', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const fact = await makeFact(keys);
  const tampered = { ...fact, value: 'radość' };
  assert.equal(await verifyObject(tampered), false);
});

test('Tampered confidence fails verification', async () => {
  const keys = await InMemoryKeyProvider.generate();
  const fact = await makeFact(keys);
  const tampered = { ...fact, confidence: 0.1 };
  assert.equal(await verifyObject(tampered), false);
});

test('signObject refuses DID mismatch', async () => {
  const keysA = await InMemoryKeyProvider.generate();
  const keysB = await InMemoryKeyProvider.generate();
  const didB = await keysB.did();

  const unsigned: Unsigned<Event> = {
    id: 'evt_01HTEST',
    did: didB, // mismatched DID — belongs to B
    source: 'mentor',
    action: 'reflection',
    timestamp: '2026-04-20T10:00:00.000Z',
  };

  await assert.rejects(
    () => signObject<Event>(unsigned, keysA),
    /does not match/
  );
});

test('Verification fails for forged signature', async () => {
  const keysA = await InMemoryKeyProvider.generate();
  const keysB = await InMemoryKeyProvider.generate();
  const factA = await makeFact(keysA);

  // Re-sign with B's key but keep A's DID: invalid.
  const didB = await keysB.did();
  const forgedPayload = { ...factA, did: didB };
  const forgedResigned = await signObject(
    { ...forgedPayload, signature: undefined as never },
    keysB
  );
  // Now swap DID back to A — signature was computed over a different payload
  const forged = { ...forgedResigned, did: factA.did };
  assert.equal(await verifyObject(forged), false);
});

test('Canonicalization is deterministic across key orderings', () => {
  const a = canonicalize({ b: 2, a: 1, c: { y: 2, x: 1 } });
  const b = canonicalize({ c: { x: 1, y: 2 }, a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2,"c":{"x":1,"y":2}}');
});

test('Canonicalization strips undefined keys', () => {
  const s = canonicalize({ a: 1, b: undefined, c: 3 });
  assert.equal(s, '{"a":1,"c":3}');
});

test('Canonicalization rejects non-finite numbers', () => {
  assert.throws(() => canonicalize({ x: NaN }));
  assert.throws(() => canonicalize({ x: Infinity }));
});
