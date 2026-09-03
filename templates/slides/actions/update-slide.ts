import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  getGenerationCreativeContext,
  mergeCreativeContextReuseLabels,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChatContextFromAction,
} from "../server/lib/deck-versions.js";
import {
  applySlideContentEdits,
  formatSlideHtml,
  type SlideContentEdit,
} from "../server/lib/slide-content-patch.js";
import {
  assertSourceSlidePreserved,
  sourceImportForDeck,
} from "../server/lib/source-import.js";
import {
  createLayoutFitRevision,
  hashSlideContent,
} from "../shared/slide-fit.js";
import { slideLabelFor, touchAgentSlidePresence } from "./_agent-presence.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { isAgentPatchCaller, withDeckLock } from "./patch-deck.js";

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

const reuseLabelSchema = z
  .object({
    itemId: z.string().min(1).optional(),
    itemVersionId: z.string().min(1).optional(),
    kind: z.string().min(1),
    label: z.string().min(1),
    dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
    elementId: z.string().min(1).optional(),
    influence: z
      .enum(["reused", "adapted", "reference-conditioned", "generated"])
      .optional(),
  })
  .superRefine((label, context) => {
    if (Boolean(label.itemId) !== Boolean(label.itemVersionId)) {
      context.addIssue({
        code: "custom",
        message: "itemId and itemVersionId must be provided together",
      });
    }
    if (
      (label.influence ?? "reference-conditioned") !== "generated" &&
      !label.itemId
    ) {
      context.addIssue({
        code: "custom",
        message: "Only generated labels may omit context item ids",
      });
    }
  });

function storedCreativeContext(value: unknown): {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: CreativeContextReuseLabel[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.contextMode !== "off" &&
    record.contextMode !== "auto" &&
    record.contextMode !== "pinned"
  ) {
    return null;
  }
  return {
    contextMode: record.contextMode,
    contextPackId:
      typeof record.contextPackId === "string" ? record.contextPackId : null,
    reuseLabels: Array.isArray(record.reuseLabels)
      ? (record.reuseLabels as CreativeContextReuseLabel[])
      : [],
  };
}

const unresolvedPlaceholderPattern =
  /__[A-Za-z][A-Za-z0-9]*(?:[_ -][A-Za-z0-9]+)*__/g;

function assertNoNewUnresolvedPlaceholders(
  previousContent: string,
  nextContent: string,
): void {
  const previous = new Set(previousContent.match(unresolvedPlaceholderPattern));
  const introduced = [
    ...new Set(nextContent.match(unresolvedPlaceholderPattern)),
  ].filter((marker) => !previous.has(marker));
  if (introduced.length > 0) {
    throw new Error(
      `Slide edit introduced unresolved placeholder content: ${introduced.join(", ")}. Re-read the slide and preserve the existing content instead of using markers as stand-ins.`,
    );
  }
}

function styleInvariant(content: string): string {
  return content
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const protectedStyleProperties = new Set([
  "padding",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-inline",
  "display",
  "visibility",
  "content",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "word-break",
  "overflow-wrap",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "grid",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "transform",
  "clip",
  "clip-path",
  "text-indent",
  "box-sizing",
  "aspect-ratio",
  "object-fit",
  "object-position",
]);

function protectedStyleInvariant(content: string): string {
  const styleBlocks = Array.from(
    content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
    (match) => match[1] ?? "",
  );
  const inlineStyles = Array.from(
    content.matchAll(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const ruleSignatures: string[] = [];
  for (const stylesheet of styleBlocks) {
    const source = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = protectedCssDeclarations(rule[2]);
      if (declarations.length > 0) {
        ruleSignatures.push(
          `rule:${rule[1].replace(/\s+/g, " ").trim()}{${declarations.join(";")}}`,
        );
      }
    }
  }
  const inlineSignatures: string[] = [];
  let inlineIndex = 0;
  for (const style of inlineStyles) {
    const declarations = protectedCssDeclarations(style);
    if (declarations.length > 0) {
      inlineSignatures.push(`inline:${inlineIndex}{${declarations.join(";")}}`);
      inlineIndex += 1;
    }
  }
  return [...ruleSignatures.sort(), ...inlineSignatures].join("|");
}

function protectedCssDeclarations(style: string): string[] {
  const declarations: string[] = [];
  const source = style.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(
    /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g,
  )) {
    const property = match[1].toLowerCase();
    if (protectedStyleProperties.has(property) || property.startsWith("--")) {
      declarations.push(`${property}:${match[2].replace(/\s+/g, " ").trim()}`);
    }
  }
  return declarations.sort();
}

function assertStyleOnlyEdit(
  previousContent: string,
  nextContent: string,
): void {
  if (styleInvariant(previousContent) !== styleInvariant(nextContent)) {
    throw new Error(
      "Style-only slide edits must preserve text, markup, element order, and layout structure; use edits that change only CSS declarations",
    );
  }
  if (
    protectedStyleInvariant(previousContent) !==
    protectedStyleInvariant(nextContent)
  ) {
    throw new Error(
      "Style-only slide edits must preserve text, markup, and protected layout CSS; use edits that change only the requested visual CSS declarations",
    );
  }
}

export default defineAction({
  title: "Edit one Slides slide",
  description:
    "Edit exactly one Slides slide. For a focused edit or translation of current or selected text, use one literal replace item in edits with the exact text and expectedMatches=1; when view-screen already supplies the target, do not fetch the full deck, use fullContent, or wait for layout-fit. Use targeted get-deck with slideId only if the selection text is missing, truncated, ambiguous, the literal match fails, or the edit changes markup or layout; then use ordered edits and an optional baseContentHash. Use exactly one input mode: edits, legacy find/replace, or fullContent. Mixed modes are rejected and write nothing. Prefer edits over fullContent so unrelated markup is not regenerated. For style-only requests, set styleOnly=true and use edits that change only the requested CSS declarations and preserve text and layout properties; the action rejects text or markup changes and fullContent in that mode. Never use unresolved placeholder markers as stand-ins for preserved content. Content edits clear existing click-reveal metadata; style-only CSS edits preserve it because the HTML structure remains stable. Use patch-deck with the complete animations list when a content edit intentionally changes both content and reveals. Source-imported slides preserve their original images and factual copy by default. The action returns immediately after persistence; layoutFit.status=pending means the open editor will measure the new content asynchronously, and get-layout-overflows can check the returned contentHash plus layoutFitRevision later.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
    find: z
      .string()
      .optional()
      .describe("Text to find (for surgical search-replace edit)"),
    replace: z
      .string()
      .optional()
      .describe("Replacement text (default: empty string)"),
    fullContent: z
      .string()
      .optional()
      .describe("Full HTML to replace entire slide content"),
    edits: z
      .array(
        z.union([
          z.object({
            op: z.literal("replace").optional(),
            find: z.string(),
            replace: z.string(),
            all: z.boolean().optional(),
            occurrence: z.number().int().positive().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
          z.object({
            op: z.enum(["insert-before", "insert-after"]),
            marker: z.string(),
            content: z.string(),
            occurrence: z.number().int().positive().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
          z.object({
            op: z.literal("replace-between"),
            start: z.string(),
            end: z.string(),
            content: z.string(),
            includeDelimiters: z.boolean().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
          z.object({
            op: z.literal("regex-replace"),
            pattern: z.string(),
            replace: z.string(),
            flags: z.string().optional(),
            all: z.boolean().optional(),
            expectedMatches: z.number().int().nonnegative().optional(),
            required: z.boolean().optional(),
          }),
        ]),
      )
      .min(1)
      .optional()
      .describe(
        "Ordered atomic edits against the current HTML. For one selected or current text replacement, use one literal replace with the exact text and expectedMatches=1. Each edit must match unless required=false.",
      ),
    styleOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Set true for a styling-only request. Requires edits and rejects any change outside CSS declarations, including text, markup, or layout structure.",
      ),
    baseContentHash: z
      .string()
      .optional()
      .describe(
        "Optional hash returned by view-screen or get-deck for the exact slide source being patched. The edit is rejected if the source changed since it was read.",
      ),
    format: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Format the resulting HTML with Prettier before persisting it.",
      ),
    preserveSource: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Keep source-imported images and factual copy (default true). Set false only when the user explicitly asks to rewrite the source slide.",
      ),
    contextPackId: z
      .string()
      .optional()
      .describe(
        "Exact pack used for this edit; omit to inherit the deck pack.",
      ),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this edit only without changing the saved preference or deck pack.",
      ),
    reuseLabels: z
      .array(reuseLabelSchema)
      .optional()
      .default([])
      .describe("Exact context item versions that influenced this slide edit."),
  }),
  http: false,
  run: async (args, ctx) => {
    const isAgentCaller = isAgentPatchCaller(ctx?.caller);
    const {
      deckId,
      slideId,
      find,
      replace,
      fullContent,
      edits,
      baseContentHash,
      format,
      preserveSource,
      styleOnly,
      contextPackId,
      contextModeOverride,
      reuseLabels,
    } = args;
    const hasLegacyMode = find !== undefined || replace !== undefined;
    const inputModeCount =
      Number(Boolean(edits)) +
      Number(hasLegacyMode) +
      Number(fullContent !== undefined);
    if (inputModeCount === 0) {
      throw new Error("One of --edits, --find, or --fullContent is required");
    }
    if (inputModeCount > 1) {
      throw new Error(
        "Use exactly one input mode: --edits, --find/--replace, or --fullContent; do not combine modes",
      );
    }
    if (styleOnly && !edits) {
      throw new Error(
        "Style-only slide edits require --edits and cannot use --fullContent or legacy find/replace",
      );
    }
    if (replace !== undefined && find === undefined) {
      throw new Error("Legacy --replace requires --find");
    }
    if (find !== undefined && find.length === 0) {
      throw new Error("find must not be empty for legacy search/replace");
    }
    await assertAccess("deck", deckId, "editor");

    // ─── Read-modify-write under the shared per-deck lock ───────────────────
    //
    // Previously this action read the deck, edited a slide in memory, and wrote
    // the whole `decks.data` blob back with no locking — so a concurrent writer
    // (another update-slide, add-slide, or the browser's patch-deck) touching a
    // different slide of the same deck could be clobbered (last-write-wins on
    // the whole blob). Holding the SAME lock used by patch-deck/add-slide
    // serialises these writes so different-slide edits never overwrite each
    // other. The editor round-trip (fit check) runs AFTER the lock is released
    // so it never stalls concurrent writers for seconds.
    const rmw = await withDeckLock(deckId, async () => {
      const db = getDb();

      // Read SQL deck for the slide-existence check and to compute the new
      // slide HTML that we persist back into decks.data.
      const [row] = await db
        .select({
          id: schema.decks.id,
          title: schema.decks.title,
          data: schema.decks.data,
          ownerEmail: schema.decks.ownerEmail,
          designSystemId: schema.decks.designSystemId,
          updatedAt: schema.decks.updatedAt,
        })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);
      if (!row) {
        throw new Error(`Deck ${deckId} not found`);
      }

      const deck = JSON.parse(row.data);
      const existingContext = storedCreativeContext(deck.creativeContext);
      if (
        existingContext &&
        contextPackId !== undefined &&
        contextPackId !== existingContext.contextPackId
      ) {
        throw new Error(
          "The slide edit must use the deck's existing creative-context pack",
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slideIndex = Array.isArray(deck.slides)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          deck.slides.findIndex((s: any) => s.id === slideId)
        : -1;
      const slide = slideIndex >= 0 ? deck.slides[slideIndex] : undefined;
      if (!slide) {
        throw new Error(`Slide ${slideId} not found in deck ${deckId}`);
      }

      if (
        baseContentHash !== undefined &&
        hashSlideContent(String(slide.content ?? "")) !== baseContentHash
      ) {
        throw new Error(
          "Slide content changed since it was read. Call get-deck with this slideId again and rebase the patch.",
        );
      }

      // ─── Apply the edit to the slide content in decks.data ────────────────
      //
      // The agent edits the canonical slide HTML stored in `decks.data` (SQL is
      // the source of truth). The change is delivered live to any open editor
      // by the framework's normal change-sync: `notifyClients` invalidates the
      // deck query, the editor refetches, and reconciles the newer slide HTML
      // into the live view — gated on the deck's `updatedAt` so a lagging poll
      // never reverts an in-progress human edit, and (for the Yjs-backed inline
      // editor) applied through the editor's real content pipeline so new block
      // structure renders and merges with concurrent typing via the Yjs CRDT.
      let applied = false;
      let notFound = false;
      // Per-edit outcomes for the `edits` batch (e.g. "insert-after:0" means
      // that edit's marker matched nothing and it silently no-opped). Stays
      // undefined for the legacy fullContent/find paths, which have no
      // per-edit breakdown to report.
      let editResults: string[] | undefined;
      const previousContent = String(slide.content ?? "");
      const validateNextContent = (nextContent: string) => {
        assertNoNewUnresolvedPlaceholders(previousContent, nextContent);
        if (styleOnly) {
          assertStyleOnlyEdit(previousContent, nextContent);
        }
        assertSourceSlidePreserved({
          metadata: sourceImportForDeck(deck.sourceImport),
          slideId,
          nextContent,
          preserveSource,
        });
      };

      if (fullContent !== undefined) {
        const nextContent = normalizeSlidePadding(fullContent);
        validateNextContent(nextContent);
        slide.content = nextContent;
        applied = nextContent !== previousContent;
      } else if (edits) {
        const sourceContent = format
          ? await formatSlideHtml(previousContent)
          : previousContent;
        const patched = await applySlideContentEdits(
          sourceContent,
          edits as SlideContentEdit[],
          format,
        );
        const nextContent = styleOnly
          ? patched.content
          : normalizeSlidePadding(patched.content);
        validateNextContent(nextContent);
        slide.content = nextContent;
        applied = patched.changed;
        editResults = patched.applied;
        if (!applied) slide.content = previousContent;
      } else if (find !== undefined) {
        const idx = previousContent.indexOf(find);
        if (idx === -1) {
          notFound = true;
        } else {
          const nextContent =
            previousContent.slice(0, idx) +
            (replace ?? "") +
            previousContent.slice(idx + find.length);
          validateNextContent(nextContent);
          slide.content = nextContent;
          applied = nextContent !== previousContent;
        }
      }

      if (applied) {
        slide.layoutFitRevision = createLayoutFitRevision();
        if (isAgentCaller) delete slide.layoutWarningDismissed;
      }

      // Animation targets are paths into the persisted HTML. A content edit
      // can keep every path valid while changing which visual element lives at
      // that path, so preserving the old list would reveal the wrong content.
      // patch-deck is the explicit escape hatch when content and animations
      // are intentionally revised together.
      if (applied && Array.isArray(slide.animations) && !styleOnly) {
        delete slide.animations;
      }

      // ─── Persist to SQL ───────────────────────────────────────────────────
      //
      // The fresh `updatedAt` (on both the deck JSON and the row) is the signal
      // an open editor uses to tell an intentional external edit apart from a
      // stale poll echo — only a newer timestamp is reconciled into the view.
      if (applied) {
        const effectivePackId = contextPackId ?? existingContext?.contextPackId;
        const requestedLabels: CreativeContextReuseLabel[] = reuseLabels.length
          ? reuseLabels
          : [
              {
                kind: "slide",
                label: "Net-new slide edit",
                dataRole: "untrusted-reference",
                elementId: slideId,
                influence: "generated",
              },
            ];
        const validated = await validateGenerationCreativeContext({
          contextPackId: effectivePackId,
          contextPackSource:
            contextPackId === undefined ? "inherited" : "explicit",
          contextModeOverride,
          reuseLabels: requestedLabels,
          reuseLabelsSource: reuseLabels.length ? "explicit" : "inherited",
        });
        const contextMode =
          validated.contextMode === "off"
            ? "off"
            : (existingContext?.contextMode ?? validated.contextMode);
        const slideReuseLabels = validated.reuseLabels.map((label) => ({
          ...label,
          elementId: slideId,
        }));
        const mergedReuseLabels = mergeCreativeContextReuseLabels(
          existingContext?.reuseLabels ?? [],
          slideReuseLabels,
        );
        const previous =
          contextMode === "off"
            ? null
            : await getGenerationCreativeContext({
                appId: "slides",
                artifactType: "deck",
                artifactId: deckId,
              });
        const editedElementProvenance = slideReuseLabels.map((label) => ({
          elementId: slideId,
          influence: label.influence ?? ("reference-conditioned" as const),
          ...(label.itemId ? { itemId: label.itemId } : {}),
          ...(label.itemVersionId
            ? { itemVersionId: label.itemVersionId }
            : {}),
          label: label.label,
        }));
        const elementProvenance =
          contextMode === "off"
            ? editedElementProvenance
            : replaceCreativeContextElementProvenance(
                previous?.elementProvenance ?? [],
                editedElementProvenance,
              );
        slide.creativeContextReuseLabels = slideReuseLabels;
        deck.creativeContext =
          contextMode === "off" && existingContext
            ? existingContext
            : {
                contextMode,
                contextPackId: validated.contextPackId,
                reuseLabels: mergedReuseLabels,
              };
        const now = nextDeckRevision(row.updatedAt);
        deck.updatedAt = now;
        await db.transaction(async (tx: any) => {
          await createDeckVersionSnapshot(
            {
              id: row.id,
              title: row.title ?? "Untitled",
              data: row.data ?? "",
              ownerEmail: row.ownerEmail ?? "",
            },
            {
              force: isAgentPatchCaller(ctx?.caller),
              chatContext: deckVersionChatContextFromAction(ctx),
              label: "Before slide edit",
              db: tx,
            },
          );
          const updateResult = await tx
            .update(schema.decks)
            .set({ data: JSON.stringify(deck), updatedAt: now })
            .where(deckRevisionWhere(schema.decks, deckId, row.updatedAt));
          assertDeckWriteApplied(updateResult, deckId, "slide edit");
          await recordGenerationCreativeContext(
            {
              appId: "slides",
              artifactType: "deck",
              artifactId: deckId,
              contextMode,
              contextPackId: validated.contextPackId,
              reuseLabels:
                contextMode === "off" ? slideReuseLabels : mergedReuseLabels,
              elementProvenance,
            },
            { db: tx },
          );
        });
        return {
          applied,
          notFound,
          editResults,
          slide,
          slideIndex,
          contentHash: hashSlideContent(String(slide.content ?? "")),
          layoutFitRevision: slide.layoutFitRevision,
          contextMode,
          contextPackId: validated.contextPackId,
          reuseLabels: slideReuseLabels,
        };
      }

      return {
        applied,
        notFound,
        editResults,
        slide,
        slideIndex,
        contentHash: hashSlideContent(String(slide.content ?? "")),
        layoutFitRevision: slide.layoutFitRevision,
      };
    });

    // ─── Non-write exits must THROW, not return ───────────────────────────
    //
    // Returning any value — `{ ok: false }` included — is indistinguishable
    // from a successful write to everything above this action. `isError` is
    // set only from the runner's catch, so a returned no-op is stamped
    // `completedSideEffect: true` and the journal later replays it to a
    // resumed run under "Already completed (do NOT re-run these — their side
    // effects already happened)". It is also invisible to the repeat
    // breakers, which is how one production thread ran 20 consecutive
    // identical "text not found" calls without one firing. Throwing is the
    // only channel that says "the deck was not modified", and it is already
    // this file's idiom for the stale-hash rejection above.
    if (rmw.notFound) {
      throw new Error(
        `Nothing was written: text not found in slide: "${find!.slice(0, 60)}". Current slide contentHash is ${rmw.contentHash}; call get-deck with this slideId and rebase the patch against the current HTML.`,
      );
    }

    const { applied, editResults } = rmw;
    const unmatched = (editResults ?? []).filter((entry) =>
      entry.endsWith(":0"),
    );
    if (!applied) {
      throw new Error(
        unmatched.length
          ? `Nothing was written: ${unmatched.join(", ")} matched no text in the slide. Current slide contentHash is ${rmw.contentHash}; call get-deck with this slideId and rebase the patch against the current HTML.`
          : `Nothing was written: the result is identical to the current slide content (contentHash ${rmw.contentHash}). The slide already says what this edit would have made it say.`,
      );
    }

    // Best-effort presence: light the agent up on this slide in open editors
    // and drop a lingering "AI edited" highlight. Never blocks or fails the
    // write (touchAgentSlidePresence swallows its own errors).
    if (applied) {
      touchAgentSlidePresence({
        deckId,
        slideId,
        label: slideLabelFor(rmw.slide, rmw.slideIndex),
      });
    }

    // Extend the SSE payload with the changed slideId + agent actor so the
    // client can attribute the edit. Backwards-compatible: consumers reading
    // only { type, deckId } are unaffected.
    notifyClients(deckId, { slideId, actor: "agent" });

    console.log(
      `update-slide: deck=${deckId} slide=${slideId} ${edits ? `edits=${edits.length}` : find !== undefined ? `find="${find.slice(0, 40)}"` : "fullContent"} applied=${applied}`,
    );

    const base = {
      ok: true,
      deckId,
      slideId,
      applied,
      editResults,
      ...(unmatched.length
        ? {
            partial: true,
            message: `Applied, but ${unmatched.join(", ")} matched no text and was skipped — do not report those parts as done.`,
          }
        : {}),
      contentHash: rmw.contentHash,
      layoutFit: {
        status: "pending" as const,
        slideId,
        contentHash: rmw.contentHash,
        layoutFitRevision: rmw.layoutFitRevision,
      },
      deepLink: deckDeepLink(deckId),
      ...(rmw.contextMode
        ? {
            contextMode: rmw.contextMode,
            contextPackId: rmw.contextPackId,
            reuseLabels: rmw.reuseLabels,
          }
        : {}),
    };

    return base;
  },
  link: ({ result, args }) => {
    const deckId =
      result && typeof result === "object"
        ? ((result as { deckId?: string }).deckId ??
          (typeof args.deckId === "string" ? args.deckId : undefined))
        : typeof args.deckId === "string"
          ? args.deckId
          : undefined;
    if (!deckId) return null;
    return {
      url: deckDeepLink(deckId),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
