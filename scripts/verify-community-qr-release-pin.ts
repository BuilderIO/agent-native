import { execFileSync } from "node:child_process";

import { gitBlobSha } from "./sync-community-qr-core-lock.ts";

const repo = process.env.REPO;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const prNumber = process.env.PR_NUMBER;
const communityAppsPath = "packages/dispatch/src/server/lib/community-apps.ts";
const communityQrPackagePath = "templates/community/qr/package.json";
const communityQrTemplatePath = "templates/community/qr";
const pullRequestFilesLimit = 3_000;

export function assertCompletePullRequestFiles(
  files: string[],
  changedFilesCount: unknown,
): string[] {
  if (
    typeof changedFilesCount !== "number" ||
    !Number.isSafeInteger(changedFilesCount) ||
    changedFilesCount < 0
  ) {
    throw new Error("GitHub returned an invalid pull request file count.");
  }
  if (changedFilesCount >= pullRequestFilesLimit) {
    throw new Error(
      `Cannot verify pull requests with ${changedFilesCount} changed files: GitHub's pull request files endpoint is capped at ${pullRequestFilesLimit}.`,
    );
  }
  if (files.length !== changedFilesCount) {
    throw new Error(
      `GitHub returned ${files.length} of ${changedFilesCount} changed pull request files.`,
    );
  }
  return files;
}

export function assertCommunityQrPackagePinOnlyChange(
  baseSource: string,
  headSource: string,
  basePackage: Buffer,
  headPackage: Buffer,
): void {
  const basePackagePin = communityQrPackagePin(baseSource);
  const headPackagePin = communityQrPackagePin(headSource);
  const expectedBasePin = gitBlobSha(basePackage);
  const expectedHeadPin = gitBlobSha(headPackage);

  if (basePackagePin !== expectedBasePin) {
    throw new Error(
      "Base QR package.json blob pin does not match its manifest.",
    );
  }
  if (headPackagePin !== expectedHeadPin) {
    throw new Error(
      "Head QR package.json blob pin does not match its manifest.",
    );
  }

  const expectedHeadSource = replaceCommunityQrPackagePin(
    baseSource,
    expectedHeadPin,
  );
  if (headSource !== expectedHeadSource) {
    throw new Error(
      "Community app catalog does not match the QR package.json blob pin update.",
    );
  }
}

function communityQrPackagePin(source: string): string {
  const marker = `templatePath: "${communityQrTemplatePath}"`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error("Expected exactly one community QR template entry.");
  }

  const end = source.indexOf("\n    },", start);
  if (end < 0) throw new Error("Community QR template entry is incomplete.");

  const block = source.slice(start, end);
  const pins = [
    ...block.matchAll(/path: "package\.json",\n\s+blobSha: "([a-f0-9]{40})"/g),
  ];
  if (pins.length !== 1) {
    throw new Error("Expected exactly one community QR package.json blob pin.");
  }
  return pins[0][1];
}

function replaceCommunityQrPackagePin(source: string, blobSha: string): string {
  const marker = `templatePath: "${communityQrTemplatePath}"`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error("Expected exactly one community QR template entry.");
  }

  const end = source.indexOf("\n    },", start);
  if (end < 0) throw new Error("Community QR template entry is incomplete.");

  const block = source.slice(start, end);
  const pins = [
    ...block.matchAll(/path: "package\.json",\n\s+blobSha: "([a-f0-9]{40})"/g),
  ];
  if (pins.length !== 1) {
    throw new Error("Expected exactly one community QR package.json blob pin.");
  }

  const pin = pins[0];
  const pinStart = start + (pin.index ?? 0);
  const replacement = pin[0].replace(pin[1], blobSha);
  return `${source.slice(0, pinStart)}${replacement}${source.slice(pinStart + pin[0].length)}`;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

export function decodeGitHubContentResponse(
  response: unknown,
  path: string,
  ref: string,
): Buffer {
  if (!response || typeof response !== "object") {
    throw new Error(`GitHub returned no file content for ${path} at ${ref}.`);
  }

  const { encoding, content, size } = response as Record<string, unknown>;
  if (encoding !== "base64" || typeof content !== "string" || !content.trim()) {
    throw new Error(
      `GitHub returned unreadable file content for ${path} at ${ref}.`,
    );
  }

  const encoded = content.replace(/\s/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new Error(
      `GitHub returned invalid base64 content for ${path} at ${ref}.`,
    );
  }

  const decoded = Buffer.from(encoded, "base64");
  if (
    !Number.isSafeInteger(size) ||
    decoded.length === 0 ||
    decoded.length !== size
  ) {
    throw new Error(
      `GitHub returned incomplete file content for ${path} at ${ref}.`,
    );
  }
  return decoded;
}

export function parseCompletePullRequestFiles(output: string): string[] {
  const files = output
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);

  if (files.length >= pullRequestFilesLimit) {
    throw new Error(
      "GitHub's pull request files API reached its 3,000-file limit; refusing to verify an incomplete release diff.",
    );
  }
  return files;
}

function contentAt(path: string, ref: string): Buffer {
  const response = JSON.parse(
    gh(["api", `repos/${repo}/contents/${path}?ref=${ref}`]),
  ) as unknown;
  return decodeGitHubContentResponse(response, path, ref);
}

function main(): void {
  if (!repo || !baseSha || !headSha || !prNumber) {
    throw new Error("Missing release PR verification context.");
  }

  const changedFiles = parseCompletePullRequestFiles(
    gh([
      "api",
      "--paginate",
      `repos/${repo}/pulls/${prNumber}/files`,
      "--jq",
      ".[].filename",
    ]),
  );
  const pullRequest = JSON.parse(
    gh(["api", `repos/${repo}/pulls/${prNumber}`]),
  ) as { changed_files?: unknown };
  const completeChangedFiles = assertCompletePullRequestFiles(
    changedFiles,
    pullRequest.changed_files,
  );

  if (
    !completeChangedFiles.includes(communityAppsPath) &&
    !completeChangedFiles.includes(communityQrPackagePath)
  ) {
    console.log("Community app catalog is unchanged.");
    return;
  }

  const baseSource = contentAt(communityAppsPath, baseSha).toString("utf8");
  const headSource = contentAt(communityAppsPath, headSha).toString("utf8");
  const basePackage = contentAt(communityQrPackagePath, baseSha);
  const headPackage = contentAt(communityQrPackagePath, headSha);

  assertCommunityQrPackagePinOnlyChange(
    baseSource,
    headSource,
    basePackage,
    headPackage,
  );
  console.log(
    "Community app catalog contains only the matching QR package pin update.",
  );
}

if (process.argv[1]?.endsWith("verify-community-qr-release-pin.ts")) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
