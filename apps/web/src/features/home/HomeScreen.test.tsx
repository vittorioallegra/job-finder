// protects=the home screen's second step is "what you are looking for", read from the profile's roles, with the companies found for them, not a list of companies to manage;
// fails_when=the second step links to the companies, says nothing when roles are missing, or ignores the roles the profile names;
// no_claim=the other steps' wording and the layout are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyPreferences, emptyProfile, type JobFinderBridge } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { HomeScreen } from "./HomeScreen";

describe("home screen", () => {
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
            <HomeScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows what you are looking for as the second step", async () => {
    await render(
      createMemoryBridge({
        profile: {
          ...emptyProfile(),
          preferences: { ...emptyPreferences(), roles: ["Backend Engineer", "Tech Lead"] },
        },
      }),
    );
    expect(container.textContent).toContain("What you are looking for");
    expect(container.textContent).toContain("Backend Engineer, Tech Lead · 0 companies found");
    expect(container.querySelector('a[href="/companies"]')).toBeNull();
  });

  it("asks for roles when the profile names none", async () => {
    await render(createMemoryBridge({ profile: emptyProfile() }));
    expect(container.textContent).toContain("Say which roles you want");
  });
});
