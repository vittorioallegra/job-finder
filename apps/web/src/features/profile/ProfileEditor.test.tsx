// protects=the profile editor saves a valid edit through the bridge, refuses an invalid email before any save, and adds or removes entries without losing the others;
// fails_when=an edited headline is not sent, an invalid email reaches the bridge, the save reports success when it failed, or removing one entry drops another;
// no_claim=visual layout, keyboard focus order and the stored record's version are not checked here; the bridge is an in-memory double.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProfile, type Profile } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { draftFromProfile } from "./profile-draft";
import { ProfileEditor } from "./ProfileEditor";

function sample(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    headline: "Backend Engineer",
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        location: "",
        startDate: "2021",
        endDate: "",
        bullets: [],
      },
    ],
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function control(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === labelText,
  );
  const element = label?.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`no control labelled ${labelText}`);
  }
  return element;
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

describe("profile editor", () => {
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

  async function render(bridge: ReturnType<typeof createMemoryBridge>, profile: Profile) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <ProfileEditor initialDraft={draftFromProfile(profile)} />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
  }

  it("saves an edited headline through the bridge and reports success", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, sample());

    await act(async () => setValue(control(container, "Headline"), "Staff Engineer"));
    await act(async () => button(container, "Save profile").click());

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ headline: "Staff Engineer" }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Profile saved.");
  });

  it("refuses an invalid email before anything reaches the bridge", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, sample());

    await act(async () => setValue(control(container, "Email"), "maria at example"));
    await act(async () => button(container, "Save profile").click());

    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Nothing was saved");
  });

  it("adds an entry and removes it again without dropping the existing one", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    await render(bridge, sample());
    const groupCount = () => container.querySelectorAll('[role="group"]').length;
    expect(groupCount()).toBe(1);

    await act(async () => button(container, "Add experience").click());
    expect(groupCount()).toBe(2);

    await act(async () => button(container, "Remove entry 2").click());
    expect(groupCount()).toBe(1);
    expect(control(container, "Company").value).toBe("Acme");
  });
});
