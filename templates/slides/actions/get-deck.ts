import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAnimationSummary(value: unknown) {
  if (!Array.isArray(value)) return null;
  return {
    count: value.length,
    steps: value.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { order: index + 1, valid: false };
      }
      const animation = entry as Record<string, unknown>;
      return {
        order: index + 1,
        id: typeof animation.id === "string" ? animation.id : null,
        elementIndex:
          typeof animation.elementIndex === "number"
            ? animation.elementIndex
            : null,
        elementPath: Array.isArray(animation.elementPath)
          ? animation.elementPath
          : null,
        type: typeof animation.type === "string" ? animation.type : null,
      };
    }),
  };
}

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export default defineAction({
  description:
    "Get a specific deck. Agent calls return compact slide metadata by default; set compact=false when full slide HTML is needed for an edit. Frontend and CLI reads remain full unless compact=true. User-visible slide numbers are 1-based and match the UI: slide 1 is the first slide. Use slideId for edits.",
  timeoutMs: 60_000,
  schema: z.object({
    id: z.string().optional().describe("Deck ID (required)"),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact slide summaries, or 'false' for full slide HTML. Agent calls default to compact output.",
      ),
  }),
  http: { method: "GET" },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Deck preview",
      description: "Open the deck in the real Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open deck",
      height: 680,
    }),
  },
  run: async (args, ctx) => {
    if (!args.id) {
      throw new Error("--id is required.");
    }

    const access = await resolveAccess("deck", args.id);
    if (!access) {
      // 404 rather than 403/500 so HTTP callers can't probe for decks they
      // can't see, and so the slide preview can tell "missing" from "broken".
      throw Object.assign(new Error("Deck not found"), { statusCode: 404 });
    }

    const row = access.resource;
    const data = JSON.parse(row.data);
    const slides = data?.slides || [];
    const ownerEmail = getRequestUserEmail();

    const compact =
      args.compact === "true" ||
      (args.compact === undefined && ctx?.caller === "tool");

    if (compact) {
      return {
        id: row.id,
        title: row.title || data?.title,
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        sourceImport: data?.sourceImport
          ? {
              mode: data.sourceImport.mode,
              format: data.sourceImport.format,
              fidelity: data.sourceImport.fidelity,
              slideCount: data.sourceImport.slideCount,
              slideIds: data.sourceImport.slideIds,
              ...(typeof data.sourceImport.imagesSkipped === "number"
                ? { imagesSkipped: data.sourceImport.imagesSkipped }
                : {}),
            }
          : null,
        slideCount: slides.length,
        slideNumbering:
          'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
        deepLink: deckDeepLink(row.id),
        slides: slides.map((s: any, i: number) => ({
          slideNumber: i + 1,
          zeroBasedIndex: i,
          id: s.id,
          layout: s.layout ?? null,
          transition: s.transition ?? null,
          animations: compactAnimationSummary(s.animations),
          textPreview: stripHtml(s.content || "").slice(0, 120),
        })),
      };
    }

    return {
      ...data,
      id: row.id,
      title: row.title || data?.title,
      visibility: row.visibility,
      createdByMe: ownerEmail ? row.ownerEmail === ownerEmail : false,
      designSystemId: row.designSystemId ?? null,
      slideCount: slides.length,
      slideNumbering:
        'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
      createdAt:
        typeof data.createdAt === "string" ? data.createdAt : row.createdAt,
      updatedAt: row.updatedAt,
      deepLink: deckDeepLink(row.id),
      slides: slides.map((s: any, i: number) => ({
        ...s,
        slideNumber: i + 1,
        zeroBasedIndex: i,
        id: s.id,
        layout: s.layout ?? null,
        content: s.content,
        notes: s.notes ?? null,
      })),
    };
  },
  link: ({ result, args }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : typeof args.id === "string"
          ? args.id
          : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
