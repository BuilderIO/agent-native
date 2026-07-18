import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  provisionUserContentSpace,
  systemIdsForContentSpace,
} from "./_content-spaces.js";

export default defineAction({
  description:
    "Create a private Content workspace with its own canonical Files database.",
  schema: z.object({
    name: z.string().trim().min(1).max(200),
    requestId: z.string().trim().min(1).max(200).optional(),
  }),
  run: async ({ name, requestId }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const result = await provisionUserContentSpace(getDb(), userEmail, {
      workspaceId: requestId ?? randomUUID(),
      name,
    });
    return {
      ...result,
      filesDocumentId: systemIdsForContentSpace(result.spaceId, "files")
        .documentId,
      name,
      kind: "user" as const,
    };
  },
});
