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
import getDesignSystem from "./get-design-system.js";

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
    "artifact by itself — author the screen HTML next and save it with " +
    "generate-design (files + canvasFrames) or create-file. When a design " +
    "system is linked, the result includes its `agentContext`; apply it " +
    "before authoring the screen. Omit designSystemId to link the caller's " +
    "default design system; pass designSystemId, or the exact title as " +
    "`designSystem`, to override.",
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
    designSystem: z
      .string()
      .optional()
      .describe(
        "Exact title of an accessible design system to link (case-insensitive, whitespace-trimmed); resolved server-side. Use designSystemId when you already have the id; the id wins if both are given.",
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
  run: async ({
    id: providedId,
    title,
    description,
    projectType,
    designSystemId,
    designSystem,
  }) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    let resolvedDesignSystemId = designSystemId;
    if (resolvedDesignSystemId) {
      await assertAccess("design-system", resolvedDesignSystemId, "viewer");
    } else {
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
