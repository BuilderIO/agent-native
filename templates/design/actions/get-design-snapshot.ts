import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { schema } from "../server/db/index.js";
import { buildDesignSnapshot } from "../server/lib/design-snapshot.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

const MCP_APP_FRAME_DOMAINS = [
  "https:",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

export default defineAction({
  description:
    "Get the CURRENT state of a design for an external agent to continue " +
    "from. Returns live file contents (Yjs collab text when a file is being " +
    "edited live, otherwise the stored content), the design's tweak " +
    "definitions, the user's applied tweak selections, and the resolved CSS " +
    "custom-property values so the agent sees the *tuned* design, not the " +
    "original generated tokens. Read-only.",
  schema: z.object({
    designId: z.string().describe("Design project ID to snapshot"),
  }),
  readOnly: true,
  http: { method: "GET" },
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    resource: embedApp({
      title: "Design snapshot",
      description: "Open the current design in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      frameDomains: MCP_APP_FRAME_DOMAINS,
      height: 680,
    }),
  },
  run: async ({ designId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      return "Error: Design not found";
    }
    const design = access.resource as typeof schema.designs.$inferSelect;

    const snapshot = await buildDesignSnapshot(designId, design.data);

    return {
      designId,
      title: design.title,
      description: design.description ?? null,
      projectType: design.projectType,
      designSystemId: design.designSystemId ?? null,
      updatedAt: design.updatedAt,
      files: snapshot.files.map((f) => ({
        filename: f.filename,
        fileType: f.fileType,
        content: f.content,
        source: f.source,
      })),
      fileCount: snapshot.files.length,
      tweaks: snapshot.tweaks,
      appliedTweaks: snapshot.appliedTweaks,
      resolvedCssVars: snapshot.resolvedCssVars,
      deepLink: designDeepLink(designId),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
