// protects=draft release notes group Conventional Commits by type, flag breaking changes, list installers and explain how to open unsigned apps;
// fails_when=a feat or fix lands in the wrong section, a breaking change is not flagged, unknown subjects are dropped, or the installer list or unsigned note is missing;
// no_claim=the git range handling of the CLI and the GitHub Release creation itself are checked by the desktop release workflow, not here.
import { describe, expect, it } from "vitest";
import { buildReleaseNotes, groupCommits } from "./release-notes.mjs";

describe("groupCommits", () => {
  it("groups subjects by type and keeps unknown subjects under Other", () => {
    const groups = groupCommits([
      "feat(engine): add restart",
      "fix: keep runs consistent",
      "ci: add workflow",
      "Merge branch main",
    ]);
    expect(groups.get("Features")).toEqual(["add restart (engine)"]);
    expect(groups.get("Fixes")).toEqual(["keep runs consistent"]);
    expect(groups.get("Build and CI")).toEqual(["add workflow"]);
    expect(groups.get("Other")).toEqual(["Merge branch main"]);
  });

  it("flags breaking changes marked with an exclamation mark", () => {
    const groups = groupCommits(["feat!: drop the legacy database file"]);
    expect(groups.get("Features")).toEqual(["**Breaking:** drop the legacy database file"]);
  });
});

describe("buildReleaseNotes", () => {
  it("lists installers and the unsigned-app note, and omits empty sections", () => {
    const notes = buildReleaseNotes({
      version: "0.2.0",
      subjects: ["fix: close the engine port"],
      installers: ["Job Finder-0.2.0-arm64.dmg", "Job Finder-0.2.0-x64.exe"],
    });
    expect(notes).toContain("## Job Finder 0.2.0");
    expect(notes).toContain("### Fixes\n\n- close the engine port");
    expect(notes).not.toContain("### Features");
    expect(notes).toContain("- `Job Finder-0.2.0-x64.exe`");
    expect(notes).toContain("### Opening unsigned apps");
    expect(notes).toContain("docs/release.md");
  });

  it("says so when no installers were attached", () => {
    const notes = buildReleaseNotes({ version: "0.2.0", subjects: [], installers: [] });
    expect(notes).toContain("No installers were attached to this build.");
  });
});
