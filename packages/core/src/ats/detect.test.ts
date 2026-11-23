// protects=ATS detection routes a careers URL to its provider and board token, and returns unknown for pages that are not an ATS board;
// fails_when=a URL of one provider is detected as another, a board token is lost or taken from the wrong part of the URL, a non-ATS company site is detected, or a page's embedded ATS link is ignored;
// no_claim=every ATS URL layout in use, and sites that embed an ATS through a script with no link in the markup.
import { describe, expect, it } from "vitest";
import { detectAts, detectAtsFromUrl } from "./index";

const URLS: Array<[string, string, string | undefined]> = [
  ["https://boards.greenhouse.io/stripe", "greenhouse", "stripe"],
  ["https://job-boards.greenhouse.io/airbnb/jobs/6111111", "greenhouse", "airbnb"],
  ["https://jobs.lever.co/leverdemo", "lever", "leverdemo"],
  ["https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b", "lever", "leverdemo"],
  ["https://jobs.ashbyhq.com/ashby", "ashby", "ashby"],
  ["https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2", "ashby", "ashby"],
  ["https://apply.workable.com/flosum/", "workable", "flosum"],
  ["https://apply.workable.com/flosum/j/422E2F2C4A/", "workable", "flosum"],
  ["https://jobs.smartrecruiters.com/SmartRecruiters", "smartrecruiters", "SmartRecruiters"],
  [
    "https://jobs.smartrecruiters.com/smartrecruiters/744000158320111-engineer",
    "smartrecruiters",
    "smartrecruiters",
  ],
  ["https://personio.jobs.personio.de/", "personio", "personio"],
  ["https://acme.jobs.personio.com/job/123", "personio", "acme"],
  ["https://personio.recruitee.com/", "recruitee", "personio"],
  ["https://personio.recruitee.com/o/api-job-berlin", "recruitee", "personio"],
  ["https://career.teamtailor.com/jobs", "teamtailor", "career"],
  ["https://acme.teamtailor.com/jobs/8746132-engineer", "teamtailor", "acme"],
];

const NOT_ATS = [
  "https://www.stripe.com/careers",
  "https://example.com/jobs",
  "https://careers.google.com/jobs/results/",
];

describe("detectAtsFromUrl", () => {
  it.each(URLS)("detects %s as %s with board %s", (url, ats, slug) => {
    expect(detectAtsFromUrl(url)).toEqual({ ats, slug });
  });

  it("returns unknown for company sites that are not ATS boards", () => {
    for (const url of NOT_ATS) expect(detectAtsFromUrl(url), url).toBeUndefined();
  });

  it("refuses non-web schemes and malformed URLs", () => {
    expect(detectAtsFromUrl("ftp://jobs.lever.co/acme")).toBeUndefined();
    expect(detectAtsFromUrl("not a url")).toBeUndefined();
  });

  it("does not take the embed script's file name as a board token", () => {
    expect(detectAtsFromUrl("https://boards.greenhouse.io/embed/job_board/js?for=acme")).toEqual({
      ats: "greenhouse",
      slug: "acme",
    });
  });
});

describe("detectAts with page markers", () => {
  it("finds the ATS from a board link in the page", () => {
    const html = `<html><body><a href="https://jobs.lever.co/acme">Open roles</a></body></html>`;
    expect(detectAts({ url: "https://www.acme.test/careers", html })).toEqual({
      ats: "lever",
      slug: "acme",
    });
  });

  it("finds the Greenhouse embed from its script URL", () => {
    const html = `<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`;
    expect(detectAts({ url: "https://www.acme.test/careers", html })).toEqual({
      ats: "greenhouse",
      slug: "acme",
    });
  });

  it("returns unknown for a page with no ATS link", () => {
    const html = `<html><body><a href="https://www.acme.test/about">About</a></body></html>`;
    expect(detectAts({ url: "https://www.acme.test/careers", html })).toBeUndefined();
  });

  it("prefers the URL over the page", () => {
    const html = `<a href="https://jobs.lever.co/other">x</a>`;
    expect(detectAts({ url: "https://apply.workable.com/acme/", html })).toEqual({
      ats: "workable",
      slug: "acme",
    });
  });
});
