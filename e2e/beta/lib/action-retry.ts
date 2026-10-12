import type { APIRequestContext } from "@playwright/test";

/**
 * Posting a fixture action to a beta host that other deploys and sessions are
 * moving under. A 401, 5xx, or timeout there has been a blip often enough to
 * cost a whole serial describe, so setup calls retry a bounded number of times
 * and then fail with every attempt listed, never with the last one alone.
 */

export interface ActionAttempt {
  /** HTTP status; 0 means the request never got one (timeout, reset). */
  status: number;
  body: string;
}

const TRANSIENT_STATUSES = new Set([0, 401, 408, 429, 500, 502, 503, 504]);

/** 409 is deliberately not here: a conflict is an answer, and callers decide. */
export function isTransientActionStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export async function retryTransientAction(
  send: () => Promise<ActionAttempt>,
  {
    attempts = 3,
    delayMs = 1_000,
    sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ final: ActionAttempt; history: ActionAttempt[] }> {
  const history: ActionAttempt[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await send();
    history.push(result);
    if (!isTransientActionStatus(result.status)) break;
    if (attempt < attempts) await sleep(delayMs * attempt);
  }
  return { final: history[history.length - 1]!, history };
}

export function describeActionFailure(
  name: string,
  history: readonly ActionAttempt[],
): string {
  const lines = history.map(
    (attempt, index) =>
      `#${index + 1} ${attempt.status === 0 ? "no response" : `HTTP ${attempt.status}`}: ${attempt.body.slice(0, 300)}`,
  );
  return `${name} failed after ${history.length} attempt(s):\n${lines.join("\n")}`;
}

export async function postActionWithRetry(
  request: APIRequestContext,
  url: string,
  input: Record<string, unknown>,
  {
    timeoutMs = 60_000,
    attempts = 3,
  }: { timeoutMs?: number; attempts?: number } = {},
): Promise<{ final: ActionAttempt; history: ActionAttempt[] }> {
  return retryTransientAction(
    async () => {
      try {
        const response = await request.post(url, {
          data: input,
          headers: { "Content-Type": "application/json" },
          timeout: timeoutMs,
        });
        return { status: response.status(), body: await response.text() };
      } catch (error) {
        return {
          status: 0,
          body: error instanceof Error ? error.message : String(error),
        };
      }
    },
    { attempts },
  );
}

/**
 * Fixture plumbing, safe to repeat. The action under a spec's assertion is not
 * on this list: a 500 from it is the finding, so it gets one attempt.
 */
const FIXTURE_ACTIONS = new Set([
  "create-design",
  "create-file",
  "update-design",
  "delete-design",
]);

export function attemptsFor(actionName: string): number {
  return FIXTURE_ACTIONS.has(actionName) ? 3 : 1;
}
