import { defineAction } from "@agent-native/core/action";
import {
  callerHasThreadAccess,
  getCurrentTurnRunEventsForThread,
  getCurrentTurnRunIdsForThread,
  getRunStatus,
  getRunTurnRef,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { isHumanCaller, trackDesign } from "../server/lib/design-tracking.js";
import { classifyDesignGenerationOutput } from "../shared/generation-output-receipt.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Read whether one completed generation turn saved output for a Design project.",
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
    runId: z.string().min(1).describe("Final run ID for the completed turn."),
    turnId: z.string().min(1).describe("Stable turn ID for that run."),
    recordReadyView: z.boolean().default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  uiOnly: true,
  run: async ({ designId, runId, turnId, recordReadyView }, ctx) => {
    try {
      const access = await resolveAccess("design", designId);
      if (!access) return { status: "unknown" as const };

      const runRef = await getRunTurnRef(runId);
      const viewerEmail = getRequestUserEmail()?.trim().toLowerCase();
      if (
        !runRef ||
        runRef.turnId !== turnId ||
        !viewerEmail ||
        !(await callerHasThreadAccess(viewerEmail, runRef.threadId, "viewer", {
          orgId: getRequestOrgId(),
        }))
      ) {
        return { status: "unknown" as const };
      }

      const [runStatus, events, runIds] = await Promise.all([
        getRunStatus(runId),
        getCurrentTurnRunEventsForThread(runRef.threadId, runRef.turnId),
        getCurrentTurnRunIdsForThread(runRef.threadId, runRef.turnId),
      ]);

      const status = classifyDesignGenerationOutput({
        designId,
        runId,
        runStatus,
        runIds,
        events,
      });
      if (
        recordReadyView &&
        status === "has_output" &&
        access.role === "owner" &&
        isHumanCaller(ctx)
      ) {
        trackDesign(
          "design_ready_viewed",
          {
            output_id: designId,
            output_type: "design",
            run_id: runId,
            turn_id: turnId,
            is_owner: true,
          },
          ctx,
        );
      }

      return {
        status,
      };
    } catch {
      return { status: "unknown" as const };
    }
  },
});
