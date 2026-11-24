// protects=a run with new matches shows one notification whose text names the count and the top score when one exists, and a click opens the new jobs; an unsupported platform shows nothing;
// fails_when=the text uses the wrong plural, drops the top score, shows on an unsupported platform, or a click opens nothing;
// no_claim=the operating system's own delivery and click handling are not exercised; Electron's Notification is wired in the main entry.
import { describe, expect, it } from "vitest";
import type { OpenNewJobsRequest } from "@job-finder/bridge";
import { createTranslator } from "../i18n";
import type { NewJobMatches } from "../scheduler/matches";
import { createNewJobsNotifier, newJobsText, type NotificationSink } from "./new-jobs";

const en = createTranslator("en");
const italian = createTranslator("it");

const matches = (overrides: Partial<NewJobMatches>): NewJobMatches => ({
  count: 2,
  topScore: 88,
  ...overrides,
});

describe("new job notification text", () => {
  it("gives the count and the top match", () => {
    expect(newJobsText(en, matches({}))).toEqual({
      title: "New matching jobs",
      body: "2 new jobs for your profile, top match 88",
    });
  });

  it("uses the singular for one job and leaves out the score when none is scored", () => {
    expect(newJobsText(en, matches({ count: 1, topScore: null })).body).toBe(
      "1 new job for your profile",
    );
  });

  it("is written in Italian for the Italian language", () => {
    expect(newJobsText(italian, matches({})).body).toBe(
      "2 nuove offerte per il tuo profilo, punteggio migliore 88",
    );
  });
});

describe("new job notifier", () => {
  function sink(supported: boolean) {
    const shown: Array<{ body: string; click: () => void }> = [];
    const fake: NotificationSink = {
      isSupported: () => supported,
      show: (text, onClick) => {
        shown.push({ body: text.body, click: onClick });
      },
    };
    return { fake, shown };
  }

  it("shows one notification, and a click opens the new jobs", () => {
    const { fake, shown } = sink(true);
    const opened: OpenNewJobsRequest[] = [];
    const notify = createNewJobsNotifier({
      translate: en,
      sink: fake,
      open: (r) => opened.push(r),
    });

    notify(matches({}));
    expect(shown).toHaveLength(1);
    shown[0]?.click();
    expect(opened).toEqual([{}]);
  });

  it("shows nothing on a platform without notifications", () => {
    const { fake, shown } = sink(false);
    const notify = createNewJobsNotifier({ translate: en, sink: fake, open: () => {} });
    notify(matches({}));
    expect(shown).toEqual([]);
  });
});
