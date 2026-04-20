/**
 * SIGIL Core — Layer A Types
 *
 * Signed, persisted, canonical types. Every object here carries the
 * owner's Cognitive DID and an Ed25519 signature. These are the types
 * that travel through the Memory Store, the Pattern Engine, the
 * Insight Graph, and the Query Engine.
 *
 * They are distinct from the Layer B types (FactCandidate) which are
 * unsigned and transient. The boundary between them is the Normalization
 * layer in normalization.ts.
 */

import type { FactType } from '@sovereign/sigil-extractor-contract';

export type { FactType };

/**
 * A did:sigil identifier. The method-specific identifier is the
 * multibase-encoded Ed25519 public key.
 *
 * Example: did:sigil:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH
 */
export type SigilDID = `did:sigil:${string}`;

/**
 * An Ed25519 signature encoded as `ed25519:<base64url-raw-signature>`.
 * The signature is computed over the canonical JSON of the object
 * with the `signature` field removed (per RFC 8785).
 */
export type Ed25519Signature = `ed25519:${string}`;

/**
 * ISO-8601 timestamp string.
 */
export type ISOTimestamp = string;

/**
 * Which self-model a fact belongs to.
 *   stated   — declarative, user-expressed
 *   observed — derived from behavior / patterns
 *   shadow   — negative-space signal (avoidance, unreturned emotion)
 */
export type Layer = 'stated' | 'observed' | 'shadow';

/**
 * Temporal phase of a fact or pattern.
 *   emergence    — newly observed, not yet stable
 *   loop         — recognized recurring pattern signature
 *   breakthrough — disruption of existing loop
 *   integration  — breakthrough stabilized into new baseline
 */
export type Phase = 'emergence' | 'loop' | 'breakthrough' | 'integration';

/**
 * Criterion under which a fact or pattern would be considered
 * falsified. Kept deliberately human-readable — not machine-evaluable
 * in v1; evaluation is a future research direction.
 */
export interface Falsification {
  criterion: string;
  window_days: number;
}

/**
 * An alternative interpretation of the same underlying evidence.
 * Stored as a sibling to the primary fact. Used by the Dual Self
 * Engine and the Human Override Layer.
 */
export interface AlternativeInterpretation {
  value: string;
  context?: string;
  confidence: number;
  rationale?: string;
}

/**
 * An Event — per Specification §5.1.
 *
 * The atomic unit of activity entering Layer A. Events are the source
 * of every Fact (the `source_events` field on a Fact references these).
 */
export interface Event {
  id: string;                // evt_<ULID>
  did: SigilDID;
  source: 'mentor' | 'creator_lab' | 'vault' | 'oracle' | 'external';
  action: string;
  timestamp: ISOTimestamp;
  metadata?: Record<string, unknown>;
  signature: Ed25519Signature;
}

/**
 * A Fact — per Specification §5.2.
 *
 * The core unit of Layer A memory. Every Fact is signed by its owner's
 * Cognitive DID. Facts are versioned — disputed facts are not deleted
 * but forked (Human Override Layer).
 */
export interface Fact {
  id: string;                // fact_<ULID>
  did: SigilDID;
  type: FactType;
  value: string;
  context?: string;
  confidence: number;        // [0..1]
  layer: Layer;
  weight?: number;           // computed by Weight Engine; may be absent at creation
  phase?: Phase;             // computed by Time Engine; may be absent at creation
  falsification?: Falsification;
  source_events: string[];   // Event IDs
  version: number;           // starts at 1
  revision_of: string | null;
  disputed_by_user: boolean;
  suppressed_by_user: boolean;
  pinned_by_user: boolean;   // persists against Memory Decay
  alternative_interpretations: AlternativeInterpretation[];
  created_at: ISOTimestamp;
  signature: Ed25519Signature;
}

/**
 * A Pattern — per Specification §5.3.
 *
 * An aggregate structure detected over many Facts. Patterns are the
 * primary unit the Insight Graph reasons over. They are produced by
 * the Pattern Engine (future module) and signed on creation.
 */
export interface Pattern {
  id: string;                // pat_<ULID>
  did: SigilDID;
  description: string;
  signature_nodes: string[];
  frequency: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  strength: number;          // [0..1]
  weight?: number;
  phase: Phase;
  loop_type: 'reinforcement' | 'escape' | 'oscillation' | 'none';
  first_observed: ISOTimestamp;
  last_observed: ISOTimestamp;
  falsification?: Falsification;
  layer: Layer;
  disputed_by_user: boolean;
  suppressed_by_user: boolean;
  created_at: ISOTimestamp;
  signature: Ed25519Signature;
}

/**
 * An unsigned version of a type. Used internally when an object has
 * been constructed but not yet signed. Never persisted.
 */
export type Unsigned<T extends { signature: Ed25519Signature }> = Omit<T, 'signature'>;
