import {
  getServiceAccountAccessToken,
  getServiceAccountEmail,
  getStartPageToken,
  listChanges,
  listDocComments,
  type GoogleDocComment,
} from "./adapters/google-docs.js";
import { getIntegrationConfig, saveIntegrationConfig } from "./config-store.js";
import { getThreadMapping, saveThreadMapping } from "./thread-mapping-store.js";
import { createThread, getThread } from "../chat-threads/store.js";
import {
  runAgentLoop,
  actionsToEngineTools,
  type ActionEntry,
} from "../agent/production-agent.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveOrgIdForEmail } from "../org/context.js";
import { createAnthropicEngine } from "../agent/engine/index.js";
import type { EngineMessage } from "../agent/engine/types.js";
import { startRun, type ActiveRun } from "../agent/run-manager.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import { updateThreadData } from "../chat-threads/store.js";
import { googleDocsAdapter } from "./adapters/google-docs.js";
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
  /** Model to use */
  model: string;
  /** Anthropic API key */
  apiKey: string;
  /** Thread owner email */
  ownerEmail: string;
  /** Webhook URL for push mode (set by plugin from WEBHOOK_BASE_URL) */
  webhookUrl?: string;
}

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let activeOptions: GoogleDocsPollerOptions | null = null;

// ─── Watch Channel Management ───────────────────────────────────────────────

/** How long a watch channel lasts (Google max is ~24h, we use 23h to renew early) */
const WATCH_CHANNEL_TTL_MS = 23 * 60 * 60 * 1000;
let watchRenewalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register a Google Drive changes.watch channel so Google pushes
 * notifications to our webhook instead of us polling.
 *
 * Returns true if the watch was registered successfully.
 */
export async function registerWatch(webhookUrl: string): Promise<boolean> {
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

  try {
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

    // Save channel info for renewal and stopping
    await saveIntegrationConfig(
      PLATFORM,
      {
        channelId: data.id,
        resourceId: data.resourceId,
        expiration: data.expiration,
        webhookUrl,
      },
      "watch-channel",
    );

    console.log(
      `[google-docs] Watch registered (channel: ${data.id}, expires: ${new Date(parseInt(data.expiration)).toISOString()})`,
    );

    // Schedule renewal before expiration
    scheduleWatchRenewal(webhookUrl);

    return true;
  } catch (err) {
    console.error("[google-docs] Watch registration error:", err);
    return false;
  }
}

/**
 * Stop an existing watch channel.
 */
async function stopWatch(): Promise<void> {
  const config = await getIntegrationConfig(PLATFORM, "watch-channel");
  if (!config?.configData?.channelId) return;

  const accessToken = await getServiceAccountAccessToken();
  if (!accessToken) return;

  try {
    await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: config.configData.channelId,
        resourceId: config.configData.resourceId,
      }),
    });
  } catch {
    // Best effort — channel may have expired already
  }

  await saveIntegrationConfig(PLATFORM, {}, "watch-channel");
}

/**
 * Schedule automatic watch renewal before the channel expires.
 */
function scheduleWatchRenewal(webhookUrl: string): void {
  if (watchRenewalTimer) clearTimeout(watchRenewalTimer);

  // Renew 1 hour before expiration
  const renewIn = WATCH_CHANNEL_TTL_MS - 60 * 60 * 1000;

  watchRenewalTimer = setTimeout(async () => {
    console.log("[google-docs] Renewing watch channel...");
    await stopWatch();
    await registerWatch(webhookUrl);
  }, renewIn);
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
      // Check for new follow-up replies from users
      const newUserReplies = (comment.replies ?? []).filter((r) => {
        if (
          serviceEmail &&
          r.author.emailAddress?.toLowerCase() === serviceEmail.toLowerCase()
        ) {
          return false;
        }
        const replyKey = `${key}:reply:${r.id}`;
        if (processedComments.has(replyKey)) return false;
        if (!isAgentMention(r.content, triggerKeyword)) return false;
        return true;
      });

      for (const reply of newUserReplies) {
        const replyKey = `${key}:reply:${reply.id}`;
        processedComments.add(replyKey);

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

  let threadId = existingThreadId;
  if (!threadId) {
    const thread = await createThread(options.ownerEmail, {
      title: `Google Doc: ${senderName}`,
    });
    await saveThreadMapping(PLATFORM, key, thread.id, { fileId, commentId });
    threadId = thread.id;
  }

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
  const tools = actionsToEngineTools(options.actions);
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
          runAgentLoop({
            engine,
            model: options.model,
            systemPrompt: options.systemPrompt,
            tools,
            messages,
            actions: options.actions,
            send,
            signal,
          }),
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
  if (pollerInterval) {
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

function startPollLoop(
  options: GoogleDocsPollerOptions,
  intervalMs: number,
): void {
  async function poll() {
    try {
      const config = await getIntegrationConfig(PLATFORM);
      if (!config?.configData?.enabled) return;
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

  setTimeout(poll, 5000);
  pollerInterval = setInterval(poll, intervalMs);

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
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
  if (watchRenewalTimer) {
    clearTimeout(watchRenewalTimer);
    watchRenewalTimer = null;
  }
  await stopWatch();
  activeOptions = null;
}
