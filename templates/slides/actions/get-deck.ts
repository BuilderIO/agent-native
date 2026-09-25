import { defineAction, embedApp, fail } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { parseHTML } from "linkedom/worker";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { formatSlideHtml } from "../server/lib/slide-content-patch.js";
import {
  sourceImportCoverage,
  sourceImportForDeck,
} from "../server/lib/source-import.js";
import { summarizeSlideAnimationTargets } from "../server/lib/validate-slide-animations.js";
import { resolveDeckDesignSystemId } from "../shared/deck-content.js";
import { normalizeOwnerEmail } from "../shared/ownership.js";
import { summarizeDeckStyle } from "../shared/representative-slide.js";
import { hashSlideContent } from "../shared/slide-fit.js";
import {
  ensureUniqueSlideIds,
  repairDeckSlideReferences,
} from "../shared/slide-ids.js";
import { getDeckUrl } from "./_app-url.js";
import getDesignSystem from "./get-design-system.js";
import { withDeckLock } from "./patch-deck.js";

const MAX_REPAIR_ATTEMPTS = 3;

async function readDeck(deckId: string) {
  const access = await resolveAccess("deck", deckId);
  if (!access) {
    // 404 rather than 403/500 so HTTP callers can't probe for decks they
    // can't see, and so the slide preview can tell "missing" from "broken".
    throw Object.assign(new Error("Deck not found"), { statusCode: 404 });
  }

  const row = access.resource;
  const data = JSON.parse(row.data);
  const normalized = ensureUniqueSlideIds(
    Array.isArray(data?.slides) ? data.slides : [],
  );
  return { row, data, ...normalized };
}

async function loadDeckWithUniqueSlideIds(deckId: string) {
  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const snapshot = await readDeck(deckId);
    if (!snapshot.changed) return { ...snapshot, repaired: false };

    const repaired = await withDeckLock(deckId, async () => {
      const lockedSnapshot = await readDeck(deckId);
      if (!lockedSnapshot.changed) {
        return { ...lockedSnapshot, repaired: false };
      }

      const repairedData = {
        ...repairDeckSlideReferences(
          lockedSnapshot.data,
          lockedSnapshot.slides,
          lockedSnapshot.originalIds,
        ),
        updatedAt: new Date().toISOString(),
      };
      const versionCondition =
        typeof lockedSnapshot.row.updatedAt !== "string"
          ? isNull(schema.decks.updatedAt)
          : eq(schema.decks.updatedAt, lockedSnapshot.row.updatedAt);
      await getDb()
        .update(schema.decks)
        .set({
          data: JSON.stringify(repairedData),
          updatedAt: repairedData.updatedAt,
        })
        .where(
          and(
            eq(schema.decks.id, lockedSnapshot.row.id),
            versionCondition,
            eq(schema.decks.data, lockedSnapshot.row.data),
          ),
        );

      const confirmed = await readDeck(deckId);
      return confirmed.changed ? null : { ...confirmed, repaired: true };
    });

    if (repaired) {
      if (repaired.repaired) await notifyClients(deckId);
      return repaired;
    }
  }

  throw new Error(`Could not repair duplicate slide IDs for deck ${deckId}.`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVisibleBackgroundClass(html: string): boolean {
  const { document } = parseHTML(html);
  const attributeMatches = (
    type: string,
    value: string | null | undefined,
    expected: string,
  ) =>
    type.toLowerCase() === "aria"
      ? value?.toLowerCase() === expected.toLowerCase()
      : value === expected;

  return Array.from(document.querySelectorAll("*")).some((element) => {
    const classNames =
      element.getAttribute("class") ?? element.getAttribute("className") ?? "";
    return classNames.split(/\s+/).some((className) => {
      const variants =
        className.match(
          /^(?:(?:[\w-]+(?:-\[[^\]]+\])?(?:\/[\w-]+)?|\[[^\]]+\]):)+/,
        )?.[0] ?? "";
      const variantNames =
        variants.slice(0, -1).match(/(?:\[[^\]]*\]|[^:])+/g) ?? [];
      const hasInactiveState = variantNames.some((variant) => {
        const selectorVariant = variant.match(/^(has|not)-\[(.+)\]$/i);
        if (selectorVariant) {
          const [, mode, selector] = selectorVariant;
          const matches =
            mode.toLowerCase() === "has"
              ? element.matches(`:has(${selector.replaceAll("_", " ")})`)
              : element.matches(selector.replaceAll("_", " "));
          return mode.toLowerCase() === "has" ? !matches : matches;
        }

        const relatedAttribute = variant.match(
          /^(group|peer)-(aria|data)-\[([\w-]+)=([^\]]+)\](?:\/([\w-]+))?$/i,
        );
        if (relatedAttribute) {
          const [
            ,
            relation,
            attributeType,
            attributeName,
            rawExpected,
            relationName,
          ] = relatedAttribute;
          const attributeNameWithType = `${attributeType}-${attributeName}`;
          const relationClass = `${relation.toLowerCase()}${relationName ? `/${relationName}` : ""}`;
          const expected = rawExpected.replace(/^['"]|['"]$/g, "");
          const matches = (candidate: Element | null | undefined) =>
            attributeMatches(
              attributeType,
              candidate?.getAttribute(attributeNameWithType),
              expected,
            );
          if (relation.toLowerCase() === "group") {
            for (
              let ancestor = element.parentElement;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              if (
                ancestor.classList.contains(relationClass) &&
                matches(ancestor)
              ) {
                return false;
              }
            }
            return true;
          }

          for (
            let sibling = element.previousElementSibling;
            sibling;
            sibling = sibling.previousElementSibling
          ) {
            if (sibling.classList.contains(relationClass) && matches(sibling)) {
              return false;
            }
          }
          return true;
        }

        // ponytail: dynamic group/peer pseudo states remain unknown; extend related-node checks as needed.
        if (
          /^(?:hover|focus(?:-visible|-within)?|active|visited|disabled|enabled|checked|indeterminate|required|optional|valid|invalid|in-range|out-of-range|placeholder-shown|autofill|read-only|read-write|open|modal|fullscreen|target|group-.+|peer-.+|has-.+|not-.+)$/i.test(
            variant,
          )
        ) {
          return true;
        }

        const aria = variant.match(/^aria-([\w-]+)$/i);
        if (aria) {
          const name = `aria-${aria[1]}`;
          const expected =
            aria[1].toLowerCase() === "current" ? "page" : "true";
          return !attributeMatches(
            "aria",
            element.getAttribute(name),
            expected,
          );
        }

        const attribute = variant.match(/^(aria|data)-\[([\w-]+)=([^\]]+)\]$/i);
        if (attribute) {
          const name = `${attribute[1]}-${attribute[2]}`;
          const expected = attribute[3].replace(/^['"]|['"]$/g, "");
          return !attributeMatches(
            attribute[1],
            element.getAttribute(name),
            expected,
          );
        }

        return /^(?:aria|data)-/i.test(variant);
      });
      if (hasInactiveState) {
        return false;
      }
      return /^bg-(?!(?:none|transparent)(?:\/|$)|opacity-|clip-|origin-|blend-|repeat(?:-|\/|$)|size-|position-|attachment-|(?:auto|cover|contain|fixed|local|scroll|center|top|bottom|left|right|no-repeat)(?:\/|$))\S+/i.test(
        className.slice(variants.length),
      );
    });
  });
}

function isBlankSlideContent(html: string): boolean {
  if (stripHtml(html)) return false;
  return !(
    hasVisibleBackgroundClass(html) ||
    /<(?:img|svg|video|canvas|table|iframe|object|embed)\b|data-slide-object-id|fmd-img-placeholder/i.test(
      html,
    ) ||
    /(?:background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|box-shadow)\s*:\s*(?!none\b|transparent\b)/i.test(
      html,
    )
  );
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
        byParagraph:
          typeof animation.byParagraph === "boolean"
            ? animation.byParagraph
            : false,
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
  title: "Read Slides deck",
  description:
    "Read a Slides deck or selected slides. Pass the deck ID as `id` or `deckId` (either name works); pass `slideId` for one targeted read or `slideIds` with compact=false for one full read of several slides, including each slide's HTML and contentHash. Compact summaries include every slide in order and `isBlank` marks slides with no text or visible media; a blank slide still occupies its numbered position and is not missing. The result includes linked `designSystem.agentContext` when the deck has a readable design system; treat it as authoritative before authoring or restyling. If view-screen supplies an exact selectedText browser range and slide ID, do not call this without slideId for a focused text edit: call update-slide directly with one literal edits replacement and expectedMatches=1. If view-screen supplies a stable objectId for a selected element, call update-slide directly with that objectId to replace only the element's inner content. An element preview without objectId or an edit that changes markup needs a targeted read before text mutation. Use compact=true for a lightweight targeted check, or compact=false and format=true when markup or layout requires source inspection. Source imports expose provenance and sourceCoverage for verification; structural edits remain supported and clear source-import metadata. When sourceCoverage is present, do not claim completion until sourceCoverage.complete is true and its expectedSlideIds and actualSlideIds match in order. User-visible slide numbers are 1-based and match the UI. Use slideId for edits. Returns deckStyle (backgrounds, text and accent colors, fonts, heading sizes across slides, with deviating slides named) and representativeSlideId; before a structural or layout change, read that slide with slideId and compact='false' and mirror its structure and values.",
  timeoutMs: 60_000,
  schema: z
    .object({
      id: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Deck ID. `deckId` is accepted as an alias; pass either one.",
        ),
      deckId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Deck ID. Alias of `id`, matching create-deck / add-slide / update-slide / patch-deck.",
        ),
      slideId: z
        .string()
        .optional()
        .describe(
          "Optional stable slide ID. When set, return only that slide for a targeted read.",
        ),
      slideIds: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe(
          "Optional ordered stable slide IDs. With compact=false, return the full source for only these slides in one read.",
        ),
      compact: z
        .enum(["true", "false"])
        .optional()
        .describe(
          "Set to 'true' for compact slide summaries, or 'false' for full slide HTML. In-app agent calls without slideId or slideIds default to compact output.",
        ),
      format: z
        .enum(["true", "false"])
        .optional()
        .describe(
          "Set to 'true' to return full slide HTML formatted with Prettier for code-style patches. The contentHash still identifies the persisted source.",
        ),
    })
    .superRefine((args, context) => {
      if (args.slideId !== undefined && args.slideIds !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slideIds"],
          message: "Pass slideId or slideIds, not both",
        });
      }
      if (
        args.slideIds &&
        new Set(args.slideIds).size !== args.slideIds.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slideIds"],
          message: "slideIds must not contain duplicates",
        });
      }
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
    const deckId = args.deckId ?? args.id;
    if (!deckId) {
      fail("Pass the deck id as `id` or `deckId`.", {
        errorCode: "deck_id_missing",
        statusCode: 400,
      });
    }
    const { row, data, slides } = await loadDeckWithUniqueSlideIds(deckId);
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
    const slideIndexesById = new Map(
      slides.map((slide: any, index: number) => [slide?.id, index] as const),
    );
    const selectedSlideIndices = (args.slideIds ?? []).map((slideId) => {
      const index = slideIndexesById.get(slideId);
      if (index === undefined) {
        throw Object.assign(new Error(`Slide not found: ${slideId}`), {
          statusCode: 404,
        });
      }
      return index;
    });
    const slideEntries: Array<{ slide: any; index: number }> =
      selectedSlideIndex >= 0
        ? [{ slide: selectedSlide, index: selectedSlideIndex }]
        : selectedSlideIndices.length > 0
          ? selectedSlideIndices.map((index) => ({
              slide: slides[index],
              index,
            }))
          : slides.map((slide: any, index: number) => ({ slide, index }));

    const compact =
      args.compact === "true" ||
      (args.compact === undefined &&
        ctx?.caller === "tool" &&
        selectedSlideIndex < 0 &&
        selectedSlideIndices.length === 0);
    const sourceImport = sourceImportForDeck(data?.sourceImport);
    const sourceCoverage = sourceImportCoverage(
      sourceImport,
      slides.map((slide: any) => slide.id),
    );
    const linkedDesignSystemId = resolveDeckDesignSystemId(row, data);
    const designSystem = await loadAgentDesignSystemContext(
      linkedDesignSystemId,
      getDesignSystem,
    );
    const { deckStyle, representativeSlideId } = summarizeDeckStyle(
      slides as any,
      selectedSlideIndex,
    );

    if (compact) {
      return {
        id: row.id,
        title: row.title || data?.title,
        visibility: row.visibility,
        designSystemId: linkedDesignSystemId,
        designSystem,
        ...(slides.length > 0 ? { deckStyle, representativeSlideId } : {}),
        generationContext: data?.generationContext ?? null,
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
        sourceCoverage,
        slideCount: slides.length,
        appUrl: getDeckUrl(row.id),
        slideNumbering:
          'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
        deepLink: deckDeepLink(row.id),
        ...(selectedSlide ? { selectedSlideId: selectedSlide.id } : {}),
        ...(args.slideIds ? { selectedSlideIds: args.slideIds } : {}),
        slides: slideEntries.map(({ slide: s, index: i }) => ({
          slideNumber: i + 1,
          zeroBasedIndex: i,
          id: s.id,
          layout: s.layout ?? null,
          transition: s.transition ?? null,
          isBlank: isBlankSlideContent(
            typeof s.content === "string" ? s.content : "",
          ),
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
      designSystemId: linkedDesignSystemId,
      designSystem,
      ...(slides.length > 0 ? { deckStyle, representativeSlideId } : {}),
      sourceCoverage,
      slideCount: slides.length,
      appUrl: getDeckUrl(row.id),
      slideNumbering:
        'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
      createdAt:
        typeof data.createdAt === "string" ? data.createdAt : row.createdAt,
      updatedAt: row.updatedAt,
      deepLink: deckDeepLink(row.id),
      ...(selectedSlide ? { selectedSlideId: selectedSlide.id } : {}),
      ...(args.slideIds ? { selectedSlideIds: args.slideIds } : {}),
      slides: fullSlides,
    };
  },
  link: ({ result, args }) => {
    const argId =
      typeof args.deckId === "string"
        ? args.deckId
        : typeof args.id === "string"
          ? args.id
          : undefined;
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : argId;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
