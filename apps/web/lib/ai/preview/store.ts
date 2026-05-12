// AI preview short-term storage (Phase D step 3).
//
// AI generation produces a `{ title, content }` preview envelope that
// users review before saving as a document. Per Phase A §15 and
// docs/ai/notive-ai-generation-policy-v1.0.md §12, this body is NOT
// persisted in any permanent table — `ai_requests` and `ai_results`
// only hold metadata. The preview lives in a short-term store with a
// 24-hour idle TTL and is either explicitly discarded by the user or
// silently aged out when the TTL elapses.
//
// This module defines the storage abstraction. The default
// implementation is in-memory (deterministic, used by tests and as
// the development default); a Redis-backed implementation will be
// added when `@notive/redis` exposes a real client, behind the same
// interface so the call sites in `apps/web/lib/services/*` do not
// change.
//
// Key shape:
//   notive:ai:preview:org:{orgId}:user:{userId}:req:{aiRequestId}
//
// Properties of this shape:
//   - The (orgId, userId) prefix prevents cross-org key collisions
//     and makes a peer's `load` attempt look up a different key
//     entirely — they can never read another user's preview because
//     the key they construct doesn't exist.
//   - The aiRequestId is the handle returned to the caller. No
//     separate opaque id is introduced; `aiRequest.id` is enough.
//   - A future Redis implementation can use this exact string as the
//     Redis key without further encoding.

const DEFAULT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface AiPreviewRecord {
  aiRequestId: string;
  organizationId: string;
  userId: string;
  title: string;
  content: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SaveAiPreviewInput {
  aiRequestId: string;
  organizationId: string;
  userId: string;
  title: string;
  content: string;
}

export interface AiPreviewLookup {
  aiRequestId: string;
  organizationId: string;
  userId: string;
}

export interface AiPreviewStore {
  save(input: SaveAiPreviewInput): Promise<{ aiRequestId: string; expiresAt: Date }>;
  /** Returns null when not found, expired, or discarded. Never throws
   *  on miss — the service layer maps null to NOT_FOUND. */
  load(lookup: AiPreviewLookup): Promise<AiPreviewRecord | null>;
  /** Remove the entry. Idempotent — no error when the key is absent. */
  discard(lookup: AiPreviewLookup): Promise<void>;
}

export interface InMemoryStoreOptions {
  /** Clock injection. Tests advance time without sleeping. Default
   *  uses the system clock. */
  now?: () => Date;
  /** Override the 24-hour default (in milliseconds). */
  ttlMs?: number;
}

/**
 * Build the canonical key for a preview record. Exposed for the
 * future Redis adapter and for tests that need to assert key shape.
 */
export function buildPreviewKey(lookup: AiPreviewLookup): string {
  return `notive:ai:preview:org:${lookup.organizationId}:user:${lookup.userId}:req:${lookup.aiRequestId}`;
}

/**
 * In-memory implementation backed by a `Map`. Used as the dev /
 * single-process default and as the test fake. Process-local — does
 * not survive restarts. The Redis-backed implementation will replace
 * the singleton in `default.ts` once the real client is wired.
 */
export function createInMemoryAiPreviewStore(opts: InMemoryStoreOptions = {}): AiPreviewStore {
  const now = opts.now ?? ((): Date => new Date());
  const ttlMs = opts.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;
  const map = new Map<string, AiPreviewRecord>();

  return {
    async save(input: SaveAiPreviewInput): Promise<{ aiRequestId: string; expiresAt: Date }> {
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlMs);
      const key = buildPreviewKey(input);
      map.set(key, {
        aiRequestId: input.aiRequestId,
        organizationId: input.organizationId,
        userId: input.userId,
        title: input.title,
        content: input.content,
        createdAt,
        expiresAt,
      });
      return { aiRequestId: input.aiRequestId, expiresAt };
    },

    async load(lookup: AiPreviewLookup): Promise<AiPreviewRecord | null> {
      const key = buildPreviewKey(lookup);
      const row = map.get(key);
      if (!row) return null;
      if (row.expiresAt.getTime() <= now().getTime()) {
        // Lazy expiry. A future Redis adapter relies on EXPIRE so the
        // server drops the key automatically; the in-memory store
        // checks on read so we don't keep a timer running per entry.
        map.delete(key);
        return null;
      }
      return row;
    },

    async discard(lookup: AiPreviewLookup): Promise<void> {
      map.delete(buildPreviewKey(lookup));
    },
  };
}

export { DEFAULT_PREVIEW_TTL_MS };
