import {
  chatThreadUrl,
  compactFailureContext,
  formatFailureReport,
  type FailureContext,
} from "../shared/failure-report.js";
import { getActiveRun } from "./active-run-state.js";
import { appPath } from "./api-path.js";
import { clientBuildId } from "./build-compatibility.js";

export type { FailureContext } from "../shared/failure-report.js";

function threadFromLocation(): string | undefined {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("thread")?.trim() ||
      params.get("threadId")?.trim() ||
      undefined
    );
  } catch {
    // coercion-ok: the report names the thread when it can; an unreadable URL
    // just means there is no thread to name.
    return undefined;
  }
}

/**
 * What the browser knows about one failure. The thread is the one the caller
 * names, else the one open in the URL, else the active run's. `appId` is the
 * host: it says app and environment in one token and matches the thread link.
 */
export function clientFailureContext(
  input: Partial<FailureContext> = {},
): FailureContext {
  if (typeof window === "undefined") return compactFailureContext(input);
  const explicit = compactFailureContext(input);
  const run = getActiveRun();
  const threadId = explicit.threadId ?? threadFromLocation() ?? run?.threadId;
  return compactFailureContext({
    appId: window.location.host,
    release: `agent-native-client@${clientBuildId() || "development"}`,
    occurredAt: new Date().toISOString(),
    ...explicit,
    threadId,
    runId:
      explicit.runId ?? (run?.threadId === threadId ? run?.runId : undefined),
    threadUrl:
      explicit.threadUrl ??
      (threadId
        ? chatThreadUrl(
            new URL(appPath("/"), window.location.origin).toString(),
            threadId,
          )
        : undefined),
  });
}

/**
 * The plain-text packet behind a "Copy details" button on an error card or
 * toast: app, thread link, run, request, code, time and build, one per line.
 */
export function formatClientFailureReport(
  input: Partial<FailureContext> & { message?: string } = {},
): string {
  const { message, ...context } = input;
  return formatFailureReport(clientFailureContext(context), { message });
}
