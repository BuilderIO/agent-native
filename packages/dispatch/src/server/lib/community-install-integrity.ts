import { createHash } from "node:crypto";

import { isValidWorkspaceAppIdFormat } from "@agent-native/core/shared";

import type { PinnedCommunitySource } from "./community-source.js";

const COMMUNITY_FILE_MAX_BYTES = 128 * 1024;
const COMMUNITY_TOTAL_MAX_BYTES = 64 * 1024;
const COMMUNITY_FILE_COUNT_MAX = 64;
const COMMUNITY_PATH_MAX_CHARS = 4096;
const GIT_SHA1_PATTERN = /^[a-f0-9]{40}$/;

export interface CommunityBranchFile {
  path: string;
  mode: string;
  content: Uint8Array;
}

export interface CommunityBranchSnapshot {
  projectId: string;
  branchName: string;
  commitSha: string;
  files: readonly CommunityBranchFile[];
}

export interface CommunityBranchExpectedRef {
  projectId: string;
  branchName: string;
}

export interface CommunityInstallIntegrityReceipt {
  projectId: string;
  branchName: string;
  commitSha: string;
  sourceId: string;
  appId: string;
  files: { path: string; blobSha: string }[];
  verified: true;
}

export type CommunityInstallIntegrityErrorCode =
  | "invalid_source"
  | "invalid_target"
  | "ref_mismatch"
  | "invalid_snapshot"
  | "file_set_mismatch"
  | "file_mode_unsupported"
  | "file_too_large"
  | "total_too_large"
  | "blob_mismatch";

export class CommunityInstallIntegrityError extends Error {
  constructor(readonly code: CommunityInstallIntegrityErrorCode) {
    super("Builder community branch did not match the reviewed template.");
    this.name = "CommunityInstallIntegrityError";
  }
}

function fail(code: CommunityInstallIntegrityErrorCode): never {
  throw new CommunityInstallIntegrityError(code);
}

function isCanonicalRelativePath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= COMMUNITY_PATH_MAX_CHARS &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function gitBlobSha(content: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function validateSource(source: PinnedCommunitySource): void {
  if (
    typeof source.id !== "string" ||
    !source.id.trim() ||
    typeof source.repo !== "string" ||
    source.ref !== "main" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo) ||
    typeof source.templatePath !== "string" ||
    !isCanonicalRelativePath(source.templatePath) ||
    !Array.isArray(source.files) ||
    source.files.length > COMMUNITY_FILE_COUNT_MAX ||
    source.files.length === 0
  ) {
    fail("invalid_source");
  }

  const paths = new Set<string>();
  for (const file of source.files) {
    if (
      typeof file.path !== "string" ||
      typeof file.blobSha !== "string" ||
      !isCanonicalRelativePath(file.path) ||
      !GIT_SHA1_PATTERN.test(file.blobSha) ||
      paths.has(file.path)
    ) {
      fail("invalid_source");
    }
    paths.add(file.path);
  }
}

export function verifyCommunityBranchFiles(
  source: PinnedCommunitySource,
  appId: string,
  snapshot: CommunityBranchSnapshot,
  expectedRef: CommunityBranchExpectedRef,
): CommunityInstallIntegrityReceipt {
  validateSource(source);
  if (
    typeof appId !== "string" ||
    appId.length > 64 ||
    !isValidWorkspaceAppIdFormat(appId)
  ) {
    fail("invalid_target");
  }
  if (
    typeof expectedRef.projectId !== "string" ||
    typeof expectedRef.branchName !== "string" ||
    !expectedRef.projectId.trim() ||
    !expectedRef.branchName.trim()
  ) {
    fail("ref_mismatch");
  }
  if (
    typeof snapshot.projectId !== "string" ||
    typeof snapshot.branchName !== "string" ||
    typeof snapshot.commitSha !== "string" ||
    !Array.isArray(snapshot.files) ||
    snapshot.files.length > COMMUNITY_FILE_COUNT_MAX ||
    !GIT_SHA1_PATTERN.test(snapshot.commitSha)
  ) {
    fail("invalid_snapshot");
  }
  if (
    snapshot.projectId !== expectedRef.projectId ||
    snapshot.branchName !== expectedRef.branchName
  ) {
    fail("ref_mismatch");
  }

  const appRoot = `apps/${appId}/`;
  const expectedFiles = new Map(
    source.files.map((file) => [
      `${appRoot}${file.path}`,
      file.blobSha.toLowerCase(),
    ]),
  );
  const seen = new Set<string>();
  let totalBytes = 0;
  const verifiedFiles: CommunityInstallIntegrityReceipt["files"] = [];

  for (const file of snapshot.files) {
    if (
      typeof file.path !== "string" ||
      typeof file.mode !== "string" ||
      !isCanonicalRelativePath(file.path) ||
      !file.path.startsWith(appRoot) ||
      seen.has(file.path)
    ) {
      fail("file_set_mismatch");
    }
    seen.add(file.path);

    const expectedBlobSha = expectedFiles.get(file.path);
    if (!expectedBlobSha) fail("file_set_mismatch");
    if (file.mode !== "100644") fail("file_mode_unsupported");
    if (!(file.content instanceof Uint8Array)) fail("invalid_snapshot");
    if (file.content.byteLength > COMMUNITY_FILE_MAX_BYTES) {
      fail("file_too_large");
    }
    totalBytes += file.content.byteLength;
    if (totalBytes > COMMUNITY_TOTAL_MAX_BYTES) fail("total_too_large");

    const blobSha = gitBlobSha(file.content);
    if (blobSha !== expectedBlobSha) fail("blob_mismatch");
    verifiedFiles.push({ path: file.path, blobSha });
  }

  if (seen.size !== expectedFiles.size) fail("file_set_mismatch");

  return {
    projectId: snapshot.projectId,
    branchName: snapshot.branchName,
    commitSha: snapshot.commitSha,
    sourceId: source.id,
    appId,
    files: verifiedFiles,
    verified: true,
  };
}
