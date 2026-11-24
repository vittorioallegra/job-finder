// protects=profile setup shows no menu, only the app name and one way out to the home screen, while every other screen keeps the menu;
// fails_when=the menu shows during setup, the exit is missing or leads elsewhere, or another screen loses its menu;
// no_claim=the screens' own content is not checked here; the routes render nothing.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../lib/i18n";
import { AppShell } from "./AppShell";

describe("app frame", () => {
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

  async function renderAt(path: string) {
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: "/", element: null },
            { path: "/onboarding", element: null },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    return router;
  }

  it("hides the menu during profile setup and offers one exit to the home screen", async () => {
    const router = await renderAt("/onboarding");
    expect(container.querySelector("nav")).toBeNull();
    const exit = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Exit setup"),
    );
    expect(exit).toBeDefined();
    await act(async () => exit!.click());
    expect(router.state.location.pathname).toBe("/");
    expect(container.querySelector("nav")?.textContent).toContain("Jobs");
  });
});
