import {
  sendToAgentChatAndConfirm,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { z } from "zod";

type SubmissionResult = { delivered: boolean; reason?: string | undefined };
type ThreadPrompt = Pick<AgentChatMessage, "message" | "context">;
type PendingSubmission = {
  prompt: ThreadPrompt;
  orgId: string;
  resolve: (result: SubmissionResult) => void;
  timer: number;
};

const pending = new Map<string, PendingSubmission>();
const readySurfaces = new Map<string, string>();
const crossTabReleases = new Map<string, () => void>();

export function queueThreadSubmission(
  threadId: string,
  orgId: string,
  prompt: ThreadPrompt,
): Promise<SubmissionResult> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(threadId);
      resolve({ delivered: false, reason: "surface-unavailable" });
    }, 30_000);
    pending.set(threadId, { prompt, orgId, resolve, timer });
    if (readySurfaces.get(threadId) === orgId)
      submitQueuedThreadPrompt(threadId, orgId);
  });
}

export function setThreadSubmissionSurfaceReady(
  threadId: string,
  orgId: string,
  ready: boolean,
): void {
  if (ready) {
    readySurfaces.set(threadId, orgId);
    crossTabReleases.get(threadId)?.();
    crossTabReleases.delete(threadId);
    const release = submitQueuedThreadPrompt(threadId, orgId);
    if (release) crossTabReleases.set(threadId, release);
  } else if (readySurfaces.get(threadId) === orgId) {
    readySurfaces.delete(threadId);
    crossTabReleases.get(threadId)?.();
    crossTabReleases.delete(threadId);
  }
}

function submitQueuedThreadPrompt(
  threadId: string,
  orgId: string,
): (() => void) | undefined {
  const submission = pending.get(threadId);
  if (!submission) return submitCrossTabSearch(threadId, orgId);
  if (submission.orgId !== orgId) return;
  pending.delete(threadId);
  window.clearTimeout(submission.timer);
  void sendToAgentChatAndConfirm({
    ...submission.prompt,
    chatTarget: "local",
    targetTabId: threadId,
    submit: true,
    openSidebar: false,
  }).then(submission.resolve, () =>
    submission.resolve({ delivered: false, reason: "timeout" }),
  );
}

const CROSS_TAB_KEY = "analytics-search-submission";
const CROSS_TAB_TTL = 30_000;
// The target's send confirms within 10s (core's submit-confirm timeout); the
// rest covers the message hops. It starts at dispatch, never extending the TTL.
const CROSS_TAB_CONFIRMATION_TIMEOUT = 15_000;
const crossTabSubmissionSchema = z.object({
  threadId: z.string().min(1),
  orgId: z.string().min(1),
  query: z.string().min(1),
  token: z.string().uuid(),
  expiresAt: z.number().finite(),
});
const crossTabMessageSchema = z.object({
  type: z.literal(CROSS_TAB_KEY),
  threadId: z.string(),
  orgId: z.string(),
  token: z.string(),
  action: z.enum(["ready", "dispatch", "result"]),
  result: z
    .object({ delivered: z.boolean(), reason: z.string().optional() })
    .optional(),
});
type CrossTabSubmission = z.infer<typeof crossTabSubmissionSchema>;
type CrossTabLease = { retain: () => () => void };
const crossTabLeases = new Map<string, CrossTabLease>();

export function queueCrossTabSearchSubmission(
  target: Window,
  threadId: string,
  orgId: string,
  query: string,
): Promise<SubmissionResult> {
  const token = crypto.randomUUID();
  const submission: CrossTabSubmission = {
    threadId,
    orgId,
    query,
    token,
    expiresAt: Date.now() + CROSS_TAB_TTL,
  };
  target.sessionStorage.setItem(CROSS_TAB_KEY, JSON.stringify(submission));
  return new Promise((resolve) => {
    let authorized = false;
    let timer: number | undefined;
    const finish = (result: SubmissionResult) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const timeout = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => finish({ delivered: false, reason: "timeout" }),
        delay,
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== target)
        return;
      const parsed = crossTabMessageSchema.safeParse(event.data);
      if (
        !parsed.success ||
        parsed.data.token !== token ||
        parsed.data.threadId !== threadId ||
        parsed.data.orgId !== orgId
      )
        return;
      if (parsed.data.action === "ready" && !authorized) {
        authorized = true;
        // Armed before postMessage: a synchronous reply finishes first and clears it.
        timeout(CROSS_TAB_CONFIRMATION_TIMEOUT);
        target.postMessage(
          { type: CROSS_TAB_KEY, action: "dispatch", threadId, orgId, token },
          window.location.origin,
        );
      } else if (
        parsed.data.action === "result" &&
        authorized &&
        parsed.data.result
      ) {
        finish(parsed.data.result);
      }
    };
    timeout(CROSS_TAB_TTL);
    window.addEventListener("message", onMessage);
  });
}

function submitCrossTabSearch(
  threadId: string,
  orgId: string,
): (() => void) | undefined {
  const key = JSON.stringify([threadId, orgId]);
  const existing = crossTabLeases.get(key);
  if (existing) return existing.retain();
  const raw = window.sessionStorage.getItem(CROSS_TAB_KEY);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    window.sessionStorage.removeItem(CROSS_TAB_KEY);
    return;
  }
  const result = crossTabSubmissionSchema.safeParse(parsed);
  if (!result.success) {
    window.sessionStorage.removeItem(CROSS_TAB_KEY);
    return;
  }
  const submission = result.data;
  if (submission.expiresAt <= Date.now()) {
    window.sessionStorage.removeItem(CROSS_TAB_KEY);
    return;
  }
  if (submission.threadId !== threadId || submission.orgId !== orgId) return;
  window.sessionStorage.removeItem(CROSS_TAB_KEY);
  const opener: Window | null = window.opener;
  if (!opener) return;
  const token = submission.token;
  let holders = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    crossTabLeases.delete(key);
    window.removeEventListener("message", onMessage);
    window.clearTimeout(timer);
  };
  const lease: CrossTabLease = {
    retain: () => {
      holders++;
      return () => {
        // React may immediately re-run an effect while checking its cleanup.
        queueMicrotask(() => {
          holders--;
          if (holders || finished) return;
          finish();
          opener.postMessage(
            {
              type: CROSS_TAB_KEY,
              action: "result",
              threadId,
              orgId,
              token,
              result: { delivered: false, reason: "surface-unavailable" },
            },
            window.location.origin,
          );
        });
      };
    },
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== opener)
      return;
    const message = crossTabMessageSchema.safeParse(event.data);
    if (
      !message.success ||
      message.data.action !== "dispatch" ||
      message.data.threadId !== threadId ||
      message.data.orgId !== orgId ||
      message.data.token !== token ||
      Date.now() >= submission.expiresAt
    )
      return;
    finish();
    void sendToAgentChatAndConfirm({
      message: submission.query,
      chatTarget: "local",
      targetTabId: threadId,
      submit: true,
      openSidebar: false,
    }).then(
      (result) =>
        opener.postMessage(
          {
            type: CROSS_TAB_KEY,
            action: "result",
            threadId,
            orgId,
            token,
            result,
          },
          window.location.origin,
        ),
      () =>
        opener.postMessage(
          {
            type: CROSS_TAB_KEY,
            action: "result",
            threadId,
            orgId,
            token,
            result: { delivered: false, reason: "timeout" },
          },
          window.location.origin,
        ),
    );
  };
  const timer = window.setTimeout(
    finish,
    Math.max(0, submission.expiresAt - Date.now()),
  );
  crossTabLeases.set(key, lease);
  window.addEventListener("message", onMessage);
  opener.postMessage(
    { type: CROSS_TAB_KEY, action: "ready", threadId, orgId, token },
    window.location.origin,
  );
  return lease.retain();
}
