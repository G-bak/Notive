// Mock AI provider adapter (Phase D step 2).
//
// CI-deterministic stand-in for an external AI generation service.
// The real provider adapter (OpenAI / Anthropic / etc.) is deferred
// to a later Phase D step; keeping a mock-first interface lets the
// generation service, the metadata persistence layer, and the
// permission / audit gates be validated end-to-end without touching
// the network.
//
// Body retention: this adapter NEVER writes to the DB. It returns
// `title` and `content` in memory; the calling service is responsible
// for keeping that envelope out of any permanent table. Phase D
// step 1 schema already removes the columns that could hold them.

export interface AiProviderInput {
  documentType: string;
  templateId: string | null;
  purpose: string | null;
  audience: string | null;
  tone: string | null;
  /**
   * Allowed references only. The caller MUST have filtered through
   * `evaluateDocumentPermission` before constructing this list — the
   * provider does not re-check.
   */
  references: ReadonlyArray<{ id: string; title: string | null }>;
}

export interface AiProviderOutput {
  title: string;
  content: string;
  latencyMs: number;
  tokenCountInput: number;
  tokenCountOutput: number;
}

export interface AiProvider {
  generate(input: AiProviderInput): Promise<AiProviderOutput>;
}

export interface MockProviderOptions {
  /**
   * Force the adapter to throw `MockProviderError(errorCode)` instead
   * of returning a result. Used by the Step 2 integration test to
   * drive the Failed lifecycle without flaking on real-world
   * provider latency.
   */
  forceFailure?: string;
}

export class MockProviderError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string) {
    super(`mock provider failed: ${errorCode}`);
    this.name = "MockProviderError";
    this.errorCode = errorCode;
  }
}

/**
 * Construct a deterministic mock provider. The returned object has a
 * single `generate` method. Output is derived purely from the input
 * so test assertions can pin the shape; no randomness, no clocks.
 */
export function createMockAiProvider(opts: MockProviderOptions = {}): AiProvider {
  return {
    async generate(input: AiProviderInput): Promise<AiProviderOutput> {
      if (opts.forceFailure) {
        throw new MockProviderError(opts.forceFailure);
      }
      const refSummary =
        input.references.length === 0
          ? "no references"
          : `references: ${input.references.map((r) => r.title ?? r.id).join(", ")}`;
      const lines: string[] = [`Document type: ${input.documentType}`];
      if (input.purpose) lines.push(`Purpose: ${input.purpose}`);
      if (input.audience) lines.push(`Audience: ${input.audience}`);
      if (input.tone) lines.push(`Tone: ${input.tone}`);
      lines.push(refSummary);
      return {
        title: `[mock] ${input.documentType}`,
        content: lines.join("\n"),
        latencyMs: 5,
        tokenCountInput: 10 + input.references.length * 2,
        tokenCountOutput: 50,
      };
    },
  };
}
