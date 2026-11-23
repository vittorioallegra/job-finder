// Builds the body of a draft GitHub Release from Conventional Commit subjects.
// CLI: node scripts/release-notes.mjs --version 0.1.0 [--previous v0.0.9] [--assets <dir>]
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["ci", "Build and CI"],
  ["build", "Build and CI"],
  ["chore", "Maintenance"],
];

const INSTALLER_PATTERN = /\.(dmg|exe|AppImage|deb)$/;
const SUBJECT_PATTERN = /^(\w+)(\([^)]*\))?(!)?:\s+(.+)$/;

/** Groups commit subjects by Conventional Commit type; unknown subjects go to "Other". */
export function groupCommits(subjects) {
  const groups = new Map();
  for (const subject of subjects.map((line) => line.trim()).filter(Boolean)) {
    const match = SUBJECT_PATTERN.exec(subject);
    const type = match?.[1]?.toLowerCase();
    const section = SECTIONS.find(([key]) => key === type)?.[1] ?? "Other";
    const text = match ? `${match[4]}${match[2] ? ` (${match[2].slice(1, -1)})` : ""}` : subject;
    const breaking = Boolean(match?.[3]);
    const entries = groups.get(section) ?? [];
    entries.push(breaking ? `**Breaking:** ${text}` : text);
    groups.set(section, entries);
  }
  return groups;
}

/** Markdown body for the draft release: changes by section, installers, and the unsigned-app note. */
export function buildReleaseNotes({ version, subjects, installers }) {
  const order = [...new Set([...SECTIONS.map(([, title]) => title), "Other"])];
  const groups = groupCommits(subjects);
  const lines = [`## Job Finder ${version}`, ""];

  for (const title of order) {
    const entries = groups.get(title);
    if (!entries?.length) {
      continue;
    }
    lines.push(`### ${title}`, "");
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  lines.push("### Installers", "");
  if (installers.length === 0) {
    lines.push("- No installers were attached to this build.");
  }
  for (const name of installers) {
    lines.push(`- \`${name}\``);
  }
  lines.push(
    "",
    "### Opening unsigned apps",
    "",
    "The installers are not code-signed. macOS and Windows show a warning the first time you",
    "open the app. See `docs/release.md` for the steps to open it.",
    "",
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`expected --name value pairs, got "${key ?? ""}"`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.version) {
    throw new Error("missing --version");
  }
  const range = args.previous ? `${args.previous}..HEAD` : "HEAD";
  const subjects = execFileSync("git", ["log", "--format=%s", range], { encoding: "utf8" })
    .split("\n");
  const installers = args.assets
    ? readdirSync(args.assets)
        .filter((name) => INSTALLER_PATTERN.test(name))
        .sort()
    : [];
  process.stdout.write(buildReleaseNotes({ version: args.version, subjects, installers }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
