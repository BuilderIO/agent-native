/**
 * patch-deck — granular, server-side read-modify-write for deck fields,
 * individual slides, slide ordering, slide deletion, and slide addition.
 *
 * All mutations run under the same per-deck lock used by `add-slide` so
 * concurrent writers touching DIFFERENT slides of the same deck never
 * silently overwrite each other's work (the last-full-PUT-wins race).
 *
 * This action is called by the client editor instead of the old full-deck PUT.
 * Agent actions (update-slide, add-slide, etc.) continue to use their own
 * dedicated actions which also use the same per-deck lock.
 */
import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeSlidePadding } from "../app/lib/normalize-slide-padding.js";
import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";

// ---------------------------------------------------------------------------
// Per-deck write lock — same pattern as add-slide.ts so all client and agent
// writes to the same deck are serialised in-process.
// ---------------------------------------------------------------------------
const LOCK_KEY = "__slidesDeckPatchLocks" as const;
type GlobalWithLocks = typeof globalThis & {
  [LOCK_KEY]?: Map<string, Promise<unknown>>;
};
const globalRef = globalThis as GlobalWithLocks;
if (!globalRef[LOCK_KEY]) {
  globalRef[LOCK_KEY] = new Map<string, Promise<unknown>>();
}
const deckLocks: Map<string, Promise<unknown>> = globalRef[LOCK_KEY]!;

export function withDeckLock<T>(
  deckId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = deckLocks.get(deckId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  deckLocks.set(deckId, next);
  next
    .finally(() => {
      if (deckLocks.get(deckId) === next) deckLocks.delete(deckId);
    })
    .catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Operation schemas
// ---------------------------------------------------------------------------

const SlideFieldsSchema = z.object({
  content: z.string().optional(),
  notes: z.string().optional(),
  background: z.string().optional(),
  layout: z.string().optional(),
  imageUrl: z.string().optional(),
  imageLoading: z.boolean().optional(),
  imagePrompt: z.string().optional(),
  excalidrawData: z.string().optional(),
  transition: z.string().optional(),
  animations: z.array(z.unknown()).optional(),
});

/** Update fields on a single existing slide */
const PatchSlideOp = z.object({
  op: z.literal("patch-slide"),
  slideId: z.string(),
  fields: SlideFieldsSchema,
});

/** Delete a single slide by ID */
const DeleteSlideOp = z.object({
  op: z.literal("delete-slide"),
  slideId: z.string(),
  allowEmpty: z.boolean().optional(),
});

/**
 * Reorder slides: send the desired ordered list of slide IDs.
 * Server reorders existing slides to match. Slides not present in the
 * orderedIds list are appended at the end (safe for concurrent adds).
 */
const ReorderSlidesOp = z.object({
  op: z.literal("reorder-slides"),
  orderedIds: z.array(z.string()),
});

/** Add a new slide. slideId must be provided by the client. */
const AddSlideOp = z.object({
  op: z.literal("add-slide"),
  slideId: z.string(),
  afterSlideId: z.string().optional(), // insert after this slide; append if absent
  fields: z
    .object({
      content: z.string(),
      notes: z.string().optional(),
      layout: z.string().optional(),
      background: z.string().optional(),
    })
    .passthrough(),
});

/** Update top-level deck fields (title, designSystemId, tweaks, etc.) */
const PatchDeckFieldsOp = z.object({
  op: z.literal("patch-deck-fields"),
  fields: z
    .object({
      title: z.string().optional(),
      designSystemId: z.string().nullable().optional(),
      tweaks: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
      aspectRatio: z.string().optional(),
      shareToken: z.string().optional(),
      visibility: z.enum(["private", "org", "public"]).optional(),
    })
    .passthrough(),
});

export const OperationSchema = z.discriminatedUnion("op", [
  PatchSlideOp,
  DeleteSlideOp,
  ReorderSlidesOp,
  AddSlideOp,
  PatchDeckFieldsOp,
]);

export type Operation = z.infer<typeof OperationSchema>;

// ---------------------------------------------------------------------------
// Core merge logic (exported for unit tests)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyOperation(deck: any, op: Operation): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides: any[] = Array.isArray(deck.slides) ? deck.slides : [];

  switch (op.op) {
    case "patch-slide": {
      const idx = slides.findIndex((s: { id: string }) => s.id === op.slideId);
      if (idx === -1) return; // slide was concurrently deleted — ignore
      const slide = slides[idx];
      const fields = op.fields;
      if (fields.content !== undefined) {
        slide.content = normalizeSlidePadding(fields.content);
      }
      if (fields.notes !== undefined) slide.notes = fields.notes;
      if (fields.background !== undefined) slide.background = fields.background;
      if (fields.layout !== undefined) slide.layout = fields.layout;
      if (fields.imageUrl !== undefined) slide.imageUrl = fields.imageUrl;
      if (fields.imageLoading !== undefined)
        slide.imageLoading = fields.imageLoading;
      if (fields.imagePrompt !== undefined)
        slide.imagePrompt = fields.imagePrompt;
      if (fields.excalidrawData !== undefined)
        slide.excalidrawData = fields.excalidrawData;
      if (fields.transition !== undefined) slide.transition = fields.transition;
      if (fields.animations !== undefined) slide.animations = fields.animations;
      break;
    }

    case "delete-slide": {
      const idx = slides.findIndex((s: { id: string }) => s.id === op.slideId);
      if (idx !== -1) slides.splice(idx, 1);
      // Ensure at least one slide remains for direct user deletes. Undoing an
      // add-slide from a legitimately empty deck opts into preserving empty.
      if (slides.length === 0 && !op.allowEmpty) {
        slides.push({
          id: `slide-${Date.now()}-fallback`,
          content: `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center;"><div style="font-size: 28px; font-weight: 600; color: rgba(255,255,255,0.4);">Double-click to edit</div></div>`,
          notes: "",
          layout: "blank",
        });
      }
      deck.slides = slides;
      break;
    }

    case "reorder-slides": {
      const { orderedIds } = op;
      const byId = new Map(slides.map((s: { id: string }) => [s.id, s]));
      // Build the new order from the client's desired order, keeping only
      // slides that actually exist in the server copy.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reordered: any[] = orderedIds
        .map((id) => byId.get(id))
        .filter(Boolean);
      // Append any slides the server has but the client didn't include in the
      // order list (e.g. a concurrent add from another writer or agent).
      const orderedSet = new Set(orderedIds);
      for (const s of slides) {
        if (!orderedSet.has(s.id)) reordered.push(s);
      }
      deck.slides = reordered;
      break;
    }

    case "add-slide": {
      const { slideId, afterSlideId, fields } = op;
      // Idempotency: if the slide already exists (duplicate delivery), skip.
      if (slides.some((s: { id: string }) => s.id === slideId)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newSlide: any = {
        id: slideId,
        content:
          typeof fields.content === "string"
            ? normalizeSlidePadding(fields.content)
            : "",
        notes: fields.notes ?? "",
        layout: fields.layout ?? "content",
      };
      if (fields.background !== undefined) {
        newSlide.background = fields.background;
      }
      const insertAfterIdx = afterSlideId
        ? slides.findIndex((s: { id: string }) => s.id === afterSlideId)
        : -1;
      if (insertAfterIdx !== -1) {
        slides.splice(insertAfterIdx + 1, 0, newSlide);
      } else {
        slides.push(newSlide);
      }
      deck.slides = slides;
      break;
    }

    case "patch-deck-fields": {
      const { fields } = op;
      if (fields.title !== undefined) deck.title = fields.title;
      if ("designSystemId" in fields)
        deck.designSystemId = fields.designSystemId;
      if (fields.tweaks !== undefined) deck.tweaks = fields.tweaks;
      if (fields.aspectRatio !== undefined)
        deck.aspectRatio = fields.aspectRatio;
      if (fields.shareToken !== undefined) deck.shareToken = fields.shareToken;
      if (fields.visibility !== undefined) deck.visibility = fields.visibility;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Granular deck patch used by the browser editor for concurrent-safe writes. " +
    "Each operation touches only the target slide or field — concurrent writers " +
    "on different slides never overwrite each other's work.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    operations: z
      .array(OperationSchema)
      .min(1)
      .describe("Ordered list of granular operations to apply"),
  }),
  run: async ({ deckId, operations }) => {
    await assertAccess("deck", deckId, "editor");

    return withDeckLock(deckId, async () => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .limit(1);

      if (!row) throw new Error(`Deck ${deckId} not found`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deck: any = JSON.parse(row.data);

      for (const op of operations) {
        applyOperation(deck, op);
      }

      const now = new Date().toISOString();
      deck.updatedAt = now;

      // For patch-deck-fields ops that include a title, also update the
      // SQL title column (kept in sync with deck.title for list queries).
      const titleOp = operations.find(
        (op): op is z.infer<typeof PatchDeckFieldsOp> =>
          op.op === "patch-deck-fields" && typeof op.fields.title === "string",
      );
      const sqlTitle = titleOp?.fields.title ?? row.title;

      // For patch-deck-fields ops that include designSystemId, update the
      // SQL designSystemId column (used by list queries and sharing checks).
      const dsOp = operations.find(
        (op): op is z.infer<typeof PatchDeckFieldsOp> =>
          op.op === "patch-deck-fields" && "designSystemId" in op.fields,
      );
      const sqlDesignSystemId = dsOp
        ? (dsOp.fields.designSystemId ?? null)
        : row.designSystemId;

      await db
        .update(schema.decks)
        .set({
          title: sqlTitle,
          data: JSON.stringify(deck),
          designSystemId: sqlDesignSystemId,
          updatedAt: now,
        })
        .where(eq(schema.decks.id, deckId));

      notifyClients(deckId);

      return { ok: true, deckId, updatedAt: now };
    });
  },
});
