import type { H3Event } from "h3";
import type { PlatformAdapter, IncomingMessage } from "./types.js";
import { getThreadMapping, saveThreadMapping } from "./thread-mapping-store.js";
import { createThread, getThread } from "../chat-threads/store.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  getOwnerActiveApiKey,
  getOwnerApiKey,
  engineToProvider,
  type ActionEntry,
} from "../agent/production-agent.js";
import { PROVIDER_TO_ENV } from "../agent/engine/provider-env-vars.js";
import { isLocalDatabase } from "../db/client.js";
import { readDeployCredentialEnv } from "../server/credential-provider.js";
import {
  getStoredModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
import type { AgentEngine } from "../agent/engine/types.js";
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
import { A2A_CONTINUATION_QUEUED_MARKER } from "./a2a-continuation-marker.js";
import { collectFinalResponseTextFromAgentEvents } from "../a2a/response-text.js";
import {
  appendA2AArtifactLinks,
  type A2AToolResultSummary,
} from "../a2a/artifact-response.js";

const PROCESSOR_DISPATCH_SETTLE_WAIT_MS = 1_500;

type ToolDoneEvent = { type: "tool_done"; tool: string; result: string };

/**
 * Build a stable per-event dedup key from the incoming message. The same
 * key is computed for every retry of the same event from the platform —
 * Slack/Telegram retry on timeout (3s for Slack), so we MUST treat the
 * second delivery as a duplicate and return 200 silently.
 *
 * The `(platform, external_event_key)` UNIQUE index in
 * `integration_pending_tasks` enforces this at the SQL layer, replacing
 * the previous in-memory Map (H3 in the webhook security audit) which
 * couldn't survive serverless cold starts.
 */
function buildEventDedupKey(incoming: IncomingMessage): string {
  return `${incoming.platform}:${incoming.externalThreadId}:${incoming.timestamp}`;
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
  /** Agent engine to use. Defaults to the same resolver as web chat. */
  engine?:
    | AgentEngine
    | string
    | { name: string; config: Record<string, unknown> };
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

function explicitEngineName(
  engineOption: WebhookHandlerOptions["engine"],
): string | undefined {
  if (!engineOption) return undefined;
  if (typeof engineOption === "string") return engineOption;
  if (
    typeof engineOption === "object" &&
    !("stream" in engineOption) &&
    typeof engineOption.name === "string"
  ) {
    return engineOption.name;
  }
  return undefined;
}

function isMultiTenantDeploy(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return !isLocalDatabase();
}

function collectToolResultSummaries(
  completedRun: ActiveRun,
): A2AToolResultSummary[] {
  return completedRun.events
    .map((runEvent) => runEvent.event)
    .filter((event): event is ToolDoneEvent => event.type === "tool_done")
    .map((event) => ({ tool: event.tool, result: event.result }));
}

async function resolveIntegrationApiKey(
  engineOption: WebhookHandlerOptions["engine"],
  ownerEmail: string,
  fallbackApiKey: string,
): Promise<string | undefined> {
  const engineName = explicitEngineName(engineOption);
  if (engineName) {
    const provider = engineToProvider(engineName);
    const userApiKey = await getOwnerApiKey(provider, ownerEmail);
    if (userApiKey || isMultiTenantDeploy()) return userApiKey;
    const envVar = PROVIDER_TO_ENV[provider];
    const providerEnvKey = envVar ? readDeployCredentialEnv(envVar) : undefined;
    return providerEnvKey || fallbackApiKey.trim() || undefined;
  }

  const userApiKey = await getOwnerActiveApiKey(ownerEmail);
  if (userApiKey || isMultiTenantDeploy()) return userApiKey;
  return fallbackApiKey.trim() || undefined;
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

  // Dedup is enforced inside enqueueAndDispatch — the unique index on
  // `(platform, external_event_key)` raises a constraint violation we treat
  // as "already enqueued" and respond 200. We can't dedup BEFORE the
  // beforeProcess hook because some templates use beforeProcess for
  // command-style intercepts that are stateless and idempotent (e.g. a
  // Slack `/help` command that doesn't enqueue a task).

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
    // Duplicate event delivery: the SQL UNIQUE constraint on
    // (platform, external_event_key) rejected the second insert. This is
    // the expected path when a platform retries an event that already
    // landed (e.g. Slack 3-second timeout) — return 200 so the platform
    // stops retrying. See H3 in the webhook security audit.
    if (isDuplicateEventError(err)) {
      return { status: 200, body: "ok" };
    }
    console.error(
      `[integrations] Failed to enqueue/dispatch ${incoming.platform} message:`,
      err,
    );
    // Return 500 so the platform retries. If the SQL insert failed for a
    // non-dup reason, the message is genuinely lost — better to let Slack
    // retry (it will re-fire the same event_callback) than silently drop it.
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
 *     Lambda with its own function budget.
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
    // SQL-level dedup key — duplicate webhook deliveries from the same
    // platform produce the same key, so the unique index rejects the
    // second insert (H3 in the webhook security audit).
    externalEventKey: buildEventDedupKey(incoming),
  });

  const baseUrl = resolveBaseUrl(event);
  const processUrl = `${baseUrl}${FRAMEWORK_ROUTE_PREFIX}/integrations/process-task`;

  // Sign the dispatch with an HMAC token so the processor endpoint can
  // verify the request came from us and not the public internet. The
  // processor refuses unsigned requests in production (C3 in the webhook
  // security audit). In dev, dispatching unsigned is allowed and falls
  // through to the SQL atomic claim for double-processing protection.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    headers["Authorization"] = `Bearer ${signInternalToken(taskId)}`;
  } catch (err) {
    // Distinguish "secret not configured" (the documented dev path) from
    // a real signing failure — silently swallowing both made malformed
    // secrets fail invisibly (L5 in the audit).
    if (err instanceof Error && !/A2A_SECRET/i.test(err.message)) {
      console.error(
        `[integrations] signInternalToken failed unexpectedly for ${taskId}:`,
        err,
      );
    }
  }

  // Fire-and-forget: do NOT await the full response (the processor's run
  // takes minutes — we don't want to block the caller). BUT on Netlify
  // Lambda, when we return immediately, the runtime can freeze the function
  // before the outbound TCP handshake even starts, which leaves the dispatch
  // request stuck waiting for the 60s retry-sweep job. Race the fetch
  // against a short timer so the request gets a reasonable chance to leave
  // the box; the trade-off is at most a couple seconds of added webhook
  // latency, still inside Slack's timeout window.
  const dispatchPromise = fetch(processUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ taskId }),
  }).catch((err) => {
    console.error("[integrations] Failed to dispatch processor request:", err);
  });
  await Promise.race([
    dispatchPromise,
    new Promise<void>((resolve) =>
      setTimeout(resolve, PROCESSOR_DISPATCH_SETTLE_WAIT_MS),
    ),
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
    taskId: task.id,
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
  opts: { taskId?: string; placeholderRef?: string } = {},
): Promise<void> {
  const {
    adapter,
    systemPrompt,
    actions,
    model,
    apiKey,
    ownerEmail,
    engine: engineOption,
  } = options;

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

  // Add the new user message. Include verified platform identity as lightweight
  // context so app-specific agents can attribute requests without guessing.
  const identityLines = [
    `Platform: ${incoming.platform}`,
    incoming.senderName ? `Sender name: ${incoming.senderName}` : null,
    incoming.senderEmail ? `Sender email: ${incoming.senderEmail}` : null,
    incoming.senderId ? `Sender ID: ${incoming.senderId}` : null,
  ].filter(Boolean);
  const userText =
    identityLines.length > 1
      ? `<integration-context>\n${identityLines.join("\n")}\n</integration-context>\n\n${incoming.text}`
      : incoming.text;

  const messages: EngineMessage[] = [
    ...existingMessages,
    { role: "user", content: [{ type: "text", text: userText }] },
  ];

  // Run agent loop via startRun, wrapped in a request context so that
  // tools (especially call-agent) can resolve the caller's org for org-scoped
  // A2A delegation. Without this, getRequestOrgId() returns undefined and
  // call-agent can't look up the org's a2a_secret or org_domain.
  const orgId = await resolveOrgIdForEmail(ownerEmail);
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
            integration: opts.taskId
              ? {
                  taskId: opts.taskId,
                  incoming,
                  placeholderRef: opts.placeholderRef,
                }
              : undefined,
          },
          async () => {
            const effectiveApiKey = await resolveIntegrationApiKey(
              engineOption,
              ownerEmail,
              apiKey,
            );
            const engine = await resolveEngine({
              engineOption,
              apiKey: effectiveApiKey,
              model,
            });
            const resolvedModel =
              (await getStoredModelForEngine(engine)) ??
              model ??
              engine.defaultModel;

            return runAgentLoop({
              engine,
              model: resolvedModel,
              systemPrompt,
              tools,
              messages,
              actions,
              send,
              signal,
            });
          },
        );
      },
      async (completedRun: ActiveRun) => {
        try {
          const queuedA2AContinuation = hasQueuedA2AContinuation(completedRun);
          let responseText = collectFinalResponseTextFromAgentEvents(
            completedRun.events.map((runEvent) => runEvent.event),
            { fallbackToPreToolText: !queuedA2AContinuation },
          );

          const suppressPlatformReply =
            queuedA2AContinuation &&
            isQueuedA2AContinuationDeferral(responseText);

          // If the run errored OR produced no text, post a graceful fallback so
          // the user isn't left wondering whether the bot saw their message.
          // Common case: an A2A delegation timed out and the agent loop bailed
          // before generating any user-facing text.
          const runErrored = completedRun.status === "errored";
          const runErrorText = completedRun.events
            .map((runEvent) =>
              runEvent.event.type === "error" ? runEvent.event.error : "",
            )
            .filter(Boolean)
            .join("\n");
          if (
            isLlmCredentialError(responseText) ||
            isLlmCredentialError(runErrorText)
          ) {
            responseText = formatLlmCredentialErrorMessage();
          } else if (
            !suppressPlatformReply &&
            (!responseText.trim() || runErrored)
          ) {
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
          if (!suppressPlatformReply) {
            responseText = appendA2AArtifactLinks(
              responseText,
              collectToolResultSummaries(completedRun),
              { baseUrl: appBaseUrl || undefined },
            );
          }
          const threadDeepLinkUrl =
            appBaseUrl && threadId
              ? `${appBaseUrl}/?thread=${threadId}`
              : undefined;

          // Format and send back to platform — update the "thinking…"
          // placeholder in place if the adapter supplied one.
          if (!suppressPlatformReply) {
            const outgoing = adapter.formatAgentResponse(responseText, {
              threadDeepLinkUrl,
            });
            await adapter.sendResponse(outgoing, incoming, {
              placeholderRef: opts.placeholderRef,
            });
          }

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

function hasQueuedA2AContinuation(completedRun: ActiveRun): boolean {
  return completedRun.events.some((runEvent) => {
    const event = runEvent.event;
    return (
      event.type === "tool_done" &&
      event.tool === "call-agent" &&
      String(event.result ?? "").includes(A2A_CONTINUATION_QUEUED_MARKER)
    );
  });
}

function isQueuedA2AContinuationDeferral(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (normalized.includes(A2A_CONTINUATION_QUEUED_MARKER)) return true;
  return /\b(?:still (?:working|processing)|is working on|taking longer than expected|will (?:post|update|surface|show up)|(?:it'?ll|it will|the result will|the final result will) (?:post|be posted|update|be updated|surface|show up)|will be (?:posted|updated|sent|shared)|final result when it finishes|while you wait|as soon as (?:it|it'?s|it is|the result|the artifact) (?:comes back|is ready|ready)|hang tight|relay from the .* agent)\b/i.test(
    normalized,
  );
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
