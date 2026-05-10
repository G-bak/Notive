// Stub for `next/headers` used by route smoke tests.
//
// Next.js's real `cookies()` requires an active request scope (the
// async-local-storage that Next sets up around an HTTP request).
// Outside that scope it throws, which breaks any direct invocation
// of a route handler in tests.
//
// vi.mock did not reliably intercept the dynamic resolution chain
// in pnpm workspaces, so we redirect `next/headers` at the vitest
// resolve level to this stub. Route handlers always pair `cookies()`
// with `getCurrentSession`, and the smoke tests vi.mock that
// session helper to return a pre-set user — so `cookies()` only
// needs to be call-safe; its return value is discarded.

export function cookies(): { get: () => undefined } {
  return { get: () => undefined };
}

export function headers(): { get: () => undefined } {
  return { get: () => undefined };
}
