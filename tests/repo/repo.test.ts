// protects=every test file carries the card comment and CLAUDE.md stays short and free of @-includes;
// fails_when=a test file lacks the protects/fails_when/no_claim card, CLAUDE.md is missing, over 80 lines, or uses an @path import;
// no_claim=the content of CLAUDE.md beyond these structural rules is not checked here.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const SKIPPED = new Set(["node_modules", ".git", "out", "dist", "coverage"]);

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) {
      continue;
    }
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, found);
    } else if (/\.(test|spec)\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("repository conventions", () => {
  it("gives every test file the card comment", () => {
    const missing = walk(root).filter((file) => {
      const head = readFileSync(file, "utf8").slice(0, 1000);
      return !(
        head.includes("// protects=") &&
        head.includes("fails_when=") &&
        head.includes("no_claim=")
      );
    });
    expect(missing.map((file) => relative(root, file))).toEqual([]);
  });

  it("keeps CLAUDE.md short and free of @-imports", () => {
    const path = join(root, "CLAUDE.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content.split("\n").length).toBeLessThanOrEqual(80);
    expect(content).not.toMatch(/^@\S/m);
  });
});
