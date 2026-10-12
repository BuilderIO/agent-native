import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { z } from "zod";

import applyMotionEditAction from "./apply-motion-edit.js";
import getMotionTimelineAction from "./get-motion-timeline.js";
import { localhostBridgeRelayContextWithResponses } from "./motion-localhost-relay.js";
import removeMotionTimelineAction from "./remove-motion-timeline.js";
import { isLocalhostBridgeRelayRequest } from "./visual-edit-browser-request.js";

export default defineAction({
  description:
    "Continue an authorized Motion operation after a browser-local source step.",
  agentTool: false,
  schema: z
    .object({
      action: z.enum([
        "get-motion-timeline",
        "apply-motion-edit",
        "remove-motion-timeline",
      ]),
      input: z.record(z.string(), z.unknown()),
      responses: z.array(z.unknown()).max(8),
    })
    .strict(),
  run: async ({ action, input, responses }, context) => {
    if (!context || !isLocalhostBridgeRelayRequest(context)) {
      return fail(
        "Motion localhost relays can only continue from the editor browser.",
        {
          errorCode: "localhost_bridge_relay_forbidden",
          statusCode: 403,
        },
      );
    }

    const relayContext = localhostBridgeRelayContextWithResponses(
      context,
      responses as never,
    );
    if (action === "get-motion-timeline") {
      return getMotionTimelineAction.run(
        input as Parameters<typeof getMotionTimelineAction.run>[0],
        relayContext as ActionRunContext,
      );
    }
    if (action === "apply-motion-edit") {
      return applyMotionEditAction.run(
        input as Parameters<typeof applyMotionEditAction.run>[0],
        relayContext as ActionRunContext,
      );
    }
    return removeMotionTimelineAction.run(
      input as Parameters<typeof removeMotionTimelineAction.run>[0],
      relayContext as ActionRunContext,
    );
  },
});
