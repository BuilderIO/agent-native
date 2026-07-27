import { defineAction } from "@agent-native/core";
import { resolveIntegrationSourceContext } from "@agent-native/core/integrations";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Resolve trusted Slack source provenance for an integration task owned by the authenticated caller.",
  schema: z.object({
    integrationTaskId: z
      .string()
      .min(1)
      .max(256)
      .describe("Opaque integration task id"),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    isConsequential: false,
  },
  run: async ({ integrationTaskId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("An authenticated user is required");
    return resolveIntegrationSourceContext(
      integrationTaskId,
      ownerEmail,
      getRequestOrgId() ?? null,
    );
  },
});
