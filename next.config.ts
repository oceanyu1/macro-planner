import type { NextConfig } from "next";

// cacheComponents is off on purpose: every screen in this single-user app reads
// the session and the database, so there is no static shell worth prerendering.
const nextConfig: NextConfig = {
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
