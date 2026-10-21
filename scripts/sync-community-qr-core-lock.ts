import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const templatePackagePath = "templates/community/qr/package.json";
const lockfilePath = "pnpm-lock.yaml";
const importerPath = "templates/community/qr";
const workspaceCorePath = "../../../packages/core";
const communityAppsPath = "packages/dispatch/src/server/lib/community-apps.ts";

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

export function gitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

// Dispatch pins each QR template file by Git blob id, so a manifest change
// invalidates the pin until it is rewritten here.
export function syncCommunityQrBlobPins(
  source: string,
  blobShaFor: (templateFile: string) => string,
): string {
  const sourceStart = source.indexOf(`templatePath: "${importerPath}"`);
  if (sourceStart < 0) {
    throw new Error(`Missing ${importerPath} source in ${communityAppsPath}.`);
  }
  const closing = source.indexOf("\n    },", sourceStart);
  const sourceEnd = closing < 0 ? source.length : closing;
  const pin = /(path: "([^"]+)",\n\s+blobSha: ")[a-f0-9]{40}(")/g;
  let pins = 0;
  const updatedBlock = source
    .slice(sourceStart, sourceEnd)
    .replace(pin, (_match, before: string, file: string, after: string) => {
      pins += 1;
      return `${before}${blobShaFor(file)}${after}`;
    });
  if (pins === 0) {
    throw new Error(`No blob pins found for ${importerPath}.`);
  }
  const updated = `${source.slice(0, sourceStart)}${updatedBlock}${source.slice(sourceEnd)}`;
  return updated;
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

  const communityApps = await readFile(communityAppsPath, "utf8");
  const repinned = syncCommunityQrBlobPins(communityApps, (file) =>
    gitBlobSha(readFileSync(path.join(importerPath, file))),
  );
  if (repinned !== communityApps) await writeFile(communityAppsPath, repinned);
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
