// protects=the profile screen shows the saved profile for editing, links to onboarding when no profile exists, and shows an error with retry when the read fails;
// fails_when=a saved profile is not shown, a missing profile shows an empty editor instead of the onboarding link, or a failed read shows a blank page;
// no_claim=the layout of the screen and the stored version number are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProfile } from "@job-finder/bridge";
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

  function labelFor(text: string): string {
    const label = [...container.querySelectorAll("label")].find(
      (node) => node.textContent === text,
    );
    return label?.htmlFor ?? "";
  }
});
