// protects=CSV cells quote commas, quotes and line breaks, neutralise spreadsheet formulas with a leading apostrophe, and write null as an empty cell;
// fails_when=a cell with a comma or quote is not quoted, a value starting with = + - @ or a tab reaches the file unescaped, or null prints as the word null;
// no_claim=how a particular spreadsheet program opens the file, and the encoding of the file on disk, are not checked here;
import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "./csv";

describe("CSV export escaping", () => {
  it("quotes fields with commas, quotes or line breaks, doubling inner quotes", () => {
    expect(csvField("Backend, Milan")).toBe('"Backend, Milan"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField("plain")).toBe("plain");
  });

  it("prefixes a formula-like value with an apostrophe so a spreadsheet does not run it", () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField("+1 555")).toBe("'+1 555");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("@sum")).toBe("'@sum");
    expect(csvField("\tTAB")).toBe("'\tTAB");
    expect(csvField("a=b")).toBe("a=b");
  });

  it("also catches a formula after leading spaces or written with full-width characters, and leaves numbers alone", () => {
    expect(csvField(" =SUM(A1)")).toBe("' =SUM(A1)");
    expect(csvField("\u00a0@cmd")).toBe("'\u00a0@cmd");
    expect(csvField("\uff1dSUM(A1)")).toBe("'\uff1dSUM(A1)");
    expect(csvField("\uff0b1")).toBe("'\uff0b1");
    expect(csvField("\uff0d1")).toBe("'\uff0d1");
    expect(csvField("\uff20x")).toBe("'\uff20x");
    expect(csvField(-5)).toBe("-5");
  });

  it("writes null as an empty cell and joins rows with CRLF after the header", () => {
    expect(csvField(null)).toBe("");
    expect(
      toCsv(
        ["Company", "Note"],
        [
          ["Acme", null],
          ["Beta", "ok"],
        ],
      ),
    ).toBe("Company,Note\r\nAcme,\r\nBeta,ok\r\n");
  });
});
