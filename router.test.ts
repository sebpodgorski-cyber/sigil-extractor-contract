/**
 * Router tests.
 *
 * Smoke coverage for the critical routing paths:
 *   - Strict Sovereignty mode (no cloud) routes local.
 *   - Unsupported language routes cloud.
 *   - Simple Polish utterance routes local.
 *   - Complex ironic utterance routes cloud.
 *   - User force overrides.
 *
 * These tests do not make real network calls. The cloud extractor here
 * is a minimal mock that implements the Extractor interface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoutingClassifier } from '../src/router.js';
import { LocalExtractor } from '../src/extractors/local.js';
import { InMemoryAuditLogger } from '../src/audit.js';
import type { Extractor, ExtractionResult, RawUtterance } from '../src/types.js';

function mockCloud(): Extractor {
  return {
    kind: 'cloud' as const,
    capabilities: () => ({
      supported_languages: ['pl', 'en', 'de', 'es', 'fr'],
      supported_fact_types: ['emotion', 'topic', 'relation', 'temporal', 'identity_signal', 'value', 'goal'],
      max_input_length: 8192,
      offline_capable: false,
    }),
    extract: async (input: RawUtterance): Promise<ExtractionResult> => ({
      facts: [],
      confidence: 0.9,
      extractor_kind: 'cloud',
      latency_ms: 100,
      redactions_applied: [],
      low_confidence_fallback: false,
    }),
  };
}

function utterance(text: string, language = 'pl'): RawUtterance {
  return {
    text,
    language,
    timestamp: new Date().toISOString(),
    session_id: 'test_session_abc12345',
  };
}

test('Strict Sovereignty: no cloud => always local', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: null,
    audit,
  });
  const { decision } = await router.decide(utterance('Jestem dziś zmęczony pracą.'));
  assert.equal(decision.chosen, 'local');
  assert.equal(decision.reason, 'cloud_unavailable');
});

test('Unsupported language => cloud', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    audit,
  });
  // LocalExtractor supports only pl, en. German is not supported.
  const { decision } = await router.decide(utterance('Ich bin heute müde.', 'de'));
  assert.equal(decision.chosen, 'cloud');
  assert.equal(decision.reason, 'unsupported_language');
});

test('Simple Polish utterance => local wins', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    audit,
  });
  // Short, no irony, no code-switch, supported language.
  const { decision } = await router.decide(utterance('Czuję stres w pracy.'));
  assert.equal(decision.chosen, 'local');
});

test('Code-switched utterance => cloud', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    audit,
  });
  // Polish primary with English tokens — triggers code-switch penalty.
  const { decision } = await router.decide(
    utterance('Mój deadline jest jutro, ale actually nie wiem czy zdążę, because mam jeszcze meeting.')
  );
  assert.equal(decision.chosen, 'cloud');
});

test('Ironic markers => cloud', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    audit,
  });
  const { decision } = await router.decide(
    utterance('"Jasne, że wszystko jest w porządku." Sarkazm.')
  );
  assert.equal(decision.chosen, 'cloud');
});

test('User forced local overrides cloud preference', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    userForced: 'local',
    audit,
  });
  // Even with ironic markers that would normally go cloud:
  const { decision } = await router.decide(
    utterance('"Jasne, że wszystko jest w porządku." Sarkazm.')
  );
  assert.equal(decision.chosen, 'local');
  assert.equal(decision.reason, 'user_forced_local');
});

test('Audit stream records every decision', async () => {
  const audit = new InMemoryAuditLogger();
  const router = new RoutingClassifier({
    local: new LocalExtractor(),
    cloud: mockCloud(),
    audit,
  });
  await router.decide(utterance('Prosta wypowiedź.'));
  await router.decide(utterance('Inna prosta wypowiedź.'));
  const routing_events = audit.events.filter((e) => e.type === 'routing_decision');
  assert.equal(routing_events.length, 2);
});
