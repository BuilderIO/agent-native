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
  includeRecentMessageCandidates?: boolean;
  accountTokens: ListInboxEmailsAccountToken[];
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

export function isGmailQuotaError(error: ListInboxEmailsError): boolean {
  return error.isQuotaError === true;
}

export function retryAfterSecondsFromErrors(
  errors: Array<{ retryAfterMs?: number }>,
): number {
  let retryAfterMs: number | undefined;
  for (const { retryAfterMs: ms } of errors) {
    if (
      typeof ms === "number" &&
      (retryAfterMs === undefined || ms > retryAfterMs)
    ) {
      retryAfterMs = ms;
    }
  }
  return Math.min(
    Math.max(1, Math.ceil((retryAfterMs ?? 60_000) / 1000)),
    5 * 60,
  );
}

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
