import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = process.env.REPO;
const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const prNumber = process.env.PR_NUMBER;
const communityAppsPath = "packages/dispatch/src/server/lib/community-apps.ts";
const communityQrPackagePath = "templates/community/qr/package.json";
const communityQrTemplatePath = "templates/community/qr";
const pullRequestFilesLimit = 3_000;

export function gitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

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

export function assertCommunityQrFilePinsSynced(
  baseSource: string,
  headSource: string,
  headFileBlobShas: Map<string, string>,
): void {
  const basePins = communityQrFilePins(baseSource);
  const headPins = communityQrFilePins(headSource);
  const basePaths = basePins.map(({ path }) => path);
  const headPaths = headPins.map(({ path }) => path);
  if (JSON.stringify(basePaths) !== JSON.stringify(headPaths)) {
    throw new Error("Community QR template file pins changed.");
  }

  const expectedHeadPins = new Map<string, string>();
  for (const { path } of headPins) {
    const blobSha = headFileBlobShas.get(path);
    if (!blobSha) {
      throw new Error(`Missing head QR template blob for ${path}.`);
    }
    expectedHeadPins.set(path, blobSha);
  }

  for (const { path, blobSha } of headPins) {
    if (blobSha !== expectedHeadPins.get(path)) {
      throw new Error(`Head QR template blob pin does not match ${path}.`);
    }
  }

  const expectedHeadSource = replaceCommunityQrFilePins(
    baseSource,
    expectedHeadPins,
  );
  if (headSource !== expectedHeadSource) {
    throw new Error(
      "Community app catalog does not match the synchronized QR template file pins.",
    );
  }
}

function communityQrFilePins(
  source: string,
): Array<{ path: string; blobSha: string }> {
  const { block } = communityQrEntry(source);
  const filesStart = block.indexOf("files: [");
  const filesEnd = block.indexOf("\n      ],", filesStart);
  if (filesStart < 0 || filesEnd < 0) {
    throw new Error("Community QR template file list is incomplete.");
  }

  const files = block.slice(filesStart, filesEnd);
  const pins = [
    ...files.matchAll(
      /\{\s*path: "([^"\n]+)",\s*blobSha: "([a-f0-9]{40})",\s*\}/g,
    ),
  ].map((match) => ({
    path: match[1],
    blobSha: match[2],
  }));
  if (
    pins.length === 0 ||
    [...files.matchAll(/\bpath:/g)].length !== pins.length ||
    [...files.matchAll(/\bblobSha:/g)].length !== pins.length
  ) {
    throw new Error("Expected complete community QR template file pins.");
  }

  const paths = new Set<string>();
  for (const { path } of pins) {
    if (
      !/^[A-Za-z0-9._/-]+$/.test(path) ||
      path.startsWith("/") ||
      path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      paths.has(path)
    ) {
      throw new Error(
        "Community QR template has an invalid or duplicate file path.",
      );
    }
    paths.add(path);
  }

  if (!paths.has("package.json")) {
    throw new Error("Expected a community QR package.json blob pin.");
  }
  return pins;
}

function communityQrEntry(source: string): {
  start: number;
  end: number;
  block: string;
} {
  const marker = `templatePath: "${communityQrTemplatePath}"`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error("Expected exactly one community QR template entry.");
  }

  const end = source.indexOf("\n    },", start);
  if (end < 0) throw new Error("Community QR template entry is incomplete.");

  return { start, end, block: source.slice(start, end) };
}

function replaceCommunityQrFilePins(
  source: string,
  blobShas: Map<string, string>,
): string {
  const { start, end, block } = communityQrEntry(source);
  const updatedBlock = block.replace(
    /(path: "([^"\n]+)",\s*blobSha: ")[a-f0-9]{40}("\s*,)/g,
    (_match, before: string, path: string, after: string) => {
      const blobSha = blobShas.get(path);
      if (!blobSha) {
        throw new Error(`Missing synchronized QR template blob for ${path}.`);
      }
      return `${before}${blobSha}${after}`;
    },
  );
  return `${source.slice(0, start)}${updatedBlock}${source.slice(end)}`;
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
  const headPins = communityQrFilePins(headSource);
  const headFileBlobShas = new Map(
    headPins.map(({ path }) => [
      path,
      gitBlobSha(contentAt(`${communityQrTemplatePath}/${path}`, headSha)),
    ]),
  );

  assertCommunityQrFilePinsSynced(baseSource, headSource, headFileBlobShas);
  console.log(
    "Community app catalog contains only the synchronized QR template file pins.",
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
