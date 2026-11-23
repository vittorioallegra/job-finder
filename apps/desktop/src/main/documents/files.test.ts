// protects=the exported PDF path is the application's own folder and the document kind, and an application id that could leave that folder is refused;
// fails_when=a path is built from an id that contains a separator or a dot segment, or a document is written under another application's folder;
// no_claim=the file system is not touched here; only the path is built and checked;
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentFilePath } from "./files";

describe("documentFilePath", () => {
  it("places the PDF in the application's folder, named by its kind", () => {
    expect(documentFilePath("/data/applications", "a1-b2", "cv")).toBe(
      join("/data/applications", "a1-b2", "cv.pdf"),
    );
    expect(documentFilePath("/data/applications", "a1", "cover-letter")).toBe(
      join("/data/applications", "a1", "cover-letter.pdf"),
    );
  });

  it("refuses an id that could name a path outside the root", () => {
    for (const id of ["../etc", "a/b", "a\\b", "", ".", "a.b"]) {
      expect(() => documentFilePath("/data/applications", id, "cv")).toThrow(
        "invalid application id",
      );
    }
  });
});
