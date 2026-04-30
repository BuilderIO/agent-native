import type { H3Event } from "h3";
import type { PlatformAdapter, IncomingMessage } from "./types.js";
import { getThreadMapping, saveThreadMapping } from "./thread-mapping-store.js";
import { createThread, getThread } from "../chat-threads/store.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  type ActionEntry,
} from "../agent/production-agent.js";
import { createAnthropicEngine } from "../agent/engine/index.js";
import type { EngineMessage } from "../agent/engine/types.js";
import { startRun, type ActiveRun } from "../agent/run-manager.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import { updateThreadData } from "../chat-threads/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveOrgIdForEmail } from "../org/context.js";
import {
  insertPendingTask,
  isDuplicateEventError,
  type PendingTask,
} from "./pending-tasks-store.js";
import { signInternalToken } from "./internal-token.js";
import { FRAMEWORK_ROUTE_PREFIX } from "../server/core-routes-plugin.js";
import { withConfiguredAppBasePath } from "../server/app-base-path.js";

/**
 * Tracks recently processed event IDs to deduplicate webhook retries.
 * Slack retries if it doesn't get a 200 within 3 seconds.
 */
const recentEventIds = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Periodically clean up old entries
setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [id, ts] of recentEventIds) {
    if (ts < cutoff) recentEventIds.delete(id);
  }
}, 60_000);

/**
 * Check if this event was already processed (for deduplication).
 * Returns true if it's a duplicate.
 */
function isDuplicate(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.set(eventId, Date.now());
  return false;
}

export interface WebhookHandlerOptions {
  adapter: PlatformAdapter;
  /** Resolved system prompt string */
  systemPrompt: string;
  /** Action entries for the agent */
  actions: Record<string, ActionEntry>;
  /** Model to use */
  model: string;
  /** Anthropic API key */
  apiKey: string;
  /** Thread owner for personal/shared resource loading */
  ownerEmail: string;
  /**
   * Pre-parsed incoming message. When provided, handleWebhook skips its own
   * verification + parsing steps. Required when the caller has already read
   * the request body (h3 doesn't reliably cache parsed bodies, so re-parsing
   * the same event hangs on streaming providers).
   */
  incoming?: IncomingMessage;
  /** Optional hook to intercept inbound commands before agent execution */
  beforeProcess?: (
    incoming: IncomingMessage,
    adapter: PlatformAdapter,
  ) => Promise<
    | {
        handled: true;
        responseText?: string;
      }
    | { handled: false }
  >;
}

/**
 * Process an incoming webhook from a messaging platform.
 *
 * Flow:
 * 1. Handle verification challenges (Slack url_verification, etc.)
 * 2. Verify webhook signature
 * 3. Parse incoming message (null = ignored event)
 * 4. Persist task to SQL
 * 5. Fire-and-forget POST to /_agent-native/integrations/process-task
 *    (a fresh function execution with its own timeout budget)
 * 6. Return HTTP 200 immediately (within Slack's 3s SLA)
 *
 * The processor endpoint runs the actual agent loop. This split is essential
 * for serverless platforms (Netlify Lambda, Vercel, Cloudflare Workers) which
 * freeze the function as soon as the response is returned, killing any
 * lingering background promises.
 */
export async function handleWebhook(
  event: H3Event,
  options: WebhookHandlerOptions,
): Promise<{ status: number; body: unknown }> {
  const { adapter, beforeProcess } = options;

  let incoming: IncomingMessage | null = options.incoming ?? null;

  // When the caller didn't pre-parse, run the full verify + parse pipeline.
  // Otherwise skip it — h3's body stream has already been consumed and a
  // second readBody call hangs on streaming providers.
  if (!incoming) {
    // Step 1: Handle platform-specific verification challenges
    const verification = await adapter.handleVerification(event);
    if (verification.handled) {
      return { status: 200, body: verification.response ?? "ok" };
    }

    // Step 2: Verify webhook signature
    const isValid = await adapter.verifyWebhook(event);
    if (!isValid) {
      return { status: 401, body: { error: "Invalid webhook signature" } };
    }

    // Step 3: Parse the incoming message
    incoming = await adapter.parseIncomingMessage(event);
    if (!incoming) {
      // Not a user message (bot message, edit, reaction, etc.) — acknowledge silently
      return { status: 200, body: "ok" };
    }
  }

  // Deduplicate (platforms retry on timeout)
  const eventId = `${incoming.platform}:${incoming.externalThreadId}:${incoming.timestamp}`;
  if (isDuplicate(eventId)) {
    return { status: 200, body: "ok" };
  }

  if (beforeProcess) {
    const result = await beforeProcess(incoming, adapter);
    if (result.handled) {
      if (result.responseText?.trim()) {
        const outgoing = adapter.formatAgentResponse(result.responseText);
        await adapter.sendResponse(outgoing, incoming);
      }
      return { status: 200, body: "ok" };
    }
  }

  // Step 4 + 5: Enqueue to SQL and dispatch to processor in a fresh request.
  try {
    await enqueueAndDispatch(event, incoming, options);
  } catch (err) {
    console.error(
      `[integrations] Failed to enqueue/dispatch ${incoming.platform} message:`,
      err,
    );
    // Return 500 so the platform retries. If the SQL insert failed, the
    // message is genuinely lost — better to let Slack retry (it will
    // re-fire the same event_callback) than silently drop it.
    return { status: 500, body: { error: "enqueue failed" } };
  }

  return { status: 200, body: "ok" };
}

/**
 * Persist the task to SQL and dispatch a fresh HTTP request to the processor
 * endpoint. The dispatch is fire-and-forget — we deliberately do NOT await
 * the resulting fetch, so the current handler can return immediately.
 *
 * This pattern works on every supported host:
 *   - Netlify Lambda: function returns; the dispatched request hits a fresh
 *     Lambda with its own 26s budget.
 *   - Vercel Functions: same.
 *   - Cloudflare Workers: same (no waitUntil dependency).
 *   - Self-hosted Node: a separate request comes back through the same
 *     server, but each handler still runs to completion.
 */
async function enqueueAndDispatch(
  event: H3Event,
  incoming: IncomingMessage,
  options: WebhookHandlerOptions,
): Promise<void> {
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Resolve the org id once at enqueue-time so the processor doesn't have to
  // re-derive it (and so we can drop it on the row for observability).
  let orgId: string | null = null;
  try {
    orgId = (await resolveOrgIdForEmail(options.ownerEmail)) ?? null;
  } catch {
    orgId = null;
  }

  // Post a "thinking…" placeholder immediately if the adapter supports
  // in-place edits. The processor flow will update this same message with
  // the final answer, so users see one tidy thread reply instead of
  // "[silence] → answer". Adapters without edit support skip this and the
  // processor posts a fresh response.
  let placeholderRef: string | undefined;
  try {
    if (options.adapter.postProcessingPlaceholder) {
      const placeholder =
        await options.adapter.postProcessingPlaceholder(incoming);
      if (placeholder?.placeholderRef) {
        placeholderRef = placeholder.placeholderRef;
      }
    }
  } catch (err) {
    console.error("[integrations] postProcessingPlaceholder failed:", err);
  }

  const payload = JSON.stringify({ incoming, placeholderRef });

  await insertPendingTask({
    id: taskId,
    platform: incoming.platform,
    externalThreadId: incoming.externalThreadId,
    payload,
    ownerEmail: options.ownerEmail,
    orgId,
  });

  const baseUrl = resolveBaseUrl(event);
  const processUrl = `${baseUrl}${FRAMEWORK_ROUTE_PREFIX}/integrations/process-task`;

  // If A2A_SECRET is configured, sign the dispatch with an HMAC token so the
  // processor endpoint can verify the request came from us and not from the
  // public internet. If A2A_SECRET isn't set we still dispatch — the
  // processor endpoint validates that the task id exists in SQL and uses the
  // atomic claim to dedupe, so an unsigned dispatch is bounded in damage to
  // re-running already-queued work.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(taskId)}`;
  } catch {
    // No A2A_SECRET — proceed without a signed token. See note above.
  }

  // Fire-and-forget: do NOT await the full response (the processor's run
  // takes minutes — we don't want to block the caller). BUT on Netlify
  // Lambda, when we return immediately, the runtime can freeze the function
  // before the outbound TCP handshake even starts, which leaves the dispatch
  // request stuck waiting for the 60s retry-sweep job. Race the fetch
  // against a short timer so the request gets at least ~250ms to leave the
  // box; the trade-off is at most ~250ms of added webhook latency.
  const dispatchPromise = fetch(processUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId }),
  }).catch((err) => {
    console.error("[integrations] Failed to dispatch processor request:", err);
  });
  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
}

/**
 * Resolve the base URL we should dispatch the processor request to.
 * Prefers explicit env vars (most reliable on serverless), falls back to the
 * inbound request's headers.
 */
export function resolveBaseUrl(event: H3Event): string {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return withConfiguredAppBasePath(fromEnv);

  try {
    const headers = (event as any).node?.req?.headers ?? (event as any).headers;
    const get = (name: string): string | undefined => {
      if (!headers) return undefined;
      if (typeof headers.get === "function") {
        return headers.get(name) ?? undefined;
      }
      const lower = String(name).toLowerCase();
      const map = headers as Record<string, string | undefined>;
      return map[name] ?? map[lower];
    };
    const proto = get("x-forwarded-proto") || "http";
    const host = get("host") || `localhost:${process.env.PORT || 3000}`;
    return withConfiguredAppBasePath(`${proto}://${host}`);
  } catch {
    return withConfiguredAppBasePath(
      `http://localhost:${process.env.PORT || 3000}`,
    );
  }
}

/**
 * Run the actual agent loop for a previously-enqueued task. Called by the
 * processor endpoint in `plugin.ts`. This is a fresh function execution, so
 * it gets its own timeout budget independent of the inbound webhook handler.
 */
export async function processIntegrationTask(
  task: PendingTask,
  options: WebhookHandlerOptions,
): Promise<void> {
  const parsed = JSON.parse(task.payload) as {
    incoming: IncomingMessage;
    placeholderRef?: string;
  };
  await processIncomingMessage(parsed.incoming, options, {
    placeholderRef: parsed.placeholderRef,
  });
}

/**
 * Resolve thread, run agent loop, post response, persist thread data.
 * Shared between the new processor endpoint and any direct callers.
 */
async function processIncomingMessage(
  incoming: IncomingMessage,
  options: WebhookHandlerOptions,
  opts: { placeholderRef?: string } = {},
): Promise<void> {
  const { adapter, systemPrompt, actions, model, apiKey, ownerEmail } = options;

  // Resolve or create internal thread
  let mapping = await getThreadMapping(
    incoming.platform,
    incoming.externalThreadId,
  );

  if (!mapping) {
    const thread = await createThread(ownerEmail, {
      title: `${adapter.label}: ${incoming.senderName || incoming.senderId || "User"}`,
    });
    await saveThreadMapping(
      incoming.platform,
      incoming.externalThreadId,
      thread.id,
      incoming.platformContext,
    );
    mapping = {
      platform: incoming.platform,
      externalThreadId: incoming.externalThreadId,
      internalThreadId: thread.id,
      platformContext: incoming.platformContext,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const threadId = mapping.internalThreadId;

  // Load existing thread history for context
  const thread = await getThread(threadId);
  const existingMessages: EngineMessage[] = [];
  if (thread?.threadData) {
    try {
      const data = JSON.parse(thread.threadData);
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const m = msg.message ?? msg;
          const textContent =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(m.content)
                ? m.content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("\n")
                : "";
          if (m.role === "user") {
            existingMessages.push({
              role: "user",
              content: [{ type: "text", text: textContent }],
            });
          } else if (m.role === "assistant") {
            existingMessages.push({
              role: "assistant",
              content: [{ type: "text", text: textContent }],
            });
          }
        }
      }
    } catch {}
  }

  // Add the new user message
  const messages: EngineMessage[] = [
    ...existingMessages,
    { role: "user", content: [{ type: "text", text: incoming.text }] },
  ];

  // Run agent loop via startRun, wrapped in a request context so that
  // tools (especially call-agent) can resolve the caller's org for org-scoped
  // A2A delegation. Without this, getRequestOrgId() returns undefined and
  // call-agent can't look up the org's a2a_secret or org_domain.
  const orgId = await resolveOrgIdForEmail(ownerEmail);
  const engine = createAnthropicEngine({ apiKey });
  const tools = actionsToEngineTools(actions);

  const runId = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Wait for the run to complete inside this fresh function execution.
  // We use a Promise so the processor endpoint can await the full lifecycle.
  await new Promise<void>((resolve) => {
    startRun(
      runId,
      threadId,
      async (send, signal) => {
        await runWithRequestContext(
          {
            userEmail: ownerEmail,
            orgId: orgId ?? undefined,
            // Lets downstream callers (call-agent script) apply tighter
            // budgets on integration paths without affecting normal
            // agent-chat. See `isIntegrationCallerRequest()`.
            isIntegrationCaller: true,
          },
          () =>
            runAgentLoop({
              engine,
              model,
              systemPrompt,
              tools,
              messages,
              actions,
              send,
              signal,
            }),
        );
      },
      async (completedRun: ActiveRun) => {
        try {
          // Collect text events from the run, but drop any pre-tool-call
          // preamble so the user sees just the final answer instead of
          // "I need to delegate this..." run-on into the raw tool result.
          //
          // Heuristic: when the agent fired any tool, only keep text events
          // that come AFTER the last tool. The preamble ("Let me check…")
          // and the final answer ("630") are emitted as two separate text
          // events, and concatenating them with no separator was producing
          // "...signup data.630" in Slack.
          let lastToolIdx = -1;
          for (let i = completedRun.events.length - 1; i >= 0; i--) {
            const t = completedRun.events[i].event.type;
            if (t === "tool_start" || t === "tool_done") {
              lastToolIdx = i;
              break;
            }
          }
          const startIdx = lastToolIdx >= 0 ? lastToolIdx + 1 : 0;
          let responseText = "";
          for (let i = startIdx; i < completedRun.events.length; i++) {
            const ev = completedRun.events[i].event;
            if (ev.type === "text") responseText += ev.text;
          }
          // If the post-tool window had no text (tool spoke for itself),
          // fall back to all text events so we never leave the user with
          // an empty reply.
          if (!responseText.trim() && lastToolIdx >= 0) {
            for (const runEvent of completedRun.events) {
              if (runEvent.event.type === "text") {
                responseText += runEvent.event.text;
              }
            }
          }

          // If the run errored OR produced no text, post a graceful fallback so
          // the user isn't left wondering whether the bot saw their message.
          // Common case: an A2A delegation timed out and the agent loop bailed
          // before generating any user-facing text.
          const runErrored = completedRun.status === "errored";
          if (!responseText.trim() || runErrored) {
            if (runErrored) {
              responseText =
                (responseText.trim() ? responseText + "\n\n" : "") +
                "I ran into a problem before I could finish that one. " +
                "If it was a complex analytics question, opening the analytics app " +
                "directly is the most reliable way to get an answer right now.";
            } else {
              responseText = "(No response)";
            }
          }

          // Compute the deep-link to the dispatch UI for this thread, then
          // hand it to the adapter as a structured `threadDeepLinkUrl` so
          // platforms with rich blocks (Slack) can render a button instead
          // of inlining a `<url|text>` link that auto-unfurls into a giant
          // preview card.
          const baseUrl = process.env.APP_URL || process.env.URL || "";
          const appBaseUrl = baseUrl ? withConfiguredAppBasePath(baseUrl) : "";
          const threadDeepLinkUrl =
            appBaseUrl && threadId
              ? `${appBaseUrl}/?thread=${threadId}`
              : undefined;

          // Format and send back to platform — update the "thinking…"
          // placeholder in place if the adapter supplied one.
          const outgoing = adapter.formatAgentResponse(responseText, {
            threadDeepLinkUrl,
          });
          await adapter.sendResponse(outgoing, incoming, {
            placeholderRef: opts.placeholderRef,
          });

          // Persist thread data
          await persistThreadData(
            threadId,
            incoming.text,
            completedRun,
            thread,
          );
        } catch (err) {
          console.error(
            `[integrations] Error sending response to ${incoming.platform}:`,
            err,
          );
          // Last-ditch: try to post a brief apology so the thread isn't silent.
          try {
            const fallback = adapter.formatAgentResponse(
              "Something went wrong on my end while replying. Please try again.",
            );
            await adapter.sendResponse(fallback, incoming);
          } catch {}
        } finally {
          resolve();
        }
      },
    );
  });
}

/**
 * Persist the user message and agent response to the thread data,
 * so the conversation history is available in the web UI too.
 */
async function persistThreadData(
  threadId: string,
  userText: string,
  completedRun: ActiveRun,
  thread: any,
): Promise<void> {
  try {
    let repo: any;
    try {
      repo = JSON.parse(thread?.threadData || "{}");
    } catch {
      repo = {};
    }
    if (!Array.isArray(repo.messages)) repo.messages = [];

    // Add user message
    const userMsg = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: [{ type: "text", text: userText }],
      createdAt: new Date().toISOString(),
    };

    // Build assistant message from run events
    const assistantMsg = buildAssistantMessage(
      completedRun.events ?? [],
      completedRun.runId,
    );

    repo.messages.push(userMsg);
    if (assistantMsg) {
      repo.messages.push(assistantMsg);
    }

    const meta = extractThreadMeta(repo);
    await updateThreadData(
      threadId,
      JSON.stringify(repo),
      meta.title || thread?.title || "Integration Chat",
      meta.preview || thread?.preview || "",
      repo.messages.length,
    );
  } catch {
    // Best-effort persistence
  }
}
