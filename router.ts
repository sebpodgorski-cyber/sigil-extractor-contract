/**
 * Routing Classifier.
 *
 * Decides per-utterance whether to route to the Local or Cloud extractor.
 * Active only in Hybrid Mode.
 *
 * Design commitments:
 *   - Fast: under 50ms on mid-range mobile CPU. No LLM calls.
 *   - Per-type thresholds: different fact types have different
 *     local-quality profiles. Emotion is harder locally than topic.
 *   - Tie-break prefers local: sovereignty wins ties.
 *   - Fallback logic: if cloud unavailable, route local with a flag.
 *
 * Confidence signals used:
 *   - lexical complexity (sentence length, rare-word rate, punctuation)
 *   - language support (is the language supported by the local extractor?)
 *   - topical familiarity (has this topic been handled successfully locally?)
 *
 * The classifier emits per-type confidence scores. Decision is made
 * per-type and then aggregated: if any type with a hit requires cloud,
 * we route cloud for the whole utterance (we never split a single
 * utterance across extractors — that would fragment provenance).
 */

import type {
  FactType,
  Extractor,
  RoutingDecision,
  RawUtterance,
} from './types.js';
import type { AuditLogger } from './audit.js';
import { hashUtterance } from './audit.js';

/**
 * Default per-type thresholds.
 * Higher threshold = harder for local to "win" = cloud preferred.
 *
 * Starting calibration, based on qualitative expectation of small-model
 * weakness: emotion and identity_signal are hardest locally.
 * These MUST be recalibrated from real measurements in Phase 1.
 */
export const DEFAULT_THRESHOLDS: Record<FactType, number> = {
  emotion: 0.75,
  topic: 0.55,
  relation: 0.70,
  temporal: 0.50,
  identity_signal: 0.80,
  value: 0.70,
  goal: 0.65,
};

export interface RoutingClassifierConfig {
  local: Extractor;
  cloud: Extractor | null; // null in Strict Sovereignty mode
  /** Per-type local acceptance thresholds. Above threshold => local. */
  thresholds?: Partial<Record<FactType, number>>;
  /** Tie-break band around threshold; within this, we prefer local. */
  tieDelta?: number;
  /** User can force a single call to a specific extractor. */
  userForced?: 'local' | 'cloud' | null;
  audit: AuditLogger;
}

/**
 * Lexical features used by the classifier.
 * These are cheap computations over the raw utterance string.
 */
interface LexicalFeatures {
  token_count: number;
  mean_token_length: number;
  has_negation: boolean;
  has_irony_markers: boolean;
  has_question: boolean;
  is_code_switched: boolean;
}

function extractLexicalFeatures(text: string, primary_lang: string): LexicalFeatures {
  const tokens = text.trim().split(/\s+/);
  const mean_len = tokens.reduce((s, t) => s + t.length, 0) / Math.max(tokens.length, 1);

  const negation = /\b(nie|never|nigdy|żaden|zaden|no(t)?)\b/i.test(text);
  const irony_markers = /["""'„"]|ironi|sarkaz|yeah right|jasne/i.test(text);
  const question = /\?/.test(text);

  // Crude code-switch detection: Polish diacritics alongside long English-looking tokens
  const has_polish_diacritics = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text);
  const has_english_words = /\b(the|and|because|actually|anyway|literally|deadline|meeting)\b/i.test(text);
  const is_code_switched =
    (primary_lang === 'pl' && has_english_words && tokens.length > 3) ||
    (primary_lang === 'en' && has_polish_diacritics);

  return {
    token_count: tokens.length,
    mean_token_length: mean_len,
    has_negation: negation,
    has_irony_markers: irony_markers,
    has_question: question,
    is_code_switched: is_code_switched,
  };
}

/**
 * Estimate local confidence per fact type.
 * This is a tiny hand-rolled heuristic. Phase 4 replaces it with a
 * trained gradient-boosted model over measured extraction successes.
 *
 * Returns a value in [0..1] — higher means "local is likely competent".
 */
function estimateLocalConfidence(
  features: LexicalFeatures,
  languageSupported: boolean
): Partial<Record<FactType, number>> {
  if (!languageSupported) {
    // Unsupported language => zero confidence across the board.
    return {};
  }

  // Base confidence by type (local strengths).
  const base: Record<FactType, number> = {
    emotion: 0.55,
    topic: 0.75,
    relation: 0.45,
    temporal: 0.70,
    identity_signal: 0.30,
    value: 0.40,
    goal: 0.50,
  };

  // Penalties from features that indicate nuance local can't handle.
  let penalty = 0;
  if (features.has_irony_markers) penalty += 0.35;
  if (features.is_code_switched) penalty += 0.30;
  if (features.token_count > 60) penalty += 0.10;   // long, complex utterance
  if (features.mean_token_length > 8) penalty += 0.05; // heavy vocabulary
  if (features.has_negation && features.token_count > 20) penalty += 0.05;

  const out: Partial<Record<FactType, number>> = {};
  for (const [type, val] of Object.entries(base)) {
    out[type as FactType] = Math.max(0, Math.min(1, val - penalty));
  }
  return out;
}

export class RoutingClassifier {
  private readonly thresholds: Record<FactType, number>;
  private readonly tieDelta: number;

  constructor(private readonly config: RoutingClassifierConfig) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(config.thresholds ?? {}) };
    this.tieDelta = config.tieDelta ?? 0.05;
  }

  /**
   * Decide, record the decision in the audit stream, and return which
   * extractor to use. Does NOT run the extractor — caller does that.
   */
  async decide(input: RawUtterance): Promise<{
    extractor: Extractor;
    decision: RoutingDecision;
  }> {
    const decided_at = new Date().toISOString();

    // 1. User force overrides everything (within mode constraints).
    if (this.config.userForced === 'local') {
      const decision: RoutingDecision = {
        chosen: 'local',
        reason: 'user_forced_local',
        confidences: {},
        thresholds: this.thresholds,
        decided_at,
      };
      await this.config.audit.logRoutingDecision(decision, hashUtterance(input.text));
      return { extractor: this.config.local, decision };
    }
    if (this.config.userForced === 'cloud' && this.config.cloud) {
      const decision: RoutingDecision = {
        chosen: 'cloud',
        reason: 'user_forced_cloud',
        confidences: {},
        thresholds: this.thresholds,
        decided_at,
      };
      await this.config.audit.logRoutingDecision(decision, hashUtterance(input.text));
      return { extractor: this.config.cloud, decision };
    }

    // 2. If cloud is unavailable (Strict Sovereignty or runtime failure), local.
    if (!this.config.cloud) {
      const decision: RoutingDecision = {
        chosen: 'local',
        reason: 'cloud_unavailable',
        confidences: {},
        thresholds: this.thresholds,
        decided_at,
      };
      await this.config.audit.logRoutingDecision(decision, hashUtterance(input.text));
      return { extractor: this.config.local, decision };
    }

    // 3. Language check against local capabilities.
    const localCaps = this.config.local.capabilities();
    const languageSupported = localCaps.supported_languages.includes(input.language);
    if (!languageSupported) {
      const decision: RoutingDecision = {
        chosen: 'cloud',
        reason: 'unsupported_language',
        confidences: {},
        thresholds: this.thresholds,
        decided_at,
      };
      await this.config.audit.logRoutingDecision(decision, hashUtterance(input.text));
      return { extractor: this.config.cloud, decision };
    }

    // 4. Compute features and per-type confidences.
    const features = extractLexicalFeatures(input.text, input.language);
    const confidences = estimateLocalConfidence(features, languageSupported);

    // 5. Per-type decision: local wins a type if local confidence exceeds
    //    that type's threshold minus the tie-delta (tie-break prefers local).
    //    Overall decision: if ANY type that local supports fails its threshold,
    //    we route to cloud (no partial splitting within an utterance).
    let anyBelow = false;
    for (const type of localCaps.supported_fact_types) {
      const local_c = confidences[type] ?? 0;
      const threshold = this.thresholds[type] - this.tieDelta;
      if (local_c < threshold) {
        anyBelow = true;
        break;
      }
    }

    // If local passed (anyBelow=false), distinguish whether it passed
    // comfortably or only inside the tie-delta band.
    let inTieZone = false;
    if (!anyBelow) {
      for (const type of localCaps.supported_fact_types) {
        const local_c = confidences[type] ?? 0;
        const threshold = this.thresholds[type];
        if (Math.abs(local_c - threshold) <= this.tieDelta) {
          inTieZone = true;
          break;
        }
      }
    }

    const chosen: 'cloud' | 'local' = anyBelow ? 'cloud' : 'local';
    const reason: RoutingDecision['reason'] = anyBelow
      ? 'confidence_cloud'
      : inTieZone
      ? 'tie_break_local'
      : 'confidence_local';

    const decision: RoutingDecision = {
      chosen,
      reason,
      confidences,
      thresholds: this.thresholds,
      decided_at,
    };
    await this.config.audit.logRoutingDecision(decision, hashUtterance(input.text));

    return {
      extractor: chosen === 'cloud' ? this.config.cloud : this.config.local,
      decision,
    };
  }
}
