import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          include: ["packages/core/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "desktop",
          environment: "node",
          include: ["apps/desktop/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "repo",
          environment: "node",
          include: ["tests/repo/**/*.test.ts"],
        },
      },
    ],
  },
});
