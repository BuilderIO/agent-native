import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { formatSlideHtml } from "../server/lib/slide-content-patch.js";
import { summarizeSlideAnimationTargets } from "../server/lib/validate-slide-animations.js";
import { normalizeOwnerEmail } from "../shared/ownership.js";
import { hashSlideContent } from "../shared/slide-fit.js";
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

function compactAnimationSummary(value: unknown, content: string) {
  if (!Array.isArray(value)) return null;
  const targetSummaries = summarizeSlideAnimationTargets(content, value);
  return {
    count: value.length,
    steps: value.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { order: index + 1, valid: false };
      }
      const animation = entry as Record<string, unknown>;
      const targetSummary = targetSummaries[index];
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
        targetPreview: targetSummary?.targetPreview ?? null,
        resolvedPath: targetSummary?.resolvedPath ?? null,
        targetValid: targetSummary?.targetValid ?? false,
        targetIssue: targetSummary
          ? targetSummary.targetIssue
          : "target-not-found",
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
    "Get a specific deck. Pass slideId to return only that slide; targeted agent reads include full HTML by default. In-app agent calls without slideId return compact slide metadata by default; set compact=false when full deck HTML is needed. Frontend and CLI reads remain full unless compact=true. User-visible slide numbers are 1-based and match the UI: slide 1 is the first slide. Use slideId for edits.",
  timeoutMs: 60_000,
  schema: z.object({
    id: z.string().optional().describe("Deck ID (required)"),
    slideId: z
      .string()
      .optional()
      .describe(
        "Optional stable slide ID. When set, return only that slide for a targeted read.",
      ),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' for compact slide summaries, or 'false' for full slide HTML. In-app agent calls without slideId default to compact output.",
      ),
    format: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "Set to 'true' to return full slide HTML formatted with Prettier for code-style patches. The contentHash still identifies the persisted source.",
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
    const normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
    const selectedSlideIndex =
      args.slideId === undefined
        ? -1
        : slides.findIndex((slide: any) => slide?.id === args.slideId);

    if (args.slideId !== undefined && selectedSlideIndex < 0) {
      throw Object.assign(new Error(`Slide not found: ${args.slideId}`), {
        statusCode: 404,
      });
    }

    const selectedSlide =
      selectedSlideIndex >= 0 ? slides[selectedSlideIndex] : null;
    const slideEntries: Array<{ slide: any; index: number }> =
      selectedSlideIndex >= 0
        ? [{ slide: selectedSlide, index: selectedSlideIndex }]
        : slides.map((slide: any, index: number) => ({ slide, index }));

    const compact =
      args.compact === "true" ||
      (args.compact === undefined &&
        ctx?.caller === "tool" &&
        selectedSlideIndex < 0);

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
        ...(selectedSlide ? { selectedSlideId: selectedSlide.id } : {}),
        slides: slideEntries.map(({ slide: s, index: i }) => ({
          slideNumber: i + 1,
          zeroBasedIndex: i,
          id: s.id,
          layout: s.layout ?? null,
          transition: s.transition ?? null,
          animations: compactAnimationSummary(
            s.animations,
            typeof s.content === "string" ? s.content : "",
          ),
          textPreview: stripHtml(s.content || "").slice(0, 120),
        })),
      };
    }

    const deckMetadata = { ...data };
    delete deckMetadata.slides;

    const formatHtml = args.format === "true";
    const fullSlides = await Promise.all(
      slideEntries.map(async ({ slide: s, index: i }) => ({
        ...s,
        slideNumber: i + 1,
        zeroBasedIndex: i,
        id: s.id,
        layout: s.layout ?? null,
        content: formatHtml
          ? await formatSlideHtml(String(s.content ?? ""))
          : s.content,
        contentHash: hashSlideContent(String(s.content ?? "")),
        notes: s.notes ?? null,
      })),
    );

    return {
      ...deckMetadata,
      id: row.id,
      title: row.title || data?.title,
      visibility: row.visibility,
      createdByMe:
        normalizedOwnerEmail !== null &&
        normalizeOwnerEmail(row.ownerEmail) === normalizedOwnerEmail,
      designSystemId: row.designSystemId ?? null,
      slideCount: slides.length,
      slideNumbering:
        'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
      createdAt:
        typeof data.createdAt === "string" ? data.createdAt : row.createdAt,
      updatedAt: row.updatedAt,
      deepLink: deckDeepLink(row.id),
      ...(selectedSlide ? { selectedSlideId: selectedSlide.id } : {}),
      slides: fullSlides,
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
