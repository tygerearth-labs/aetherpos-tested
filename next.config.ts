import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles its own output — no "standalone" needed
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ── Cache-Control headers for build-guard critical files ───────────────
  //
  // /sw.js MUST NEVER be cached by the browser or any CDN/edge. A stale
  // /sw.js locks the entire app into an old Service Worker lifecycle and is
  // the root cause of "Ctrl+Shift+R required to restore the app" bugs. The
  // browser must always re-fetch /sw.js on every navigation so a new deploy
  // is detected immediately.
  //
  // /api/build-version is also marked here as a belt-and-suspenders measure
  // (the route handler sets the same headers at response time).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/api/build-version",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;