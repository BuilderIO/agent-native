import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Dist-tags that either already mean something on npm (latest, nightly) or
// would be confusing next to the real release trains (beta/rc/etc). The
// workflow always publishes under `dev-<devTag>`, so a collision on the raw
// npm registry isn't possible — this guards against a developer picking a
// name that reads like a real release channel.
export const RESERVED_DEV_TAGS = new Set([
  "latest",
  "nightly",
  "beta",
  "next",
  "stable",
  "canary",
  "alpha",
  "rc",
  "release",
  "dev",
]);

const DEV_TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,32}[a-z0-9]$/;

export function validateDevTag(tag: string | undefined): string {
  const trimmed = (tag ?? "").trim();
  if (!trimmed) {
    throw new Error(
      "devTag must not be empty. Pass a short identifier, e.g. your username.",
    );
  }
  const normalized = trimmed.toLowerCase();
  if (RESERVED_DEV_TAGS.has(normalized)) {
    throw new Error(
      `devTag "${trimmed}" is reserved and cannot be used for a dev snapshot publish. Reserved values: ${[
        ...RESERVED_DEV_TAGS,
      ]
        .sort()
        .join(", ")}.`,
    );
  }
  if (!DEV_TAG_PATTERN.test(normalized)) {
    throw new Error(
      `devTag "${trimmed}" must be lowercase letters, digits, and hyphens (2-34 characters), and cannot start or end with a hyphen.`,
    );
  }
  return normalized;
}

export async function hasPendingChangesets(
  repoRoot = rootDir,
): Promise<boolean> {
  const entries = await readdir(path.join(repoRoot, ".changeset"));
  return entries.some(
    (entry) => entry.endsWith(".md") && entry !== "README.md",
  );
}

export function devSnapshotChangesetContents(devTag: string): string {
  const packages = NPM_PUBLISH_PACKAGE_NAMES.map(
    (name) => `"${name}": patch`,
  ).join("\n");

  return `---\n${packages}\n---\nSynthesized dev snapshot changeset for on-demand publish with dist-tag "dev-${devTag}". Not a real release note; only gives \`changeset version --snapshot\` something to act on.\n`;
}

export async function createDevSnapshotChangeset(
  devTag: string,
  runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`,
  repoRoot = rootDir,
): Promise<string> {
  const safeRunId = runId.replace(/[^A-Za-z0-9-]/g, "-");
  const filePath = path.join(
    repoRoot,
    ".changeset",
    `dev-snapshot-${safeRunId}.md`,
  );

  await writeFile(filePath, devSnapshotChangesetContents(devTag), {
    encoding: "utf8",
    flag: "wx",
  });
  return filePath;
}

export type PrepareDevSnapshotResult = {
  devTag: string;
  synthesizedChangesetPath: string | null;
};

export async function prepareDevSnapshot(
  tag: string | undefined,
  repoRoot = rootDir,
): Promise<PrepareDevSnapshotResult> {
  const devTag = validateDevTag(tag);
  if (await hasPendingChangesets(repoRoot)) {
    return { devTag, synthesizedChangesetPath: null };
  }
  const changesetPath = await createDevSnapshotChangeset(
    devTag,
    undefined,
    repoRoot,
  );
  return { devTag, synthesizedChangesetPath: changesetPath };
}

async function main(): Promise<void> {
  const result = await prepareDevSnapshot(
    process.argv[2] ?? process.env.DEV_TAG,
  );
  console.log(`Using dev snapshot dist-tag "dev-${result.devTag}".`);
  if (result.synthesizedChangesetPath) {
    console.log(
      `No pending changesets found; synthesized ${path.relative(
        rootDir,
        result.synthesizedChangesetPath,
      )} covering all public packages.`,
    );
  } else {
    console.log(
      "Found pending changeset(s) on this branch; using them for the snapshot.",
    );
  }
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
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
