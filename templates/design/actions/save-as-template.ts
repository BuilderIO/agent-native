import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { duplicateDesignRecord } from "../server/lib/duplicate-design-record.js";

function templatesDeepLink(): string {
  return buildDeepLink({
    app: "design",
    view: "templates",
    to: "/templates",
  });
}

export default defineAction({
  description:
    "Save an accessible design as a reusable template. The template is a " +
    "frozen deep copy; later edits to the source design do not affect it.",
  schema: z.object({
    designId: z.string().describe("Source design ID to save as a template"),
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional title for the template; defaults to source title"),
    description: z
      .string()
      .optional()
      .describe("Optional template description"),
  }),
  run: async ({ designId, title, description }) => {
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error(`Design not found: ${designId}`);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;
    const source = access.resource;

    return duplicateDesignRecord({
      source,
      title: title ?? source.title,
      description: description ?? source.description,
      ownerEmail,
      orgId,
      visibility: orgId ? "org" : "private",
      isTemplate: true,
      templateMeta: { sourceDesignId: designId },
    });
  },
  link: () => ({
    url: templatesDeepLink(),
    label: "View templates",
    view: "templates",
  }),
});
