// protects=a place typed as a country or an area (EU, Europa, Unione Europea) resolves to country codes, other text stays text, and a remote scope reaches a country only through its name, an area containing it, or a worldwide word;
// fails_when=an area resolves to the wrong countries, a city is read as a country, or the scope words for a country include an area that does not contain it;
// no_claim=the SQL that applies these words is covered by the jobs filter tests in the desktop project;
import { describe, expect, it } from "vitest";
import { remoteScopeTerms, resolvePlace } from "./geo";

describe("resolvePlace", () => {
  it("reads countries in several languages and areas as country codes", () => {
    expect(resolvePlace("Italia")).toEqual({ kind: "countries", codes: ["IT"] });
    expect(resolvePlace("Germany")).toEqual({ kind: "countries", codes: ["DE"] });
    const eu = resolvePlace("UE");
    expect(eu.kind === "countries" && eu.codes).toContain("IT");
    expect(eu.kind === "countries" && eu.codes).not.toContain("GB");
    const europe = resolvePlace("Europa");
    expect(europe.kind === "countries" && europe.codes).toContain("GB");
  });

  it("keeps a city as text", () => {
    expect(resolvePlace(" Milano ")).toEqual({ kind: "text", text: "Milano" });
  });
});

describe("remoteScopeTerms", () => {
  it("names the country, the areas containing it and the world", () => {
    const terms = remoteScopeTerms(["IT"]);
    expect(terms).toEqual(expect.arrayContaining(["italy", "italia", "eu", "europe", "worldwide"]));
    expect(terms).not.toContain("dach");
    expect(terms).not.toContain("north america");
  });
});
