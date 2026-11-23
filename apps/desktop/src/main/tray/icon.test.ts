// protects=the tray icon is read from the packaged resources when installed and from the build folder in development;
// fails_when=the installed app looks for the icon in the source tree, or development looks in the resources folder;
// no_claim=that the icon file exists in the packaged app is checked by the packaged smoke test and the build configuration, not here.
import { describe, expect, it } from "vitest";
import { resolveTrayIconPath } from "./icon";

describe("tray icon path", () => {
  it("uses the resources folder when packaged and the build folder in development", () => {
    expect(
      resolveTrayIconPath({
        isPackaged: true,
        resourcesPath: "/app/resources",
        appRoot: "/src/desktop",
      }),
    ).toBe("/app/resources/icon.png");
    expect(
      resolveTrayIconPath({
        isPackaged: false,
        resourcesPath: "/app/resources",
        appRoot: "/src/desktop",
      }),
    ).toBe("/src/desktop/build/icon.png");
  });
});
