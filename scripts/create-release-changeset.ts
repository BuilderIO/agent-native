import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";

export const RELEASE_BUMP_TYPES = ["patch", "minor", "major"] as const;
export type ReleaseBumpType = (typeof RELEASE_BUMP_TYPES)[number];

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function parseReleaseBumpType(
  value: string | undefined,
): ReleaseBumpType {
  if (value && RELEASE_BUMP_TYPES.includes(value as ReleaseBumpType)) {
    return value as ReleaseBumpType;
  }

  throw new Error(
    `Release bump must be one of ${RELEASE_BUMP_TYPES.join(", ")}; received ${value ?? "nothing"}.`,
  );
}

export function releaseChangesetContents(bump: ReleaseBumpType): string {
  const packages = NPM_PUBLISH_PACKAGE_NAMES.map(
    (name) => `"${name}": ${bump}`,
  ).join("\n");

  return `---\n${packages}\n---\nRelease all public npm packages with a ${bump} version bump.\n`;
}

export async function createReleaseChangeset(
  bump: ReleaseBumpType,
  runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`,
  repoRoot = rootDir,
): Promise<string> {
  const safeRunId = runId.replace(/[^A-Za-z0-9-]/g, "-");
  const filePath = path.join(
    repoRoot,
    ".changeset",
    `manual-release-${safeRunId}.md`,
  );

  await writeFile(filePath, releaseChangesetContents(bump), {
    encoding: "utf8",
    flag: "wx",
  });
  return filePath;
}

async function main(): Promise<void> {
  const bump = parseReleaseBumpType(process.argv[2]);
  const filePath = await createReleaseChangeset(bump);
  console.log(
    `Created ${path.relative(rootDir, filePath)} for a ${bump} release.`,
  );
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
