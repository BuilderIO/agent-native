import type {
  McpApprovalView,
  McpApprovalViewState,
} from "../mcp/approval-route.js";
import { agentNativePath } from "./api-path.js";

/**
 * The browser side of an MCP approval review: an app page reads the review
 * and sends the decision through the framework route, which checks the
 * browser session, the grant's owner and app, and the decision token.
 */

export {
  MCP_APPROVAL_HASH_PARAM,
  readMcpApprovalId,
} from "../shared/mcp-approval-review.js";
export {
  mcpApprovalMessagesForLocale,
  type McpApprovalMessages,
} from "../localization/mcp-approval-messages.js";
export {
  formatApprovalTime,
  formatWallTime,
  zoneOffsetMinutes,
} from "../mcp/approval-time.js";
export { describeFieldValue } from "../mcp/approval-summary.js";
export type {
  McpApprovalRequester,
  McpApprovalView,
  McpApprovalViewState,
} from "../mcp/approval-route.js";
export type {
  McpApprovalField,
  McpApprovalSummary,
} from "../mcp/approval-summary.js";
export type { McpApprovalPriorRun } from "../mcp/execute-action-call.js";

type McpApprovalUnauthorized =
  | { status: "signed-out" }
  /** The app's own authentication can't sign anyone in to this page. */
  | { status: "sign-in-unavailable" };

export type McpApprovalLoadResult =
  | { status: "ready"; view: McpApprovalView }
  /** No grant with this id is the reader's; `otherOrganization` when it is theirs elsewhere. */
  | { status: "not-found"; otherOrganization: boolean }
  | McpApprovalUnauthorized;

export type McpApprovalDecisionResult =
  /** The grant's state now: the decision, or one made first elsewhere. */
  | { status: "decided"; state: McpApprovalViewState; expiresAt: number }
  /** The token is for another session or user; read the review again. */
  | { status: "out-of-date" }
  | { status: "not-found" }
  | McpApprovalUnauthorized;

/** A response the review page can't act on. */
export class McpApprovalRequestError extends Error {
  constructor(readonly status: number) {
    super(`The approval review request failed with status ${status}`);
    this.name = "McpApprovalRequestError";
  }
}

function approvalPath(id: string): string {
  return agentNativePath(`/_agent-native/mcp/approvals/${id}`);
}

async function readUnauthorized(
  response: Response,
): Promise<McpApprovalUnauthorized> {
  const body = (await response.json()) as { reason?: unknown };
  return body.reason === "sign-in-unavailable"
    ? { status: "sign-in-unavailable" }
    : { status: "signed-out" };
}

function readDecided(body: unknown): McpApprovalDecisionResult | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { state, expiresAt } = body as Record<string, unknown>;
  return typeof state === "string" && typeof expiresAt === "number"
    ? { status: "decided", state: state as McpApprovalViewState, expiresAt }
    : undefined;
}

/** Reads one review for the signed-in user. Throws when the server can't answer. */
export async function fetchMcpApproval(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<McpApprovalLoadResult> {
  const response = await fetch(approvalPath(id), {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal: options.signal,
  });
  if (response.status === 401) return readUnauthorized(response);
  if (response.status === 404) {
    const body = (await response.json()) as { reason?: unknown };
    return {
      status: "not-found",
      otherOrganization: body.reason === "other-organization",
    };
  }
  if (!response.ok) throw new McpApprovalRequestError(response.status);
  return { status: "ready", view: (await response.json()) as McpApprovalView };
}

/** Approves or denies one review with the token its view carried. */
export async function sendMcpApprovalDecision(
  id: string,
  decision: "approve" | "deny",
  csrfToken: string,
): Promise<McpApprovalDecisionResult> {
  const response = await fetch(approvalPath(id), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ decision, csrfToken }),
  });
  if (response.status === 401) return readUnauthorized(response);
  if (response.status === 403) return { status: "out-of-date" };
  if (response.status === 404) return { status: "not-found" };
  // 409: decided or expired before this decision arrived; the body says how.
  if (response.ok || response.status === 409) {
    const decided = readDecided(await response.json());
    if (decided) return decided;
  }
  throw new McpApprovalRequestError(response.status);
}
