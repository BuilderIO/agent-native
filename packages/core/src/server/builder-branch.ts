/**
 * Read and message helpers for one Builder agent branch.
 *
 * `runBuilderAgent` starts a branch; these cover what a caller needs
 * afterwards: the state of the branch's agent, and a way to send it a
 * follow-up. Each returns a typed result or throws `BuilderBranchError`, and
 * neither ever creates a project or branch.
 *
 * Both routes sit under Builder's `/projects` OAuth policy, so they take the
 * project scopes, not the `builder:agents:run` scope the start route needs.
 * Legacy private keys also send the space/public key as `apiKey`.
 */

import { z } from "zod";

import { isActionContractError } from "../action.js";
import {
  resolveBuilderRequestAuthorization,
  type BuilderRequestAuthorization,
} from "./builder-api-auth.js";
import { getBuilderApiHost } from "./builder-browser.js";
import type { BuilderOAuthPermissionScope } from "./builder-oauth.js";
import { CredentialStoreUnavailableError } from "./credential-provider.js";

const BRANCH_STATUS_TIMEOUT_MS = 30_000;
// Builder boots the branch container before it accepts the message, even for
// a fire-and-forget send, so a cold branch needs longer than a read.
const BRANCH_MESSAGE_TIMEOUT_MS = 60_000;
// Builder's own wording for a failed container boot in the send-message
// stream. Any other error text is treated as a plain rejection.
const CONTAINER_SETUP_FAILED = "Container setup failed";

export type BuilderBranchAgentState = "running" | "waiting" | "idle";
export type BuilderBranchState = "active" | "archived" | "deleted";
export type BuilderBranchPrStatus =
  | "open"
  | "closed"
  | "merged"
  | "draft"
  | "approved";

export interface BuilderBranchRef {
  projectId: string;
  branchName: string;
}

export interface GetBuilderBranchStatusOptions extends BuilderBranchRef {
  timeoutMs?: number;
}

export interface BuilderBranchStatus {
  /** `null` when Builder has recorded no agent state for the branch. */
  agentState: BuilderBranchAgentState | null;
  /** Epoch milliseconds; `null` when Builder has recorded no activity. */
  lastActivityAt: number | null;
  state: BuilderBranchState;
  archived: boolean;
  prStatus: BuilderBranchPrStatus | null;
  prUrl: string | null;
}

export interface SendBuilderBranchMessageOptions extends BuilderBranchRef {
  message: string;
  timeoutMs?: number;
}

export interface SendBuilderBranchMessageResult {
  /** Builder handed the message to the branch agent, queued or started. */
  accepted: true;
}

export type BuilderBranchOperation = "status" | "message";

export type BuilderBranchErrorCode =
  | "invalid_request"
  | "not_connected"
  | "credentials_unavailable"
  | "unauthorized"
  | "forbidden"
  | "branch_not_found"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "incomplete_response"
  | "request_rejected"
  | "container_unavailable"
  | "message_rejected";

const RETRYABLE_CODES: ReadonlySet<BuilderBranchErrorCode> = new Set([
  "credentials_unavailable",
  "rate_limited",
  "server_error",
  "timeout",
  "network_error",
  "incomplete_response",
  "container_unavailable",
]);

/**
 * Every failure from the branch helpers. `retryable` means the failure looks
 * transient, not that a retry is free: after `timeout`, `network_error` or
 * `incomplete_response` on `sendBuilderBranchMessage` the request was already
 * on the wire and Builder may have delivered the message, so a retry can send
 * it twice. Messages never carry response bodies or credentials.
 */
export class BuilderBranchError extends Error {
  readonly code: BuilderBranchErrorCode;
  readonly retryable: boolean;
  readonly operation: BuilderBranchOperation;
  readonly status: number | null;

  constructor(
    code: BuilderBranchErrorCode,
    operation: BuilderBranchOperation,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "BuilderBranchError";
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    this.operation = operation;
    this.status = options.status ?? null;
  }
}

const OPERATION_LABEL: Record<BuilderBranchOperation, string> = {
  status: "branch status",
  message: "branch message",
};

const branchStatusResponseSchema = z.object({
  branch: z.object({
    agentState: z.enum(["running", "waiting", "idle"]).nullish(),
    lastActivityAt: z.number().nullish(),
    state: z.enum(["active", "archived", "deleted"]).nullish(),
    deleted: z.boolean().nullish(),
    prStatus: z
      .enum(["open", "closed", "merged", "draft", "approved"])
      .nullish(),
    prUrl: z.string().nullish(),
  }),
});

function requireValue(
  operation: BuilderBranchOperation,
  value: unknown,
  name: string,
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new BuilderBranchError(
      "invalid_request",
      operation,
      `${name} is required`,
    );
  }
  return trimmed;
}

async function authorize(
  operation: BuilderBranchOperation,
  requiredScope: BuilderOAuthPermissionScope,
): Promise<BuilderRequestAuthorization> {
  let authorization: BuilderRequestAuthorization | null;
  try {
    authorization = await resolveBuilderRequestAuthorization({
      requiredScope,
    });
  } catch (error) {
    if (isActionContractError(error)) {
      throw new BuilderBranchError(
        "not_connected",
        operation,
        "Builder.io access is missing or needs re-authorizing.",
        { cause: error },
      );
    }
    if (error instanceof CredentialStoreUnavailableError) {
      throw new BuilderBranchError(
        "credentials_unavailable",
        operation,
        "Saved Builder connections could not be read. Try again shortly.",
        { cause: error },
      );
    }
    throw error;
  }
  if (!authorization) {
    throw new BuilderBranchError(
      "not_connected",
      operation,
      "Builder.io is not connected.",
    );
  }
  if (authorization.source === "legacy" && !authorization.legacyPublicKey) {
    throw new BuilderBranchError(
      "not_connected",
      operation,
      "Builder legacy credentials require BUILDER_PUBLIC_KEY for this request.",
    );
  }
  return authorization;
}

function branchApiUrl(
  path: string,
  authorization: BuilderRequestAuthorization,
  params: Record<string, string>,
): URL {
  const url = new URL(path, getBuilderApiHost());
  if (authorization.legacyPublicKey) {
    url.searchParams.set("apiKey", authorization.legacyPublicKey);
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function transportError(
  operation: BuilderBranchOperation,
  error: unknown,
): BuilderBranchError {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new BuilderBranchError(
      "timeout",
      operation,
      `Builder ${OPERATION_LABEL[operation]} request timed out`,
      { cause: error },
    );
  }
  return new BuilderBranchError(
    "network_error",
    operation,
    `Builder ${OPERATION_LABEL[operation]} request could not reach Builder`,
    { cause: error },
  );
}

/** Wraps only network I/O so a bug in the code around it is not retyped. */
async function viaTransport<T>(
  operation: BuilderBranchOperation,
  io: () => Promise<T>,
): Promise<T> {
  try {
    return await io();
  } catch (error) {
    throw transportError(operation, error);
  }
}

function statusError(
  operation: BuilderBranchOperation,
  status: number,
): BuilderBranchError {
  const label = OPERATION_LABEL[operation];
  const options = { status };
  if (status === 401) {
    return new BuilderBranchError(
      "unauthorized",
      operation,
      `Builder rejected the credential for the ${label} request (401). Reconnect Builder.io.`,
      options,
    );
  }
  if (status === 403) {
    return new BuilderBranchError(
      "forbidden",
      operation,
      `Builder denied the ${label} request (403): the connection lacks access to this space or scope.`,
      options,
    );
  }
  if (operation === "status" && (status === 404 || status === 410)) {
    return new BuilderBranchError(
      "branch_not_found",
      operation,
      `Builder has no active branch for this project and branch name (${status}).`,
      options,
    );
  }
  if (status === 408) {
    return new BuilderBranchError(
      "timeout",
      operation,
      `Builder timed out handling the ${label} request (408)`,
      options,
    );
  }
  if (status === 429) {
    return new BuilderBranchError(
      "rate_limited",
      operation,
      `Builder rate-limited the ${label} request (429)`,
      options,
    );
  }
  if (status >= 500) {
    return new BuilderBranchError(
      "server_error",
      operation,
      `Builder failed the ${label} request (${status})`,
      options,
    );
  }
  return new BuilderBranchError(
    "request_rejected",
    operation,
    `Builder rejected the ${label} request (${status})`,
    options,
  );
}

async function sendRequest(args: {
  operation: BuilderBranchOperation;
  url: URL;
  method: "GET" | "POST";
  authorization: BuilderRequestAuthorization;
  body?: Record<string, unknown>;
  timeoutMs: number;
}): Promise<Response> {
  const response = await viaTransport(args.operation, () =>
    fetch(args.url, {
      method: args.method,
      headers: {
        Authorization: args.authorization.authorization,
        ...(args.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(args.body ? { body: JSON.stringify(args.body) } : {}),
      signal: AbortSignal.timeout(args.timeoutMs),
    }),
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw statusError(args.operation, response.status);
  }
  return response;
}

function invalidResponse(
  operation: BuilderBranchOperation,
): BuilderBranchError {
  return new BuilderBranchError(
    "invalid_response",
    operation,
    `Builder returned an unreadable ${OPERATION_LABEL[operation]} response`,
  );
}

function parseBranchStatus(text: string): BuilderBranchStatus {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // No cause: a SyntaxError quotes the start of the response body.
    throw invalidResponse("status");
  }
  const parsed = branchStatusResponseSchema.safeParse(payload);
  if (!parsed.success) throw invalidResponse("status");

  const { branch } = parsed.data;
  // Legacy branch records carry only `deleted`; Builder's own state reader
  // falls back to it the same way.
  const state: BuilderBranchState =
    branch.state ?? (branch.deleted ? "deleted" : "active");
  return {
    agentState: branch.agentState ?? null,
    lastActivityAt: branch.lastActivityAt ?? null,
    state,
    archived: state === "archived",
    prStatus: branch.prStatus ?? null,
    prUrl: branch.prUrl?.trim() || null,
  };
}

export async function getBuilderBranchStatus(
  options: GetBuilderBranchStatusOptions,
): Promise<BuilderBranchStatus> {
  const projectId = requireValue("status", options.projectId, "projectId");
  const branchName = requireValue("status", options.branchName, "branchName");
  const authorization = await authorize("status", "builder:projects:read");

  // Query form of the branch read: the same handler serves
  // /projects/:projectId/branches/:branchName, but a branch name containing
  // slashes then depends on every proxy preserving %2F in the path.
  const response = await sendRequest({
    operation: "status",
    url: branchApiUrl("/projects/branches", authorization, {
      projectId,
      branchName,
    }),
    method: "GET",
    authorization,
    timeoutMs: options.timeoutMs ?? BRANCH_STATUS_TIMEOUT_MS,
  });
  const text = await viaTransport("status", () => response.text());
  return parseBranchStatus(text);
}

function readMessageLine(line: string): SendBuilderBranchMessageResult | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let chunk: unknown;
  try {
    chunk = JSON.parse(trimmed);
  } catch {
    throw invalidResponse("message");
  }
  if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw invalidResponse("message");
  }
  const { type, message } = chunk as { type?: unknown; message?: unknown };
  if (type === "message-sent") return { accepted: true };
  if (type === "error") {
    if (message === CONTAINER_SETUP_FAILED) {
      throw new BuilderBranchError(
        "container_unavailable",
        "message",
        "Builder could not start the branch container, so the message was not delivered.",
      );
    }
    throw new BuilderBranchError(
      "message_rejected",
      "message",
      "Builder reported the message was not delivered.",
    );
  }
  return null;
}

/**
 * Reads the send-message stream until it reports an outcome. The route answers
 * 200 even when the send fails, so success is only the `message-sent` chunk.
 */
async function readMessageOutcome(
  response: Response,
): Promise<SendBuilderBranchMessageResult> {
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      for (;;) {
        const { done, value } = await viaTransport("message", () =>
          reader.read(),
        );
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          const outcome = readMessageLine(line);
          if (outcome) return outcome;
        }
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new BuilderBranchError(
    "incomplete_response",
    "message",
    "Builder's message stream ended without reporting whether the message was delivered.",
  );
}

export async function sendBuilderBranchMessage(
  options: SendBuilderBranchMessageOptions,
): Promise<SendBuilderBranchMessageResult> {
  const projectId = requireValue("message", options.projectId, "projectId");
  const branchName = requireValue("message", options.branchName, "branchName");
  requireValue("message", options.message, "message");
  const authorization = await authorize("message", "builder:projects:write");

  const response = await sendRequest({
    operation: "message",
    url: branchApiUrl(
      "/projects/branch/message",
      authorization,
      authorization.legacyPublicKey && authorization.userId
        ? { userId: authorization.userId }
        : {},
    ),
    method: "POST",
    authorization,
    body: {
      projectId,
      branchName,
      // Without it the stream stays open for the agent's whole turn.
      fireAndForget: true,
      // Builder's own automated senders set `queue` so a follow-up waits for a
      // running turn instead of racing it.
      userMessage: { userPrompt: options.message, queue: true },
    },
    timeoutMs: options.timeoutMs ?? BRANCH_MESSAGE_TIMEOUT_MS,
  });
  return readMessageOutcome(response);
}
