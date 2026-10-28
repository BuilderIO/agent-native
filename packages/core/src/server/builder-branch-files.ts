import { createHash } from "node:crypto";

import { z } from "zod";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { resolveBuilderRequestAuthorization } from "./builder-api-auth.js";
import {
  BuilderGitBundleError,
  readBuilderGitBundle,
} from "./builder-branch-git.js";
import { getBuilderApiHost } from "./builder-browser.js";

const SHA = /^[a-f0-9]{40}$/;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;

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

const downloadSchema = z.object({
  signedUrl: z.string().url(),
  filePath: z.string().min(1).max(4096),
  partial: z.literal(false),
  expiresAt: z.string(),
});

type BranchRef = { projectId: string; branchName: string };

function unverified(): never {
  throw new BuilderBranchFilesError(
    "unverified",
    "Builder has no complete, current, identity-bound branch backup to verify.",
  );
}

function primaryCommit(snapshot: string): string | undefined {
  if (SHA.test(snapshot)) return snapshot;
  const pairs = snapshot.split(",");
  const entries: string[] = [];
  for (const pair of pairs) {
    const separator = pair.indexOf(":");
    if (separator < 1) unverified();
    let folder: string;
    try {
      folder = decodeURIComponent(pair.slice(0, separator));
    } catch {
      return unverified();
    }
    const commit = pair.slice(separator + 1);
    if (!SHA.test(commit)) unverified();
    if (folder === "code") entries.push(commit);
  }
  return entries.length === 1 ? entries[0] : undefined;
}

async function readBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder response has no body.",
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
        );
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof BuilderBranchFilesError) throw error;
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder response could not be read completely.",
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
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(input.projectId) ||
    input.branchName.length > 256 ||
    input.branchName
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      ) ||
    !/^apps\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.appPath)
  ) {
    throw new BuilderBranchFilesError(
      "invalid_request",
      "A canonical project, branch and app path are required.",
    );
  }
  let authorization: Awaited<
    ReturnType<typeof resolveBuilderRequestAuthorization>
  >;
  try {
    authorization = await resolveBuilderRequestAuthorization({
      requiredScope: "builder:projects:read",
    });
  } catch {
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder read access could not be checked.",
    );
  }
  if (
    !authorization ||
    (authorization.source === "legacy" && !authorization.legacyPublicKey)
  ) {
    throw new BuilderBranchFilesError(
      "not_connected",
      "Connect Builder with project read access.",
    );
  }
  const auth = authorization;
  async function request(pathname: string, body?: BranchRef): Promise<unknown> {
    const url = new URL(pathname, getBuilderApiHost());
    if (auth.legacyPublicKey)
      url.searchParams.set("apiKey", auth.legacyPublicKey);
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

  async function readStatus() {
    const result = statusSchema.safeParse(
      await request("/projects/branch/status"),
    );
    if (!result.success) return unverified();
    const { branch, backupStatuses } = result.data;
    const backup = backupStatuses.code.backup;
    if (
      branch.projectId !== input.projectId ||
      branch.name !== input.branchName ||
      backup.projectId !== input.projectId ||
      backup.branchName !== input.branchName ||
      branch.ownerId !== backup.ownerId ||
      backup.at < branch.lastActivityAt ||
      primaryCommit(branch.lastCommitHash) !== backup.lastCommitHash
    )
      return unverified();
    return backup;
  }

  // Export can fall back to an older backup after a refresh error. Only accept
  // the bytes whose digest and commit still match the branch's recorded state.
  const download = downloadSchema.safeParse(
    await request("/projects/branch/bundle-download-url", {
      projectId: input.projectId,
      branchName: input.branchName,
    }),
  );
  if (!download.success) return unverified();
  const before = await readStatus();
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
    return unverified();
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
    return unverified();
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
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new BuilderBranchFilesError(
      "unavailable",
      "Builder branch bundle is unavailable.",
    );
  }
  const bundle = await readBytes(response, MAX_BUNDLE_BYTES);
  if (
    bundle.byteLength !== before.size ||
    createHash("md5").update(bundle).digest("base64") !== before.contentMd5
  ) {
    throw new BuilderBranchFilesError(
      "integrity_failed",
      "Builder branch bundle failed its recorded byte integrity check.",
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
    );
  }
  const after = await readStatus();
  if (
    after.lastCommitHash !== before.lastCommitHash ||
    after.contentMd5 !== before.contentMd5 ||
    after.at !== before.at
  )
    return unverified();
  return {
    projectId: input.projectId,
    branchName: input.branchName,
    ...snapshot,
  };
}
