import { join } from "node:path";

/**
 * The tray icon file: copied next to the packaged app's resources (see `extraResources`), and read
 * from the build folder in development.
 */
export function resolveTrayIconPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "icon.png")
    : join(options.appRoot, "build", "icon.png");
}
