import { execFileSync } from "node:child_process";

import {
  fetchPullRequestFilePages,
  type RunGhApi,
} from "./github-pull-request-files.ts";
import { parseReleasePullRequestPackageFiles } from "./list-release-pr-package-files.ts";
import {
  isMajorVersionPromotion,
  packageManifestVersionChange,
  type PackageManifestAtRef,
} from "./release-package-version-policy.ts";

const repo = process.env.REPO;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const pullRequestNumber = process.env.PR_NUMBER;

const gh: RunGhApi = (args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

function manifestAt(file: string, ref: string): PackageManifestAtRef | null {
  let output: string;
  try {
    output = gh(["api", `repos/${repo}/contents/${file}?ref=${ref}`]);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "";
    if (/HTTP 404\b/.test(stderr)) return null;
    throw new Error(`Could not read ${file} at ${ref}: ${stderr || error}`);
  }

  let response: unknown;
  try {
    response = JSON.parse(output);
  } catch {
    throw new Error(`GitHub returned invalid content for ${file} at ${ref}`);
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error(`GitHub returned invalid content for ${file} at ${ref}`);
  }

  const { encoding, content, size } = response as Record<string, unknown>;
  if (encoding !== "base64" || typeof content !== "string" || !content.trim()) {
    throw new Error(`GitHub returned unreadable content for ${file} at ${ref}`);
  }
  const encoded = content.replace(/\s/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new Error(`GitHub returned invalid base64 for ${file} at ${ref}`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (
    !Number.isSafeInteger(size) ||
    bytes.length === 0 ||
    bytes.length !== size
  ) {
    throw new Error(`GitHub returned incomplete content for ${file} at ${ref}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${file} at ${ref} is not valid JSON`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${file} at ${ref} is not a package manifest`);
  }

  const version = (manifest as Record<string, unknown>).version;
  if (version === undefined) return { version: null };
  if (typeof version !== "string") {
    throw new Error(`${file} at ${ref} has an invalid package version`);
  }
  return { version };
}

function main(): void {
  if (!repo || !baseSha || !headSha || !pullRequestNumber) {
    throw new Error("Missing release PR version verification context.");
  }

  const files = parseReleasePullRequestPackageFiles(
    fetchPullRequestFilePages(repo, pullRequestNumber, gh),
  );
  const promotions: string[] = [];
  for (const { filename, status } of files) {
    const versionChange = packageManifestVersionChange(
      filename,
      status,
      manifestAt(filename, baseSha),
      manifestAt(filename, headSha),
    );
    if (
      versionChange &&
      isMajorVersionPromotion(versionChange.before, versionChange.after)
    ) {
      promotions.push(
        `${filename}: ${versionChange.before} -> ${versionChange.after}`,
      );
    }
  }

  if (promotions.length > 0) {
    throw new Error(
      "This release PR contains a forbidden major promotion:\n" +
        promotions.map((line) => `  ${line}`).join("\n") +
        "\nMajor promotions remain human-only. Leaving the PR open for deliberate release handling.",
    );
  }

  console.log(
    `No forbidden promotion in ${files.length} changed package.json file(s).`,
  );
}

if (process.argv[1]?.endsWith("verify-release-package-version-changes.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
