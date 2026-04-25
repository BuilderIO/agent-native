/**
 * Framework-level agent tools for the progress primitive. Registered as
 * native tools so every template exposes them. Use from long agent loops
 * to communicate status to the user while work is still in-flight.
 *
 * All operations are consolidated into a single `manage-progress` tool
 * with an `action` discriminator.
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
    "manage-progress": {
      tool: {
        description: `Manage long-running task progress visible to the user. Use this whenever a task will take more than a few seconds so the user can watch status in the runs tray.

Actions:
• "start" — Begin tracking a new task. Returns a runId to pass to subsequent calls. Params: title (required), step (optional initial step text), metadataJson (optional JSON string with link/thread/artifact info).
• "update" — Report progress on a running task. Call frequently during long loops. Params: runId (required), percent (optional 0–100), step (optional current step text). Omitted fields stay unchanged.
• "complete" — Mark a task as finished. Params: runId (required), status (required: "succeeded" | "failed" | "cancelled"), step (optional final step text). Pairs well with \`notify\` to tell the user the outcome.
• "list" — List the user's recent runs. Use when the user asks "what is still running" or "what did you do earlier". Params: active (optional boolean, filter to in-progress only), limit (optional number, default 20, max 200).`,
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["start", "update", "complete", "list"],
              description:
                'The operation to perform: "start" a new run, "update" progress, "complete" a run, or "list" recent runs.',
            },
            title: {
              type: "string",
              description:
                '[start] Short human-readable title, e.g. "Triage 128 unread emails".',
            },
            step: {
              type: "string",
              description:
                '[start/update/complete] Step description, e.g. "Fetching inbox" or "Drafting reply 23/100".',
            },
            metadataJson: {
              type: "string",
              description:
                "[start] Optional JSON metadata: link, thread id, artifact path, etc.",
            },
            runId: {
              type: "string",
              description:
                '[update/complete] The id returned by a "start" action.',
            },
            percent: {
              type: "number",
              description:
                "[update] Progress 0–100. Omit if the task has no known upper bound.",
            },
            status: {
              type: "string",
              enum: ["succeeded", "failed", "cancelled"],
              description: "[complete] Terminal status for the run.",
            },
            active: {
              type: "boolean",
              description:
                "[list] When true, only return runs still in progress.",
            },
            limit: {
              type: "number",
              description: "[list] Max rows (default 20, max 200).",
            },
          },
          required: ["action"],
        },
      },
      run: async (args: Record<string, unknown>) => {
        const owner = getCurrentUser();
        const action = String(args.action ?? "");

        switch (action) {
          case "start": {
            const title = args.title ? String(args.title) : "";
            if (!title) return "Error: title is required for the start action.";
            let metadata: Record<string, unknown> | undefined;
            if (args.metadataJson) {
              try {
                metadata = JSON.parse(String(args.metadataJson));
              } catch {
                return "Error: metadataJson must be valid JSON.";
              }
            }
            const run = await startRun({
              owner,
              title,
              step: args.step ? String(args.step) : undefined,
              metadata,
            });
            return `Run started. runId=${run.id}`;
          }

          case "update": {
            const runId = String(args.runId ?? "");
            if (!runId)
              return "Error: runId is required for the update action.";
            const percent =
              args.percent == null ? undefined : Number(args.percent);
            const run = await updateRunProgress(runId, owner, {
              percent,
              step: args.step ? String(args.step) : undefined,
            });
            if (!run) return `Error: run ${runId} not found.`;
            return `Run updated (percent=${run.percent ?? "?"}, step=${run.step ?? ""}).`;
          }

          case "complete": {
            const runId = String(args.runId ?? "");
            const status = String(args.status ?? "");
            if (!runId || !status) {
              return "Error: runId and status are required for the complete action.";
            }
            const run = await completeRun(
              runId,
              owner,
              status as "succeeded" | "failed" | "cancelled",
              args.step ? { step: String(args.step) } : undefined,
            );
            if (!run) return `Error: run ${runId} not found.`;
            return `Run ${run.id} completed with status=${run.status}.`;
          }

          case "list": {
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
          }

          default:
            return `Error: unknown action "${action}". Use one of: start, update, complete, list.`;
        }
      },
    },
  };
}
