import type { H3Event } from "h3";
import { setResponseStatus } from "h3";
import type { PlatformAdapter, IncomingMessage } from "./types.js";
import { getThreadMapping, saveThreadMapping } from "./thread-mapping-store.js";
import { createThread, getThread } from "../chat-threads/store.js";
import { runAgentLoop, type ActionEntry } from "../agent/production-agent.js";
import { startRun, type ActiveRun } from "../agent/run-manager.js";
import {
  buildAssistantMessage,
  extractThreadMeta,
} from "../agent/thread-data-builder.js";
import { updateThreadData } from "../chat-threads/store.js";
import { readBody } from "../server/h3-helpers.js";

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
}

/**
 * Process an incoming webhook from a messaging platform.
 *
 * Flow:
 * 1. Handle verification challenges (Slack url_verification, etc.)
 * 2. Verify webhook signature
 * 3. Parse incoming message (null = ignored event)
 * 4. Return HTTP 200 immediately
 * 5. Resolve/create internal thread
 * 6. Run agent loop in background
 * 7. Post response back to platform
 */
export async function handleWebhook(
  event: H3Event,
  options: WebhookHandlerOptions,
): Promise<{ status: number; body: unknown }> {
  const { adapter, systemPrompt, actions, model, apiKey } = options;

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
  const incoming = await adapter.parseIncomingMessage(event);
  if (!incoming) {
    // Not a user message (bot message, edit, reaction, etc.) — acknowledge silently
    return { status: 200, body: "ok" };
  }

  // Deduplicate (platforms retry on timeout)
  const eventId = `${incoming.platform}:${incoming.externalThreadId}:${incoming.timestamp}`;
  if (isDuplicate(eventId)) {
    return { status: 200, body: "ok" };
  }

  // Step 4: Return immediately — processing happens in background
  // (The caller should send this response before awaiting processMessage)
  processMessageInBackground(incoming, options).catch((err) => {
    console.error(
      `[integrations] Error processing ${incoming.platform} message:`,
      err,
    );
  });

  return { status: 200, body: "ok" };
}

/**
 * Process an incoming message in the background:
 * resolve thread, run agent, send response back to platform.
 */
async function processMessageInBackground(
  incoming: IncomingMessage,
  options: WebhookHandlerOptions,
): Promise<void> {
  const { adapter, systemPrompt, actions, model, apiKey } = options;

  // Step 5: Resolve or create internal thread
  let mapping = await getThreadMapping(
    incoming.platform,
    incoming.externalThreadId,
  );

  if (!mapping) {
    const thread = await createThread(`integration@${incoming.platform}`, {
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
  const existingMessages: any[] = [];
  if (thread?.threadData) {
    try {
      const data = JSON.parse(thread.threadData);
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const m = msg.message ?? msg;
          if (m.role === "user") {
            existingMessages.push({
              role: "user",
              content:
                typeof m.content === "string"
                  ? m.content
                  : Array.isArray(m.content)
                    ? m.content
                        .filter((c: any) => c.type === "text")
                        .map((c: any) => c.text)
                        .join("\n")
                    : "",
            });
          } else if (m.role === "assistant") {
            existingMessages.push({
              role: "assistant",
              content:
                typeof m.content === "string"
                  ? m.content
                  : Array.isArray(m.content)
                    ? m.content
                        .filter((c: any) => c.type === "text")
                        .map((c: any) => c.text)
                        .join("\n")
                    : "",
            });
          }
        }
      }
    } catch {}
  }

  // Add the new user message
  const messages: any[] = [
    ...existingMessages,
    { role: "user", content: incoming.text },
  ];

  // Step 6: Run agent loop via startRun
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const tools = Object.entries(actions).map(([name, entry]) => ({
    name,
    description: entry.tool.description,
    input_schema: entry.tool.parameters ?? {
      type: "object" as const,
      properties: {},
    },
  }));

  const runId = `integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const run = startRun(
    runId,
    threadId,
    async (send, signal) => {
      await runAgentLoop({
        client,
        model,
        systemPrompt,
        tools,
        messages,
        actions,
        send,
        signal,
      });
    },
    async (completedRun: ActiveRun) => {
      // Step 7: On completion, send response back to platform
      try {
        // Collect text from events
        let responseText = "";
        for (const runEvent of completedRun.events) {
          if (runEvent.event.type === "text") {
            responseText += runEvent.event.text;
          }
        }

        if (!responseText.trim()) {
          responseText = "(No response)";
        }

        // Format and send back to platform
        const outgoing = adapter.formatAgentResponse(responseText);
        await adapter.sendResponse(outgoing, incoming);

        // Persist thread data
        await persistThreadData(threadId, incoming.text, completedRun, thread);
      } catch (err) {
        console.error(
          `[integrations] Error sending response to ${incoming.platform}:`,
          err,
        );
      }
    },
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
