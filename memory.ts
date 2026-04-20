// memory.ts

import type { Event, Fact, Pattern } from './types.js';

export interface FactQuery {
  ids?: string[];
  types?: string[];
  sourceEventIds?: string[];
  limit?: number;
}

export interface PatternQuery {
  ids?: string[];
  limit?: number;
}

export interface MemoryStore {
  putEvent(event: Event): Promise<void>;
  putFacts(facts: Fact[]): Promise<void>;
  putPatterns(patterns: Pattern[]): Promise<void>;

  getEvent(id: string): Promise<Event | null>;
  getFact(id: string): Promise<Fact | null>;
  getPattern(id: string): Promise<Pattern | null>;

  queryFacts(query?: FactQuery): Promise<Fact[]>;
  queryPatterns(query?: PatternQuery): Promise<Pattern[]>;

  listEvents(): Promise<Event[]>;
  listFacts(): Promise<Fact[]>;
  listPatterns(): Promise<Pattern[]>;

  deleteEvent(id: string): Promise<void>;
  deleteFact(id: string): Promise<void>;
  deletePattern(id: string): Promise<void>;

  clear(): Promise<void>;
}

function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string'
  );
}

function getFactType(fact: Fact): string | undefined {
  if (
    typeof fact === 'object' &&
    fact !== null &&
    'type' in fact &&
    typeof (fact as { type?: unknown }).type === 'string'
  ) {
    return (fact as { type: string }).type;
  }

  if (
    typeof fact === 'object' &&
    fact !== null &&
    'fact_type' in fact &&
    typeof (fact as { fact_type?: unknown }).fact_type === 'string'
  ) {
    return (fact as { fact_type: string }).fact_type;
  }

  return undefined;
}

function getSourceEventIds(fact: Fact): string[] {
  if (
    typeof fact === 'object' &&
    fact !== null &&
    'sourceEventIds' in fact &&
    Array.isArray((fact as { sourceEventIds?: unknown }).sourceEventIds)
  ) {
    return (fact as { sourceEventIds: string[] }).sourceEventIds;
  }

  if (
    typeof fact === 'object' &&
    fact !== null &&
    'source_event_ids' in fact &&
    Array.isArray((fact as { source_event_ids?: unknown }).source_event_ids)
  ) {
    return (fact as { source_event_ids: string[] }).source_event_ids;
  }

  return [];
}

export class InMemoryStore implements MemoryStore {
  private readonly events = new Map<string, Event>();
  private readonly facts = new Map<string, Fact>();
  private readonly patterns = new Map<string, Pattern>();

  async putEvent(event: Event): Promise<void> {
    if (!hasId(event)) {
      throw new Error('Event must have a string id.');
    }

    this.events.set(event.id, event);
  }

  async putFacts(facts: Fact[]): Promise<void> {
    for (const fact of facts) {
      if (!hasId(fact)) {
        throw new Error('Fact must have a string id.');
      }

      this.facts.set(fact.id, fact);
    }
  }

  async putPatterns(patterns: Pattern[]): Promise<void> {
    for (const pattern of patterns) {
      if (!hasId(pattern)) {
        throw new Error('Pattern must have a string id.');
      }

      this.patterns.set(pattern.id, pattern);
    }
  }

  async getEvent(id: string): Promise<Event | null> {
    return this.events.get(id) ?? null;
  }

  async getFact(id: string): Promise<Fact | null> {
    return this.facts.get(id) ?? null;
  }

  async getPattern(id: string): Promise<Pattern | null> {
    return this.patterns.get(id) ?? null;
  }

  async queryFacts(query: FactQuery = {}): Promise<Fact[]> {
    let results = Array.from(this.facts.values());

    if (query.ids?.length) {
      const ids = new Set(query.ids);
      results = results.filter((fact) => hasId(fact) && ids.has(fact.id));
    }

    if (query.types?.length) {
      const types = new Set(query.types);
      results = results.filter((fact) => {
        const factType = getFactType(fact);
        return factType ? types.has(factType) : false;
      });
    }

    if (query.sourceEventIds?.length) {
      const sourceIds = new Set(query.sourceEventIds);
      results = results.filter((fact) => {
        const linked = getSourceEventIds(fact);
        return linked.some((id) => sourceIds.has(id));
      });
    }

    if (typeof query.limit === 'number') {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async queryPatterns(query: PatternQuery = {}): Promise<Pattern[]> {
    let results = Array.from(this.patterns.values());

    if (query.ids?.length) {
      const ids = new Set(query.ids);
      results = results.filter((pattern) => hasId(pattern) && ids.has(pattern.id));
    }

    if (typeof query.limit === 'number') {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async listEvents(): Promise<Event[]> {
    return Array.from(this.events.values());
  }

  async listFacts(): Promise<Fact[]> {
    return Array.from(this.facts.values());
  }

  async listPatterns(): Promise<Pattern[]> {
    return Array.from(this.patterns.values());
  }

  async deleteEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  async deleteFact(id: string): Promise<void> {
    this.facts.delete(id);
  }

  async deletePattern(id: string): Promise<void> {
    this.patterns.delete(id);
  }

  async clear(): Promise<void> {
    this.events.clear();
    this.facts.clear();
    this.patterns.clear();
  }
}
      
