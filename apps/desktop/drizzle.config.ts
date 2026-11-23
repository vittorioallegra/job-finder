import { defineConfig } from "drizzle-kit";

// Schema lives in the pure core package; migrations are generated here and shipped with the app.
export default defineConfig({
  dialect: "sqlite",
  schema: "../../packages/core/src/db/schema.ts",
  out: "./drizzle",
});
