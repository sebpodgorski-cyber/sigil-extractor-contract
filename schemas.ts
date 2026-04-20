/**
 * Runtime schemas for Layer B <-> Layer A boundary.
 * Every object crossing the boundary is validated here.
 * Objects failing validation are rejected (never partially ingested).
 */

import { z } from 'zod';

export const FactTypeSchema = z.enum([
  'emotion',
  'topic',
  'relation',
  'temporal',
  'identity_signal',
  'value',
  'goal',
]);

export const RawUtteranceSchema = z.object({
  text: z.string().min(1).max(8192),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  timestamp: z.string().datetime(),
  session_id: z.string().min(8).max(64),
});

export const FactCandidateSchema = z.object({
  type: FactTypeSchema,
  value: z.string().min(1).max(512),
  context: z.string().max(512).optional(),
  confidence: z.number().min(0).max(1),
  language: z.string(),
  source_timestamp: z.string().datetime(),
});

export const ExtractionResultSchema = z.object({
  facts: z.array(FactCandidateSchema).max(64),
  confidence: z.number().min(0).max(1),
  extractor_kind: z.enum(['cloud', 'local']),
  latency_ms: z.number().min(0),
  redactions_applied: z.array(z.string()),
  low_confidence_fallback: z.boolean(),
});

/**
 * Strict JSON Schema the Cloud Extractor asks the LLM to conform to.
 * If the response doesn't match, it is rejected — we do not coerce.
 */
export const CloudFactArraySchema = z.object({
  facts: z.array(
    z.object({
      type: FactTypeSchema,
      value: z.string().min(1).max(512),
      context: z.string().max(512).optional().nullable(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export type CloudFactArray = z.infer<typeof CloudFactArraySchema>;
