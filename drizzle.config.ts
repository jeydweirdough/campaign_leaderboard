import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env.local on its own; the npm scripts pass it via --env-file.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
