/**
 * Framework-level agent tools for the progress primitive. Registered as
 * native tools so every template exposes them. Use from long agent loops
 * to communicate status to the user while work is still in-flight.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import {
  startRun,
  updateRunProgress,
  completeRun,
  listRuns,
} from "./registry.js";

export function createProgressToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "start-run": {
      tool: {
        description:
          "Mark the start of a long-running task the user should be able to watch. Returns a runId — pass it to `update-run-progress` and `complete-run`. Call this at the top of any task that will take more than a few seconds.",
        parameters: {
          type: "object" as const,
          properties: {
            title: {
              type: "string",
              description:
                'Short human-readable title, e.g. "Triage 128 unread emails".',
            },
            step: {
              type: "string",
              description: 'Initial step description, e.g. "Fetching inbox".',
            },
            metadataJson: {
              type: "string",
              description:
                "Optional JSON metadata: link, thread id, artifact path, etc.",
            },
          },
          required: ["title"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        if (!args.title) return "Error: --title is required.";
        let metadata: Record<string, unknown> | undefined;
        if (args.metadataJson) {
          try {
            metadata = JSON.parse(args.metadataJson);
          } catch {
            return "Error: metadataJson must be valid JSON.";
          }
        }
        const run = await startRun({
          owner,
          title: args.title,
          step: args.step || undefined,
          metadata,
        });
        return `Run started. runId=${run.id}`;
      },
    },

    "update-run-progress": {
      tool: {
        description:
          "Update a running task with progress. Call frequently during long loops so the user can watch status in the runs tray. Any omitted field stays unchanged.",
        parameters: {
          type: "object" as const,
          properties: {
            runId: {
              type: "string",
              description: "The id returned by `start-run`.",
            },
            percent: {
              type: "number",
              description:
                "Progress 0–100. Omit if the task has no known upper bound.",
            },
            step: {
              type: "string",
              description: 'Current step, e.g. "Drafting reply 23/100".',
            },
          },
          required: ["runId"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const owner = getCurrentUser();
        const runId = String(args.runId ?? "");
        if (!runId) return "Error: --runId is required.";
        const percent = args.percent == null ? undefined : Number(args.percent);
        const run = await updateRunProgress(runId, owner, {
          percent,
          step: args.step ? String(args.step) : undefined,
        });
        if (!run) return `Error: run ${runId} not found.`;
        return `Run updated (percent=${run.percent ?? "?"}, step=${run.step ?? ""}).`;
      },
    },

    "complete-run": {
      tool: {
        description:
          "Mark a task as finished. Use `succeeded` for a clean finish, `failed` when something went wrong, `cancelled` when the user interrupted. Pairs well with `notify` to tell the user the outcome.",
        parameters: {
          type: "object" as const,
          properties: {
            runId: {
              type: "string",
              description: "The id returned by `start-run`.",
            },
            status: {
              type: "string",
              enum: ["succeeded", "failed", "cancelled"],
              description: "Terminal status.",
            },
            step: {
              type: "string",
              description: "Optional final step text.",
            },
          },
          required: ["runId", "status"],
        },
      },
      run: async (args: Record<string, string>) => {
        const owner = getCurrentUser();
        if (!args.runId || !args.status) {
          return "Error: --runId and --status are required.";
        }
        const run = await completeRun(
          args.runId,
          owner,
          args.status as "succeeded" | "failed" | "cancelled",
          args.step ? { step: args.step } : undefined,
        );
        if (!run) return `Error: run ${args.runId} not found.`;
        return `Run ${run.id} completed with status=${run.status}.`;
      },
    },

    "list-runs": {
      tool: {
        description:
          "List the user's recent runs. Use when the user asks 'what is still running' or 'what did you do earlier'.",
        parameters: {
          type: "object" as const,
          properties: {
            active: {
              type: "boolean",
              description: "When true, only return runs still in progress.",
            },
            limit: {
              type: "number",
              description: "Max rows (default 20, max 200).",
            },
          },
        },
      },
      run: async (args: Record<string, unknown>) => {
        const owner = getCurrentUser();
        const rows = await listRuns(owner, {
          activeOnly: args.active === true || args.active === "true",
          limit: Math.min(Number(args.limit ?? 20), 200),
        });
        if (rows.length === 0) {
          return args.active ? "No active runs." : "No runs.";
        }
        return rows
          .map(
            (r) =>
              `[${r.status}] ${r.title}${r.percent != null ? ` · ${r.percent}%` : ""}${r.step ? ` — ${r.step}` : ""} · ${r.startedAt}`,
          )
          .join("\n");
      },
      readOnly: true,
    },
  };
}
