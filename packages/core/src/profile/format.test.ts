// protects=CV dates in the usual shapes read as YYYY-MM, YYYY or present, language levels read as CEFR codes or native, and a profile saved with a field of study keeps it in the degree;
// fails_when=a common date shape ("03/2021", "marzo 2021", "presente") is not read, an unknown shape is guessed, a level is invented from a word like "fluent", or an old profile's field of study is lost or refused;
// no_claim=dates written as ranges in one value ("2012 – 2014") are not read; they stay as written for the user to pick.
import { describe, expect, it } from "vitest";
import { ProfileSchema, emptyProfile } from "./schema";
import { formatProfileDate, parseLanguageLevel, parseProfileDate } from "./format";

const stored = (text: string) => {
  const parsed = parseProfileDate(text);
  return parsed === null ? null : formatProfileDate(parsed);
};

describe("profile dates and levels", () => {
  it("reads the date shapes CVs use", () => {
    expect(stored("03/2021")).toBe("2021-03");
    expect(stored("2021-3")).toBe("2021-03");
    expect(stored("2018")).toBe("2018");
    expect(stored("marzo 2021")).toBe("2021-03");
    expect(stored("Sept. 2019")).toBe("2019-09");
    expect(stored("15/06/2020")).toBe("2020-06");
    expect(stored(" Presente ")).toBe("present");
    expect(stored("in corso")).toBe("present");
  });

  it("leaves an unknown shape unread instead of guessing", () => {
    expect(stored("2012 – 2014")).toBeNull();
    expect(stored("13/2021")).toBeNull();
    expect(stored("spring 2020")).toBeNull();
    expect(stored("")).toBeNull();
  });

  it("reads CEFR levels and native speakers, and nothing from vaguer words", () => {
    expect(parseLanguageLevel("C1 (IELTS 7.5)")).toBe("C1");
    expect(parseLanguageLevel("b2")).toBe("B2");
    expect(parseLanguageLevel("Madrelingua")).toBe("native");
    expect(parseLanguageLevel("Native speaker")).toBe("native");
    expect(parseLanguageLevel("Fluent")).toBeNull();
  });

  it("keeps an old profile's field of study in its degree", () => {
    const profile = ProfileSchema.parse({
      ...emptyProfile(),
      education: [
        {
          institution: "PoliMi",
          degree: "BSc",
          field: "Computer Engineering",
          startDate: "",
          endDate: "",
        },
        {
          institution: "PoliTo",
          degree: "Laurea in Informatica",
          field: "Informatica",
          startDate: "",
          endDate: "",
        },
      ],
    });
    expect(profile.education.map((item) => [item.degree, item.grade])).toEqual([
      ["BSc, Computer Engineering", ""],
      ["Laurea in Informatica", ""],
    ]);
  });
});
