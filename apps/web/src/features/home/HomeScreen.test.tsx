// protects=the home screen's second step is "what you are looking for", read from the profile's roles, with the companies found for them, not a list of companies to manage, and the four steps look alike whatever is done;
// fails_when=the second step links to the companies, says nothing when roles are missing, or ignores the roles the profile names;
// no_claim=the other steps' wording and the layout are not checked here; the four steps are only compared for one icon colour and one button style;
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

  it("draws the four steps alike: one icon colour and one button style, whatever is done", async () => {
    await render(
      createMemoryBridge({
        profile: {
          ...emptyProfile(),
          preferences: { ...emptyPreferences(), roles: ["Backend Engineer"] },
        },
      }),
    );

    const steps = [...container.querySelectorAll("li")];
    expect(steps).toHaveLength(4);
    const iconClasses = new Set(steps.map((step) => step.querySelector("div > div")?.className));
    const buttonClasses = new Set(steps.map((step) => step.querySelector("a")?.className));
    expect(iconClasses.size).toBe(1);
    expect(buttonClasses.size).toBe(1);
  });

  it("asks for roles when the profile names none", async () => {
    await render(createMemoryBridge({ profile: emptyProfile() }));
    expect(container.textContent).toContain("Say which roles you want");
  });
});
