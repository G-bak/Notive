/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // Enables apps/web/instrumentation.ts, which validates env at server start.
    instrumentationHook: true,
  },
};

export default nextConfig;
