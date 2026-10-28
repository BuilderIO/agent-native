import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER,
  type LocalhostBridgeRelayResponse,
} from "../shared/visual-edit-bridge-relay.js";
import applyMotionEditAction from "./apply-motion-edit.js";
import getMotionTimelineAction from "./get-motion-timeline.js";
import {
  allMotionLocalhostRelayResponsesValidated,
  completeMotionLocalhostRelayChain,
  isActiveMotionLocalhostRelayChain,
  isLocalhostBridgeRelay,
  localhostBridgeRelayContextWithResponses,
  motionLocalhostRelayIdentity,
  withMotionLocalhostRelayIdentity,
} from "./motion-localhost-relay.js";
import removeMotionTimelineAction from "./remove-motion-timeline.js";
import { isLocalhostBridgeRelayRequest } from "./visual-edit-browser-request.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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
      chainId: z.string().regex(/^[a-f0-9-]{32,64}$/i),
    })
    .strict(),
  run: async ({ action, input, responses, chainId }, context) => {
    if (!context || !isLocalhostBridgeRelayRequest(context)) {
      return fail(
        "Motion localhost relays can only continue from the editor browser.",
        {
          errorCode: "localhost_bridge_relay_forbidden",
          statusCode: 403,
        },
      );
    }

    if (
      context.requestHeaders?.get(LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER) !==
      chainId
    ) {
      return fail("The Motion relay chain does not match this request.", {
        errorCode: "localhost_bridge_relay_chain_mismatch",
        statusCode: 409,
      });
    }

    const target =
      action === "get-motion-timeline"
        ? getMotionTimelineAction
        : action === "apply-motion-edit"
          ? applyMotionEditAction
          : removeMotionTimelineAction;
    const targetSchema = (
      target as unknown as {
        schema?: { parse(value: unknown): unknown };
      }
    ).schema;
    if (!targetSchema) {
      return fail("The Motion action schema is unavailable.", {
        errorCode: "localhost_bridge_relay_action_schema_unavailable",
        statusCode: 500,
      });
    }
    const normalizedInput = targetSchema.parse(input) as Record<
      string,
      unknown
    >;
    const identityContext = withMotionLocalhostRelayIdentity(
      { ...context, actionName: action },
      action,
      normalizedInput,
    );
    if (!identityContext) {
      return fail("The Motion relay chain identity is unavailable.", {
        errorCode: "localhost_bridge_relay_chain_invalid",
        statusCode: 400,
      });
    }
    const identity = motionLocalhostRelayIdentity(identityContext);
    if (!identity || !(await isActiveMotionLocalhostRelayChain(identity))) {
      return fail("The Motion relay chain is expired or already complete.", {
        errorCode: "localhost_bridge_relay_chain_expired",
        statusCode: 409,
      });
    }
    if (
      !Array.isArray(responses) ||
      responses.some(
        (entry) =>
          !isRecord(entry) ||
          !isLocalhostBridgeRelay(entry.relay) ||
          !isRecord(entry.result),
      )
    ) {
      return fail("The Motion relay response list is malformed.", {
        errorCode: "localhost_bridge_relay_response_invalid",
        statusCode: 400,
      });
    }
    const relayResponses = responses as LocalhostBridgeRelayResponse[];

    const relayContext = localhostBridgeRelayContextWithResponses(
      identityContext,
      relayResponses,
      identity,
    );
    let result: unknown;
    if (action === "get-motion-timeline") {
      result = await getMotionTimelineAction.run(
        normalizedInput as Parameters<typeof getMotionTimelineAction.run>[0],
        relayContext as ActionRunContext,
      );
    } else if (action === "apply-motion-edit") {
      result = await applyMotionEditAction.run(
        normalizedInput as Parameters<typeof applyMotionEditAction.run>[0],
        relayContext as ActionRunContext,
      );
    } else {
      result = await removeMotionTimelineAction.run(
        normalizedInput as Parameters<typeof removeMotionTimelineAction.run>[0],
        relayContext as ActionRunContext,
      );
    }
    if (isLocalhostBridgeRelay(result)) return result;
    if (
      !allMotionLocalhostRelayResponsesValidated(
        relayContext,
        relayResponses,
      ) ||
      !(await completeMotionLocalhostRelayChain(identity))
    ) {
      return fail("The Motion relay responses were not all consumed.", {
        errorCode: "localhost_bridge_relay_unconsumed_response",
        statusCode: 409,
      });
    }
    return result;
  },
});
