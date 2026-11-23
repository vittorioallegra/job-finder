// protects=log files stay bounded by rotation and never store credential-like values;
// fails_when=the active file grows past maxBytes without rotating, more than maxFiles rotated files are kept, or a token pattern is written unredacted;
// no_claim=log delivery to the OS console and log levels filtering are not covered here.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileLogger, redactSecrets } from "./file-logger";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "job-finder-log-"));
}

describe("file logger", () => {
  it("rotates the active file once it exceeds maxBytes and keeps at most maxFiles rotated files", () => {
    const directory = tempDir();
    const logger = createFileLogger({ directory, maxBytes: 300, maxFiles: 2 });
    for (let index = 0; index < 40; index += 1) {
      logger.log("info", `line ${index} ${"x".repeat(40)}`);
    }
    const names = readdirSync(directory).sort();
    expect(names).toEqual(["main.log", "main.log.1", "main.log.2"]);
    expect(readFileSync(logger.filePath, "utf8").length).toBeLessThanOrEqual(300);
  });

  it("redacts secrets before writing them to disk", () => {
    const directory = tempDir();
    const logger = createFileLogger({ directory });
    logger.log("error", "request failed with api_key=abc123SECRET and Bearer eyJhbGciOi.payload");
    const content = readFileSync(logger.filePath, "utf8");
    expect(content).not.toContain("abc123SECRET");
    expect(content).not.toContain("eyJhbGciOi.payload");
    expect(content).toContain("[REDACTED]");
  });
});

describe("redactSecrets", () => {
  it("masks OpenAI-style keys and password assignments", () => {
    expect(redactSecrets("key sk-proj-ABCDEFGH12345")).toBe("key [REDACTED]");
    expect(redactSecrets('{"password": "hunter2"}')).toBe('{"password": "[REDACTED]"}');
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("window opened in 120 ms")).toBe("window opened in 120 ms");
  });
});
