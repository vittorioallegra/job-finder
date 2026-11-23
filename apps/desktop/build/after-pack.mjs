// Hardens the packaged Electron binary with @electron/fuses. The package is ESM-only, so this hook
// is an .mjs file that electron-builder loads through `afterPack` in electron-builder.yml.
import { join } from "node:path";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";

export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const { productFilename } = packager.appInfo;
  const binary =
    electronPlatformName === "darwin"
      ? join(appOutDir, `${productFilename}.app`)
      : electronPlatformName === "win32"
        ? join(appOutDir, `${productFilename}.exe`)
        : join(appOutDir, packager.executableName);

  await flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
}
