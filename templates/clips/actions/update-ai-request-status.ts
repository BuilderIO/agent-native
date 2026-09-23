import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { CLIPS_AI_REQUEST_KINDS } from "../shared/ai-request-status.js";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";

export default defineAction({
  description:
    "Report progress, completion, failure, or cancellation for queued Clips AI work so the recording page can show its current status.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(CLIPS_AI_REQUEST_KINDS).describe("Queued request kind"),
    requestedAt: z
      .string()
      .datetime()
      .describe("Exact timestamp of the queued request being updated"),
    status: z
      .enum(["working", "completed", "failed", "cancelled"])
      .describe("Current request status"),
    message: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("Optional short status detail"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    const statusKey = `${STATUS_KEY_PREFIX}${args.recordingId}`;
    const current = await readAppState(statusKey);
    if (!current || typeof current.kind !== "string") {
      fail(`No active AI request exists for ${args.recordingId}.`, {
        errorCode: "request_not_found",
        statusCode: 409,
      });
    }
    if (typeof current.kind === "string" && current.kind !== args.kind) {
      fail(
        `Cannot update ${args.kind}; ${current.kind} is the active request.`,
        {
          errorCode: "request_conflict",
          statusCode: 409,
        },
      );
    }

    if (
      typeof current.requestedAt !== "string" ||
      current.requestedAt !== args.requestedAt
    ) {
      fail(`Cannot update a stale ${args.kind} request.`, {
        errorCode: "request_conflict",
        statusCode: 409,
      });
    }
    const terminalStatuses = ["completed", "failed", "cancelled"];
    if (terminalStatuses.includes(String(current.status))) {
      if (args.status === "cancelled") {
        return {
          recordingId: args.recordingId,
          kind: args.kind,
          requestedAt: args.requestedAt,
          status: current.status,
          cancelled: false,
        };
      }
      fail(`The ${args.kind} request is already ${current.status}.`, {
        errorCode: "request_finished",
        statusCode: 409,
      });
    }

    let expected = current;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = {
        kind: args.kind,
        status: args.status,
        message: args.message || null,
        requestedAt: args.requestedAt,
        updatedAt: new Date().toISOString(),
      };
      if (await compareAndSetAppState(statusKey, expected, next)) {
        return {
          recordingId: args.recordingId,
          kind: args.kind,
          requestedAt: args.requestedAt,
          status: args.status,
          cancelled: args.status === "cancelled",
        };
      }

      const latest = await readAppState(statusKey);
      if (
        latest &&
        latest.kind === args.kind &&
        latest.requestedAt === args.requestedAt &&
        terminalStatuses.includes(String(latest.status))
      ) {
        if (args.status === "cancelled") {
          return {
            recordingId: args.recordingId,
            kind: args.kind,
            requestedAt: args.requestedAt,
            status: latest.status,
            cancelled: false,
          };
        }
        fail(`The ${args.kind} request is already ${latest.status}.`, {
          errorCode: "request_finished",
          statusCode: 409,
        });
      }
      if (
        args.status !== "working" &&
        attempt < 2 &&
        latest &&
        latest.kind === args.kind &&
        latest.requestedAt === args.requestedAt &&
        ["queued", "working"].includes(String(latest.status))
      ) {
        expected = latest;
        continue;
      }
      break;
    }
    fail(`The ${args.kind} request changed before the update was saved.`, {
      errorCode: "request_conflict",
      statusCode: 409,
    });
  },
});
