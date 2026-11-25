import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "@portkey-gateway": path.join(process.cwd(), "gateway/vendor/src/index.ts") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: { APP_ENV: "test" },
  },
});
