import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const templatePackagePath = "templates/community/qr/package.json";
const lockfilePath = "pnpm-lock.yaml";
const importerPath = "templates/community/qr";
const workspaceCorePath = "../../../packages/core";

export function syncCommunityQrCoreLock(
  lockfile: string,
  coreSpecifier: string,
): string {
  const importerStart = lockfile.indexOf(`  ${importerPath}:\n`);
  if (importerStart < 0) {
    throw new Error(`Missing ${importerPath} importer in pnpm-lock.yaml.`);
  }

  const importerBodyStart = importerStart + importerPath.length + 4;
  const nextImporter = /\n  \S/m.exec(lockfile.slice(importerBodyStart));
  const importerEnd = nextImporter
    ? importerBodyStart + nextImporter.index + 1
    : lockfile.length;
  const importer = lockfile.slice(importerStart, importerEnd);
  const coreDependency =
    /^      '@agent-native\/core':\n        specifier: [^\n]+\n        version: [^\n]+/m;

  if (!coreDependency.test(importer)) {
    throw new Error(
      `Missing @agent-native/core dependency in ${importerPath} importer.`,
    );
  }

  const updatedImporter = importer.replace(
    coreDependency,
    `      '@agent-native/core':\n        specifier: ${coreSpecifier}\n        version: link:${workspaceCorePath}`,
  );

  return `${lockfile.slice(0, importerStart)}${updatedImporter}${lockfile.slice(importerEnd)}`;
}

async function main(): Promise<void> {
  const [packageSource, lockfile] = await Promise.all([
    readFile(templatePackagePath, "utf8"),
    readFile(lockfilePath, "utf8"),
  ]);
  const templatePackage = JSON.parse(packageSource) as {
    dependencies?: Record<string, unknown>;
  };
  const coreSpecifier = templatePackage.dependencies?.["@agent-native/core"];
  if (typeof coreSpecifier !== "string") {
    throw new Error(
      `Missing @agent-native/core dependency in ${templatePackagePath}.`,
    );
  }

  const updated = syncCommunityQrCoreLock(lockfile, coreSpecifier);
  if (updated !== lockfile) await writeFile(lockfilePath, updated);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
