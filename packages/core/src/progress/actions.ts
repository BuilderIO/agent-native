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

function parseLimit(value: unknown, fallback = 20): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 200);
}

export function createProgressToolEntries(
  getCurrentUser: () => string,
): Record<string, ActionEntry> {
  return {
    "manage-progress": {
      tool: {
        description: `Track multi-step task progress visible to the user in the runs tray.

Use for non-trivial work with multiple real steps (not single-action lookups). Do NOT create single-step plans. Skip for trivial tasks that finish in one tool call.

**Discipline:**
- Exactly one task in progress at a time; never batch-complete steps after the fact — update as you go.
- Always transition pending → in_progress before completing a step.
- If the task pivots (scope change, unexpected blocker), update the current step to reflect it before continuing.
- End every run with "complete" (succeeded / failed / cancelled). Never leave a run open indefinitely.

Actions:
• "start" — Begin tracking. Returns a runId for subsequent calls. Params: title (required, short human description e.g. "Triage 42 emails"), step (optional initial step), metadataJson (optional JSON with link/thread/artifact info).
• "update" — Report progress. Call after each meaningful milestone. Params: runId (required), percent (optional 0–100 when a bound is known), step (optional current step text). Omitted fields stay unchanged.
• "complete" — Mark finished. Params: runId (required), status (required: "succeeded" | "failed" | "cancelled"), step (optional final step text). Pair with \`notify\` when the user should be alerted.
• "list" — List recent runs. Use when the user asks "what is still running" or "what did you do earlier". Params: active (optional boolean, filter to in-progress only), limit (optional number, default 20, max 200).`,
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
            if (!["succeeded", "failed", "cancelled"].includes(status)) {
              return 'Error: status must be "succeeded", "failed", or "cancelled".';
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
              limit: parseLimit(args.limit),
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
