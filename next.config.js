/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise Next.js version
  experimental: {
    serverActions: { bodySizeLimit: '50mb' },
    // Run src/instrumentation.ts at server boot — aligns the DB schema with
    // the code (see src/lib/db/bootstrap.ts) so a code upload can't break on
    // missing columns.
    instrumentationHook: true,
  },

  async headers() {
    return [
      {
        // Security headers on every response
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // Legacy IE/Edge XSS protector (modern browsers ignore but harmless)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Cross-Origin protections
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        // Tighter cache/security on API: never cache responses by intermediaries.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'Vary', value: 'Cookie, Authorization' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
