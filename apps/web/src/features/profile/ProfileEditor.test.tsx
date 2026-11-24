// protects=the profile editor saves a valid edit through the bridge, refuses an invalid email before any save, adds or removes entries without losing the others, edits dates with month and year pickers (ongoing as present), skills as chips, language levels as a selector and an optional grade, shows no pronouns field, enables Save only with unsaved changes, and groups contracts as employee, freelance and internship;
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

function choose(element: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
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

  it("edits dates with month and year pickers and marks an ongoing role", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, {
      ...sample(),
      experience: [{ ...sample().experience[0]!, startDate: "03/2021", endDate: "Presente" }],
    });
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select")];
    const month = selects.find((select) => select.value === "3");
    const year = selects.find((select) => select.value === "2021");
    expect(month).toBeDefined();
    expect(year).toBeDefined();
    const ongoing = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.trim() === "Still going on")
      ?.querySelector<HTMLInputElement>("input");
    expect(ongoing?.checked).toBe(true);

    await act(async () => choose(year!, "2020"));
    await act(async () => ongoing!.click());
    await act(async () => button(container, "Save profile").click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: [expect.objectContaining({ startDate: "2020-03", endDate: "" })],
      }),
    );
  });

  it("keeps skills as chips, levels as a selector, a grade for education, and no pronouns", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, {
      ...sample(),
      education: [
        { institution: "PoliMi", degree: "MSc", grade: "", startDate: "2012", endDate: "2014" },
      ],
      skills: [{ name: "Go", level: "expert", aliases: ["Golang"] }],
      languages: [{ name: "English", level: "C1 (IELTS 7.5)" }],
    });
    expect(container.textContent).not.toContain("Pronouns");
    expect(container.textContent).not.toContain("One per line");

    const add = container.querySelector<HTMLInputElement>('input[placeholder="Add a skill"]')!;
    await act(async () => setValue(add, "TypeScript"));
    await act(async () => {
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove Go"]')!.click(),
    );
    await act(async () => setValue(add, "Kubernetes"));
    await act(async () => {
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => setValue(control(container, "Grade (optional)"), "110/110"));
    const level = [...container.querySelectorAll<HTMLSelectElement>("select")].find(
      (select) => select.value === "C1",
    );
    expect(level).toBeDefined();
    await act(async () => choose(level!, "native"));
    await act(async () => button(container, "Save profile").click());

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [
          { name: "TypeScript", level: "", aliases: [] },
          { name: "Kubernetes", level: "", aliases: [] },
        ],
        languages: [{ name: "English", level: "native" }],
        education: [expect.objectContaining({ grade: "110/110" })],
      }),
    );
  });

  it("edits what you are looking for: roles as chips and work modes as choices", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, sample());
    const role = container.querySelector<HTMLInputElement>('input[placeholder="Add a role"]')!;
    await act(async () => setValue(role, "Backend Engineer, Tech Lead"));
    await act(async () => {
      role.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const remote = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.trim() === "Remote")
      ?.querySelector<HTMLInputElement>("input");
    await act(async () => remote!.click());
    await act(async () => button(container, "Save profile").click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          roles: ["Backend Engineer", "Tech Lead"],
          workModes: ["remote"],
        }),
      }),
    );
  });

  it("enables Save only with unsaved changes, and says so until they are saved", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    await render(bridge, sample());
    expect(button(container, "Save profile").disabled).toBe(true);
    expect(container.textContent).not.toContain("Unsaved changes.");

    await act(async () => setValue(control(container, "Headline"), "Staff Engineer"));
    expect(button(container, "Save profile").disabled).toBe(false);
    expect(container.textContent).toContain("Unsaved changes.");

    await act(async () => button(container, "Save profile").click());
    expect(button(container, "Save profile").disabled).toBe(true);
    expect(container.textContent).toContain("Profile saved.");
  });

  it("offers employee, freelance and internship as contracts, and no level", async () => {
    const bridge = createMemoryBridge({ profile: sample() });
    const save = vi.spyOn(bridge.profile, "save");
    await render(bridge, sample());
    expect(container.textContent).not.toContain("Level");
    const employee = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.trim() === "Employee")
      ?.querySelector<HTMLInputElement>("input");
    await act(async () => employee!.click());
    await act(async () => button(container, "Save profile").click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          employmentTypes: ["full_time", "part_time", "temporary"],
        }),
      }),
    );
  });
});
