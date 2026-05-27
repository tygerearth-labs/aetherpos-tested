import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['dexie', 'dexie-react-hooks'],
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'xlsx', 'sharp'],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
      {
        // API routes — stricter CSP
        source: '/api/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
