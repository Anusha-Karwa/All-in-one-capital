import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// Migrations default to the dev branch. Set APP_ENV=prod explicitly to migrate prod.
const url = process.env.APP_ENV === "prod" ? process.env.DATABASE_URL : process.env.DATABASE_URL_DEV;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: url ?? "postgres://placeholder" },
  strict: true,
});
