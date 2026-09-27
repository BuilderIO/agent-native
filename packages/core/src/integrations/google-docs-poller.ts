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

const processedComments = new Set<string>();
const lastCheckedTimes = new Map<string, string>();

export interface GoogleDocsPollerOptions {
  intervalMs?: number;
  triggerKeyword?: string;
  systemPrompt: string;
  actions: Record<string, ActionEntry>;
  initialToolNames?: string[];
  model: string;
  apiKey: string;
  ownerEmail: string;
  webhookUrl?: string;
}

let pollerJob: IntervalJobHandle | null = null;
let pollerStartTimer: ReturnType<typeof setTimeout> | null = null;
let activeOptions: GoogleDocsPollerOptions | null = null;
let pollerGeneration = 0;

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

function isCurrentPollerGeneration(generation?: number): boolean {
  return generation === undefined || generation === pollerGeneration;
}

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

async function cleanupRegisteredWatch(
  accessToken: string,
  channel: WatchChannel,
): Promise<void> {
  let currentConfig: IntegrationConfig | null = null;
  try {
    currentConfig = await getIntegrationConfig(PLATFORM, "watch-channel");
  } catch (err) {
    console.warn(
      "[google-docs] Could not read watch config during cleanup; continuing with provider stop",
      err,
    );
  }

  const stopped = await stopGoogleDocsWatchChannel(
    accessToken,
    channel.id,
    channel.resourceId,
  );
  if (!stopped) {
    scheduleOrphanedWatchCleanup(channel);
    return;
  }

  if (currentConfig?.configData?.channelId === channel.id) {
    try {
      await saveIntegrationConfigIfUnchanged(
        PLATFORM,
        {},
        "watch-channel",
        currentConfig,
      );
    } catch (err) {
      console.warn(
        "[google-docs] Could not clear watch config after provider stop",
        err,
      );
    }
  }
}

export async function registerWatch(
  webhookUrl: string,
  expectedChannelId?: string,
  expectedPollerGeneration?: number,
): Promise<boolean> {
  if (!isCurrentPollerGeneration(expectedPollerGeneration)) return false;

  const integrationConfig = await getIntegrationConfig(PLATFORM);
  if (!integrationConfig?.configData?.enabled) return false;

  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return false;

  let pageToken = await getPageToken();
  if (!pageToken) {
    pageToken = await getStartPageToken(accessToken);
    await setPageToken(pageToken);
  }

  if (!isCurrentPollerGeneration(expectedPollerGeneration)) return false;

  const channelId = `gdocs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiration = Date.now() + WATCH_CHANNEL_TTL_MS;
  const { token: channelToken, tokenHash: channelTokenHash } =
    createGoogleDocsChannelAuth();
  let registeredChannel: { id: string; resourceId: string } | null = null;

  try {
    const currentConfig = await getIntegrationConfig(PLATFORM, "watch-channel");
    if (
      expectedChannelId !== undefined &&
      currentConfig?.configData?.channelId !== expectedChannelId
    ) {
      return false;
    }

    if (!isCurrentPollerGeneration(expectedPollerGeneration)) return false;

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

    if (!isCurrentPollerGeneration(expectedPollerGeneration)) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
      return false;
    }

    const enabledAfterRegistration = await getIntegrationConfig(PLATFORM);
    if (!enabledAfterRegistration?.configData?.enabled) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
      return false;
    }

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
      await cleanupRegisteredWatch(accessToken, registeredChannel);
      console.warn(
        `[google-docs] Watch registration lost a concurrent update (channel: ${data.id})`,
      );
      return false;
    }

    if (!isCurrentPollerGeneration(expectedPollerGeneration)) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
      return false;
    }

    const enabledBeforeScheduling = await getIntegrationConfig(PLATFORM);
    if (!enabledBeforeScheduling?.configData?.enabled) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
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

    if (!isCurrentPollerGeneration(expectedPollerGeneration)) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
      return false;
    }

    console.log(
      `[google-docs] Watch registered (channel: ${data.id}, expires: ${new Date(parseInt(data.expiration)).toISOString()})`,
    );

    scheduleWatchRenewal(
      webhookUrl,
      undefined,
      data.id,
      expectedPollerGeneration,
    );

    return true;
  } catch (err) {
    if (registeredChannel) {
      await cleanupRegisteredWatch(accessToken, registeredChannel);
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

function scheduleWatchRenewal(
  webhookUrl: string,
  delayMs = WATCH_CHANNEL_TTL_MS - 60 * 60 * 1000,
  expectedChannelId?: string,
  expectedPollerGeneration?: number,
): void {
  if (!isCurrentPollerGeneration(expectedPollerGeneration)) return;
  if (watchRenewalTimer) clearTimeout(watchRenewalTimer);

  watchRenewalTimer = setTimeout(async () => {
    watchRenewalTimer = null;
    if (!isCurrentPollerGeneration(expectedPollerGeneration)) return;
    try {
      console.log("[google-docs] Renewing watch channel...");
      if (
        await registerWatch(
          webhookUrl,
          expectedChannelId,
          expectedPollerGeneration,
        )
      ) {
        return;
      }

      if (!(await shouldRetryWatchRenewal(expectedChannelId))) return;

      if (!isCurrentPollerGeneration(expectedPollerGeneration)) return;

      console.warn(
        `[google-docs] Could not register the replacement watch; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
      );
      scheduleWatchRenewal(
        webhookUrl,
        WATCH_RETRY_MS,
        expectedChannelId,
        expectedPollerGeneration,
      );
    } catch (err) {
      console.warn(
        `[google-docs] Watch renewal failed; retrying in ${WATCH_RETRY_MS / 60_000} minutes`,
        err,
      );
      if (!isCurrentPollerGeneration(expectedPollerGeneration)) return;
      try {
        if (!(await shouldRetryWatchRenewal(expectedChannelId))) return;
      } catch (configErr) {
        console.warn(
          "[google-docs] Could not verify the current watch before retrying",
          configErr,
        );
        return;
      }
      scheduleWatchRenewal(
        webhookUrl,
        WATCH_RETRY_MS,
        expectedChannelId,
        expectedPollerGeneration,
      );
    }
  }, delayMs);
  unrefTimer(watchRenewalTimer);
}

async function shouldRetryWatchRenewal(
  expectedChannelId?: string,
): Promise<boolean> {
  const integrationConfig = await getIntegrationConfig(PLATFORM);
  if (!integrationConfig?.configData?.enabled) return false;
  if (expectedChannelId === undefined) return true;

  const currentConfig = await getIntegrationConfig(PLATFORM, "watch-channel");
  return currentConfig?.configData?.channelId === expectedChannelId;
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

async function getPageToken(): Promise<string | null> {
  const config = await getIntegrationConfig(PLATFORM, "page-token");
  return (config?.configData?.pageToken as string) ?? null;
}

async function setPageToken(token: string): Promise<void> {
  await saveIntegrationConfig(PLATFORM, { pageToken: token }, "page-token");
}

function isAgentMention(commentText: string, triggerKeyword: string): boolean {
  return commentText.toLowerCase().includes(triggerKeyword.toLowerCase());
}

function commentKey(fileId: string, commentId: string): string {
  return `${fileId}:${commentId}`;
}

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

    if (
      serviceEmail &&
      comment.author.emailAddress?.toLowerCase() === serviceEmail.toLowerCase()
    ) {
      continue;
    }

    const existingMapping = await getThreadMapping(PLATFORM, key);

    if (existingMapping) {
      const persistedReplyIds =
        existingMapping.platformContext.processedReplyIds;
      const processedReplyIds = new Set<string>(
        Array.isArray(persistedReplyIds) ? (persistedReplyIds as string[]) : [],
      );

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

export async function processChanges(
  options: GoogleDocsPollerOptions,
): Promise<void> {
  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return;

  let pageToken = await getPageToken();
  if (!pageToken) {
    pageToken = await getStartPageToken(accessToken);
    await setPageToken(pageToken);
    return;
  }

  const { changes, nextPageToken } = await listChanges(pageToken, accessToken);
  await setPageToken(nextPageToken);

  if (changes.length === 0) return;

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

export async function startGoogleDocsPoller(
  options: GoogleDocsPollerOptions,
): Promise<void> {
  if (pollerJob || pollerStartTimer) {
    console.warn("[google-docs] Already running");
    return;
  }

  const generation = ++pollerGeneration;
  activeOptions = options;

  const config = await getIntegrationConfig(PLATFORM);
  if (!isCurrentPollerGeneration(generation)) return;
  if (!config?.configData?.enabled) {
    startPollLoop(options, options.intervalMs ?? 30_000);
    return;
  }

  const webhookUrl = options.webhookUrl;
  let pushMode = false;

  if (webhookUrl) {
    pushMode = await registerWatch(webhookUrl, undefined, generation);
    if (!isCurrentPollerGeneration(generation)) return;
    if (pushMode) {
      console.log("[google-docs] Push mode active — using Drive webhooks");
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

const DISABLED_CONFIG_RECHECK_MS = 5 * 60 * 1000;

function startPollLoop(
  options: GoogleDocsPollerOptions,
  intervalMs: number,
): void {
  let disabledUntil = 0;
  let disabledAtConfigWriteEpoch = -1;

  async function poll(): Promise<void> {
    try {
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
      const detail =
        err instanceof Error
          ? err
          : ((err as any)?.error ?? (err as any)?.message ?? err);
      console.error("[google-docs] Poller error:", detail);
    }
  }

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

export async function stopGoogleDocsPoller(): Promise<void> {
  pollerGeneration += 1;
  activeOptions = null;
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
}
