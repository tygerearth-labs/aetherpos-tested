import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles its own output — no "standalone" needed
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;