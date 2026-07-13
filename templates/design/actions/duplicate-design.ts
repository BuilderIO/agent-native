import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { duplicateDesignRecord } from "../server/lib/duplicate-design-record.js";

export default defineAction({
  description:
    "Duplicate an existing design project, creating a deep copy with new IDs " +
    "for the design and all its files. Returns the new design's ID and title.",
  schema: z.object({
    id: z.string().describe("Source design ID to duplicate"),
    title: z
      .string()
      .optional()
      .describe("Title for the copy (defaults to 'Copy of ...')"),
  }),
  run: async ({ id, title }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;
    const source = access.resource;
    const newTitle = title || `Copy of ${source.title}`;

    return duplicateDesignRecord({
      source,
      title: newTitle,
      ownerEmail,
      orgId,
      visibility: orgId ? "org" : "private",
    });
  },
});
