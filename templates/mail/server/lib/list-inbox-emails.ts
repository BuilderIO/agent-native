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
  /** Disable the extra recent-message candidate pass for bounded inventory. */
  includeRecentMessageCandidates?: boolean;
  accountTokens: ListInboxEmailsAccountToken[];
  /** Selected account ids are forwarded to Gmail before token refresh. */
  accountEmails?: string[];
  labelMap: Map<string, string>;
}

export interface ListInboxEmailsError {
  email: string;
  error: string;
  isQuotaError?: boolean;
  retryAfterMs?: number;
}

export interface ListInboxEmailsSuccess {
  ok: true;
  emails: EmailMessage[];
  errors: ListInboxEmailsError[];
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

// Quota/cooldown errors must be identified by the `isQuotaError` flag that
// google-auth.ts sets from `error instanceof GmailQuotaCooldownError` — never
// by matching the message text. The message is deliberately jargon-free for
// the agent (no "quota"/"429"/"rate limit") so a regex here would silently
// stop matching and every cooldown would surface as a hard failure (502)
// instead of a graceful 429 + Retry-After. That mismatch is exactly what
// produced the "frequent 502s switching labels" report: the label view has
// no cached data to fall back to, so every switch during an active 90s
// cooldown hit this misclassification.
export function isGmailQuotaError(error: ListInboxEmailsError): boolean {
  return error.isQuotaError === true;
}

export function retryAfterSecondsFromErrors(
  errors: Array<{ retryAfterMs?: number }>,
): number {
  // Worst case across accounts: whichever cooldown clears last. Only fall
  // back to the 60s default when no error carried a real duration.
  let retryAfterMs: number | undefined;
  for (const { retryAfterMs: ms } of errors) {
    if (
      typeof ms === "number" &&
      (retryAfterMs === undefined || ms > retryAfterMs)
    ) {
      retryAfterMs = ms;
    }
  }
  return Math.min(Math.round((retryAfterMs ?? 60_000) / 1000), 5 * 60);
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
    includeRecentMessageCandidates = true,
    accountTokens,
    accountEmails,
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
        includeRecentMessageCandidates &&
        !q &&
        (view === "inbox" || view === "unread")
          ? DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT
          : undefined,
      accountEmails,
    });

  const failedAccounts = new Set(
    errors.map((error) => error.email.toLowerCase()),
  );
  const everySelectedAccountFailed = [...connectedEmails].every((email) =>
    failedAccounts.has(email),
  );
  if (
    messages.length === 0 &&
    errors.length > 0 &&
    everySelectedAccountFailed
  ) {
    const isQuotaError = errors.every((e) => isGmailQuotaError(e));
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
