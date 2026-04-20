/**
 * Redaction tests.
 *
 * Every pattern in redaction.ts needs to be verified. If the redactor
 * lets PII through, the entire privacy posture of Cloud-Assisted mode
 * is compromised.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPII } from '../src/redaction.js';

test('Emails redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Wyślij na jan.kowalski@example.com, dzięki.'
  );
  assert.ok(!redacted_text.includes('jan.kowalski@example.com'));
  assert.ok(applied.includes('email'));
});

test('Polish mobile phone redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Zadzwoń do mnie na +48 601 234 567 jak się ogarniesz.'
  );
  assert.ok(!redacted_text.match(/\+48\s?\d{3}/));
  assert.ok(applied.includes('phone'));
});

test('Credit card redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Numer karty to 4111 1111 1111 1111, proszę zapisz.'
  );
  assert.ok(!redacted_text.includes('4111'));
  assert.ok(applied.includes('credit_card'));
});

test('Polish IBAN redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Konto: PL61109010140000071219812874.'
  );
  assert.ok(!redacted_text.includes('PL61109010140000071219812874'));
  assert.ok(applied.includes('iban_like'));
});

test('IP address redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Serwer odpowiada na 192.168.1.42, sprawdź.'
  );
  assert.ok(!redacted_text.includes('192.168.1.42'));
  assert.ok(applied.includes('ip_address'));
});

test('URL with embedded credentials redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Test: https://admin:secret@example.com/api'
  );
  assert.ok(!redacted_text.includes('admin:secret'));
  assert.ok(applied.includes('url_with_credentials'));
});

test('Clean text produces no redactions', () => {
  const { redacted_text, applied } = redactPII(
    'Dziś czuję się zmęczony i nie wiem, co z tym zrobić.'
  );
  assert.equal(
    redacted_text,
    'Dziś czuję się zmęczony i nie wiem, co z tym zrobić.'
  );
  assert.equal(applied.length, 0);
});

test('Multiple PII types in one utterance all redacted', () => {
  const { redacted_text, applied } = redactPII(
    'Napisz do mnie na kontakt@firma.pl albo zadzwoń +48 600 111 222.'
  );
  assert.ok(!redacted_text.includes('kontakt@firma.pl'));
  assert.ok(!redacted_text.match(/\+48\s?\d{3}/));
  assert.ok(applied.includes('email'));
  assert.ok(applied.includes('phone'));
});
