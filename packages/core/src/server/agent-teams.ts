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
 */

import type { AgentChatEvent } from "../agent/types.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { createThread } from "../chat-threads/store.js";
import { startRun, subscribeToRun } from "../agent/run-manager.js";
import { runAgentLoop } from "../agent/production-agent.js";

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

/** In-memory task registry — maps taskId → AgentTask */
const tasks = new Map<string, AgentTask>();

/** Maps threadId → taskId for reverse lookup */
const threadToTask = new Map<string, string>();

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

  // Create a dedicated thread for the sub-agent
  const thread = await createThread(opts.ownerEmail, {
    title: opts.description.slice(0, 100),
  });

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

  tasks.set(taskId, task);
  threadToTask.set(thread.id, taskId);

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

  startRun(
    runId,
    thread.id,
    async (send, signal) => {
      // Wrap the send function to also emit preview updates to parent
      const wrappedSend = (event: AgentChatEvent) => {
        send(event);

        // Accumulate text for preview
        if (event.type === "text") {
          accumulatedText += event.text;
          // Send periodic preview updates to parent (every ~200 chars of new text)
          task.preview = accumulatedText.slice(-500);
          if (accumulatedText.length % 200 < (event.text?.length ?? 0)) {
            opts.parentSend({
              type: "agent_task_update",
              taskId,
              preview: task.preview,
            });
          }
        } else if (event.type === "tool_start") {
          task.currentStep = `Running ${event.tool}...`;
          opts.parentSend({
            type: "agent_task_update",
            taskId,
            preview: task.preview,
            currentStep: task.currentStep,
          });
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
    // onComplete callback
    () => {
      task.status = "completed";
      task.summary =
        accumulatedText.slice(0, 500) || "Task completed successfully.";

      opts.parentSend({
        type: "agent_task_complete",
        taskId,
        summary: task.summary,
      });
    },
  );

  return task;
}

/** Get task by ID */
export function getTask(taskId: string): AgentTask | undefined {
  return tasks.get(taskId);
}

/** Get task by thread ID */
export function getTaskByThread(threadId: string): AgentTask | undefined {
  const taskId = threadToTask.get(threadId);
  return taskId ? tasks.get(taskId) : undefined;
}

/** List all tasks (most recent first) */
export function listTasks(): AgentTask[] {
  return Array.from(tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Send a message to a running sub-agent (for bidirectional communication) */
export function sendToTask(
  taskId: string,
  _message: string,
): { ok: boolean; error?: string } {
  const task = tasks.get(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.status !== "running")
    return { ok: false, error: "Task is not running" };

  // TODO: Inject message into the sub-agent's run
  // This requires extending run-manager to support message injection
  return { ok: true };
}
