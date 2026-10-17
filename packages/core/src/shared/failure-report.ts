/**
 * One failure, described well enough that whoever meets it in analytics, Slack
 * or GitHub can open the exact thread, run or route without asking the reporter
 * for anything. Isomorphic: the server attaches it to captures
 * (`observability/failure-context.ts`), the client formats the report a person
 * copies from an error card (`client/failure-report.ts`).
 */
export interface FailureContext {
  appId?: string;
  route?: string;
  actionName?: string;
  automationName?: string;
  threadId?: string;
  runId?: string;
  requestId?: string;
  /** `org` when the work ran under an organization, never an email address. */
  userScope?: "org" | "personal";
  /** `https://<app host>/?thread=<chat_threads.id>`, the canonical deep link. */
  threadUrl?: string;
  release?: string;
  environment?: string;
  errorCode?: string;
  failureClass?: string;
  occurredAt?: string;
}

const MAX_VALUE_CHARS = 300;

/** The query parameter `?thread=` that opens a chat thread (`chat-thread-url.ts`). */
const CHAT_THREAD_QUERY_PARAM = "thread";

export function chatThreadUrl(appBaseUrl: string, threadId: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/?${CHAT_THREAD_QUERY_PARAM}=${encodeURIComponent(threadId)}`;
}

/** Drops empty keys so a packet never carries `undefined` or blank strings. */
export function compactFailureContext(
  context: Partial<FailureContext>,
): FailureContext {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out as FailureContext;
}

function line(label: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  // One line per field: a pasted report must never gain extra lines from a
  // value that carried a newline.
  const flat = value.replace(/\s+/g, " ").trim();
  return flat ? `${label}: ${flat.slice(0, MAX_VALUE_CHARS)}` : undefined;
}

/**
 * The compact plain-text packet behind a "Copy details" button. The last line
 * names the read-only inspection action, so an agent that is handed only this
 * text knows where to look next.
 */
export function formatFailureReport(
  context: FailureContext,
  options: { message?: string } = {},
): string {
  const inspect = context.runId
    ? `get-agent-thread-debug ${JSON.stringify({ runId: context.runId })}`
    : context.threadId
      ? `get-agent-thread-debug ${JSON.stringify({ threadId: context.threadId })}`
      : undefined;
  return [
    "Agent-Native failure report",
    line("error", options.message),
    line("app", context.appId),
    line("thread", context.threadUrl ?? context.threadId),
    line("run", context.runId),
    line("request", context.requestId),
    line("code", context.errorCode),
    line("class", context.failureClass),
    line("route", context.route),
    line("action", context.actionName),
    line("automation", context.automationName),
    line("scope", context.userScope),
    line("time", context.occurredAt),
    line("build", context.release),
    line("environment", context.environment),
    line("inspect", inspect),
  ]
    .filter((entry): entry is string => entry !== undefined)
    .join("\n");
}
