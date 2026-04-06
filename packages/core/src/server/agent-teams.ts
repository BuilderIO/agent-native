/**
 * Agent Teams — sub-agent orchestration for agent-native.
 *
 * The main agent chat acts as an orchestrator. It spawns sub-agents
 * for individual tasks, which run in their own threads. Sub-agents
 * appear as rich preview cards (chips) inline in the main chat.
 *
 * This module provides the server-side infrastructure:
 * - Creating sub-agent threads and running them in background
 * - Tracking task status and results
 * - Emitting SSE events for live preview cards
 * - Bidirectional messaging between main agent and sub-agents
 *
 * Task state is persisted in application_state (SQL) so it survives
 * serverless cold starts and works across multiple processes.
 */

import type { AgentChatEvent } from "../agent/types.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { createThread } from "../chat-threads/store.js";
import { startRun, subscribeToRun } from "../agent/run-manager.js";
import { runAgentLoop } from "../agent/production-agent.js";
import {
  readAppState,
  writeAppState,
  listAppState,
  deleteAppState,
} from "../application-state/script-helpers.js";

export interface AgentTask {
  taskId: string;
  threadId: string;
  description: string;
  status: "running" | "completed" | "errored";
  preview: string;
  summary: string;
  currentStep: string;
  createdAt: number;
}

/** Key prefix for task records: agent-task:{taskId} */
const TASK_PREFIX = "agent-task:";

/** Key prefix for thread→task reverse lookup: agent-task-thread:{threadId} */
const THREAD_PREFIX = "agent-task-thread:";

async function saveTask(task: AgentTask): Promise<void> {
  await writeAppState(`${TASK_PREFIX}${task.taskId}`, task as any);
  await writeAppState(`${THREAD_PREFIX}${task.threadId}`, {
    taskId: task.taskId,
  });
}

async function loadTask(taskId: string): Promise<AgentTask | null> {
  const data = await readAppState(`${TASK_PREFIX}${taskId}`);
  return data ? (data as unknown as AgentTask) : null;
}

async function loadTaskByThread(threadId: string): Promise<AgentTask | null> {
  const ref = await readAppState(`${THREAD_PREFIX}${threadId}`);
  if (!ref || !ref.taskId) return null;
  return loadTask(ref.taskId as string);
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SpawnTaskOptions {
  /** Description of what the sub-agent should do */
  description: string;
  /** Additional instructions scoped to this sub-agent */
  instructions?: string;
  /** Model to use (e.g. "claude-haiku-4-5"). Uses default if omitted */
  model?: string;
  /** The owner email for thread creation */
  ownerEmail: string;
  /** The system prompt base for the sub-agent */
  systemPrompt: string;
  /** Available actions for the sub-agent */
  actions: Record<string, ActionEntry>;
  /** API key for Anthropic */
  apiKey: string;
  /** Callback to emit events to the parent chat stream */
  parentSend: (event: AgentChatEvent) => void;
}

/**
 * Spawn a sub-agent task. Creates a thread, starts a background agent run,
 * and emits agent_task events to the parent chat stream.
 */
export async function spawnTask(opts: SpawnTaskOptions): Promise<AgentTask> {
  const taskId = generateTaskId();

  // Create a dedicated thread for the sub-agent with the task as the first message
  const thread = await createThread(opts.ownerEmail, {
    title: opts.description.slice(0, 100),
  });

  // Save the initial user message to thread data so the tab shows content immediately.
  // Format must match assistant-ui's threadRuntime.import() expectations:
  // content must be an array of parts, not a plain string.
  try {
    const { updateThreadData } = await import("../chat-threads/store.js");
    const threadData = JSON.stringify({
      messages: [
        {
          message: {
            id: `msg-${Date.now()}-user`,
            role: "user",
            content: [{ type: "text", text: opts.description }],
          },
        },
      ],
    });
    await updateThreadData(
      thread.id,
      threadData,
      opts.description.slice(0, 100),
      opts.description.slice(0, 200),
      1,
    );
  } catch {
    // Best effort — thread will still work without persisted messages
  }

  const task: AgentTask = {
    taskId,
    threadId: thread.id,
    description: opts.description,
    status: "running",
    preview: "",
    summary: "",
    currentStep: "",
    createdAt: Date.now(),
  };

  await saveTask(task);

  // Notify parent chat that a sub-agent was spawned
  opts.parentSend({
    type: "agent_task",
    taskId,
    threadId: thread.id,
    description: opts.description,
    status: "running",
  });

  // Build scoped system prompt
  let systemPrompt = opts.systemPrompt;
  if (opts.instructions) {
    systemPrompt += `\n\n## Task-Specific Instructions\n\n${opts.instructions}`;
  }

  // Import Anthropic SDK
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? "claude-sonnet-4-6";

  // Build tools from actions
  const tools: any[] = Object.entries(opts.actions).map(([name, entry]) => ({
    name,
    description: entry.tool.description,
    input_schema: entry.tool.parameters ?? {
      type: "object" as const,
      properties: {},
    },
  }));

  const messages: any[] = [{ role: "user", content: opts.description }];

  // Start the agent run in background
  const runId = `run-task-${taskId}`;
  let accumulatedText = "";
  let lastPreviewSent = 0;
  const PREVIEW_INTERVAL_MS = 300; // Throttle preview updates to every 300ms

  startRun(
    runId,
    thread.id,
    async (send, signal) => {
      const sendPreviewUpdate = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastPreviewSent < PREVIEW_INTERVAL_MS) return;
        lastPreviewSent = now;
        task.preview = accumulatedText.slice(-800);
        // Persist to SQL so task-status calls from other processes see live state
        await saveTask(task);
        opts.parentSend({
          type: "agent_task_update",
          taskId,
          preview: task.preview,
          currentStep: task.currentStep,
        });
      };

      // Wrap the send function to also emit preview updates to parent
      const wrappedSend = (event: AgentChatEvent) => {
        send(event);

        if (event.type === "text") {
          accumulatedText += event.text;
          sendPreviewUpdate();
        } else if (event.type === "tool_start") {
          task.currentStep = `Running ${event.tool}...`;
          sendPreviewUpdate(true);
        } else if (event.type === "tool_done") {
          task.currentStep = "";
          sendPreviewUpdate(true);
        }
      };

      await runAgentLoop({
        client,
        model,
        systemPrompt,
        tools,
        messages,
        actions: opts.actions,
        send: wrappedSend,
        signal,
      });
    },
    // onComplete callback — called when the run finishes (success or error)
    async (run) => {
      if (run.status === "errored") {
        task.status = "errored";
        task.summary = accumulatedText.slice(-500) || "Task failed.";
        await saveTask(task);
        // Emit error as agent_task_complete with errored status
        opts.parentSend({
          type: "agent_task",
          taskId,
          threadId: thread.id,
          description: task.description,
          status: "errored",
        });
      } else {
        task.status = "completed";
        task.summary =
          accumulatedText.slice(-1000) || "Task completed successfully.";
        await saveTask(task);
        opts.parentSend({
          type: "agent_task_complete",
          taskId,
          summary: task.summary,
        });
      }

      // Persist the full conversation to threadData so the sub-agent tab
      // can restore it later (after the in-memory run is cleaned up).
      // Convert Anthropic messages to the assistant-ui repository format.
      try {
        const { updateThreadData } = await import("../chat-threads/store.js");
        const repoMessages = messages.map((msg: any, i: number) => {
          const parts: any[] = [];
          const content = msg.content;
          if (typeof content === "string") {
            parts.push({ type: "text", text: content });
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                parts.push({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                parts.push({
                  type: "tool-call",
                  toolCallId: block.id,
                  toolName: block.name,
                  args: block.input,
                });
              } else if (block.type === "tool_result") {
                // Tool results are part of the user message in Anthropic format
                // but in assistant-ui they're attached to the tool-call
                // Skip here — they'll be matched to their tool-call
              }
            }
          }
          const repoMsg: any = {
            id: `msg-${taskId}-${i}`,
            role: msg.role,
            content: parts.length > 0 ? parts : [{ type: "text", text: "" }],
          };
          if (msg.role === "assistant") {
            repoMsg.status = { type: "complete", reason: "stop" };
          }
          return repoMsg;
        });

        // Attach tool results to their corresponding tool-call parts
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
          for (const block of msg.content) {
            if (block.type !== "tool_result") continue;
            // Find the assistant message with the matching tool_use
            for (const repoMsg of repoMessages) {
              if (repoMsg.role !== "assistant") continue;
              const tc = repoMsg.content?.find(
                (p: any) =>
                  p.type === "tool-call" && p.toolCallId === block.tool_use_id,
              );
              if (tc) {
                tc.result =
                  typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content);
                break;
              }
            }
          }
        }

        // Filter out user messages that only contain tool_result blocks (empty content)
        const filteredMessages = repoMessages.filter(
          (m: any) =>
            m.content.length > 0 &&
            !(
              m.content.length === 1 &&
              m.content[0].type === "text" &&
              m.content[0].text === ""
            ),
        );

        // Wrap in assistant-ui's { message: ... } format
        const repo = {
          messages: filteredMessages.map((m: any) => ({ message: m })),
        };
        const title = opts.description.slice(0, 100);
        const preview = accumulatedText.slice(0, 200);
        await updateThreadData(
          thread.id,
          JSON.stringify(repo),
          title,
          preview,
          filteredMessages.length,
        );
      } catch {
        // Best effort — the in-memory replay path still works
      }
    },
  );

  return task;
}

/** Get task by ID */
export async function getTask(taskId: string): Promise<AgentTask | undefined> {
  const task = await loadTask(taskId);
  return task ?? undefined;
}

/** Get task by thread ID */
export async function getTaskByThread(
  threadId: string,
): Promise<AgentTask | undefined> {
  const task = await loadTaskByThread(threadId);
  return task ?? undefined;
}

/** List all tasks (most recent first) */
export async function listTasks(): Promise<AgentTask[]> {
  const entries = await listAppState(TASK_PREFIX);
  const tasks = entries.map((e) => e.value as unknown as AgentTask);
  return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

/** Send a message/update to a running sub-agent via application state */
export async function sendToTask(
  taskId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await loadTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.status !== "running")
    return { ok: false, error: "Task is not running" };

  // Write the message to application state so the sub-agent can read it
  // on its next tool call or iteration
  try {
    const { appStatePut } = await import("../application-state/store.js");
    const sessionId = process.env.AGENT_USER_EMAIL || "local@localhost";
    await appStatePut(sessionId, `task-message:${taskId}`, {
      from: "orchestrator",
      message,
      timestamp: Date.now(),
    });
  } catch {
    // Application state not available — best effort
  }

  return { ok: true };
}

/** Mark a task as errored */
export async function markTaskErrored(
  taskId: string,
  error: string,
): Promise<void> {
  const task = await loadTask(taskId);
  if (task) {
    task.status = "errored";
    task.summary = error;
    await saveTask(task);
  }
}
