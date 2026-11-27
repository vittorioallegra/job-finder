// protects=the profile screen shows the saved profile for editing, links to onboarding when no profile exists, and shows an error with retry when the read fails;
// fails_when=the review checks or the written review are not shown, a cloud provider is called without the agreement, the AI off offers a review, a saved profile is not shown, a missing profile shows an empty editor instead of the onboarding link, or a failed read shows a blank page;
// no_claim=the layout of the screen and the stored version number are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  aiConsentTarget,
  emptyProfile,
  type ProfileReviewView,
} from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { ProfileScreen } from "./ProfileScreen";

describe("profile screen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(bridgeFactory: () => ReturnType<typeof createMemoryBridge>) {
    const bridge = bridgeFactory();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <ProfileScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows the saved headline in the editor", async () => {
    await render(() =>
      createMemoryBridge({ profile: { ...emptyProfile(), headline: "Data Engineer" } }),
    );
    const headline = container.querySelector<HTMLInputElement>(
      "#" + CSS.escape(labelFor("Headline")),
    );
    expect(headline?.value).toBe("Data Engineer");
  });

  it("links to onboarding when no profile is saved yet", async () => {
    await render(() => createMemoryBridge());
    const link = container.querySelector<HTMLAnchorElement>('a[href="/onboarding"]');
    expect(link?.textContent).toBe("Set up from a CV");
    expect(container.querySelector("form")).toBeNull();
  });

  it("shows an error with a retry when the profile cannot be read", async () => {
    await render(() => {
      const bridge = createMemoryBridge();
      bridge.profile.get = async () => {
        throw new Error("read failed");
      };
      return bridge;
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    expect(container.querySelector("form")).toBeNull();
  });

  const view = (overrides: Partial<ProfileReviewView> = {}): ProfileReviewView => ({
    hasProfile: true,
    findings: [
      { code: "short-summary", section: "summary", severity: "medium", params: { length: 17 } },
      { code: "no-links", section: "links", severity: "low", params: {} },
      {
        code: "market-skill-missing",
        section: "skills",
        severity: "high",
        params: { skill: "Kubernetes", percent: 70, jobs: 21 },
      },
      {
        code: "experience-no-bullets",
        section: "experience",
        severity: "high",
        params: { count: 2 },
      },
    ],
    marketJobs: 30,
    ai: { enabled: true, needsConsent: true, review: null, reviewedAt: null },
    ...overrides,
  });
  const cloud = {
    ...DEFAULT_APP_SETTINGS,
    ai: { ...DEFAULT_APP_SETTINGS.ai, enabled: true, provider: "anthropic" as const, model: "m" },
  };

  it("shows the checks with their sentences, counts and sections, and how many postings the skills were compared with", async () => {
    await render(() => createMemoryBridge({ profile: emptyProfile(), profileReview: view() }));
    const text = container.textContent ?? "";
    expect(text).toContain("Profile review");
    expect(text).toContain("The summary is only 17 characters.");
    expect(text).toContain(
      "Kubernetes is named in 70% of the postings for your roles (21 postings)",
    );
    expect(text).toContain("2 roles have no detail.");
    expect(text).toContain("Skills compared with 30 postings for your roles.");
    expect(text).toContain("4 findings");
    expect(text).toContain("Important");
    expect(text).toContain("Minor");
  });

  it("says the checks found nothing, and with the AI off points to Settings and the Evaluate button is disabled", async () => {
    await render(() =>
      createMemoryBridge({
        profile: emptyProfile(),
        profileReview: view({
          findings: [],
          marketJobs: 0,
          ai: { enabled: false, needsConsent: false, review: null, reviewedAt: null },
        }),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("The checks found nothing to fix.");
    expect(text).toContain("The AI is off.");
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    const evaluate = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Evaluate",
    );
    expect(evaluate?.disabled).toBe(true);
  });

  it("asks for the agreement before sending the profile to a cloud provider, then shows the written review", async () => {
    const memory = createMemoryBridge({
      settings: cloud,
      profile: emptyProfile(),
      profileReview: view(),
    });
    const reviewAi = vi.fn(async () => ({
      ok: true as const,
      review: {
        summary: "A focused profile.",
        suggestions: [
          {
            section: "experience" as const,
            title: "Add scale to the Acme role",
            advice: "Say what the service handled.",
            example: "Cut latency by 40%.",
          },
        ],
      },
      reviewedAt: 1_700_000_000_000,
    }));
    await render(() => ({ ...memory, profile: { ...memory.profile, reviewAi } }));
    const start = () =>
      [...container.querySelectorAll("button")].find((node) => node.textContent === "Evaluate")!;
    expect(start().disabled).toBe(true);
    expect(container.textContent).toContain("is sent to Anthropic");

    const box = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (node) => node.closest("label")?.textContent?.includes("I agree to send it"),
    )!;
    await act(async () => box.click());
    expect(start().disabled).toBe(false);
    await act(async () => start().click());
    await act(async () => {});

    expect(reviewAi).toHaveBeenCalledWith({
      consent: true,
      consentTarget: aiConsentTarget(cloud.ai),
    });
    const text = container.textContent ?? "";
    expect(text).toContain("A focused profile.");
    expect(text).toContain("Add scale to the Acme role");
    expect(text).toContain("Cut latency by 40%.");
    expect(text).toContain("It is kept until your profile changes.");
  });

  it("shows why the written review failed", async () => {
    const memory = createMemoryBridge({
      profile: emptyProfile(),
      profileReview: view({
        ai: { enabled: true, needsConsent: false, review: null, reviewedAt: null },
      }),
      profileReviewAi: { ok: false, code: "invalid-key" },
    });
    await render(() => memory);
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Evaluate")!
        .click(),
    );
    await act(async () => {});
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "rejected the API key",
    );
  });

  function labelFor(text: string): string {
    const label = [...container.querySelectorAll("label")].find(
      (node) => node.textContent === text,
    );
    return label?.htmlFor ?? "";
  }
});
