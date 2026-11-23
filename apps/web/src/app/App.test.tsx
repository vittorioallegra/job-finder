// protects=the renderer mounts the router and shows the home screen text in the detected language;
// fails_when=the router is not wired into App or a home string is missing from the i18n resources;
// no_claim=layout, styling and navigation beyond the home route are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../lib/i18n";
import { App } from "./App";

describe("App shell", () => {
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

  it("renders the home screen title in English", async () => {
    await act(async () => {
      root.render(<App />);
    });
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("Job Finder");
    expect(container.textContent).toContain("Nothing here yet");
  });
});
