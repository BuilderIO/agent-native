import { defineAction, fail } from "@agent-native/core/action";
import {
  FeatureNotConfiguredError,
  fetchBuilderDesignSystemDecodeJobStatus,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

export default defineAction({
  title: "Get design-system decode status",
  description:
    "Read Builder decode-job progress for a design system the current user can view.",
  schema: z.object({
    designSystemId: z
      .string()
      .min(1)
      .describe("Local design-system id returned by Builder indexing"),
  }),
  readOnly: true,
  retrySafe: true,
  http: { method: "GET" },
  agentTool: false,
  run: async ({ designSystemId }) => {
    const access = await assertAccess(
      "design-system",
      designSystemId,
      "viewer",
    );
    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference) {
      fail("This design system is not backed by Builder indexing.", {
        errorCode: "not_builder_design_system",
        statusCode: 404,
      });
    }

    try {
      return await fetchBuilderDesignSystemDecodeJobStatus(
        reference.builderJobId,
      );
    } catch (error) {
      if (error instanceof FeatureNotConfiguredError) {
        fail(error.message, {
          errorCode: "builder_not_configured",
          statusCode: 412,
          ...(error.builderConnectUrl
            ? { details: { builderConnectUrl: error.builderConnectUrl } }
            : {}),
        });
      }
      throw error;
    }
  },
});
