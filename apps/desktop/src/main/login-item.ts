/**
 * Registers the app to start at login on macOS and Windows only, and only from the installed app:
 * a development run would register the Electron binary instead. Linux has no such setting here.
 * Returns whether the setting was applied.
 */
export function applyLaunchAtLogin(
  enabled: boolean,
  options: {
    platform: NodeJS.Platform;
    isPackaged: boolean;
    setOpenAtLogin: (openAtLogin: boolean) => void;
  },
): boolean {
  const supported = options.platform === "darwin" || options.platform === "win32";
  if (!supported || !options.isPackaged) return false;
  options.setOpenAtLogin(enabled);
  return true;
}
