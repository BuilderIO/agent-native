import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  resolveDefaultDesignSystemId,
  resolveDesignSystemIdByTitle,
} from "../server/lib/design-system-defaults.js";
import { DESIGN_CREATION_METHODS } from "../server/lib/design-tracking.js";
import {
  defaultCreationMethod,
  trackDesignCreated,
} from "./_design-tracking.js";
import getDesignSystem from "./get-design-system.js";

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
    "generate-design (files + canvasFrames) or create-file. When a design " +
    "system is linked, the result includes its `agentContext`; apply it " +
    "before authoring the screen. Omit designSystemId to link the caller's " +
    "default design system; pass null for no design system, or pass " +
    "designSystemId or the exact title as `designSystem` to override.",
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
    designSystemId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Design system ID to link; omit for the caller's default, or pass null for no design system. Overrides designSystem.",
      ),
    designSystem: z
      .string()
      .optional()
      .describe(
        "Exact title of an accessible design system to link (case-insensitive, whitespace-trimmed); resolved server-side. Use designSystemId when you already have the id; the id wins if both are given.",
      ),
    creationMethod: z
      .enum(DESIGN_CREATION_METHODS)
      .optional()
      .describe(
        "Internal: set by the Design UI and import flows to record how the project was started. Agents should omit this.",
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
    {
      id: providedId,
      title,
      description,
      projectType,
      designSystemId,
      designSystem,
      creationMethod,
    },
    ctx,
  ) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    let resolvedDesignSystemId = designSystemId;
    if (resolvedDesignSystemId) {
      await assertAccess("design-system", resolvedDesignSystemId, "viewer");
    } else if (designSystemId !== null) {
      resolvedDesignSystemId =
        (designSystem
          ? await resolveDesignSystemIdByTitle(designSystem)
          : undefined) ??
        (await resolveDefaultDesignSystemId(ownerEmail)) ??
        undefined;
    }

    await db.insert(schema.designs).values({
      id,
      title,
      description: description ?? null,
      projectType: projectType ?? "prototype",
      designSystemId: resolvedDesignSystemId ?? null,
      data: "{}",
      ownerEmail,
      orgId,
      visibility: orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });

    trackDesignCreated(
      id,
      {
        creationMethod: creationMethod ?? defaultCreationMethod(ctx),
        projectType: projectType ?? "prototype",
        designSystemId: resolvedDesignSystemId,
        variantCount: 0,
      },
      ctx,
    );

    return {
      id,
      title,
      projectType,
      designSystemId: resolvedDesignSystemId ?? null,
      designSystem: await loadAgentDesignSystemContext(
        resolvedDesignSystemId,
        getDesignSystem,
        { full: true },
      ),
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
