# @sovereign/sigil-core

**Memory Core, Normalization, and Signing for the SIGIL Cognitive Operating System.**

This is the Layer A foundation. It owns the contract between extracted meaning (Layer B, handled by `@sovereign/sigil-extractor-contract`) and persisted cognitive memory. Every fact that lives in the graph traveled through here: validated, DID-signed, provenance-anchored to a source event, and handed off to a Memory Store that verifies the signature on every read.

> **Prerequisites:** Read `SIGIL Cognitive Specification v1.0`, sections 1–4 and 5.1–5.3. This package implements §5 (Memory Core), §16 (Human Override boundary), and the `did:sigil:` method specified in §19.1.

---

## What's in here (this release)

```
src/
  types.ts               Signed Event, Fact, Pattern (Specification §5)
  signing.ts             Ed25519, did:sigil method, canonicalization
  normalization.ts       The Layer B → Layer A boundary crossing
  store/
    interface.ts         MemoryStore contract
    memory.ts            In-memory reference implementation
  index.ts               Public surface
tests/
  signing.test.ts        Round-trip, tamper detection, DID enforcement
  normalization.test.ts  End-to-end: event → facts → query
```

## What's NOT in here yet (next phases)

The following modules defined in the Specification are separate packages or subsequent releases of this one:

- `sigil-core`, later releases: Weight Engine, Time Engine, Memory Decay, Privacy Guard
- `sigil-pattern-engine` — frequency, clustering, loop detection
- `sigil-insight-graph` — graph storage and traversal
- `sigil-dual-self` — Stated vs Observed models and Delta Layer
- Encrypted SQLite store backing — this release ships only the in-memory reference implementation

The in-memory store implements the full `MemoryStore` interface. Any Layer A module written against this release will work unchanged against the SQLite-backed store that ships in Phase 1.

---

## Install

```bash
npm install
npm run build
npm test
```

Node 20+.

## The boundary, in 20 lines

```typescript
import {
  InMemoryKeyProvider,
  InMemoryStore,
  normalize,
  signEvent,
} from '@sovereign/sigil-core';

const keys = await InMemoryKeyProvider.generate(); // production: OS keychain
const did = await keys.did();
const store = new InMemoryStore();

// 1. Capture an utterance as an Event. Sign it. Store it.
const event = await signEvent(
  { source: 'mentor', action: 'utterance_captured', timestamp: new Date().toISOString() },
  keys
);
await store.putEvent(event);

// 2. Run the extractor (from sigil-extractor-contract).
const extraction = await extractor.extract({ text, language: 'pl', timestamp, session_id });

// 3. Normalize — this is where Layer B becomes Layer A.
const { facts, rejected } = await normalize(
  extraction,
  { sourceEventIds: [event.id] },
  keys
);

// 4. Persist. Signatures verified on write.
await store.putFacts(facts);
```

## Guarantees enforced in code

**Every Fact in the Store is:**
- Signed by its owner's Cognitive DID (verified on write and on every read path the Store surfaces).
- Traceable to at least one source Event (provenance enforced by the Store, rejects references to unknown events).
- Versioned (the Store's `forkFact` method enforces version continuity; `putFacts` rejects re-insertion of existing IDs).

**Canonicalization is deterministic:**
- Object keys sorted recursively.
- Undefined values stripped.
- Non-finite numbers rejected.
- Two semantically-equal objects produce byte-identical canonical forms regardless of key insertion order.

**Signing keys never leave the KeyProvider:**
- The `KeyProvider` interface is the only abstraction over key material.
- Production implementations back to hardware-isolated stores (iOS Secure Enclave, Android Keystore, libsecret, etc.).
- `InMemoryKeyProvider` is explicitly marked as test/dev only.

**Override flags preserve signature validity:**
- User override actions (suppress, pin, dispute) are stored in sidecar tables in the MemoryStore, not by mutating signed fact content.
- This lets users mark their memory without invalidating the cryptographic trail.

## The did:sigil method (Phase 0 form)

```
did:sigil:z<base64url(ed25519_public_key)>
```

Example:

```
did:sigil:zP9xKvF2nQ8wT3mY6jH4sL1oR5eN7uA0bW9cI2dV8fG
```

The `z` prefix is a multibase sentinel (Phase 0 simplification — Phase 1 upgrades to proper `z6Mk` multicodec-prefixed form per W3C DID spec; signatures are unaffected by the upgrade).

## What's honest about this release

- The canonicalization used for signing is a simple deterministic sort-and-serialize. It handles all shapes SIGIL currently emits. The Phase 1 upgrade to strict RFC 8785 changes some edge cases (Unicode normalization of strings, specific number formatting) but does not affect the signatures of any SIGIL-shaped object.
- The `did:sigil:` method in this release uses a simplified multibase form. Phase 1 ships the full multicodec-prefixed form. DIDs from this release are not wire-compatible with Phase 1 DIDs; reference implementations will ship a migration tool.
- Only the in-memory Store is here. SQLite-backed encrypted Store is the next deliverable.
- Fork semantics in `forkFact` rely on a sidecar `disputed` set rather than re-signing the old fact with `disputed_by_user: true`. This is intentional: the old signed content is cryptographically preserved, and disputed status is tracked as a user-override side effect. The Query Engine sees both.

## License

MIT.
