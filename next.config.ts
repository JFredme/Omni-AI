import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The version shown in the app comes from package.json, so a release only has to bump it there.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The desktop app bundles a self-contained server. Its build goes to its own folder so it never disturbs a running dev server.
const forDesktop = process.env.OMNI_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  ...(forDesktop ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
  /* config options here */
  // Hides the small Next.js badge that shows in the corner while developing.
  devIndicators: false,
  cacheComponents: true,
  experimental: {
    // Uploads go through the sign-in proxy, which buffers request bodies; the default 10 MB would silently cut files short.
    proxyClientMaxBodySize: "20mb",
  },
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
