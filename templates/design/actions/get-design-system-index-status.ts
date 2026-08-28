import { defineAction } from "@agent-native/core/action";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Check Builder DSI indexing status for a design system without modifying it. Use this while a large import is processing instead of repeatedly calling the refresh action.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      throw Object.assign(new Error("Design system not found"), {
        statusCode: 404,
      });
    }

    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference) {
      return { id, isBuilderBacked: false, status: "not-builder-backed" };
    }

    const hydrated = await hydrateBuilderDesignSystemReference(reference);
    return {
      id,
      isBuilderBacked: true,
      builderDesignSystemId: reference.builderDesignSystemId,
      builderJobId: reference.builderJobId,
      status: hydrated.builderStatus ?? reference.builderStatus ?? "in-progress",
      ready:
        hydrated.builderStatus === "ready" ||
        hydrated.builderStatus === "complete" ||
        hydrated.builderStatus === "completed" ||
        hydrated.completionConfirmed === true,
      docCount: hydrated.docCount,
      tokenCount: Object.keys(hydrated.tokenValues).length,
    };
  },
});
