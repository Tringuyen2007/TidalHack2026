/** @type {import('next').NextConfig} */

const nextConfig = {
  devIndicators: false,
  serverExternalPackages: ['bull', 'ioredis', 'xlsx'],
  experimental: {
    serverActions: {
      bodySizeLimit: '30mb'
    }
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none';"
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
        ],
      },
    ];
  },
};

export default nextConfig;
