import { defineAction, fail } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { CLIPS_AI_REQUEST_KINDS } from "../shared/ai-request-status.js";

const STATUS_KEY_PREFIX = "clips-ai-request-status-";

export default defineAction({
  description:
    "Report progress or completion for queued Clips AI work so the recording page can show its current status.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    kind: z.enum(CLIPS_AI_REQUEST_KINDS).describe("Queued request kind"),
    requestedAt: z
      .string()
      .datetime()
      .describe("Exact timestamp of the queued request being updated"),
    status: z
      .enum(["working", "completed", "failed"])
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
    if (current.status === "completed" || current.status === "failed") {
      fail(`The ${args.kind} request is already ${current.status}.`, {
        errorCode: "request_finished",
        statusCode: 409,
      });
    }

    await writeAppState(statusKey, {
      kind: args.kind,
      status: args.status,
      message: args.message || null,
      requestedAt: args.requestedAt,
      updatedAt: new Date().toISOString(),
    });
    return {
      recordingId: args.recordingId,
      kind: args.kind,
      requestedAt: args.requestedAt,
      status: args.status,
    };
  },
});
