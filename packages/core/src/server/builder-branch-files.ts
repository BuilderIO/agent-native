import { createHash } from "node:crypto";

import { z } from "zod";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { isValidWorkspaceAppIdFormat } from "../shared/workspace-app-id.js";
import {
  isBuilderReauthorizationRequired,
  resolveBuilderRequestAuthorization,
} from "./builder-api-auth.js";
import {
  BuilderGitBundleError,
  readBuilderGitBundle,
} from "./builder-branch-git.js";
import { getBuilderApiHost } from "./builder-browser.js";

const SHA = /^[a-f0-9]{40}$/;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;

export type BuilderBranchReadbackStage =
  | "status_request"
  | "status_shape"
  | "status_binding"
  | "status_no_backup"
  | "status_currentness"
  | "post_read_status_request"
  | "post_read_status_shape"
  | "post_read_status_binding"
  | "post_read_status_currentness"
  | "download_url_request"
  | "download_url_shape"
  | "download_url_binding"
  | "bundle_download"
  | "bundle_read"
  | "bundle_digest"
  | "bundle_parse"
  | "target_subtree_missing"
  | "post_read_currentness";

export class BuilderBranchFilesError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "not_connected"
      | "forbidden"
      | "unavailable"
      | "unverified"
      | "integrity_failed",
    message: string,
    readonly readbackStage?: BuilderBranchReadbackStage,
  ) {
    super(message);
    this.name = "BuilderBranchFilesError";
  }
}

const backupSchema = z.object({
  projectId: z.string(),
  ownerId: z.string().min(1),
  branchName: z.string(),
  at: z.number().finite().positive(),
  size: z.number().int().positive().max(MAX_BUNDLE_BYTES),
  lastCommitHash: z.string().regex(SHA),
  partial: z.literal(false),
  status: z.literal("completed"),
  contentMd5: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  forced: z.undefined().optional(),
  changedSubmodules: z.array(z.string()).max(0).optional(),
});

const statusSchema = z.object({
  status: z.literal("ok"),
  branch: z.object({
    projectId: z.string(),
    name: z.string(),
    ownerId: z.string(),
    agentState: z.literal("idle"),
    hasUnpushedChanges: z.literal(false),
    lastCommitHash: z.string().min(1).max(8192),
    lastActivityAt: z.number().finite().nonnegative(),
    deleted: z.literal(false).optional(),
    state: z.literal("active").optional(),
  }),
  backupStatuses: z.object({
    code: z.object({
      state: z.literal("valid"),
      outcome: z.literal("valid"),
      backup: backupSchema,
    }),
  }),
});

const inspectedBackupSchema = z.object({
  projectId: z.string().min(1).max(200),
  ownerId: z.string().min(1).max(256),
  branchName: z.string().min(1).max(256),
  at: z.number().finite().positive(),
  lastCommitHash: z.string().min(1).max(8192),
  partial: z.unknown().optional(),
  status: z.enum(["initiated", "completed"]),
});

const invalidBackupOutcomes = z.enum([
  "no-backup",
  "error",
  "not-completed",
  "no-session-id",
  "no-last-commit-hash",
  "no-backup-file",
  "empty-full-backup",
  "no-vcpCodeGenEvent",
  "commits-not-in-repo",
  "no-after-commit",
  "no-signed-url",
  "no-git-branch-name",
  "repo-url-mismatch",
  "branch-uninitialized",
  "unexpected-partial-backup",
  "unexpected-full-backup",
  "no-backup-keys",
]);

const backupCheckSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("valid"),
    outcome: z.literal("valid"),
    backup: inspectedBackupSchema,
  }),
  z.object({
    state: z.literal("forced-backup"),
    outcome: z.literal("forced-offline-full-backup"),
    backup: inspectedBackupSchema,
  }),
  z.object({
    state: z.literal("stale"),
    outcome: z.literal("hash-mismatch"),
    backup: inspectedBackupSchema,
  }),
  z.object({
    state: z.literal("submodule-changes"),
    outcome: z.literal("submodule-changes"),
    backup: inspectedBackupSchema,
  }),
  z.object({
    state: z.literal("invalid"),
    outcome: invalidBackupOutcomes,
    backup: inspectedBackupSchema.optional(),
  }),
]);

const backupInspectionSchema = z.object({
  status: z.literal("ok"),
  branch: z.object({
    projectId: z.string().min(1).max(200),
    name: z.string().min(1).max(256),
    ownerId: z.string().min(1).max(256),
    state: z.enum(["active", "archived", "deleted"]).optional(),
    deleted: z.boolean().optional(),
    agentState: z.enum(["running", "waiting", "idle"]),
    hasUnpushedChanges: z.boolean(),
    lastCommitHash: z.string().min(1).max(8192),
    lastActivityAt: z.number().finite().nonnegative(),
  }),
  backupStatuses: z.object({
    code: backupCheckSchema,
  }),
});

const downloadSchema = z.object({
  signedUrl: z.string().url(),
  filePath: z.string().min(1).max(4096),
  partial: z.literal(false),
  expiresAt: z.string(),
});

type BranchRef = { projectId: string; branchName: string };
type StatusReadPhase = "before_read" | "after_read";
type StatusFailure = "request" | "shape" | "binding" | "currentness";

const statusFailureStages = {
  before_read: {
    request: "status_request",
    shape: "status_shape",
    binding: "status_binding",
    currentness: "status_currentness",
  },
  after_read: {
    request: "post_read_status_request",
    shape: "post_read_status_shape",
    binding: "post_read_status_binding",
    currentness: "post_read_status_currentness",
  },
} satisfies Record<
  StatusReadPhase,
  Record<StatusFailure, BuilderBranchReadbackStage>
>;

function backupIdentityFingerprint(
  backup: z.infer<typeof backupSchema>,
): string {
  return JSON.stringify([
    backup.projectId,
    backup.ownerId,
    backup.branchName,
    backup.lastCommitHash,
    backup.contentMd5,
    backup.at,
    backup.size,
  ]);
}

function unverified(stage: BuilderBranchReadbackStage): never {
  throw new BuilderBranchFilesError(
    "unverified",
    "Builder has no complete, current, identity-bound branch backup to verify.",
    stage,
  );
}

async function authorizeBranchRead(): Promise<{
  authorization: string;
}> {
  let authorization: Awaited<
    ReturnType<typeof resolveBuilderRequestAuthorization>
  >;
  try {
    authorization = await resolveBuilderRequestAuthorization({
      requiredScope: "builder:projects:read",
      legacyCredentialKeys: [],
    });
  } catch (error) {
    const requiresReauthorization = isBuilderReauthorizationRequired(error);
    throw new BuilderBranchFilesError(
      requiresReauthorization ? "not_connected" : "unavailable",
      requiresReauthorization
        ? "Connect Builder with project read access."
        : "Builder read access could not be checked.",
    );
  }
  if (!authorization || authorization.source !== "oauth") {
    throw new BuilderBranchFilesError(
      "not_connected",
      "Connect Builder with project read access.",
    );
  }
  return { authorization: authorization.authorization };
}

async function requestBranchStatus(
  input: BranchRef,
  authorization: string,
): Promise<unknown> {
  const url = new URL("/projects/branch/status", getBuilderApiHost());
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("branchName", input.branchName);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder branch readback could not be reached.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new BuilderBranchFilesError(
      response.status === 401 || response.status === 403
        ? "forbidden"
        : "unavailable",
      "Builder branch readback was rejected.",
    );
  }
  const bytes = await readBytes(response, 512 * 1024);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder returned an invalid readback response.",
    );
  }
}

function validateBranchRef(input: BranchRef): void {
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(input.projectId) ||
    input.branchName.length > 256 ||
    input.branchName
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      )
  ) {
    throw new BuilderBranchFilesError(
      "invalid_request",
      "A canonical project and branch are required.",
    );
  }
}

export async function readBuilderBranchBackupStatus(input: BranchRef) {
  validateBranchRef(input);
  const auth = await authorizeBranchRead();
  let rawStatus: unknown;
  try {
    rawStatus = await requestBranchStatus(input, auth.authorization);
  } catch (error) {
    if (error instanceof BuilderBranchFilesError) {
      throw new BuilderBranchFilesError(
        error.code,
        error.message,
        "status_request",
      );
    }
    throw error;
  }
  const result = backupInspectionSchema.safeParse(rawStatus);
  if (!result.success) return unverified("status_shape");
  const { branch, backupStatuses } = result.data;
  const backup = backupStatuses.code.backup;
  if (
    branch.projectId !== input.projectId ||
    branch.name !== input.branchName
  ) {
    return unverified("status_binding");
  }
  if (
    branch.deleted !== undefined &&
    branch.state !== undefined &&
    branch.deleted !== (branch.state === "deleted")
  ) {
    return unverified("status_binding");
  }
  if (!backup) {
    if (
      backupStatuses.code.state === "invalid" &&
      backupStatuses.code.outcome === "no-backup"
    ) {
      return unverified("status_no_backup");
    }
    return unverified("status_shape");
  }
  if (
    backup.projectId !== input.projectId ||
    backup.branchName !== input.branchName ||
    branch.ownerId !== backup.ownerId
  ) {
    return unverified("status_binding");
  }
  const branchCommit = primaryCommit(
    branch.lastCommitHash,
    "status_currentness",
  );
  const backupCommit = primaryCommit(
    backup.lastCommitHash,
    "status_currentness",
  );
  if (!branchCommit || !backupCommit) return unverified("status_currentness");
  const branchState: "active" | "archived" | "deleted" | "unknown" =
    branch.state ?? (branch.deleted === true ? "deleted" : "unknown");
  const backupPartial: boolean | "missing" | "invalid" =
    typeof backup.partial === "boolean"
      ? backup.partial
      : backup.partial === undefined
        ? "missing"
        : "invalid";
  return {
    branchState,
    backupPartial,
    backupValid: backupStatuses.code.state === "valid",
    backupComplete: backup.status === "completed",
    backupCurrent:
      backup.at >= branch.lastActivityAt && branchCommit === backupCommit,
    agentIdle: branch.agentState === "idle",
    hasUnpushedChanges: branch.hasUnpushedChanges,
    verificationPerformed: false as const,
  };
}

function primaryCommit(
  snapshot: string,
  failureStage: BuilderBranchReadbackStage,
): string | undefined {
  if (SHA.test(snapshot)) return snapshot;
  const pairs = snapshot.split(",");
  const entries: string[] = [];
  for (const pair of pairs) {
    const separator = pair.indexOf(":");
    if (separator < 1) unverified(failureStage);
    let folder: string;
    try {
      folder = decodeURIComponent(pair.slice(0, separator));
    } catch {
      return unverified(failureStage);
    }
    const commit = pair.slice(separator + 1);
    if (!SHA.test(commit)) unverified(failureStage);
    if (folder === "code") entries.push(commit);
  }
  return entries.length === 1 ? entries[0] : undefined;
}

async function readBytes(
  response: Response,
  maxBytes: number,
  stage?: BuilderBranchReadbackStage,
): Promise<Buffer> {
  if (!response.body) {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder response has no body.",
      stage,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        throw new BuilderBranchFilesError(
          "integrity_failed",
          "Builder readback exceeds its byte limit.",
          stage,
        );
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof BuilderBranchFilesError) throw error;
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder response could not be read completely.",
      stage,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readBuilderBranchFiles(
  input: BranchRef & { appPath: string },
) {
  const appId = input.appPath.startsWith("apps/")
    ? input.appPath.slice("apps/".length)
    : "";
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(input.projectId) ||
    input.branchName.length > 256 ||
    input.branchName
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      ) ||
    !isValidWorkspaceAppIdFormat(appId) ||
    appId.length > 64
  ) {
    throw new BuilderBranchFilesError(
      "invalid_request",
      "A canonical project, branch and app path are required.",
    );
  }
  const auth = await authorizeBranchRead();
  async function request(pathname: string, body?: BranchRef): Promise<unknown> {
    const url = new URL(pathname, getBuilderApiHost());
    if (!body) {
      url.searchParams.set("projectId", input.projectId);
      url.searchParams.set("branchName", input.branchName);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: {
          Authorization: auth.authorization,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch {
      throw new BuilderBranchFilesError(
        "unavailable",
        "Builder branch readback could not be reached.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new BuilderBranchFilesError(
        response.status === 401 || response.status === 403
          ? "forbidden"
          : "unavailable",
        "Builder branch readback was rejected.",
      );
    }
    const bytes = await readBytes(response, 512 * 1024);
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new BuilderBranchFilesError(
        "unavailable",
        "Builder returned an invalid readback response.",
      );
    }
  }

  async function readStatus(phase: StatusReadPhase) {
    let rawStatus: unknown;
    try {
      rawStatus = await requestBranchStatus(input, auth.authorization);
    } catch (error) {
      if (error instanceof BuilderBranchFilesError) {
        throw new BuilderBranchFilesError(
          error.code,
          error.message,
          statusFailureStages[phase].request,
        );
      }
      throw error;
    }
    const result = statusSchema.safeParse(rawStatus);
    if (!result.success) return unverified(statusFailureStages[phase].shape);
    const { branch, backupStatuses } = result.data;
    const backup = backupStatuses.code.backup;
    if (
      branch.projectId !== input.projectId ||
      branch.name !== input.branchName ||
      backup.projectId !== input.projectId ||
      backup.branchName !== input.branchName ||
      branch.ownerId !== backup.ownerId
    ) {
      return unverified(statusFailureStages[phase].binding);
    }
    const branchCommit = primaryCommit(
      branch.lastCommitHash,
      statusFailureStages[phase].currentness,
    );
    if (
      backup.at < branch.lastActivityAt ||
      branchCommit !== backup.lastCommitHash
    )
      return unverified(statusFailureStages[phase].currentness);
    return backup;
  }

  // Export can fall back to an older backup after a refresh error. Only accept
  // the bytes whose digest and commit still match the branch's recorded state.
  let rawDownload: unknown;
  try {
    rawDownload = await request("/projects/branch/bundle-download-url", {
      projectId: input.projectId,
      branchName: input.branchName,
    });
  } catch (error) {
    if (error instanceof BuilderBranchFilesError) {
      throw new BuilderBranchFilesError(
        error.code,
        error.message,
        "download_url_request",
      );
    }
    throw error;
  }
  const download = downloadSchema.safeParse(rawDownload);
  if (!download.success) return unverified("download_url_shape");
  const before = await readStatus("before_read");
  const beforeFingerprint = backupIdentityFingerprint(before);
  const filePath =
    before.ownerId +
    "/" +
    input.projectId +
    "/" +
    input.branchName +
    "/git.bundle";
  const url = new URL(download.data.signedUrl);
  const expiresAt = Date.parse(download.data.expiresAt);
  let storagePath: string;
  try {
    storagePath = decodeURIComponent(url.pathname);
  } catch {
    return unverified("download_url_binding");
  }
  if (
    download.data.filePath !== filePath ||
    url.origin !== "https://storage.googleapis.com" ||
    url.username ||
    url.password ||
    url.hash ||
    storagePath !== "/builder-projects-git-backups/" + filePath ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 25 * 60 * 60 * 1000
  )
    return unverified("download_url_binding");
  let response: Response;
  try {
    response = await ssrfSafeFetch(
      url.toString(),
      { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
      {
        httpsOnly: true,
        followRedirects: false,
        maxRedirects: 0,
        assertUrlAllowed: (candidate) => {
          if (new URL(candidate).origin !== url.origin)
            throw new Error("Unexpected bundle host");
        },
      },
    );
  } catch {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder branch bundle could not be downloaded.",
      "bundle_download",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder branch bundle is unavailable.",
      "bundle_download",
    );
  }
  const bundle = await readBytes(response, MAX_BUNDLE_BYTES, "bundle_read");
  if (
    bundle.byteLength !== before.size ||
    createHash("md5").update(bundle).digest("base64") !== before.contentMd5
  ) {
    throw new BuilderBranchFilesError(
      "integrity_failed",
      "Builder branch bundle failed its recorded byte integrity check.",
      "bundle_digest",
    );
  }
  let snapshot: Awaited<ReturnType<typeof readBuilderGitBundle>>;
  try {
    snapshot = await readBuilderGitBundle({
      bundle,
      commitSha: before.lastCommitHash,
      appPath: input.appPath,
    });
  } catch (error) {
    throw new BuilderBranchFilesError(
      error instanceof BuilderGitBundleError && error.code === "unavailable"
        ? "unavailable"
        : "integrity_failed",
      "Builder branch files could not be verified from the bundle.",
      error instanceof BuilderGitBundleError && error.code === "target_missing"
        ? "target_subtree_missing"
        : "bundle_parse",
    );
  }
  const after = await readStatus("after_read");
  if (backupIdentityFingerprint(after) !== beforeFingerprint)
    return unverified("post_read_currentness");
  return {
    projectId: input.projectId,
    branchName: input.branchName,
    ...snapshot,
  };
}
