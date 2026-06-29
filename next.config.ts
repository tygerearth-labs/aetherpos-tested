import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles its own output — no "standalone" needed
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ['21.0.5.102'],
};

export default nextConfig;