/**
 * Shared Gmail inbox-listing core.
 *
 * This is the single source of truth for turning a view/query/label into a
 * filtered, sorted list of emails from Gmail — called by both the actions
 * surface (agent, `actions/list-emails.ts`) and the REST route handler
 * (frontend, `handlers/emails.ts::listEmails`). Before this file existed the
 * two call sites re-implemented the same query-build + pagination +
 * thread-scoping pipeline independently, which let them drift: the REST
 * handler filtered out snoozed threads and handled Gmail 429/quota errors
 * gracefully, while the agent action did neither. Keeping this logic in one
 * place means the agent's inbox always matches what the human sees.
 *
 * Callers remain responsible for resolving `accountTokens` / `labelMap`
 * (the two call sites fetch these differently — the REST handler caches
 * label names and account display names, the action does not — that's a
 * legitimate perf difference, not part of the listing core) and for shaping
 * their own response envelope (compact/counts for the action; pagination
 * tokens, error headers, and HTTP status for the REST handler).
 */
import type { EmailMessage } from "@shared/types.js";

import {
  buildGmailEmailSearchQuery,
  filterInboxScopedThreadMessages,
} from "./gmail-query.js";
import {
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT,
  gmailToEmailMessage,
  listGmailMessages,
} from "./google-auth.js";
import { getSnoozedThreadIds } from "./jobs.js";

export interface ListInboxEmailsAccountToken {
  email: string;
  accessToken: string;
}

export interface ListInboxEmailsParams {
  ownerEmail: string;
  view: string;
  q?: string;
  label?: string;
  limit: number;
  pageTokens?: Record<string, string>;
  threadFormat?: "full" | "metadata" | "minimal";
  threadCandidateLimit?: number;
  accountTokens: ListInboxEmailsAccountToken[];
  labelMap: Map<string, string>;
}

export interface ListInboxEmailsSuccess {
  ok: true;
  emails: EmailMessage[];
  errors: Array<{ email: string; error: string }>;
  nextPageTokens?: Record<string, string>;
  resultSizeEstimate?: number;
}

export interface ListInboxEmailsFailure {
  ok: false;
  message: string;
  isQuotaError: boolean;
  retryAfterSeconds?: number;
}

export type ListInboxEmailsResult =
  | ListInboxEmailsSuccess
  | ListInboxEmailsFailure;

export function isGmailQuotaError(message: string): boolean {
  return /\b(?:429|quota|rate limit|rateLimitExceeded|userRateLimitExceeded)\b/i.test(
    message,
  );
}

export function retryAfterSecondsFromErrors(
  errors: Array<{ error: string }>,
): number {
  let retryAfter = 60;
  for (const { error } of errors) {
    const match = error.match(/retry in\s+(\d+)s/i);
    if (!match) continue;
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > retryAfter) {
      retryAfter = seconds;
    }
  }
  return Math.min(retryAfter, 5 * 60);
}

/**
 * Fetch, thread-scope, sort, and snooze-filter Gmail messages for a view.
 * Returns a discriminated result instead of throwing on Gmail errors so both
 * callers can decide how to surface a rate-limit/quota failure gracefully
 * (HTTP status + Retry-After header for the REST handler, a structured JSON
 * error payload for the agent action) rather than an unhandled exception.
 */
export async function listInboxEmails(
  params: ListInboxEmailsParams,
): Promise<ListInboxEmailsResult> {
  const {
    ownerEmail,
    view,
    q,
    label,
    limit,
    pageTokens,
    threadFormat,
    threadCandidateLimit,
    accountTokens,
    labelMap,
  } = params;

  const connectedEmails = new Set(
    accountTokens.map((account) => account.email.toLowerCase()),
  );
  const searchQuery = buildGmailEmailSearchQuery({ view, q, label });

  const { messages, errors, nextPageTokens, resultSizeEstimate } =
    await listGmailMessages(searchQuery, limit, ownerEmail, pageTokens, {
      mode: "threads",
      threadFormat,
      threadCandidateLimit,
      threadRecentMessageCandidateLimit:
        !q && (view === "inbox" || view === "unread")
          ? DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT
          : undefined,
    });

  if (messages.length === 0 && errors.length > 0) {
    const isQuotaError = errors.every((e) => isGmailQuotaError(e.error));
    return {
      ok: false,
      message: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
      isQuotaError,
      retryAfterSeconds: isQuotaError
        ? retryAfterSecondsFromErrors(errors)
        : undefined,
    };
  }

  let emails = messages.map((m: any) =>
    gmailToEmailMessage(m, m._accountEmail, labelMap),
  ) as EmailMessage[];
  emails = filterInboxScopedThreadMessages(
    emails,
    view,
    label,
    connectedEmails,
  );
  emails = [...emails].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // Filter out snoozed threads (they may linger in Gmail due to eventual
  // consistency). Skip when searching — the user/agent wants to find snoozed
  // emails too when explicitly searching for them.
  if (!q && (view === "inbox" || view === "unread")) {
    const snoozedIds = await getSnoozedThreadIds(ownerEmail);
    if (snoozedIds.size > 0) {
      emails = emails.filter(
        (e) => !snoozedIds.has(e.threadId) && !snoozedIds.has(e.id),
      );
    }
  }

  return { ok: true, emails, errors, nextPageTokens, resultSizeEstimate };
}
