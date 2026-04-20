/**
 * Local Audit Stream.
 *
 * Records every significant event in the extraction pipeline:
 *   - cloud calls (timestamp, latency, redactions applied, utterance hash)
 *   - routing decisions (chosen extractor, reason, confidences)
 *   - extraction failures
 *   - mode changes
 *
 * The audit stream is local-only and user-inspectable. It is one of the
 * primary accountability surfaces of SIGIL: the user can always see
 * what left their device and why.
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ExtractorKind, RoutingDecision } from './types.js';
import type { RedactionKind } from './redaction.js';

export type AuditEventType =
  | 'cloud_call'
  | 'local_extraction'
  | 'routing_decision'
  | 'extraction_failure'
  | 'mode_change'
  | 'redaction_applied';

export interface AuditEvent {
  at: string; // ISO-8601
  type: AuditEventType;
  details: Record<string, unknown>;
}

/**
 * SHA-256 hash of an utterance. Used in audit records to reference
 * an utterance without storing its content. The hash is deterministic
 * across runs — useful for correlating with downstream fact records.
 */
export function hashUtterance(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface AuditLogger {
  log(event: AuditEvent): Promise<void>;
  logCloudCall(args: {
    utterance_hash: string;
    latency_ms: number;
    redactions: RedactionKind[];
    model: string;
    success: boolean;
    error?: string;
  }): Promise<void>;
  logRoutingDecision(decision: RoutingDecision, utterance_hash: string): Promise<void>;
  logExtraction(args: {
    utterance_hash: string;
    extractor_kind: ExtractorKind;
    fact_count: number;
    latency_ms: number;
  }): Promise<void>;
}

/**
 * File-backed audit logger. Append-only. One JSON event per line.
 * Production implementations may wrap this with rotation, signing,
 * and tamper-evident chaining (Merkle log). The interface here is
 * intentionally minimal.
 */
export class FileAuditLogger implements AuditLogger {
  constructor(private readonly path: string) {}

  async log(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(event) + '\n', 'utf8');
  }

  async logCloudCall(args: {
    utterance_hash: string;
    latency_ms: number;
    redactions: RedactionKind[];
    model: string;
    success: boolean;
    error?: string;
  }): Promise<void> {
    await this.log({
      at: new Date().toISOString(),
      type: 'cloud_call',
      details: { ...args },
    });
  }

  async logRoutingDecision(
    decision: RoutingDecision,
    utterance_hash: string
  ): Promise<void> {
    await this.log({
      at: decision.decided_at,
      type: 'routing_decision',
      details: { utterance_hash, ...decision },
    });
  }

  async logExtraction(args: {
    utterance_hash: string;
    extractor_kind: ExtractorKind;
    fact_count: number;
    latency_ms: number;
  }): Promise<void> {
    await this.log({
      at: new Date().toISOString(),
      type: args.extractor_kind === 'cloud' ? 'cloud_call' : 'local_extraction',
      details: { ...args },
    });
  }
}

/**
 * In-memory audit logger for tests and development.
 * Events are retrievable for assertions.
 */
export class InMemoryAuditLogger implements AuditLogger {
  public readonly events: AuditEvent[] = [];

  async log(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async logCloudCall(args: {
    utterance_hash: string;
    latency_ms: number;
    redactions: RedactionKind[];
    model: string;
    success: boolean;
    error?: string;
  }): Promise<void> {
    await this.log({
      at: new Date().toISOString(),
      type: 'cloud_call',
      details: { ...args },
    });
  }

  async logRoutingDecision(
    decision: RoutingDecision,
    utterance_hash: string
  ): Promise<void> {
    await this.log({
      at: decision.decided_at,
      type: 'routing_decision',
      details: { utterance_hash, ...decision },
    });
  }

  async logExtraction(args: {
    utterance_hash: string;
    extractor_kind: ExtractorKind;
    fact_count: number;
    latency_ms: number;
  }): Promise<void> {
    await this.log({
      at: new Date().toISOString(),
      type: args.extractor_kind === 'cloud' ? 'cloud_call' : 'local_extraction',
      details: { ...args },
    });
  }
}
