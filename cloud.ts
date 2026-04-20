/**
 * Cloud Extractor (Anthropic Zero Data Retention).
 *
 * IMPORTANT: This extractor may be used ONLY with an API key covered by
 * a Zero Data Retention agreement. ZDR is an Anthropic Enterprise-tier
 * contractual commitment. Using this extractor without ZDR violates
 * SIGIL's privacy posture. The code path does not technically differ
 * from a standard API call; the guarantee is contractual, not code-enforced.
 *
 * Properties enforced in code:
 *   - Stateless: each call sends one utterance. No conversation history.
 *     No user identity. No graph state. No prior facts.
 *   - Redacted: PII redaction runs before egress.
 *   - Schema-enforced: the model is asked for strict JSON conforming to
 *     CloudFactArraySchema. Non-conforming responses are rejected.
 *   - Audited: every call is logged with a hash of the (redacted) utterance.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Extractor,
  ExtractorCapabilities,
  ExtractionResult,
  RawUtterance,
  FactCandidate,
  FactType,
} from '../types.js';
import { CloudFactArraySchema } from '../schemas.js';
import { redactPII } from '../redaction.js';
import type { AuditLogger } from '../audit.js';
import { hashUtterance } from '../audit.js';

export interface CloudExtractorConfig {
  apiKey: string;
  /** Model string, e.g. 'claude-sonnet-4-6' */
  model: string;
  /** Optional override of the default system prompt */
  systemPrompt?: string;
  /** Max tokens for extraction response */
  maxTokens?: number;
  /** Timeout for single extraction call in ms */
  timeoutMs?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a meaning extractor for the SIGIL Cognitive Operating System.
Your sole job is to extract structured facts from a single utterance.

Rules:
- Output ONLY valid JSON matching the schema below.
- No prose, no explanation, no markdown fences.
- Do not invent facts that are not in the utterance.
- Extract at most 8 facts per utterance.
- Confidence reflects how clearly the fact is expressed (0.3 = weak implication, 0.9 = explicit).
- For Polish input, output fact values in Polish. For mixed Polish/English, use the dominant language.

Fact types:
  emotion         — an affective state the speaker is experiencing
  topic           — a subject the speaker is engaging with
  relation        — a relationship between entities the speaker mentions
  temporal        — a time-based orientation (past/present/future, urgency)
  identity_signal — something the speaker is saying about who they are
  value           — something the speaker treats as important
  goal            — something the speaker is reaching toward

Schema:
{
  "facts": [
    {
      "type": "emotion|topic|relation|temporal|identity_signal|value|goal",
      "value": "<short phrase, max 200 chars>",
      "context": "<optional short qualifier or null>",
      "confidence": <number between 0 and 1>
    }
  ]
}

If the utterance contains no extractable facts, return {"facts": []}.`;

export class CloudExtractor implements Extractor {
  readonly kind = 'cloud' as const;

  private readonly client: Anthropic;
  private readonly config: Required<CloudExtractorConfig>;

  constructor(
    config: CloudExtractorConfig,
    private readonly audit: AuditLogger
  ) {
    if (!config.apiKey) {
      throw new Error(
        'CloudExtractor requires an Anthropic API key covered by a Zero Data Retention agreement.'
      );
    }
    this.config = {
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      maxTokens: config.maxTokens ?? 1024,
      timeoutMs: config.timeoutMs ?? 10_000,
    };
    this.client = new Anthropic({ apiKey: this.config.apiKey });
  }

  capabilities(): ExtractorCapabilities {
    return {
      supported_languages: ['pl', 'en', 'de', 'es', 'fr', 'it', 'nl', 'pt'],
      supported_fact_types: [
        'emotion',
        'topic',
        'relation',
        'temporal',
        'identity_signal',
        'value',
        'goal',
      ],
      max_input_length: 8192,
      offline_capable: false,
    };
  }

  async extract(input: RawUtterance): Promise<ExtractionResult> {
    const started = Date.now();

    // Step 1: redact PII before any network egress.
    const { redacted_text, applied: redactions } = redactPII(input.text);
    const utterance_hash = hashUtterance(redacted_text);

    // Step 2: stateless API call. No system-level memory, no prior turns.
    try {
      const response = await this.client.messages.create(
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: this.config.systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Language: ${input.language}\n\nUtterance:\n${redacted_text}`,
            },
          ],
        },
        { timeout: this.config.timeoutMs }
      );

      const latency_ms = Date.now() - started;

      // Step 3: extract text content from the response.
      const textBlock = response.content.find(
        (c: { type: string }) => c.type === 'text'
      );
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Cloud response contained no text block');
      }

      // Step 4: strict schema validation. Non-conforming responses rejected.
      const parsed = this.parseAndValidate(textBlock.text);

      // Step 5: map to FactCandidate[].
      const facts: FactCandidate[] = parsed.facts.map((f) => ({
        type: f.type as FactType,
        value: f.value,
        ...(f.context != null ? { context: f.context } : {}),
        confidence: f.confidence,
        language: input.language,
        source_timestamp: input.timestamp,
      }));

      const aggregate = facts.length === 0
        ? 0
        : facts.reduce((s, f) => s + f.confidence, 0) / facts.length;

      await this.audit.logCloudCall({
        utterance_hash,
        latency_ms,
        redactions,
        model: this.config.model,
        success: true,
      });

      return {
        facts,
        confidence: aggregate,
        extractor_kind: 'cloud',
        latency_ms,
        redactions_applied: redactions,
        low_confidence_fallback: false,
      };
    } catch (err) {
      const latency_ms = Date.now() - started;
      await this.audit.logCloudCall({
        utterance_hash,
        latency_ms,
        redactions,
        model: this.config.model,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private parseAndValidate(text: string): { facts: Array<{
    type: string;
    value: string;
    context?: string | null;
    confidence: number;
  }> } {
    // The model was instructed to output pure JSON. If it wrapped in fences
    // despite instruction, strip them once. We do NOT attempt more aggressive
    // coercion — if the model is misbehaving, we reject.
    const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let raw: unknown;
    try {
      raw = JSON.parse(stripped);
    } catch {
      throw new Error('Cloud extractor returned non-JSON response');
    }
    const result = CloudFactArraySchema.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Cloud extractor response failed schema validation: ${result.error.message}`
      );
    }
    return result.data;
  }
}
