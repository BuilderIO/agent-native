import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

export default defineAction({
  description:
    "Create a new empty design project shell. This is not a renderable " +
    "artifact by itself. For non-trivial new prompts, call " +
    "show-design-questions next and wait for the user's answers; only call " +
    "generate-design directly when the direction is already unambiguous.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe(
        "Optional pre-generated UI ID. Agents should omit this and use the ID returned by the successful action.",
      ),
    title: z.string().describe("Design project title"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design project"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .default("prototype")
      .describe("Type of design project"),
    designSystemId: z
      .string()
      .optional()
      .describe("Design system ID to link to this design"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design project",
      description: "Open the new design project in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({
    id: providedId,
    title,
    description,
    projectType,
    designSystemId,
  }) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

    await db.insert(schema.designs).values({
      id,
      title,
      description: description ?? null,
      projectType: projectType ?? "prototype",
      designSystemId: designSystemId ?? null,
      data: "{}",
      ownerEmail,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      title,
      projectType,
      renderable: false,
      nextRequiredAction:
        "show-design-questions for non-trivial new prompts, then generate-design or present-design-variants after the user answers",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { id?: string }).id;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
