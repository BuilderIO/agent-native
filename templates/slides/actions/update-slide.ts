import { defineAction } from "@agent-native/core";
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
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import { slideLabelFor, touchAgentSlidePresence } from "./_agent-presence.js";
import {
  awaitLayoutFitCheck,
  formatOverflowForTool,
} from "./_await-fit-check.js";
import { withDeckLock } from "./patch-deck.js";

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

export default defineAction({
  description:
    "Surgically edit a slide's content using search-replace or full replacement. " +
    "Syncs live to open editors. Prefer this over full deck rewrites.",
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
  run: async (args) => {
    const {
      deckId,
      slideId,
      find,
      replace,
      fullContent,
      contextPackId,
      contextModeOverride,
      reuseLabels,
    } = args;
    if (!find && !fullContent) {
      throw new Error("Either --find or --fullContent is required");
    }
    const fitSince = Date.now();

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

      if (fullContent) {
        slide.content = normalizeSlidePadding(fullContent);
        applied = true;
      } else if (find) {
        const idx = (slide.content as string).indexOf(find);
        if (idx === -1) {
          notFound = true;
        } else {
          slide.content =
            slide.content.slice(0, idx) +
            (replace ?? "") +
            slide.content.slice(idx + find.length);
          applied = true;
        }
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
        await createDeckVersionSnapshot(
          {
            id: row.id,
            title: row.title ?? "Untitled",
            data: row.data ?? "",
            ownerEmail: row.ownerEmail ?? "",
          },
          { label: "Before slide edit" },
        );
        const now = new Date().toISOString();
        deck.updatedAt = now;
        await db.transaction(async (tx: any) => {
          await tx
            .update(schema.decks)
            .set({ data: JSON.stringify(deck), updatedAt: now })
            .where(eq(schema.decks.id, deckId));
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
          slide,
          slideIndex,
          contextMode,
          contextPackId: validated.contextPackId,
          reuseLabels: slideReuseLabels,
        };
      }

      return { applied, notFound, slide, slideIndex };
    });

    if (rmw.notFound) {
      return {
        ok: false,
        message: `Text not found in slide: "${find!.slice(0, 60)}". Use get-deck to see current slide content.`,
      };
    }

    const { applied } = rmw;

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
      `update-slide: deck=${deckId} slide=${slideId} ${find ? `find="${find.slice(0, 40)}"` : "fullContent"} applied=${applied}`,
    );

    // Wait briefly for the editor to re-render and measure. If the patched
    // slide still overflows, surface the new measurement so the agent can
    // tighten further. Timeout = no editor open / nothing to measure.
    const fit = await awaitLayoutFitCheck(slideId, fitSince, 4000);

    const base = {
      ok: true,
      deckId,
      slideId,
      applied,
      deepLink: deckDeepLink(deckId),
      ...(rmw.contextMode
        ? {
            contextMode: rmw.contextMode,
            contextPackId: rmw.contextPackId,
            reuseLabels: rmw.reuseLabels,
          }
        : {}),
    };

    if (fit.status === "overflows") {
      return {
        ...base,
        layoutOverflow: {
          verticalOverflow: fit.measurement.verticalOverflow,
          contentHeight: fit.measurement.contentHeight,
          viewportHeight: fit.measurement.viewportHeight,
        },
        message: formatOverflowForTool(deckId, fit.measurement),
      };
    }

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
