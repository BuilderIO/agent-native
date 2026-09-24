import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";
import { validateDevTag } from "./prepare-dev-snapshot.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const WORKFLOW = "auto-publish.yml";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

export function devTagFromEmail(email: string): string | null {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const cleaned = local.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || null;
}

export function resolveDevTag(
  explicit: string | undefined,
  gitEmail: string,
): string {
  if (explicit?.trim()) {
    return validateDevTag(explicit);
  }
  const derived = devTagFromEmail(gitEmail);
  if (!derived) {
    throw new Error(
      "Could not derive a dev tag from `git config user.email`. Pass one explicitly: pnpm release-dev <tag>",
    );
  }
  return validateDevTag(derived);
}

export function dispatchArgs(branch: string, devTag: string): string[] {
  return [
    "workflow",
    "run",
    WORKFLOW,
    "--ref",
    branch,
    "-f",
    `devTag=${devTag}`,
  ];
}

function main(): void {
  let gitEmail = "";
  try {
    gitEmail = git(["config", "user.email"]);
  } catch {
    // No configured email is fine as long as a tag was passed explicitly;
    // resolveDevTag turns the empty string into an actionable error.
  }
  const devTag = resolveDevTag(process.argv[2], gitEmail);

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") {
    throw new Error(
      "HEAD is detached. Check out a branch before publishing a dev snapshot.",
    );
  }

  // The workflow publishes whatever the pushed commit contains, so an
  // uncommitted edit would silently not be in the package a teammate installs.
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      `Working tree has uncommitted changes, which would not be included in the published snapshot. Commit or stash them first:\n${dirty}`,
    );
  }

  console.log(`Pushing ${branch} to origin...`);
  execFileSync("git", ["push", "--set-upstream", "origin", branch], {
    cwd: rootDir,
    stdio: "inherit",
  });

  console.log(`Dispatching ${WORKFLOW} on ${branch} with devTag=${devTag}...`);
  execFileSync("gh", dispatchArgs(branch, devTag), {
    cwd: rootDir,
    stdio: "inherit",
  });

  console.log(
    [
      "",
      `Dev snapshot requested. Watch it with:`,
      `  gh run list --workflow=${WORKFLOW} --branch ${branch}`,
      "",
      "Once it finishes, install with:",
      ...NPM_PUBLISH_PACKAGE_NAMES.map(
        (name) => `  pnpm add ${name}@dev-${devTag}`,
      ),
    ].join("\n"),
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
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
