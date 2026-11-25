import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "unpdf"],
  // Portkey's open-source gateway, vendored by gateway/vendor.sh and run in-process (D-042).
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@portkey-gateway": path.join(process.cwd(), "gateway/vendor/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
