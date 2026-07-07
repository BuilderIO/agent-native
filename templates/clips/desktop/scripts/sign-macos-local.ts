import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IDENTITY =
  "Developer ID Application: Builder.io, Inc (W3PMF2T3MW)";

if (process.platform !== "darwin") {
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const appPath = resolve(
  desktopDir,
  "src-tauri/target/release/bundle/macos/Clips.app",
);
const entitlementsPath = resolve(desktopDir, "src-tauri/Entitlements.plist");

if (!existsSync(appPath)) {
  console.warn(`[clips-desktop] No macOS app bundle found at ${appPath}`);
  process.exit(0);
}

function sign(identity: string) {
  const result = spawnSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      identity,
      "--options",
      "runtime",
      "--entitlements",
      entitlementsPath,
      appPath,
    ],
    { encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

const configuredIdentity = process.env.CLIPS_MACOS_CODESIGN_IDENTITY;
const identity = configuredIdentity || DEFAULT_IDENTITY;
let result = sign(identity);

if (
  result.status !== 0 &&
  !configuredIdentity &&
  /identity|not found|no identity/i.test(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  )
) {
  console.warn(
    "[clips-desktop] Builder.io Developer ID identity is unavailable; falling back to ad-hoc signing.",
  );
  console.warn(
    "[clips-desktop] Camera capture may still require a Developer ID signed local build.",
  );
  result = sign("-");
}

process.exit(result.status ?? 1);
