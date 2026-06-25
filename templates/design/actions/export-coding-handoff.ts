import { defineAction, embedApp } from "@agent-native/core";
import {
  signShortLivedToken,
  buildDeepLink,
  getAppProductionUrl,
  getRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import {
  buildCodingHandoffPrompt,
  buildRawHandoffUrl,
  normalizeHandoffFormat,
} from "../server/lib/coding-handoff.js";
import { buildDesignSnapshot } from "../server/lib/design-snapshot.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

const HANDOFF_TTL_SECONDS = 7 * 24 * 60 * 60;

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
    "Turn a design into code: create a coding-tool handoff for a design " +
    "project. Returns a tokenized raw-code URL external agents can fetch, " +
    "plus a ready-to-copy prompt. The bundle reflects the design's CURRENT " +
    "state — live editor (collab) content plus the user's applied visual " +
    "tweaks resolved into the HTML :root — so the generated code matches the " +
    "tuned design, not the original generated tokens. This is the canonical " +
    "design->code tool.",
  schema: z.object({
    id: z.string().describe("Design ID to export for coding tools"),
    origin: z
      .string()
      .optional()
      .describe(
        "Optional app origin such as https://design.agent-native.com. Used to return an absolute raw-code URL.",
      ),
    format: z
      .enum(["markdown", "json"])
      .optional()
      .default("markdown")
      .describe("Raw bundle response format for the generated URL"),
  }),
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design coding handoff",
      description: "Open the design in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({ id, origin, format }) => {
    const access = await assertAccess("design", id, "viewer");
    const design = access.resource as typeof schema.designs.$inferSelect;

    // Build from the same snapshot logic as get-design-snapshot: live collab
    // content where a file is being edited, plus resolved tweak tokens.
    const snapshot = await buildDesignSnapshot(id, design.data);

    if (snapshot.files.length === 0) {
      throw new Error("This design has no files to hand off yet");
    }

    const token = signShortLivedToken({
      resourceId: id,
      ttlSeconds: HANDOFF_TTL_SECONDS,
    });
    const handoffFormat = normalizeHandoffFormat(format);
    // External agents (MCP / A2A) that don't pass `origin` would otherwise get
    // a relative URL they can't fetch. Resolution order:
    //   1. explicit `origin` arg (caller knows best),
    //   2. the live request origin from the request context (set by the MCP
    //      layer from the inbound request — the actual local-workspace app
    //      origin, e.g. http://127.0.0.1:8085, so the signed raw-code URL is
    //      fetchable in dev/workspace setups), then
    //   3. the canonical first-party app origin (env override → registry
    //      prodUrl → platform URL → localhost) for deployed apps.
    const resolvedOrigin =
      origin || getRequestContext()?.requestOrigin || getAppProductionUrl();
    const rawUrl = buildRawHandoffUrl({
      id,
      token,
      origin: resolvedOrigin,
      format: handoffFormat,
    });
    const prompt = buildCodingHandoffPrompt({
      rawUrl,
      title: design.title,
      fileCount: snapshot.files.length,
    });

    return {
      designId: id,
      rawUrl,
      prompt,
      clipboardText: prompt,
      format: handoffFormat,
      fileCount: snapshot.files.length,
      appliedTweaks: snapshot.appliedTweaks,
      resolvedCssVars: snapshot.resolvedCssVars,
      deepLink: designDeepLink(id),
      expiresAt: new Date(
        Date.now() + HANDOFF_TTL_SECONDS * 1000,
      ).toISOString(),
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
