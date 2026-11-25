import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    // §9.1: every model call goes through src/ai/call.ts — provider SDKs may only be imported inside src/ai.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "portkey-ai", message: "Use callModel/embed from @/ai/call." },
            { name: "@google/genai", message: "Use callModel/embed from @/ai/call." },
            { name: "langfuse", message: "Use the tracer in @/ai." },
            { name: "@langfuse/tracing", message: "Use the tracer in @/ai." },
            { name: "@langfuse/otel", message: "Use the tracer in @/ai." },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "drizzle/**",
      "gateway/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
