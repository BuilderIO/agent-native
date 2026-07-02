import { z } from "zod";

import { defineAction } from "../../../action.js";
import { appStatePut } from "../../../application-state/store.js";
import { getRequestUserEmail } from "../../../server/request-context.js";
import {
  CONTEXT_XRAY_MANIFEST_KEY,
  type ContextManifest,
} from "../../../shared/context-xray.js";
import { callerOwnsThread } from "../../run-ownership.js";
import {
  contextXrayAuthError,
  contextXrayThreadNotFoundError,
} from "./errors.js";

const reportedSegmentSchema = z.object({
  segmentId: z.string(),
  label: z.string(),
  tokenCount: z.number().int().nonnegative(),
  group: z.string().default("External context"),
  status: z
    .enum(["active", "pinned", "evicted", "summarized"])
    .default("active"),
});

export default defineAction({
  description:
    "Report an external agent host's visible context segments to Context X-Ray. External reports are advisory unless the content came from Agent-Native.",
  schema: z.object({
    threadId: z.string(),
    model: z.string().optional(),
    segments: z.array(reportedSegmentSchema).default([]),
  }),
  run: async (args): Promise<ContextManifest> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw contextXrayAuthError();
    if (!(await callerOwnsThread(ownerEmail, args.threadId))) {
      throw contextXrayThreadNotFoundError();
    }
    const rawTokens = args.segments.reduce(
      (sum, segment) => sum + segment.tokenCount,
      0,
    );
    const manifest: ContextManifest = {
      threadId: args.threadId,
      computedAt: Date.now(),
      ...(args.model ? { model: args.model } : {}),
      totalTokens: rawTokens,
      rawTokens,
      reclaimedTokens: 0,
      tokenCountMethod: "estimate",
      source: "external",
      enforceable: false,
      segments: args.segments.map((segment) => ({
        segmentId: segment.segmentId,
        type: "text",
        role: "user",
        group: segment.group,
        label: segment.label,
        tokenCount: segment.tokenCount,
        tokenMethod: "estimate",
        status: segment.status,
      })),
    };
    await appStatePut(
      args.threadId,
      CONTEXT_XRAY_MANIFEST_KEY,
      manifest as unknown as Record<string, unknown>,
      {
        requestSource: "context-xray",
      },
    );
    return manifest;
  },
});
