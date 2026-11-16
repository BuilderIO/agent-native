import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FRAMEWORK_PACKAGE_VERSIONS_FILE =
  "framework-package-versions.json";

/**
 * Every public `@agent-native/*` package's version in one monorepo checkout.
 * Core's build records this so a scaffold pins the exact set that was released
 * together. A floating spec such as `latest` installs an independently
 * versioned package like Dispatch, which may already import exports newer than
 * the Core it is installed beside.
 */
export function collectFrameworkPackageVersions(
  packagesDir: string,
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      name?: unknown;
      version?: unknown;
      private?: unknown;
    };
    if (
      typeof manifest.name !== "string" ||
      !manifest.name.startsWith("@agent-native/") ||
      manifest.private === true
    ) {
      continue;
    }
    if (typeof manifest.version !== "string" || !manifest.version) {
      throw new Error(`${manifestPath} has no version.`);
    }
    versions[manifest.name] = manifest.version;
  }
  return versions;
}

function loadFrameworkPackageVersions(): Record<string, string> {
  const builtPath = path.resolve(
    __dirname,
    "..",
    FRAMEWORK_PACKAGE_VERSIONS_FILE,
  );
  if (fs.existsSync(builtPath)) {
    return JSON.parse(fs.readFileSync(builtPath, "utf-8"));
  }
  // Only the monorepo runs this file from src/. A published build without the
  // file must fail: the directory above an installed Core holds the user's
  // installed packages, not the set this Core was released with.
  if (path.basename(path.dirname(__dirname)) !== "src") {
    throw new Error(
      `${builtPath} is missing. Rebuild @agent-native/core before scaffolding.`,
    );
  }
  return collectFrameworkPackageVersions(path.resolve(__dirname, "../../.."));
}

export function releasedFrameworkPackageVersion(name: string): string {
  const version = loadFrameworkPackageVersions()[name];
  if (!version) {
    throw new Error(
      `This @agent-native/core build has no released version of ${name}.`,
    );
  }
  return version;
}
