import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API responses proxied through /api/platform must never be cached; route
  // handlers set cache-control themselves. Pages are dynamic (cookie-scoped).
  poweredByHeader: false,
};

export default nextConfig;
