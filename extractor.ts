/**
 * Public Extractor contract.
 *
 * Layer A modules (sigil-core, sigil-pattern-engine, etc.) import the
 * Extractor interface from this module and nothing else from this package.
 * This keeps the dependency graph one-directional:
 *
 *   Layer A --> Extractor interface <-- Layer B implementations
 *
 * Layer A is never coupled to a specific extractor implementation.
 */

export type {
  Extractor,
  ExtractorKind,
  ExtractorCapabilities,
  RawUtterance,
  FactCandidate,
  FactType,
  ExtractionResult,
  RoutingDecision,
  PrivacyMode,
} from './types.js';
