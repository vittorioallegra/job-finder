// protects=the companies screen finds boards through the bridge and adds only the ones the user picks, adds a company by its link and shows why one is refused, shows each company's last scan, retries a scan for one company, and shows an error with a retry when the list cannot be read;
// fails_when=a found board is added without a click, a board already in the list is offered again, a refused company is shown as added, a last scan is missing or wrong, a retry scans all companies or starts with no message, or a failed read shows a blank page;
// no_claim=layout, keyboard focus order and the real search provider are not checked here; the core discovery tests and the engine runtime tests cover the search.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRecord, JobFinderBridge } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { CompaniesScreen, splitTerms } from "./CompaniesScreen";

const acme: CompanyRecord = {
  id: "co-1",
  name: "Acme",
  careersUrl: "https://boards.greenhouse.io/acme",
  ats: "greenhouse",
  slug: "acme",
  createdAt: 1,
  lastScan: { outcome: "scanned", at: 5, jobCount: 4, closedCount: 1 },
};

function setInputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`no button ${text}`);
  }
  return found;
}

function field(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.includes(labelText),
  );
  const control = label?.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`no input labelled ${labelText}`);
  }
  return control;
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
    expect(button(container, "Search job boards").disabled).toBe(true);
  });

  it("lists each company with its board and last scan, and offers a retry only with a board", async () => {
    const failed: CompanyRecord = {
      ...acme,
      id: "co-2",
      name: "Globex",
      careersUrl: "https://example.com/careers",
      ats: null,
      slug: null,
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

    expect(container.textContent).toContain("Board: greenhouse");
    expect(container.textContent).toContain("Last scan: 4 postings read, 1 closed.");
    expect(container.textContent).toContain("No parseable jobs in the last scan.");
    expect(container.textContent).toContain("Last scan failed: the site answered with an error.");
    expect(container.textContent).toContain("Not scanned yet.");
    expect(container.textContent).toContain("No supported board");
    expect(
      [...container.querySelectorAll("button")].filter((node) => node.textContent === "Scan again"),
    ).toHaveLength(3);
  });

  it("finds boards for the keywords and adds only the one the user picks", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    const search = vi.fn(async () => ({
      ok: true as const,
      candidates: [
        {
          ats: "greenhouse",
          slug: "acme",
          careersUrl: "https://boards.greenhouse.io/acme",
          name: "acme",
        },
        {
          ats: "lever",
          slug: "globex",
          careersUrl: "https://jobs.lever.co/globex",
          name: "globex",
        },
      ],
    }));
    bridge.discovery.search = search;
    const add = vi.spyOn(bridge.companies, "add");
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Keywords"), " data engineer, ml ");
      setInputValue(field(container, "Location"), "Milan");
    });
    await act(async () => {
      button(container, "Search job boards").click();
    });
    await act(async () => {});

    expect(search).toHaveBeenCalledWith({
      keywords: ["data engineer", "ml"],
      locations: ["Milan"],
    });
    expect(container.textContent).toContain("Boards found: 2.");
    expect(container.textContent).toContain("Already added");
    expect(add).not.toHaveBeenCalled();

    await act(async () => {
      button(container, "Add globex").click();
    });
    await act(async () => {});

    expect(add).toHaveBeenCalledWith({
      name: "globex",
      careersUrl: "https://jobs.lever.co/globex",
    });
    expect(container.textContent).toContain("Already added");
  });

  it("says why a search gave no boards, and that nothing was added when it was blocked", async () => {
    const bridge = createMemoryBridge();
    bridge.discovery.search = async () => ({ ok: false, code: "search-blocked" });
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Keywords"), "engineer");
    });
    await act(async () => {
      button(container, "Search job boards").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The search provider blocked the request",
    );
    expect(container.textContent).not.toContain("Boards found");
  });

  it("adds a company by its link through the bridge and shows it in the list", async () => {
    const bridge = createMemoryBridge();
    const add = vi.spyOn(bridge.companies, "add");
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Company name"), "Acme");
      setInputValue(field(container, "Careers page link"), "https://boards.greenhouse.io/acme");
    });
    await act(async () => {
      button(container, "Add company").click();
    });
    await act(async () => {});

    expect(add).toHaveBeenCalledWith({
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    expect(container.textContent).toContain("Company added.");
    expect(container.querySelector("ul")?.textContent).toContain("Acme");
  });

  it("shows why a company is refused and keeps the list unchanged", async () => {
    const bridge = createMemoryBridge();
    bridge.companies.add = async () => ({ ok: false, code: "duplicate-company" });
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Company name"), "Acme");
      setInputValue(field(container, "Careers page link"), "https://boards.greenhouse.io/acme");
    });
    await act(async () => {
      button(container, "Add company").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already in the list");
    expect(container.textContent).not.toContain("Company added.");
  });

  it("scans one company again and says when a scan is already running", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    const start = vi.fn(async (companyId?: string) =>
      companyId === "co-1"
        ? ({ ok: false, code: "already-running" } as const)
        : ({ ok: true, runId: "run-x" } as const),
    );
    bridge.ingest.start = start;
    await render(bridge);

    await act(async () => {
      button(container, "Scan again").click();
    });
    await act(async () => {});

    expect(start).toHaveBeenCalledWith("co-1");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "A scan is already running.",
    );
  });

  it("confirms a retry that started", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    bridge.ingest.start = async () => ({ ok: true, runId: "run-2" });
    await render(bridge);

    await act(async () => {
      button(container, "Scan again").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Scan started.");
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

describe("search terms", () => {
  // protects=the comma-separated search terms are trimmed, empty ones dropped and at most five kept, the most the search accepts;
  // fails_when=an empty term is sent, a term keeps its padding, or a sixth term reaches the search;
  // no_claim=how the search reads the terms, which the core query tests cover.
  it("trims, drops empty terms and keeps at most five", () => {
    expect(splitTerms(" a, ,b ,, c")).toEqual(["a", "b", "c"]);
    expect(splitTerms("1,2,3,4,5,6")).toHaveLength(5);
  });
});
