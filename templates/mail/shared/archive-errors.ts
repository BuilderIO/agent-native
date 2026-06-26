export interface ArchiveFailureMessage {
  message: string;
  statusCode: number;
}

interface ArchiveFailureDetail {
  detail: string;
  statusCode: number;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function withoutActionPrefix(message: string): string {
  return message.replace(/^Action\s+archive-email\s+failed:\s*/i, "").trim();
}

function quotaDetail(message: string): string {
  const wait = message.match(/ready again in about ([^.]+)\./i)?.[1];
  if (wait) {
    return `Gmail is briefly busy and will be ready again in about ${wait}.`;
  }
  return "Gmail is briefly busy. Try again in a moment.";
}

function classifyArchiveFailure(message: string): ArchiveFailureDetail {
  const lower = message.toLowerCase();

  if (
    /\b(429|quota|rate limit|ratelimit|user-rate)\b/i.test(message) ||
    lower.includes("briefly busy")
  ) {
    return { detail: quotaDetail(message), statusCode: 429 };
  }

  if (
    lower.includes("invalid_grant") ||
    lower.includes("invalid_client") ||
    lower.includes("unauthorized_client") ||
    lower.includes("oauth token refresh failed") ||
    lower.includes("no valid access token") ||
    /\b401\b/.test(lower)
  ) {
    return {
      detail: "Gmail needs to be reconnected.",
      statusCode: 409,
    };
  }

  if (
    lower.includes("insufficient_scope") ||
    lower.includes("insufficient permissions") ||
    lower.includes("forbidden") ||
    lower.includes("gmail.modify") ||
    /\b403\b/.test(lower)
  ) {
    return {
      detail:
        "this Google connection does not have permission to modify Gmail. Reconnect Gmail and grant Mail access.",
      statusCode: 409,
    };
  }

  if (lower.includes("no google account connected")) {
    return {
      detail: "no Google account is connected. Connect Gmail before archiving.",
      statusCode: 409,
    };
  }

  if (lower.includes("account not owned") || lower.includes("not connected")) {
    return {
      detail: "the Gmail account for this conversation is not connected.",
      statusCode: 409,
    };
  }

  if (
    lower.includes("not found") ||
    lower.includes("thread not found") ||
    /\b404\b/.test(lower)
  ) {
    return {
      detail:
        "Gmail no longer has that conversation. Refresh Mail and try again.",
      statusCode: 409,
    };
  }

  return {
    detail: "Gmail did not accept the change. Refresh Mail and try again.",
    statusCode: 409,
  };
}

export function summarizeArchiveFailures(input: {
  succeeded: number;
  total: number;
  failures: string[];
}): ArchiveFailureMessage {
  const firstFailure = input.failures.find((failure) => failure.trim()) ?? "";
  const classified = classifyArchiveFailure(firstFailure);
  const failedCount = Math.max(0, input.total - input.succeeded);

  if (input.total <= 1) {
    return {
      message: `Archive failed because ${classified.detail}`,
      statusCode: classified.statusCode,
    };
  }

  return {
    message: `Archived ${input.succeeded}/${input.total} conversations. Could not archive ${failedCount} because ${classified.detail}`,
    statusCode: classified.statusCode,
  };
}

export function archiveFailureToastMessage(
  error: unknown,
  fallback: string,
): string {
  const message = withoutActionPrefix(errorText(error));
  if (!message || /^internal server error$/i.test(message)) return fallback;

  if (/\bFailures:/i.test(message)) {
    return summarizeArchiveFailures({
      succeeded: 0,
      total: 1,
      failures: [message],
    }).message;
  }

  return message;
}
