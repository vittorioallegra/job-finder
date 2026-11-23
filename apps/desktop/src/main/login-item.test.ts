// protects=the launch-at-login setting reaches the operating system only for the installed app on macOS and Windows, and is left alone elsewhere or in development;
// fails_when=a development run registers the Electron binary, Linux registers a login item, or the setting is not applied on macOS or Windows;
// no_claim=whether the operating system actually starts the app at login is not checked here.
import { describe, expect, it } from "vitest";
import { applyLaunchAtLogin } from "./login-item";

describe("launch at login", () => {
  it("applies the setting on macOS and Windows from the installed app", () => {
    const calls: boolean[] = [];
    const setOpenAtLogin = (value: boolean) => calls.push(value);
    expect(applyLaunchAtLogin(true, { platform: "darwin", isPackaged: true, setOpenAtLogin })).toBe(
      true,
    );
    expect(applyLaunchAtLogin(false, { platform: "win32", isPackaged: true, setOpenAtLogin })).toBe(
      true,
    );
    expect(calls).toEqual([true, false]);
  });

  it("leaves the operating system alone on Linux and in development", () => {
    const calls: boolean[] = [];
    const setOpenAtLogin = (value: boolean) => calls.push(value);
    expect(applyLaunchAtLogin(true, { platform: "linux", isPackaged: true, setOpenAtLogin })).toBe(
      false,
    );
    expect(
      applyLaunchAtLogin(true, { platform: "darwin", isPackaged: false, setOpenAtLogin }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });
});
