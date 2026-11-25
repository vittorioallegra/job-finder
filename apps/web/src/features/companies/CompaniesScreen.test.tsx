// protects=the sources page finds companies for the profile's roles (also on ?discover=1) or points to the profile without roles, shows what the background reading is doing, lists each company with its last scan and country in a panel that starts closed with its count and failures, lets a company be excluded, lists the excluded ones with who excluded them and brings one back, and shows an error with a retry when the list cannot be read;
// fails_when=a last scan is missing or wrong, the list starts open or hides its failures, a removed company stays listed, a failed read shows a blank page, or the page offers to add a company by hand;
// no_claim=layout, keyboard focus order and the real search sources are not checked here; the core discovery tests and the engine runtime tests cover the search;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyPreferences,
  emptyProfile,
  type CompanyRecord,
  type JobFinderBridge,
} from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { CompaniesScreen } from "./CompaniesScreen";

const acme: CompanyRecord = {
  id: "co-1",
  name: "Acme",
  careersUrl: "https://boards.greenhouse.io/acme",
  ats: "greenhouse",
  slug: "acme",
  createdAt: 1,
  country: "IT",
  lastScan: { outcome: "scanned", at: 5, jobCount: 4, closedCount: 1 },
};

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`no button ${text}`);
  }
  return found;
}

describe("companies screen", () => {
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

  async function render(bridge: JobFinderBridge) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <CompaniesScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows the empty state when no company is saved yet", async () => {
    await render(createMemoryBridge());

    expect(container.textContent).toContain("No companies yet.");
  });

  it("lists each company with its board or careers page and last scan, inside a closed panel with the count and the failures", async () => {
    const failed: CompanyRecord = {
      ...acme,
      id: "co-2",
      name: "Globex",
      careersUrl: "https://example.com/careers",
      ats: null,
      slug: null,
      country: null,
      lastScan: null,
    };
    const empty: CompanyRecord = {
      ...acme,
      id: "co-3",
      name: "Initech",
      careersUrl: "https://jobs.lever.co/initech",
      ats: "lever",
      slug: "initech",
      lastScan: { outcome: "scanned", at: 6, jobCount: 0, closedCount: 0 },
    };
    const broken: CompanyRecord = {
      ...acme,
      id: "co-4",
      name: "Umbrella",
      careersUrl: "https://boards.greenhouse.io/umbrella",
      slug: "umbrella",
      lastScan: { outcome: "failed", at: 7, code: "http-status" },
    };
    await render(createMemoryBridge({ companies: [acme, failed, empty, broken] }));

    expect(container.textContent).toContain("Job page on greenhouse");
    // Where each company is based, or that it is not known yet.
    expect(container.textContent).toContain("Based in Italy");
    expect(container.textContent).toContain("Country not known yet");
    expect(container.textContent).toContain("Last scan: 4 postings read, 1 closed.");
    expect(container.textContent).toContain("No parseable jobs in the last scan.");
    expect(container.textContent).toContain("Last scan failed: the site answered with an error.");
    expect(container.textContent).toContain("Not scanned yet.");
    expect(container.textContent).toContain("Careers page, read with AI");
    expect(
      [...container.querySelectorAll("button")].some((node) => node.textContent === "Scan again"),
    ).toBe(false);
    const panel = container.querySelector("details");
    expect(panel?.open).toBe(false);
    expect(panel?.querySelector("summary")?.textContent).toContain("4 companies followed");
    expect(panel?.querySelector("summary")?.textContent).toContain("1 not read in the last scan");
  });

  it("excludes a company from the sources and lists the rest", async () => {
    const memory = createMemoryBridge({ companies: [acme] });
    const remove = vi.fn(memory.companies.remove);
    await render({ ...memory, companies: { ...memory.companies, remove } });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Exclude Acme from the sources"]')!
        .click();
    });
    await act(async () => {});
    expect(remove).toHaveBeenCalledWith(acme.id);
    expect(container.textContent).not.toContain(acme.careersUrl);
  });

  it("lists the excluded companies with who excluded them, and brings one back", async () => {
    const memory = createMemoryBridge({ companies: [] });
    let left = [
      {
        id: "x1",
        name: "Far Away",
        careersUrl: "https://boards.greenhouse.io/far",
        ats: "greenhouse",
        country: "US",
        excludedAt: 5,
        reason: "auto" as const,
      },
    ];
    const restore = vi.fn(async () => {
      left = [];
      return true;
    });
    await render({
      ...memory,
      companies: { ...memory.companies, excluded: async () => left, restore },
    });
    expect(container.textContent).toContain("1 company excluded");
    expect(container.textContent).toContain("Excluded by the app: no job in your places");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Bring back Far Away"]')!
        .click();
    });
    await act(async () => {});
    expect(restore).toHaveBeenCalledWith("x1");
    expect(container.textContent).not.toContain("company excluded");
  });

  it("finds companies for the profile's roles on ?discover=1 and says what it added", async () => {
    const memory = createMemoryBridge({
      companies: [acme],
      profile: {
        ...emptyProfile(),
        preferences: { ...emptyPreferences(), roles: ["Backend Engineer"] },
      },
      profileDiscovery: { ok: true, found: 3, added: 2, runStarted: true },
    });
    const fromProfile = vi.fn(memory.discovery.fromProfile);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/companies?discover=1"]}>
          <BridgeProvider bridge={{ ...memory, discovery: { ...memory.discovery, fromProfile } }}>
            <CompaniesScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
    await act(async () => {});
    expect(fromProfile).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("companies hiring as Backend Engineer");
    expect(container.textContent).toContain("Added 2 new companies out of 3 found.");
    expect(container.textContent).toContain("Their jobs are being read now.");
  });

  it("shows what the background reading is doing, and how much it stored once it ended", async () => {
    const memory = createMemoryBridge({ companies: [] });
    const withStatus = (status: { running: boolean; phase: "boards" | null; stored: number }) =>
      ({
        ...memory,
        discovery: { ...memory.discovery, backgroundStatus: async () => status },
      }) as JobFinderBridge;

    await render(withStatus({ running: true, phase: "boards", stored: 7 }));
    expect(container.textContent).toContain("2000 at a time. Stored so far: 7.");

    act(() => root.unmount());
    root = createRoot(container);
    await render(withStatus({ running: false, phase: null, stored: 9 }));
    expect(container.textContent).toContain("Background reading finished: 9 postings stored.");
  });

  it("points to the profile when it names no role, and offers no search", async () => {
    await render(createMemoryBridge({ companies: [acme], profile: emptyProfile() }));
    expect(container.textContent).toContain("Say which roles you are looking for in your profile");
    expect(container.textContent).not.toContain("Find new companies");
  });

  it("shows an error with a retry when the list cannot be read, and recovers on retry", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    const list = vi
      .fn<() => Promise<CompanyRecord[]>>()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue([acme]);
    bridge.companies.list = list;
    await render(bridge);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    await act(async () => {
      button(container, "Try again").click();
    });
    await act(async () => {});

    expect(container.textContent).toContain("Acme");
    expect(list).toHaveBeenCalledTimes(2);
  });
});
