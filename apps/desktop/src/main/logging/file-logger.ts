import { appendFileSync, mkdirSync, renameSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export interface FileLoggerOptions {
  directory: string;
  fileName?: string;
  /** Rotate the active file once it would grow beyond this size in bytes. */
  maxBytes?: number;
  /** Number of rotated files kept besides the active one. */
  maxFiles?: number;
}

export interface FileLogger {
  readonly filePath: string;
  log(level: LogLevel, message: string): void;
}

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [
    /((?:api[_-]?key|access[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
    "$1[REDACTED]",
  ],
];

/** Removes credential-like values. Applied at the sink so no caller can bypass it. */
export function redactSecrets(text: string): string {
  return REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

/** Creates a line-based logger that rotates by size and redacts secrets before writing. */
export function createFileLogger(options: FileLoggerOptions): FileLogger {
  const fileName = options.fileName ?? "main.log";
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxFiles = options.maxFiles ?? 3;
  const filePath = join(options.directory, fileName);
  mkdirSync(options.directory, { recursive: true });

  function rotateIfNeeded(incomingBytes: number): void {
    if (!existsSync(filePath) || statSync(filePath).size + incomingBytes <= maxBytes) {
      return;
    }
    rmSync(`${filePath}.${maxFiles}`, { force: true });
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = `${filePath}.${index}`;
      if (existsSync(from)) {
        renameSync(from, `${filePath}.${index + 1}`);
      }
    }
    renameSync(filePath, `${filePath}.1`);
  }

  return {
    filePath,
    log(level, message) {
      const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redactSecrets(message)}\n`;
      rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(filePath, line, "utf8");
    },
  };
}
