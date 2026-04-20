/**
 * PII Redaction Layer.
 *
 * Applied to every utterance before transmission in Cloud-Assisted mode.
 * Purpose: strip obvious personally identifiable information before any
 * network egress. This is not a full anonymization system — it is a
 * defense-in-depth layer. The primary privacy guarantees come from:
 *   - Zero Data Retention contract with the provider
 *   - Stateless requests (no identity, no history)
 *   - Mode-level egress controls
 *
 * Redaction patterns are conservative. False positives (over-redaction)
 * are preferred over false negatives (leakage).
 */

export type RedactionKind =
  | 'email'
  | 'phone'
  | 'credit_card'
  | 'ssn_like'
  | 'ip_address'
  | 'url_with_credentials'
  | 'iban_like';

export interface RedactionResult {
  redacted_text: string;
  applied: RedactionKind[];
}

interface RedactionRule {
  kind: RedactionKind;
  pattern: RegExp;
  replacement: string;
}

/**
 * Regex rules. Ordered — earlier rules run first.
 * Replacements use stable tokens so the cloud model understands
 * that a slot was redacted without seeing the value.
 */
const RULES: RedactionRule[] = [
  {
    kind: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    kind: 'url_with_credentials',
    pattern: /https?:\/\/[^\s:@]+:[^\s:@]+@[^\s]+/g,
    replacement: '[REDACTED_URL_WITH_CREDS]',
  },
  {
    kind: 'credit_card',
    // 13–19 digit runs, optionally with spaces or dashes every 4
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: '[REDACTED_CC]',
  },
  {
    kind: 'iban_like',
    // PL IBAN: 2 letters + 2 check digits + up to 30 alphanumerics
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    replacement: '[REDACTED_IBAN]',
  },
  {
    kind: 'ssn_like',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED_SSN]',
  },
  {
    kind: 'phone',
    // Tolerant: country code optional, separators optional, 8–15 digits total
    pattern: /(?:(?:\+|00)\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,5}\d{2,4}/g,
    replacement: '[REDACTED_PHONE]',
  },
  {
    kind: 'ip_address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
  },
];

/**
 * Redact PII from text.
 * Returns the redacted text and the list of redaction kinds that were applied.
 * Applied list has no duplicates.
 */
export function redactPII(text: string): RedactionResult {
  let out = text;
  const applied = new Set<RedactionKind>();

  for (const rule of RULES) {
    // Reset regex state for global patterns
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(out)) {
      applied.add(rule.kind);
      out = out.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    redacted_text: out,
    applied: Array.from(applied),
  };
}

/**
 * For tests and diagnostics: run redaction and assert that the output
 * contains no patterns from the rule set. Throws if it does.
 */
export function assertFullyRedacted(text: string): void {
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      throw new Error(
        `Redaction incomplete: pattern for ${rule.kind} still matches`
      );
    }
  }
}
