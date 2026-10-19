import { defineAction, fail } from "@agent-native/core/action";
import {
  FeatureNotConfiguredError,
  indexBuilderDesignSystem,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";
import { assertDesignSystemWorkflowsEnabled } from "../server/lib/design-system-workflows.js";

export default defineAction({
  title: "Index uploaded design system files",
  description:
    "Finish Builder DSI indexing for files uploaded through the design-system upload flow. Pass the upload tokens returned for those files and an optional design-system name.",
  schema: z.object({
    projectName: z
      .string()
      .trim()
      .optional()
      .describe("Optional name for the design system being indexed"),
    uploadTokens: z
      .array(z.string().trim().min(1))
      .min(1)
      .describe("Upload tokens returned by the authenticated file-upload flow"),
  }),
  agentTool: false,
  retrySafe: false,
  run: async ({ projectName, uploadTokens }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in before indexing uploaded design-system files.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    await assertDesignSystemWorkflowsEnabled();

    let result: Awaited<ReturnType<typeof indexBuilderDesignSystem>>;
    try {
      result = await indexBuilderDesignSystem({
        sources: uploadTokens.map((uploadToken) => ({
          kind: "file" as const,
          uploadToken,
        })),
        projectName,
      });
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
    const proxy = await upsertBuilderProxyDesignSystem({
      result,
      ownerEmail,
      orgId: getRequestOrgId(),
      projectName,
      sourceKind: "figma",
    });

    return {
      ...result,
      ...proxy,
      uploadedFileCount: uploadTokens.length,
    };
  },
});
