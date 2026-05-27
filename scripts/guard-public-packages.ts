import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const packageAppAllowlist = new Set([
  "@agent-native/desktop-app",
  "@agent-native/docs",
  "@agent-native/mobile-app",
]);

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: {
    access?: string;
    provenance?: boolean;
  };
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readIgnoredPackages(): Set<string> {
  const configPath = path.join(repoRoot, ".changeset", "config.json");
  if (!fs.existsSync(configPath)) {
    return new Set();
  }

  const config = readJson<{ ignore?: unknown }>(configPath);
  return new Set(Array.isArray(config.ignore) ? config.ignore : []);
}

const packagesDir = path.join(repoRoot, "packages");
const ignoredPackages = readIgnoredPackages();
const failures: string[] = [];

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const pkg = readJson<PackageJson>(packageJsonPath);
  if (!pkg.name?.startsWith("@agent-native/")) continue;
  if (packageAppAllowlist.has(pkg.name)) continue;

  if (pkg.private === true) {
    failures.push(`${pkg.name} must not set "private": true`);
  }
  if (!pkg.version) {
    failures.push(`${pkg.name} must declare a version before publishing`);
  }
  if (pkg.publishConfig?.access !== "public") {
    failures.push(`${pkg.name} must set publishConfig.access to "public"`);
  }
  if (pkg.publishConfig?.provenance !== true) {
    failures.push(`${pkg.name} must set publishConfig.provenance to true`);
  }
  if (ignoredPackages.has(pkg.name)) {
    failures.push(
      `${pkg.name} must not be listed in .changeset/config.json ignore`,
    );
  }
}

if (failures.length > 0) {
  console.error("Package publish metadata is not public:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("OK Agent-Native package publish metadata is public.");
