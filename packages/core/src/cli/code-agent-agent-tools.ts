import type { ActionEntry } from "../agent/production-agent.js";
import {
  createCodeAgentThread,
  listCodeAgentThreadSummaries,
  messageCodeAgentThread,
} from "./code-agent-collaboration.js";
import {
  createCodeAgentSchedule,
  deleteCodeAgentSchedule,
  listCodeAgentSchedules,
  updateCodeAgentSchedule,
} from "./code-agent-schedules.js";

export function createCodeAgentAgentTools(
  runId: string,
  cwd: string,
  runTitle?: string,
): Record<string, ActionEntry> {
  return {
    "manage-schedules": {
      tool: {
        description:
          "Create and manage durable local desktop schedules. A global schedule starts a new Agent-Native Code thread on every interval. A thread schedule queues a message into an existing thread. Use intervalMinutes for intervals such as 360 for every 6 hours.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create", "list", "update", "delete"],
              description: "The schedule operation.",
            },
            scheduleId: {
              type: "string",
              description: "Required for update or delete.",
            },
            name: {
              type: "string",
              description: "Human-readable schedule name.",
            },
            prompt: {
              type: "string",
              description: "Instructions sent to the new or existing thread.",
            },
            scope: {
              type: "string",
              enum: ["global", "thread"],
              description:
                "Whether to start a new thread or message an existing one.",
            },
            targetRunId: {
              type: "string",
              description: "Existing thread id when scope is thread.",
            },
            intervalMinutes: {
              type: "number",
              description:
                "Whole minutes between runs, for example 360 is every 6 hours.",
            },
            enabled: {
              type: "boolean",
              description: "Whether the schedule is active.",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        try {
          switch (args.action) {
            case "list":
              return JSON.stringify({
                ok: true,
                schedules: listCodeAgentSchedules(),
              });
            case "create": {
              const schedule = createCodeAgentSchedule({
                name: String(args.name ?? ""),
                prompt: String(args.prompt ?? ""),
                scope: args.scope === "thread" ? "thread" : "global",
                targetRunId:
                  typeof args.targetRunId === "string"
                    ? args.targetRunId
                    : undefined,
                intervalMinutes: Number(args.intervalMinutes),
                enabled: args.enabled !== false,
                createdByRunId: runId,
              });
              return JSON.stringify({ ok: true, schedule });
            }
            case "update": {
              const scheduleId = String(args.scheduleId ?? "").trim();
              if (!scheduleId)
                return "Error: scheduleId is required for update.";
              const schedule = updateCodeAgentSchedule(scheduleId, {
                ...(typeof args.name === "string" ? { name: args.name } : {}),
                ...(typeof args.prompt === "string"
                  ? { prompt: args.prompt }
                  : {}),
                ...(args.scope === "global" || args.scope === "thread"
                  ? { scope: args.scope }
                  : {}),
                ...(typeof args.targetRunId === "string"
                  ? { targetRunId: args.targetRunId }
                  : {}),
                ...(args.intervalMinutes !== undefined
                  ? { intervalMinutes: Number(args.intervalMinutes) }
                  : {}),
                ...(typeof args.enabled === "boolean"
                  ? { enabled: args.enabled }
                  : {}),
              });
              return schedule
                ? JSON.stringify({ ok: true, schedule })
                : `Error: schedule not found: ${scheduleId}`;
            }
            case "delete": {
              const scheduleId = String(args.scheduleId ?? "").trim();
              if (!scheduleId)
                return "Error: scheduleId is required for delete.";
              return JSON.stringify({
                ok: deleteCodeAgentSchedule(scheduleId),
                scheduleId,
              });
            }
            default:
              return "Error: action must be create, list, update, or delete.";
          }
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    "manage-agent-threads": {
      tool: {
        description:
          "List threads, create a new Agent-Native Code thread, or queue a message to another thread. Messages are durable and include a source-agent marker in the recipient transcript.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "create", "message"],
              description: "The thread operation.",
            },
            query: {
              type: "string",
              description: "Optional title/id filter for list.",
            },
            title: { type: "string", description: "Title for a new thread." },
            prompt: {
              type: "string",
              description: "Initial prompt or message.",
            },
            targetRunId: {
              type: "string",
              description: "Recipient thread id when action is message.",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        try {
          switch (args.action) {
            case "list":
              return JSON.stringify({
                ok: true,
                threads: listCodeAgentThreadSummaries(
                  typeof args.query === "string" ? args.query : undefined,
                ),
              });
            case "create": {
              const result = createCodeAgentThread({
                title: typeof args.title === "string" ? args.title : undefined,
                prompt: String(args.prompt ?? ""),
                cwd,
                sourceRunId: runId,
                sourceRunTitle: runTitle,
              });
              return JSON.stringify({
                ok: true,
                thread: result.run,
                event: result.event,
              });
            }
            case "message": {
              const result = messageCodeAgentThread({
                targetRunId: String(args.targetRunId ?? ""),
                prompt: String(args.prompt ?? ""),
                sourceRunId: runId,
                sourceRunTitle: runTitle,
              });
              return JSON.stringify({
                ok: true,
                thread: result.run,
                event: result.event,
              });
            }
            default:
              return "Error: action must be list, create, or message.";
          }
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  };
}
