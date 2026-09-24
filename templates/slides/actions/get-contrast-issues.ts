import { defineAction } from "@agent-native/core/action";
import { parseBuilderDesignSystemProxyReference } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  analyzeSlideContrast,
  type SlideContrastDesignSystemColors,
} from "../server/lib/slide-contrast.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";

interface DesignSystemColorsLookup {
  status: "none" | "available" | "unavailable";
  colors?: SlideContrastDesignSystemColors;
}

function readStringField(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Resolve just the flat `colors` object this audit needs. Deliberately does
 * not call the get-design-system action: that path fetches Builder docs and
 * builds agent-context prose neither of which this contrast computation
 * uses, so reading the row directly keeps the audit cheap and side-effect
 * free.
 */
async function loadDesignSystemColorsForContrast(
  designSystemId: string | null,
): Promise<DesignSystemColorsLookup> {
  if (!designSystemId) return { status: "none" };

  const access = await resolveAccess("design-system", designSystemId);
  if (!access) return { status: "unavailable" };

  const row = access.resource as { data?: string | null };
  if (parseBuilderDesignSystemProxyReference(row.data ?? null)) {
    // Builder-hosted design systems expose colors as arbitrary DSI token
    // names, not this fixed `colors.*` shape. Resolving those generically is
    // the token-fallback work this branch intentionally does not take on;
    // report unavailable so callers see "unresolved", never a guessed color.
    return { status: "unavailable" };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = row.data
      ? (JSON.parse(row.data) as Record<string, unknown>)
      : null;
  } catch {
    return { status: "unavailable" };
  }

  const colors = parsed?.colors;
  if (!colors || typeof colors !== "object") return { status: "unavailable" };
  const colorsRecord = colors as Record<string, unknown>;
  const slideDefaults = parsed?.slideDefaults;
  const slideDefaultsRecord =
    slideDefaults && typeof slideDefaults === "object"
      ? (slideDefaults as Record<string, unknown>)
      : undefined;

  return {
    status: "available",
    colors: {
      text: readStringField(colorsRecord, "text"),
      textMuted: readStringField(colorsRecord, "textMuted"),
      accent: readStringField(colorsRecord, "accent"),
      surface: readStringField(colorsRecord, "surface"),
      primary: readStringField(colorsRecord, "primary"),
      secondary: readStringField(colorsRecord, "secondary"),
      background: readStringField(colorsRecord, "background"),
      slideDefaultsBackground: readStringField(
        slideDefaultsRecord,
        "background",
      ),
    },
  };
}

export default defineAction({
  description:
    "Audit real foreground/background color combinations across a deck (or one slide) for WCAG AA text contrast, using each slide's actual inline colors and the deck's linked design system colors. Returns, per slide, failing text runs with their exact resolved colors, measured ratio, and required ratio, plus elements whose colors could not be resolved statically — treat those as unknown, never as passing. Use this as the completion signal for a 'fix contrast' request instead of a visual guess; it is the contrast analog of get-layout-overflows.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z
      .string()
      .optional()
      .describe("Optional: audit only this slide instead of the whole deck"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ deckId, slideId }) => {
    const access = await resolveAccess("deck", deckId);
    if (!access)
      throw Object.assign(new Error("Deck not found"), { statusCode: 404 });

    const row = access.resource as {
      designSystemId?: string | null;
      data: string;
    };
    const data = JSON.parse(row.data) as {
      designSystemId?: string | null;
      slides?: Array<{ id: string; content?: string; background?: string }>;
    };
    const slides = Array.isArray(data.slides) ? data.slides : [];

    if (slideId && !slides.some((slide) => slide.id === slideId)) {
      throw Object.assign(new Error(`Slide not found: ${slideId}`), {
        statusCode: 404,
      });
    }

    const linkedDesignSystemId = resolveDeckDesignSystemId(row, data);
    const designSystemLookup =
      await loadDesignSystemColorsForContrast(linkedDesignSystemId);

    const slideResults = slides
      .map((slide, index) => ({ slide, slideNumber: index + 1 }))
      .filter(({ slide }) => !slideId || slide.id === slideId)
      .map(({ slide, slideNumber }) => {
        const result = analyzeSlideContrast(String(slide.content ?? ""), {
          slideBackground: slide.background,
          designSystem:
            designSystemLookup.status === "available"
              ? designSystemLookup.colors
              : undefined,
        });
        return {
          slideId: slide.id,
          slideNumber,
          status: result.status,
          elementsChecked: result.elementsChecked,
          issues: result.issues,
          unresolvedElements: result.unresolved,
        };
      });

    const totalIssues = slideResults.reduce(
      (sum, slide) => sum + slide.issues.length,
      0,
    );
    const totalUnresolvedElements = slideResults.reduce(
      (sum, slide) => sum + slide.unresolvedElements.length,
      0,
    );
    const slidesWithNoRoot = slideResults
      .filter((slide) => slide.status === "no-root")
      .map((slide) => slide.slideId);

    return {
      deckId,
      designSystemId: linkedDesignSystemId,
      designSystemColorsResolved: designSystemLookup.status,
      slideCount: slideResults.length,
      totalIssues,
      totalUnresolvedElements,
      canClaimDeckPassesContrast:
        totalIssues === 0 &&
        totalUnresolvedElements === 0 &&
        slidesWithNoRoot.length === 0,
      slides: slideResults,
      ...(slidesWithNoRoot.length > 0
        ? {
            warning: `Slide(s) ${slidesWithNoRoot.join(", ")} have no .fmd-slide wrapper and could not be audited.`,
          }
        : {}),
      ...(totalUnresolvedElements > 0
        ? {
            guidance:
              "Some elements use colors this audit cannot resolve statically (gradients, background: currentColor, or unrecognized CSS values). Do not report the deck as passing contrast until those are reviewed manually or rewritten with a resolvable color.",
          }
        : {}),
      ...(designSystemLookup.status === "unavailable" && linkedDesignSystemId
        ? {
            designSystemWarning:
              "The linked design system's colors could not be read for this audit (for example, a Builder-hosted design system). Slides relying on --ds-* tokens without a literal fallback are reported as unresolved instead of assumed to pass.",
          }
        : {}),
    };
  },
});
