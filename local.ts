/**
 * Local Extractor (Heuristic Stub).
 *
 * This is the Phase 1 placeholder. It uses lexicon-based heuristics for
 * emotion and topic extraction with very conservative confidence scores.
 * It is intentionally weak — its role in Phase 1 is to establish the
 * interface and audit path, not to compete with the cloud extractor.
 *
 * Phase 3 replaces the internals with a small-model runtime (e.g. Bielik,
 * PLLuM, or equivalent Polish-capable 2–8B model) while keeping this
 * public interface stable. Layer A code never changes.
 *
 * Polish support: the lexicons here include Polish tokens. For production
 * this must be expanded and validated; current state is demonstrative.
 */

import type {
  Extractor,
  ExtractorCapabilities,
  ExtractionResult,
  RawUtterance,
  FactCandidate,
} from '../types.js';

// Minimal bilingual emotion lexicon. Keys are root forms; matching is
// stem-prefix (a word matches if it starts with any key).
// Production systems replace this with a proper small model.
const EMOTION_LEXICON: Record<string, string[]> = {
  anxiety:  ['lęk', 'niepokój', 'niepokoj', 'stres', 'stress', 'anxi', 'worr'],
  anger:    ['złość', 'zlosc', 'wściek', 'wsciek', 'anger', 'furi', 'mad'],
  sadness:  ['smut', 'żal', 'zal', 'sad', 'grief', 'depres'],
  fear:     ['strach', 'boj', 'fear', 'afraid', 'terror'],
  joy:      ['rado', 'szczę', 'szcze', 'happy', 'joy', 'delight'],
  fatigue:  ['zmęcz', 'zmecz', 'wyczerpan', 'tired', 'exhaust', 'fatigue'],
  shame:    ['wstyd', 'zażenow', 'zazenow', 'shame', 'embarrass'],
  pressure: ['presj', 'presi', 'pressure', 'urgen'],
};

// Topic markers. Also bilingual, also stem-prefix.
const TOPIC_LEXICON: Record<string, string[]> = {
  work:          ['prac', 'work', 'job', 'career', 'projekt', 'project'],
  money:         ['pieni', 'kasa', 'money', 'finan', 'budget', 'budżet', 'kredyt', 'loan'],
  relationship:  ['związek', 'zwiazek', 'partner', 'żon', 'zon', 'mąż', 'maz', 'relation'],
  family:        ['rodzin', 'famil', 'mam', 'tat', 'mother', 'father'],
  health:        ['zdrow', 'health', 'chor', 'sick', 'lek', 'doctor'],
  future:        ['przyszł', 'przyszl', 'future', 'plan', 'jutro', 'tomorrow'],
  past:          ['przeszł', 'przeszl', 'past', 'wczoraj', 'yesterday'],
  decision:      ['decyz', 'decision', 'wybór', 'wybor', 'choice', 'choose'],
};

// Lightweight temporal markers for the 'temporal' fact type.
const TEMPORAL_MARKERS: Record<string, string[]> = {
  future_orientation: ['będę', 'bede', 'będzie', 'bedzie', 'will', 'jutro', 'tomorrow', 'za tydzień'],
  past_orientation:   ['był', 'byl', 'byłem', 'bylem', 'was', 'were', 'wczoraj', 'yesterday'],
  urgency:            ['teraz', 'zaraz', 'pilnie', 'natychmiast', 'now', 'urgent', 'asap'],
};

function scan(text: string, lex: Record<string, string[]>): { label: string; hits: number }[] {
  const lower = text.toLowerCase();
  const tokens = lower.split(/\s+/);
  const results: { label: string; hits: number }[] = [];
  for (const [label, stems] of Object.entries(lex)) {
    let hits = 0;
    for (const token of tokens) {
      for (const stem of stems) {
        if (token.startsWith(stem)) {
          hits += 1;
          break;
        }
      }
    }
    if (hits > 0) results.push({ label, hits });
  }
  return results;
}

export class LocalExtractor implements Extractor {
  readonly kind = 'local' as const;

  capabilities(): ExtractorCapabilities {
    // Honest Phase 1 capability declaration: the lexicon-based stub is
    // only acceptable-quality for topic and temporal. Emotions are still
    // extracted when they appear (as a bonus) but are NOT claimed — the
    // router therefore routes anything with significant emotional nuance
    // to cloud. Phase 4's real small-model extractor will expand this list.
    return {
      supported_languages: ['pl', 'en'],
      supported_fact_types: ['topic', 'temporal'],
      max_input_length: 4096,
      offline_capable: true,
    };
  }

  async extract(input: RawUtterance): Promise<ExtractionResult> {
    const started = Date.now();
    const facts: FactCandidate[] = [];

    const emotions = scan(input.text, EMOTION_LEXICON);
    for (const { label, hits } of emotions) {
      facts.push({
        type: 'emotion',
        value: label,
        confidence: Math.min(0.5 + 0.1 * hits, 0.75),
        language: input.language,
        source_timestamp: input.timestamp,
      });
    }

    const topics = scan(input.text, TOPIC_LEXICON);
    for (const { label, hits } of topics) {
      facts.push({
        type: 'topic',
        value: label,
        confidence: Math.min(0.55 + 0.1 * hits, 0.8),
        language: input.language,
        source_timestamp: input.timestamp,
      });
    }

    const temporals = scan(input.text, TEMPORAL_MARKERS);
    for (const { label } of temporals) {
      facts.push({
        type: 'temporal',
        value: label,
        confidence: 0.6,
        language: input.language,
        source_timestamp: input.timestamp,
      });
    }

    const latency_ms = Date.now() - started;
    const aggregate = facts.length === 0
      ? 0
      : facts.reduce((s, f) => s + f.confidence, 0) / facts.length;

    return {
      facts,
      confidence: aggregate,
      extractor_kind: 'local',
      latency_ms,
      redactions_applied: [],
      low_confidence_fallback: false,
    };
  }
}
