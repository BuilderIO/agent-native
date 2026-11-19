import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DESIGN_CREATION_METHODS } from "../server/lib/design-tracking.js";
import { designBriefsSchema } from "../shared/design-briefs.js";
import {
  defaultCreationMethod,
  trackDesignCreated,
} from "./_design-tracking.js";

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
    "artifact by itself — author the screen HTML next and save it with " +
    "generate-design (files + canvasFrames) or create-file.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe(
        "Optional pre-generated UI ID. Agents should omit this and use the ID returned by the successful action.",
      ),
    title: z
      .string()
      .describe(
        "A concise, specific project name derived from the user's request. Never use a placeholder such as 'Untitled Design'.",
      ),
    description: z
      .string()
      .optional()
      .describe("Short description of the design project"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .default("prototype")
      .describe("Type of design project"),
    creationMethod: z
      .enum(DESIGN_CREATION_METHODS)
      .optional()
      .describe(
        "Internal: set by the Design UI and import flows to record how the project was started. Agents should omit this.",
      ),
    briefs: designBriefsSchema
      .optional()
      .describe(
        "Content pages this design is built from, each with its id and http(s) link. The Design UI sets this when a Content page is attached to the prompt; agents may pass a page they read as the brief.",
      ),
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    { id: providedId, title, description, projectType, creationMethod, briefs },
    ctx,
  ) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    await db.insert(schema.designs).values({
      id,
      title,
      description: description ?? null,
      projectType: projectType ?? "prototype",
      data: briefs?.length ? JSON.stringify({ briefs }) : "{}",
      ownerEmail,
      orgId,
      visibility: orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });

    await trackDesignCreated(
      id,
      {
        creationMethod: creationMethod ?? defaultCreationMethod(ctx),
        projectType: projectType ?? "prototype",
        variantCount: 0,
      },
      ctx,
    );

    return {
      id,
      title,
      projectType,
      renderable: false,
      nextRequiredAction:
        "Author the screen HTML, then save it with generate-design or create-file.",
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
