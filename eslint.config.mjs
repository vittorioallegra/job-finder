import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const electronBan = {
  patterns: [
    { group: ["electron", "electron/*"], message: "Only apps/desktop may import Electron." },
  ],
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/out/**", "**/node_modules/**", "**/playwright-report/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...electronBan.patterns,
            { group: ["react", "react-dom", "react/*"], message: "core must not import React." },
            {
              group: ["@job-finder/web", "@job-finder/desktop"],
              message: "core must not import apps.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/bridge/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...electronBan.patterns,
            {
              group: ["@job-finder/web", "@job-finder/desktop"],
              message: "bridge must not import apps.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, i18next },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...electronBan.patterns,
            {
              group: ["@job-finder/desktop", "**/apps/desktop/**"],
              message: "web must not import desktop.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/desktop/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "react-router", "react-i18next"],
              message: "desktop must not import the renderer stack.",
            },
            { group: ["@job-finder/web"], message: "desktop must not import the web app." },
          ],
        },
      ],
    },
  },
);
