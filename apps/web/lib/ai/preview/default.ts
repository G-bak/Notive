// Default AI preview store singleton (Phase D step 3).
//
// `generateAiDocument` and the read-side service entry points use
// this singleton when the caller does not inject an explicit store
// via `opts.previewStore`. Currently in-memory; a Redis-backed store
// will replace this instance once `@notive/redis` exposes a real
// client, without changing any call site.

import { type AiPreviewStore, createInMemoryAiPreviewStore } from "./store";

export const defaultAiPreviewStore: AiPreviewStore = createInMemoryAiPreviewStore();
