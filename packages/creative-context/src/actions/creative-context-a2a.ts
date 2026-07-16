import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  createCreativeContextA2AResponseToken,
  decodeCreativeContextA2ARequest,
} from "../server/isolated-a2a.js";

export default defineAction({
  description:
    "Execute one authenticated, bounded Creative Context A2A protocol request. Use only for an inbound Creative Context machine-protocol message, then return responseToken verbatim.",
  schema: z
    .object({
      requestToken: z.string().min(1).max(512_000),
    })
    .strict(),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
  },
  run: async ({ requestToken }) => {
    if (!getRequestUserEmail()) {
      throw new Error(
        "Creative Context A2A requires a cryptographically verified caller identity",
      );
    }
    const request = decodeCreativeContextA2ARequest(requestToken);
    let result: unknown;
    switch (request.operation) {
      case "resolve": {
        const { resolveGenerationCreativeContextLocal } =
          await import("../server/generation-context.js");
        result = await resolveGenerationCreativeContextLocal(request.payload);
        break;
      }
      case "validate": {
        const { validateGenerationCreativeContextLocal } =
          await import("../server/generation-context.js");
        result = await validateGenerationCreativeContextLocal(request.payload);
        break;
      }
      case "read": {
        const { getGenerationCreativeContext } =
          await import("../store/generation.js");
        result = await getGenerationCreativeContext(request.payload.identity, {
          accessScope: request.payload.accessScope,
        });
        break;
      }
      case "record": {
        const { recordGenerationCreativeContext } =
          await import("../store/generation.js");
        result = await recordGenerationCreativeContext(request.payload);
        break;
      }
    }
    const responseToken = createCreativeContextA2AResponseToken(
      request,
      result,
    );
    return {
      protocol: "creative-context-a2a-v1",
      requestId: request.requestId,
      responseToken,
      instruction: "Return responseToken verbatim and nothing else.",
    };
  },
});
