import { randomUUID } from "node:crypto";

import { isInBackgroundFunctionRuntime } from "../agent/durable-background.js";
import { createAnthropicEngine } from "../agent/engine/index.js";
import type { EngineMessage } from "../agent/engine/types.js";
import {
  actionsToEngineTools,
  filterInitialEngineTools,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "../agent/run-loop-with-resume.js";
import { startRun, type ActiveRun } from "../agent/run-manager.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import { attachToolSearch } from "../agent/tool-search.js";
import {
  createThread,
  getThread,
  setThreadSourceIfMissing,
  updateThreadData,
} from "../chat-threads/store.js";
import { resolveOrgIdForEmail } from "../org/context.js";
import {
  startIntervalJob,
  type IntervalJobHandle,
} from "../server/interval-job.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  getServiceAccountAccessToken,
  getServiceAccountEmail,
  getStartPageToken,
  googleDocsAdapter,
  listChanges,
  listDocComments,
} from "./adapters/google-docs.js";
import {
  getIntegrationConfig,
  integrationConfigWriteEpoch,
  saveIntegrationConfig,
  saveIntegrationConfigIfUnchanged,
  type IntegrationConfig,
} from "./config-store.js";
import {
  createGoogleDocsChannelAuth,
  type GoogleDocsPushHeaders,
  verifyGoogleDocsChannel,
} from "./google-docs-webhook.js";
import { getThreadMapping, saveThreadMapping } from "./thread-mapping-store.js";
import type { IncomingMessage } from "./types.js";

const PLATFORM = "google-docs";
const DEFAULT_TRIGGER = "@agent";

/** Track processed comment IDs to avoid reprocessing */
const processedComments = new Set<string>();
/** Track last-checked time per document for comment filtering */
const lastCheckedTimes = new Map<string, string>();

export interface GoogleDocsPollerOptions {
  /** Polling interval in milliseconds (fallback mode). Default: 30000 (30s) */
  intervalMs?: number;
  /** Trigger keyword in comments. Default: "@agent" (case-insensitive) */
  triggerKeyword?: string;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Action entries for the agent */
  actions: Record<string, ActionEntry>;
  /**
   * Tool names to expose on the FIRST engine request. See
   * `WebhookHandlerOptions.initialToolNames` (`webhook-handler.ts`) — same
   * semantics, shared `actions` source from `createIntegrationsPlugin`. Omit
   * to keep the full `actions` set visible up front (current behavior).
   */
  initialToolNames?: string[];
  /** Model to use */
  model: string;
  /** Anthropic API key */
  apiKey: string;
  /** Thread owner email */
  ownerEmail: string;
  /** Webhook URL for push mode (set by plugin from WEBHOOK_BASE_URL) */
  webhookUrl?: string;
}

let pollerJob: IntervalJobHandle | null = null;
// Held only for the startup delay below. It counts as "already running" for
// both the idempotency guard and stop(): `pollerJob` is still null during that
// window, so without this a second start() would build a second independent
// poller, and a stop() inside the window could not prevent the loop from
// arming itself afterwards.
let pollerStartTimer: ReturnType<typeof setTimeout> | null = null;
let activeOptions: GoogleDocsPollerOptions | null = null;

// ─── Watch Channel Management ───────────────────────────────────────────────

/** How long a watch channel lasts (Google max is ~24h, we use 23h to renew early) */
const WATCH_CHANNEL_TTL_MS = 23 * 60 * 60 * 1000;
const WATCH_RETRY_MS = 5 * 60 * 1000;
const WATCH_STOP_CLAIM_TTL_MS = WATCH_RETRY_MS - 30 * 1000;
let watchRenewalTimer: ReturnType<typeof setTimeout> | null = null;

type WatchStopResult =
  | { status: "stopped" }
  | { status: "not-owned"; claimId?: string; retryAt?: number }
  | { status: "retry"; claimId: string };
type WatchChannel = { id: string; resourceId?: string };
const watchCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

function getWatchClaim(
  config: IntegrationConfig | null,
): { id: string; expiresAt: number } | null {
  const id = config?.configData?.renewalClaimId;
  const expiresAt = config?.configData?.renewalClaimExpiresAt;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof expiresAt !== "number"
  ) {
    return null;
  }
  return { id, expiresAt };
}

function notOwnedWatchResult(
  config: IntegrationConfig | null,
): WatchStopResult {
  const claim = getWatchClaim(config);
  return claim
    ? { status: "not-owned", claimId: claim.id, retryAt: claim.expiresAt }
    : { status: "not-owned" };
}

function retryDelay(retryAt?: number): number {
  return retryAt ? Math.max(1000, retryAt - Date.now()) : WATCH_RETRY_MS;
}

function scheduleOrphanedWatchCleanup(
  channel: WatchChannel,
  delayMs = WATCH_RETRY_MS,
): void {
  const existingTimer = watchCleanupTimers.get(channel.id);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    watchCleanupTimers.delete(channel.id);
    try {
      const accessToken = await getServiceAccountAccessToken();
      if (
        accessToken &&
        (await stopGoogleDocsWatchChannel(
          accessToken,
          channel.id,
          channel.resourceId,
        ))
      ) {
        return;
      }
    } catch (err) {
      console.warn(
        `[google-docs] Orphaned watch cleanup failed; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
        err,
      );
    }

    scheduleOrphanedWatchCleanup(channel);
  }, delayMs);
  unrefTimer(timer);
  watchCleanupTimers.set(channel.id, timer);
}

/**
 * Register a Google Drive changes.watch channel so Google pushes
 * notifications to our webhook instead of us polling.
 *
 * Returns true if the watch was registered successfully.
 */
export async function registerWatch(
  webhookUrl: string,
  expectedChannelId?: string,
): Promise<boolean> {
  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return false;

  // Get the current page token as the starting point
  let pageToken = await getPageToken();
  if (!pageToken) {
    pageToken = await getStartPageToken(accessToken);
    await setPageToken(pageToken);
  }

  const channelId = `gdocs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiration = Date.now() + WATCH_CHANNEL_TTL_MS;
  const { token: channelToken, tokenHash: channelTokenHash } =
    createGoogleDocsChannelAuth();
  let registeredChannel: { id: string; resourceId: string } | null = null;

  try {
    // Keep the active channel until Google accepts the replacement. A failed
    // registration must not take down a still-valid channel.
    const currentConfig = await getIntegrationConfig(PLATFORM, "watch-channel");
    if (
      expectedChannelId !== undefined &&
      currentConfig?.configData?.channelId !== expectedChannelId
    ) {
      return false;
    }

    const res = await fetch(
      "https://www.googleapis.com/drive/v3/changes/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          expiration: expiration,
          token: channelToken,
          payload: true,
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("[google-docs] Failed to register watch:", err);
      return false;
    }

    const data = (await res.json()) as {
      id: string;
      resourceId: string;
      expiration: string;
    };
    registeredChannel = { id: data.id, resourceId: data.resourceId };

    // Promote only if no other registration changed the active channel while
    // this request was in flight. Stop this orphaned channel if it lost.
    const promoted = await saveIntegrationConfigIfUnchanged(
      PLATFORM,
      {
        channelId: data.id,
        channelTokenHash,
        resourceId: data.resourceId,
        expiration: data.expiration,
        webhookUrl,
      },
      "watch-channel",
      currentConfig,
    );
    if (!promoted) {
      const stopped = await stopGoogleDocsWatchChannel(
        accessToken,
        data.id,
        data.resourceId,
      );
      if (!stopped) {
        scheduleOrphanedWatchCleanup({
          id: data.id,
          resourceId: data.resourceId,
        });
      }
      console.warn(
        `[google-docs] Watch registration lost a concurrent update (channel: ${data.id})`,
      );
      return false;
    }

    const previousChannelId = currentConfig?.configData?.channelId;
    if (
      typeof previousChannelId === "string" &&
      previousChannelId !== data.id
    ) {
      const previousStopped = await stopGoogleDocsWatchChannel(
        accessToken,
        previousChannelId,
        currentConfig?.configData?.resourceId,
      );
      if (!previousStopped) {
        console.warn(
          `[google-docs] Could not retire the previous watch channel ${previousChannelId}; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
        );
        scheduleOrphanedWatchCleanup({
          id: previousChannelId,
          resourceId:
            typeof currentConfig?.configData?.resourceId === "string"
              ? currentConfig.configData.resourceId
              : undefined,
        });
      }
    }

    console.log(
      `[google-docs] Watch registered (channel: ${data.id}, expires: ${new Date(parseInt(data.expiration)).toISOString()})`,
    );

    // Schedule renewal before expiration
    scheduleWatchRenewal(webhookUrl, undefined, data.id);

    return true;
  } catch (err) {
    if (registeredChannel) {
      await stopGoogleDocsWatchChannel(
        accessToken,
        registeredChannel.id,
        registeredChannel.resourceId,
      );
    }
    console.error("[google-docs] Watch registration error:", err);
    return false;
  }
}

export async function verifyGoogleDocsPushNotification(
  headers: GoogleDocsPushHeaders,
): Promise<boolean> {
  const config = await getIntegrationConfig(PLATFORM, "watch-channel");
  return verifyGoogleDocsChannel(config?.configData, headers);
}

/**
 * Stop an existing watch channel.
 */
async function stopWatch(expectedClaimId?: string): Promise<WatchStopResult> {
  const config = await getIntegrationConfig(PLATFORM, "watch-channel");
  const claim = getWatchClaim(config);

  if (expectedClaimId !== undefined && claim?.id !== expectedClaimId) {
    return notOwnedWatchResult(config);
  }

  if (!config?.configData?.channelId) return { status: "stopped" };

  if (claim && claim.expiresAt > Date.now()) {
    return {
      status: "not-owned",
      claimId: claim.id,
      retryAt: claim.expiresAt,
    };
  }

  const claimId = randomUUID();
  const claimed = await saveIntegrationConfigIfUnchanged(
    PLATFORM,
    {
      ...config.configData,
      renewalClaimId: claimId,
      renewalClaimExpiresAt: Date.now() + WATCH_STOP_CLAIM_TTL_MS,
    },
    "watch-channel",
    config,
  );
  if (!claimed) {
    return notOwnedWatchResult(
      await getIntegrationConfig(PLATFORM, "watch-channel"),
    );
  }

  // Re-read the CAS result so the cleanup below can only clear this claim.
  const claimedConfig = await getIntegrationConfig(PLATFORM, "watch-channel");
  const claimedWatch = getWatchClaim(claimedConfig);
  if (!claimedConfig || claimedWatch?.id !== claimId) {
    return notOwnedWatchResult(claimedConfig);
  }

  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return { status: "retry", claimId };

  const stopped = await stopGoogleDocsWatchChannel(
    accessToken,
    claimedConfig.configData.channelId,
    claimedConfig.configData.resourceId,
  );
  if (!stopped) return { status: "retry", claimId };

  const cleared = await saveIntegrationConfigIfUnchanged(
    PLATFORM,
    {},
    "watch-channel",
    claimedConfig,
  );
  if (cleared) return { status: "stopped" };
  return notOwnedWatchResult(
    await getIntegrationConfig(PLATFORM, "watch-channel"),
  );
}

export async function stopGoogleDocsWatchChannel(
  accessToken: string,
  channelId: unknown,
  resourceId: unknown,
): Promise<boolean> {
  if (typeof channelId !== "string" || channelId.length === 0) return false;

  try {
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/channels/stop",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          ...(typeof resourceId === "string" && { resourceId }),
        }),
      },
    );

    // An already-expired or already-stopped channel is safe to replace.
    if (res.ok || res.status === 404 || res.status === 410) {
      return true;
    }

    console.warn(
      `[google-docs] Failed to stop watch channel ${channelId} (HTTP ${res.status})`,
    );
    return false;
  } catch (err) {
    console.warn(
      `[google-docs] Failed to stop watch channel ${channelId}`,
      err,
    );
    return false;
  }
}

/**
 * Schedule automatic watch renewal before the channel expires.
 */
function scheduleWatchRenewal(
  webhookUrl: string,
  delayMs = WATCH_CHANNEL_TTL_MS - 60 * 60 * 1000,
  expectedChannelId?: string,
): void {
  if (watchRenewalTimer) clearTimeout(watchRenewalTimer);

  watchRenewalTimer = setTimeout(async () => {
    watchRenewalTimer = null;
    try {
      console.log("[google-docs] Renewing watch channel...");
      if (await registerWatch(webhookUrl, expectedChannelId)) return;

      if (expectedChannelId !== undefined) {
        const currentConfig = await getIntegrationConfig(
          PLATFORM,
          "watch-channel",
        );
        if (currentConfig?.configData?.channelId !== expectedChannelId) {
          return;
        }
      }

      console.warn(
        `[google-docs] Could not register the replacement watch; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
      );
      scheduleWatchRenewal(webhookUrl, WATCH_RETRY_MS, expectedChannelId);
    } catch (err) {
      console.warn(
        `[google-docs] Watch renewal failed; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
        err,
      );
      scheduleWatchRenewal(webhookUrl, WATCH_RETRY_MS, expectedChannelId);
    }
  }, delayMs);
  unrefTimer(watchRenewalTimer);
}

function scheduleWatchCleanupRetry(
  expectedClaimId: string | undefined,
  delayMs = WATCH_RETRY_MS,
): void {
  if (watchRenewalTimer) clearTimeout(watchRenewalTimer);

  watchRenewalTimer = setTimeout(async () => {
    watchRenewalTimer = null;
    try {
      const stopResult = await stopWatch(expectedClaimId);
      if (stopResult.status === "stopped") return;

      if (stopResult.status === "not-owned") {
        if (stopResult.claimId && stopResult.retryAt) {
          scheduleWatchCleanupRetry(
            stopResult.claimId,
            retryDelay(stopResult.retryAt),
          );
        }
        return;
      }

      scheduleWatchCleanupRetry(stopResult.claimId);
    } catch (err) {
      console.warn(
        `[google-docs] Watch cleanup failed; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
        err,
      );
      scheduleWatchCleanupRetry(expectedClaimId);
    }
  }, delayMs);
  unrefTimer(watchRenewalTimer);
}

// ─── Page Token Management ──────────────────────────────────────────────────

async function getPageToken(): Promise<string | null> {
  const config = await getIntegrationConfig(PLATFORM, "page-token");
  return (config?.configData?.pageToken as string) ?? null;
}

async function setPageToken(token: string): Promise<void> {
  await saveIntegrationConfig(PLATFORM, { pageToken: token }, "page-token");
}

// ─── Comment Detection ──────────────────────────────────────────────────────

function isAgentMention(commentText: string, triggerKeyword: string): boolean {
  return commentText.toLowerCase().includes(triggerKeyword.toLowerCase());
}

function commentKey(fileId: string, commentId: string): string {
  return `${fileId}:${commentId}`;
}

/**
 * Check a single document for new agent-directed comments.
 */
async function checkDocumentComments(
  fileId: string,
  accessToken: string,
  options: GoogleDocsPollerOptions,
): Promise<void> {
  const triggerKeyword = options.triggerKeyword ?? DEFAULT_TRIGGER;
  const serviceEmail = getServiceAccountEmail();

  const lastChecked = lastCheckedTimes.get(fileId);
  const comments = await listDocComments(fileId, accessToken, lastChecked);
  const now = new Date().toISOString();

  for (const comment of comments) {
    if (comment.resolved) continue;

    const key = commentKey(fileId, comment.id);

    // Skip comments authored by the service account
    if (
      serviceEmail &&
      comment.author.emailAddress?.toLowerCase() === serviceEmail.toLowerCase()
    ) {
      continue;
    }

    const existingMapping = await getThreadMapping(PLATFORM, key);

    if (existingMapping) {
      // Durable per-reply dedup: the in-memory `processedComments` Set does not
      // survive serverless cold starts (see pending-tasks-store H3 note), which
      // would let already-answered replies be reprocessed and double-posted.
      // Persist processed reply ids in the existing SQL thread mapping instead.
      const persistedReplyIds =
        existingMapping.platformContext.processedReplyIds;
      const processedReplyIds = new Set<string>(
        Array.isArray(persistedReplyIds) ? (persistedReplyIds as string[]) : [],
      );

      // Check for new follow-up replies from users
      const newUserReplies = (comment.replies ?? []).filter((r) => {
        if (
          serviceEmail &&
          r.author.emailAddress?.toLowerCase() === serviceEmail.toLowerCase()
        ) {
          return false;
        }
        const replyKey = `${key}:reply:${r.id}`;
        if (processedReplyIds.has(r.id) || processedComments.has(replyKey))
          return false;
        if (!isAgentMention(r.content, triggerKeyword)) return false;
        return true;
      });

      for (const reply of newUserReplies) {
        const replyKey = `${key}:reply:${reply.id}`;
        processedComments.add(replyKey);
        processedReplyIds.add(reply.id);
        // Persist immediately so a crash/cold-start between replies cannot
        // re-answer this reply on the next invocation.
        await saveThreadMapping(
          PLATFORM,
          key,
          existingMapping.internalThreadId,
          {
            ...existingMapping.platformContext,
            processedReplyIds: Array.from(processedReplyIds),
          },
        );

        const text = reply.content
          .replace(
            new RegExp(
              triggerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "gi",
            ),
            "",
          )
          .trim();

        await processComment(
          fileId,
          comment.id,
          text,
          reply.author.displayName,
          options,
          existingMapping.internalThreadId,
        );
      }
      continue;
    }

    // New comment — check if it mentions the agent
    if (!isAgentMention(comment.content, triggerKeyword)) continue;

    processedComments.add(key);

    let text = comment.content;
    if (comment.quotedFileContent?.value) {
      text = `[Highlighted text: "${comment.quotedFileContent.value}"]\n\n${text}`;
    }

    text = text
      .replace(
        new RegExp(triggerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        "",
      )
      .trim();

    await processComment(
      fileId,
      comment.id,
      text,
      comment.author.displayName,
      options,
    );
  }

  lastCheckedTimes.set(fileId, now);
}

// ─── Process Changes ────────────────────────────────────────────────────────

/**
 * Process pending Drive changes — called by both push notifications and polling.
 * Fetches changes since the last page token, finds Google Docs that changed,
 * and checks their comments for agent mentions.
 */
export async function processChanges(
  options: GoogleDocsPollerOptions,
): Promise<void> {
  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return;

  let pageToken = await getPageToken();
  if (!pageToken) {
    pageToken = await getStartPageToken(accessToken);
    await setPageToken(pageToken);
    return; // First run — just save the cursor
  }

  const { changes, nextPageToken } = await listChanges(pageToken, accessToken);
  await setPageToken(nextPageToken);

  if (changes.length === 0) return;

  // Deduplicate and filter to Google Docs
  const docFileIds = new Set<string>();
  for (const change of changes) {
    if (change.removed) continue;
    if (
      change.file?.mimeType === "application/vnd.google-apps.document" ||
      !change.file?.mimeType
    ) {
      docFileIds.add(change.fileId);
    }
  }

  for (const fileId of docFileIds) {
    try {
      await checkDocumentComments(fileId, accessToken, options);
    } catch (err) {
      console.error(`[google-docs] Error checking comments on ${fileId}:`, err);
    }
  }
}

/**
 * Handle a push notification from Google Drive changes.watch.
 * Called from the integration webhook route.
 */
export async function handlePushNotification(): Promise<void> {
  if (!activeOptions) {
    console.warn(
      "[google-docs] Push notification received but poller not configured",
    );
    return;
  }

  try {
    await processChanges(activeOptions);
  } catch (err) {
    console.error("[google-docs] Error processing push notification:", err);
  }
}

// ─── Agent Processing ───────────────────────────────────────────────────────

async function processComment(
  fileId: string,
  commentId: string,
  text: string,
  senderName: string,
  options: GoogleDocsPollerOptions,
  existingThreadId?: string,
): Promise<void> {
  const adapter = googleDocsAdapter();
  const key = commentKey(fileId, commentId);

  const incoming: IncomingMessage = {
    platform: PLATFORM,
    externalThreadId: key,
    text,
    senderName,
    platformContext: { fileId, commentId },
    timestamp: Date.now(),
  };

  const source = {
    platform: PLATFORM,
    url: `https://docs.google.com/document/d/${fileId}/edit`,
  };

  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await createThread(options.ownerEmail, {
      title: `Google Doc: ${senderName}`,
      source,
    });
    await saveThreadMapping(PLATFORM, key, thread.id, { fileId, commentId });
    threadId = thread.id;
  }

  // Older mapped conversations predate thread provenance. Backfill them as
  // they are touched so Dispatch's default local-history view excludes them.
  await setThreadSourceIfMissing(threadId, source);

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

  const messages: EngineMessage[] = [
    ...existingMessages,
    { role: "user", content: [{ type: "text", text }] },
  ];

  const engine = createAnthropicEngine({ apiKey: options.apiKey });
  // Attach tool-search on a shallow copy so framework additions merged in by
  // `createIntegrationsPlugin` (integration memory, `call-agent`) can be
  // deferred behind it without mutating the plugin's long-lived registry.
  // `runAgentLoop`'s `expandActiveTools` re-expands from `availableTools`
  // after a tool-search call, so anything filtered out of the initial
  // `tools` list stays reachable.
  const runnableActions = attachToolSearch({ ...options.actions });
  const availableTools = actionsToEngineTools(runnableActions);
  const tools = filterInitialEngineTools(
    availableTools,
    options.initialToolNames,
  );
  const runId = `gdocs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const capturedThreadId = threadId;
  const orgId = (await resolveOrgIdForEmail(options.ownerEmail)) ?? undefined;

  startRun(
    runId,
    capturedThreadId,
    async (send, signal) => {
      await runWithRequestContext(
        { userEmail: options.ownerEmail, orgId, isIntegrationCaller: true },
        () =>
          // Wrapper, not raw `runAgentLoop`: a doc-comment reply has no client
          // driving continuation, so a transport-level cut has to be resumed
          // inside this invocation or the commenter never gets an answer.
          runAgentLoopDirectWithSoftTimeout(
            {
              engine,
              model: options.model,
              systemPrompt: options.systemPrompt,
              tools,
              availableTools,
              messages,
              actions: runnableActions,
              send,
              signal,
            },
            undefined,
            // Same omission the scheduled-job runner had: without this, a
            // poller-driven reply inherits the interactive clamp (40s soft
            // timeout, a no-progress backstop at 0.75x that, 6 continuations)
            // even though no client is waiting on a response. Uses the runtime
            // check rather than a hardcoded `true` — matching webhook-handler.ts
            // in this same subsystem — because unlike the job runner there is no
            // hard-abort cap here to bound a wider ceiling.
            {
              useHostedDefault: true,
              backgroundFunction: isInBackgroundFunctionRuntime(),
            },
          ),
      );
    },
    async (completedRun: ActiveRun) => {
      try {
        let responseText = "";
        for (const runEvent of completedRun.events) {
          if (runEvent.event.type === "text") {
            responseText += runEvent.event.text;
          }
        }
        if (!responseText.trim()) responseText = "(No response)";

        const outgoing = adapter.formatAgentResponse(responseText);
        await adapter.sendResponse(outgoing, incoming);
        await persistThreadData(capturedThreadId, text, completedRun, thread);
      } catch (err) {
        console.error("[google-docs] Error sending response:", err);
      }
    },
    // No userId here: `options.ownerEmail` is PII (email), which the
    // terminal event must not carry.
    { model: options.model, engineName: engine.name },
  );
}

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

    repo.messages.push({
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: [{ type: "text", text: userText }],
      createdAt: new Date().toISOString(),
    });

    const assistantMsg = buildAssistantMessage(
      completedRun.events ?? [],
      completedRun.runId,
    );
    if (assistantMsg) repo.messages.push(assistantMsg);

    const meta = extractThreadMeta(repo);
    await updateThreadData(
      threadId,
      JSON.stringify(repo),
      meta.title || thread?.title || "Google Doc Comment",
      meta.preview || thread?.preview || "",
      repo.messages.length,
    );
  } catch {
    // Best-effort
  }
}

// ─── Poller (Hybrid: Push Primary, Poll Fallback) ───────────────────────────

/**
 * Start the Google Docs integration.
 *
 * Hybrid approach:
 * 1. Attempts to register a Google Drive changes.watch webhook for
 *    near-instant push notifications (~seconds latency)
 * 2. Falls back to polling if the watch registration fails
 *    (e.g. domain not verified, local dev)
 * 3. Even in push mode, polls at a slow interval (5min) as a safety net
 *    in case a push notification is missed
 */
export async function startGoogleDocsPoller(
  options: GoogleDocsPollerOptions,
): Promise<void> {
  if (pollerJob || pollerStartTimer) {
    console.warn("[google-docs] Already running");
    return;
  }

  activeOptions = options;

  // Check if integration is enabled before trying to register watch
  const config = await getIntegrationConfig(PLATFORM);
  if (!config?.configData?.enabled) {
    // Still start the poll loop so it picks up when enabled later
    startPollLoop(options, options.intervalMs ?? 30_000);
    return;
  }

  // Try to register push notifications
  const webhookUrl = options.webhookUrl;
  let pushMode = false;

  if (webhookUrl) {
    pushMode = await registerWatch(webhookUrl);
    if (pushMode) {
      console.log("[google-docs] Push mode active — using Drive webhooks");
      // In push mode, still poll slowly as a safety net (every 5 min)
      startPollLoop(options, 5 * 60 * 1000);
    }
  }

  if (!pushMode) {
    console.log(
      "[google-docs] Polling mode — push registration failed or no webhook URL",
    );
    startPollLoop(options, options.intervalMs ?? 30_000);
  }
}

/** Backoff for the config probe while google-docs is disabled. */
const DISABLED_CONFIG_RECHECK_MS = 5 * 60 * 1000;

function startPollLoop(
  options: GoogleDocsPollerOptions,
  intervalMs: number,
): void {
  let disabledUntil = 0;
  let disabledAtConfigWriteEpoch = -1;

  async function poll(): Promise<void> {
    try {
      // The loop starts even when google-docs was never configured (so it picks
      // up a later enable), which used to mean one `integration_configs` read
      // every 30s per app forever. While disabled, re-read only every
      // DISABLED_CONFIG_RECHECK_MS — or immediately after any in-process config
      // write, so enabling the integration still takes effect on the next tick.
      const epoch = integrationConfigWriteEpoch();
      if (Date.now() < disabledUntil && epoch === disabledAtConfigWriteEpoch) {
        return;
      }
      const config = await getIntegrationConfig(PLATFORM);
      if (!config?.configData?.enabled) {
        disabledUntil = Date.now() + DISABLED_CONFIG_RECHECK_MS;
        disabledAtConfigWriteEpoch = epoch;
        return;
      }
      disabledUntil = 0;
      await processChanges(options);
    } catch (err) {
      // Unwrap ErrorEvent (Neon WS driver emits these on network failure) so logs show the real cause
      const detail =
        err instanceof Error
          ? err
          : ((err as any)?.error ?? (err as any)?.message ?? err);
      console.error("[google-docs] Poller error:", detail);
    }
  }

  // processChanges ultimately calls the Drive/Docs REST API
  // (adapters/google-docs.ts), none of whose fetch()s carry a request
  // timeout — startIntervalJob's own cadence-scaled timeout backstops a hung
  // call, same convention as SyncTransport's poll abort.
  if (pollerStartTimer) clearTimeout(pollerStartTimer);
  pollerStartTimer = setTimeout(() => {
    pollerStartTimer = null;
    pollerJob = startIntervalJob(poll, { intervalMs });
  }, 5000);

  const email = getServiceAccountEmail();
  if (process.env.DEBUG) {
    console.log(
      `[google-docs] Poll loop started (interval: ${intervalMs / 1000}s, service account: ${email ?? "not configured"})`,
    );
  }
}

/**
 * Stop the Google Docs integration.
 */
export async function stopGoogleDocsPoller(): Promise<void> {
  if (pollerStartTimer) {
    clearTimeout(pollerStartTimer);
    pollerStartTimer = null;
  }
  if (pollerJob) {
    pollerJob.stop();
    pollerJob = null;
  }
  if (watchRenewalTimer) {
    clearTimeout(watchRenewalTimer);
    watchRenewalTimer = null;
  }
  try {
    const stopResult = await stopWatch();
    if (stopResult.status === "retry") {
      scheduleWatchCleanupRetry(stopResult.claimId);
    } else if (stopResult.status === "not-owned") {
      if (stopResult.claimId && stopResult.retryAt) {
        scheduleWatchCleanupRetry(
          stopResult.claimId,
          retryDelay(stopResult.retryAt),
        );
      }
    }
  } catch (err) {
    console.warn(
      `[google-docs] Watch cleanup failed; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
      err,
    );
    scheduleWatchCleanupRetry(undefined);
  }
  activeOptions = null;
}
