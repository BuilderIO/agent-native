import { defineAction, embedApp } from "@agent-native/core";
import {
  deleteAppState,
  writeAppState,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { seedFromText } from "@agent-native/core/collab";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  mergeCanvasFramePlacements,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import { isUniqueConstraintViolation } from "../shared/db-conflict.js";
import { widthToPrefix } from "../shared/responsive-classes.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

const VARIANT_GAP = 96;
const MAX_COLUMNS = 3;
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const TABLET_WIDTH = 768;
const TABLET_HEIGHT = 1024;
const DESKTOP_WIDTH = 1440;
const DESKTOP_HEIGHT = 1024;
const DEFAULT_RESPONSIVE_BREAKPOINTS = [390, 768, 1440].map((widthPx) => ({
  id: `generated-${widthPx}`,
  label: widthPx === 390 ? "Mobile" : widthPx === 768 ? "Tablet" : "Desktop",
  widthPx,
  prefix: widthToPrefix(widthPx),
}));

function hasBreakpointSet(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const breakpoints = (value as { breakpoints?: unknown }).breakpoints;
  return Array.isArray(breakpoints) && breakpoints.length > 0;
}

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}?view=overview`,
  });
}

const FALLBACK_INSTRUCTIONS =
  "The generated directions have been saved as normal screens on the Design " +
  "overview board. The chat shows one button per screen. Ask the user to pick " +
  "a screen by name if the inline buttons are not available; after they pick, " +
  "delete each other variant screen at most once, call get-design-snapshot with fileId for " +
  "the kept screen once, then call edit-design on that same fileId in a bounded pass. " +
  'Use mode "replace-file" to replace the representative direction screen with ' +
  "the actual requested product UI; make the result complete but compact and " +
  "prefer visible controls/affordances over exhaustive content if the request is large. " +
  "Do not leave a direction board, summary card, or variant brief as the final result. " +
  "Do not call generate-design after a variant pick.";

const VARIANT_PICK_SUBMIT_MESSAGE =
  "Use this design direction. Keep the selected screen, clean up each other " +
  "variant screen at most once, read only the kept screen, then update that " +
  "same screen in one bounded pass into the requested app/product UI. Make it " +
  "complete but compact: prioritize the primary workflow, and if the full feature " +
  "list is too large for one reliable edit, render secondary details as visible " +
  "controls, states, or affordances instead of expanding the action input. " +
  "The selected screen is only a representative direction; the final saved " +
  "screen must not be a direction board, variant brief, or summary card. " +
  "If a cleanup action reports a screen was " +
  "already missing, continue. Use the exact file ids and tool instructions in " +
  "the selected answer below. Do not repeat cleanup/read cycles, do not create " +
  "a new index.html, and stop after the first successful screen update.";

const variantSchema = z.object({
  id: z.string().min(1).describe("Stable variant id, e.g. 'minimal-focus'"),
  label: z
    .string()
    .min(1)
    .describe("Short user-facing screen name, e.g. 'One-Line Focus'"),
  description: z
    .string()
    .optional()
    .describe(
      "Short visual direction summary. Use this instead of a huge HTML payload when exploring variants quickly.",
    ),
  accentColor: z
    .string()
    .optional()
    .describe("Optional CSS color used as this variant's primary accent."),
  features: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Optional short feature/polish bullets to show in the variant."),
  content: z
    .string()
    .optional()
    .describe(
      "Optional complete self-contained HTML document for this variant. Keep it compact: one representative screen or directional snapshot, not a full multi-screen app. For faster exploration, omit this and provide label/description/features; Design will generate a compact representative screen.",
    ),
  width: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional source viewport/artboard width for the overview frame.",
    ),
  height: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional source viewport/artboard height for the overview frame.",
    ),
});

interface VariantScreen {
  id: string;
  variantId: string;
  label: string;
  filename: string;
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const MAX_FILENAME_INSERT_ATTEMPTS = 5;

/**
 * True only when `rawSet` proves none of its screens has ever been removed by
 * delete-file.ts. This action stamps every variant set it creates with
 * `screenCount` — the exact number of screens it generated, which never
 * changes afterward (present-design-variants.ts never mutates an existing
 * set's `screenCount`, and delete-file.ts's `pruneDesignVariantSets` only
 * ever shortens/removes a set's `screens` array, never touches `screenCount`).
 * The moment any member is deleted, `screens.length` drops below the
 * recorded `screenCount` (or the whole entry is removed once <=1 screens
 * remain) — either way, `screens.length === screenCount` no longer holds. So
 * this equality proves no delete-file call has EVER resolved against this
 * set.
 *
 * IMPORTANT: this does NOT prove the user never picked a screen from the set.
 * A pick only exists as a chat instruction (see `VARIANT_PICK_SUBMIT_MESSAGE`)
 * until the agent's follow-up turn actually calls delete-file for the losers;
 * there is no synchronous server-side seam that records a pick before that
 * turn runs (an agent retry after a run cutoff, or a second
 * present-design-variants call, can both land before the delete-file calls
 * do). So `isUntouchedVariantSet` is used only to decide whether a set is
 * eligible to be *marked* superseded — never as authority to delete its
 * files. See `markSupersededVariantSets` / `deleteVariantSetsByIds` below.
 * Sets without a numeric `screenCount` at all (legacy data predating this
 * field) are NOT treated as untouched either, since we cannot prove those
 * were never picked.
 */
function isUntouchedVariantSet(
  rawSet: unknown,
): rawSet is { screens: unknown[]; screenCount: number } & Record<
  string,
  unknown
> {
  return (
    isRecord(rawSet) &&
    Array.isArray(rawSet.screens) &&
    typeof rawSet.screenCount === "number" &&
    rawSet.screens.length === rawSet.screenCount
  );
}

function collectUnmarkedSupersededCandidateIds(
  variantSets: Record<string, unknown>,
): string[] {
  const setIds: string[] = [];
  for (const [setId, rawSet] of Object.entries(variantSets)) {
    if (!isUntouchedVariantSet(rawSet)) continue;
    if (isRecord(rawSet) && rawSet.superseded === true) continue;
    setIds.push(setId);
  }
  return setIds;
}

function screenFileIdsForSet(rawSet: { screens: unknown[] }): string[] {
  const fileIds = new Set<string>();
  for (const screen of rawSet.screens) {
    const id = isRecord(screen)
      ? screen.id
      : typeof screen === "string"
        ? screen
        : undefined;
    if (typeof id === "string") fileIds.add(id);
  }
  return Array.from(fileIds);
}

function pruneKeyedRecordForIds(
  value: unknown,
  ids: string[],
): Record<string, unknown> {
  const next = isRecord(value) ? { ...value } : {};
  for (const id of ids) delete next[id];
  return next;
}

/**
 * Marks each PREVIOUS present-design-variants set for this design that is
 * proven untouched (see `isUntouchedVariantSet`) as `superseded: true`,
 * whenever a new variant set is created for the same design. This is
 * bookkeeping ONLY — it never deletes files, never touches `canvasFrames` or
 * `screenMetadata`, and is always safe to run unconditionally. A set with
 * `superseded: true` still renders normally; the flag only makes it eligible
 * for the opt-in `deleteSupersededSetIds` path below.
 *
 * Deletion is intentionally NOT automatic here. The failure mode this
 * guards against: set V1=[S1,S2,S3] is generated; the user picks S2 in chat;
 * before the agent's delete-file turn for S1/S3 actually runs (run cutoff,
 * retry, or a second present-design-variants call arriving first),
 * `screens.length === screenCount` still holds for V1 — a pick is not
 * observable server-side until delete-file resolves it. Auto-deleting on
 * that inference would have hard-deleted the picked screen S2 with no
 * recovery. So this function only records bookkeeping; real deletion
 * requires the agent to explicitly name the set via `deleteSupersededSetIds`
 * — see that action param's description for the discipline expected of
 * callers.
 */
async function markSupersededVariantSets(
  designId: string,
): Promise<{ markedSetIds: string[] }> {
  const db = getDb();

  // Cheap early-exit read so the common case (no stale variant set to mark)
  // never bumps the design's updatedAt via a no-op mutateDesignData call —
  // mutateDesignDataUnlocked always advances updatedAt on every commit, even
  // when the payload is unchanged. The authoritative check still runs inside
  // the mutate() callback below, so a race against this snapshot is harmless.
  const [designRow] = await db
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(
      and(
        eq(schema.designs.id, designId),
        accessFilter(schema.designs, schema.designShares),
      ),
    );
  if (!designRow) return { markedSetIds: [] };
  let precheckVariantSets: Record<string, unknown> = {};
  if (designRow.data) {
    try {
      const parsed: unknown = JSON.parse(designRow.data);
      if (isRecord(parsed) && isRecord(parsed.designVariantSets)) {
        precheckVariantSets = parsed.designVariantSets;
      }
    } catch {
      return { markedSetIds: [] };
    }
  }
  if (collectUnmarkedSupersededCandidateIds(precheckVariantSets).length === 0) {
    return { markedSetIds: [] };
  }

  let markedSetIds: string[] = [];

  await mutateDesignData({
    designId,
    mutate: (current, { updatedAt }) => {
      const variantSets = isRecord(current.designVariantSets)
        ? current.designVariantSets
        : {};
      const setIds = collectUnmarkedSupersededCandidateIds(variantSets);
      markedSetIds = setIds;
      if (setIds.length === 0) return current;

      const nextVariantSets = { ...variantSets };
      for (const setId of setIds) {
        const rawSet = variantSets[setId];
        if (isRecord(rawSet)) {
          nextVariantSets[setId] = { ...rawSet, superseded: true };
        }
      }

      return {
        ...current,
        designVariantSets: nextVariantSets,
        updatedAt,
      };
    },
    isApplied: (current) => {
      const variantSets = isRecord(current.designVariantSets)
        ? current.designVariantSets
        : {};
      return markedSetIds.every(
        (setId) =>
          isRecord(variantSets[setId]) &&
          variantSets[setId]!.superseded === true,
      );
    },
  });

  return { markedSetIds };
}

/**
 * Explicit, opt-in permanent deletion of specific variant sets by id. This is
 * the ONLY path that hard-deletes variant-set files; it never runs
 * automatically. The caller (the agent) must pass `deleteSupersededSetIds`
 * naming the exact sets it knows were abandoned without any user pick — e.g.
 * generating a brand-new set after the user asked to see different options.
 * Never pass a previous set's id here on the strength of a guess or a retry;
 * only do so when there is no reason to believe the user discussed or picked
 * one of its screens.
 *
 * As a safety net, a requested id is only honored when the set is already
 * flagged `superseded: true` by `markSupersededVariantSets` (i.e. proven
 * untouched by any delete-file call as of this same run). A set that has
 * already had even one delete-file call resolve against it — the normal sign
 * that a pick is mid-flight — is never marked superseded and is therefore
 * never eligible here, regardless of what the caller requests.
 */
async function deleteVariantSetsByIds(
  designId: string,
  requestedSetIds: string[],
): Promise<{ removedSetIds: string[]; removedFileIds: string[] }> {
  const db = getDb();

  // Same cheap early-exit as markSupersededVariantSets: skip the
  // updatedAt-bumping mutateDesignData commit when none of the requested set
  // ids currently qualifies for deletion. The authoritative check still runs
  // inside the mutate() callback below.
  const [designRow] = await db
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(
      and(
        eq(schema.designs.id, designId),
        accessFilter(schema.designs, schema.designShares),
      ),
    );
  if (!designRow) return { removedSetIds: [], removedFileIds: [] };
  let precheckVariantSets: Record<string, unknown> = {};
  if (designRow.data) {
    try {
      const parsed: unknown = JSON.parse(designRow.data);
      if (isRecord(parsed) && isRecord(parsed.designVariantSets)) {
        precheckVariantSets = parsed.designVariantSets;
      }
    } catch {
      return { removedSetIds: [], removedFileIds: [] };
    }
  }
  if (
    !requestedSetIds.some((setId) => {
      const rawSet = precheckVariantSets[setId];
      return (
        isRecord(rawSet) &&
        rawSet.superseded === true &&
        Array.isArray(rawSet.screens)
      );
    })
  ) {
    return { removedSetIds: [], removedFileIds: [] };
  }

  let removedSetIds: string[] = [];
  let removedFileIds: string[] = [];

  await mutateDesignData({
    designId,
    mutate: (current, { updatedAt }) => {
      const variantSets = isRecord(current.designVariantSets)
        ? current.designVariantSets
        : {};
      const setIds: string[] = [];
      const fileIds = new Set<string>();
      for (const setId of requestedSetIds) {
        const rawSet = variantSets[setId];
        if (
          !isRecord(rawSet) ||
          rawSet.superseded !== true ||
          !Array.isArray(rawSet.screens)
        ) {
          continue;
        }
        setIds.push(setId);
        for (const id of screenFileIdsForSet(
          rawSet as { screens: unknown[] },
        )) {
          fileIds.add(id);
        }
      }
      removedSetIds = setIds;
      removedFileIds = Array.from(fileIds);
      if (setIds.length === 0) return current;

      const nextVariantSets = { ...variantSets };
      for (const setId of setIds) delete nextVariantSets[setId];

      return {
        ...current,
        canvasFrames: pruneKeyedRecordForIds(
          current.canvasFrames,
          removedFileIds,
        ),
        screenMetadata: pruneKeyedRecordForIds(
          current.screenMetadata,
          removedFileIds,
        ),
        designVariantSets: nextVariantSets,
        updatedAt,
      };
    },
    isApplied: (current) => {
      const variantSets = isRecord(current.designVariantSets)
        ? current.designVariantSets
        : {};
      return removedSetIds.every((setId) => !(setId in variantSets));
    },
  });

  if (removedFileIds.length > 0) {
    await db
      .delete(schema.designFiles)
      .where(inArray(schema.designFiles.id, removedFileIds));

    // Closes the small window between the metadata prune above and the
    // physical row delete: mirrors delete-file.ts's before/delete/after
    // pattern so a sibling request that refreshed canvasFrames/screenMetadata
    // for one of these now-deleted ids in that window still gets swept.
    await mutateDesignData({
      designId,
      mutate: (current, { updatedAt }) => ({
        ...current,
        canvasFrames: pruneKeyedRecordForIds(
          current.canvasFrames,
          removedFileIds,
        ),
        screenMetadata: pruneKeyedRecordForIds(
          current.screenMetadata,
          removedFileIds,
        ),
        updatedAt,
      }),
      isApplied: (current) => {
        const frames = isRecord(current.canvasFrames)
          ? current.canvasFrames
          : {};
        const metadata = isRecord(current.screenMetadata)
          ? current.screenMetadata
          : {};
        return removedFileIds.every(
          (id) => !(id in frames) && !(id in metadata),
        );
      },
    });
  }

  return { removedSetIds, removedFileIds };
}

function slugify(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || fallback
  );
}

function optionName(index: number) {
  return `Option ${String.fromCharCode(65 + index)}`;
}

function uniqueFilename(preferred: string, used: Set<string>) {
  const dot = preferred.lastIndexOf(".");
  const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
  const ext = dot > 0 ? preferred.slice(dot) : ".html";
  let candidate = `${stem}${ext}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function firstCssPixelValue(content: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*:\\s*(\\d{2,4})px`, "i");
  const match = content.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function boundedDimension(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : undefined;
}

function inferVariantSize(
  variant: z.infer<typeof variantSchema>,
  prompt?: string,
) {
  const explicitWidth = boundedDimension(variant.width, 240, 1920);
  const explicitHeight = boundedDimension(variant.height, 240, 3000);
  if (explicitWidth && explicitHeight) {
    return { width: explicitWidth, height: explicitHeight };
  }

  const content = variant.content ?? "";
  const cssWidth =
    firstCssPixelValue(content, "width") ??
    firstCssPixelValue(content, "max-width") ??
    firstCssPixelValue(content, "min-width");
  const cssHeight =
    firstCssPixelValue(content, "height") ??
    firstCssPixelValue(content, "min-height");
  const inferredWidth = boundedDimension(cssWidth, 240, 1920);
  const inferredHeight = boundedDimension(cssHeight, 240, 3000);
  if (inferredWidth && inferredWidth <= 560) {
    return {
      width: explicitWidth ?? inferredWidth,
      height: explicitHeight ?? inferredHeight ?? MOBILE_HEIGHT,
    };
  }
  if (inferredWidth && inferredHeight) {
    return {
      width: explicitWidth ?? inferredWidth,
      height: explicitHeight ?? inferredHeight,
    };
  }

  const lowercase = [
    content,
    variant.label,
    variant.description ?? "",
    ...(variant.features ?? []),
    prompt ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (
    /\b(?:mobile|phone|iphone|android)\b/.test(lowercase) ||
    /\b(?:max-w-sm|max-w-md|w-\[(?:360|375|390|393|414)px\])\b/.test(lowercase)
  ) {
    return {
      width: explicitWidth ?? MOBILE_WIDTH,
      height: explicitHeight ?? MOBILE_HEIGHT,
    };
  }
  if (/\b(?:tablet|ipad)\b/.test(lowercase)) {
    return {
      width: explicitWidth ?? TABLET_WIDTH,
      height: explicitHeight ?? TABLET_HEIGHT,
    };
  }

  return {
    width: explicitWidth ?? DESKTOP_WIDTH,
    height: explicitHeight ?? DESKTOP_HEIGHT,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorForVariant(
  variant: z.infer<typeof variantSchema>,
  index: number,
) {
  const provided = variant.accentColor?.trim();
  if (provided) return provided;
  return ["#f59e0b", "#06b6d4", "#10b981", "#f43f5e", "#d97706"][index % 5]!;
}

function fallbackVariantContent(
  variant: z.infer<typeof variantSchema>,
  index: number,
  prompt?: string,
  size: { width: number; height: number } = {
    width: DESKTOP_WIDTH,
    height: DESKTOP_HEIGHT,
  },
) {
  const label = escapeHtml(variant.label.trim() || optionName(index));
  const description = escapeHtml(
    variant.description?.trim() ||
      "A compact dark-mode product direction with a clear primary workflow, crisp hierarchy, and fast keyboard-first flow.",
  );
  const sourcePrompt = escapeHtml(
    prompt?.trim() ||
      "Generated app interface direction with a polished workflow and production-ready interaction model.",
  );
  const accent = escapeHtml(colorForVariant(variant, index));
  const features =
    variant.features && variant.features.length > 0
      ? variant.features.slice(0, 6)
      : [
          "Primary workflow",
          "Fast capture",
          "Structured details",
          "Status tracking",
          "Inline editing",
          "Shortcut hints",
        ];
  const safeFeatures = features.map((feature) => escapeHtml(feature));
  const cardTitles = [
    safeFeatures[0] ?? "Primary workflow",
    safeFeatures[1] ?? "Structured details",
    safeFeatures[2] ?? "Polished interactions",
    safeFeatures[3] ?? "Status tracking",
    safeFeatures[4] ?? "Review flow",
  ];
  const density =
    index % 3 === 0 ? "spacious" : index % 3 === 1 ? "glass" : "dense";
  const screenWidth = Math.round(size.width);
  const screenHeight = Math.round(size.height);
  const compact = screenWidth <= 560;
  const tablet = screenWidth > 560 && screenWidth <= 900;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${label}</title>
<style>
:root { color-scheme: dark; --accent: ${accent}; --bg: #080a0f; --panel: rgba(18, 22, 33, 0.82); --line: rgba(255,255,255,.11); --muted: #94a3b8; }
* { box-sizing: border-box; }
body { margin: 0; width: ${screenWidth}px; min-height: ${screenHeight}px; overflow: hidden; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f8fafc; background:
  radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--accent) 42%, transparent), transparent 30%),
  linear-gradient(140deg, #05070b 0%, #111827 48%, #05070b 100%); }
.shell { width: ${screenWidth}px; min-height: ${screenHeight}px; padding: ${compact ? "18" : "34"}px; display: grid; grid-template-columns: ${compact ? "1fr" : tablet ? "220px 1fr" : "258px 1fr 304px"}; gap: ${compact ? "14" : "22"}px; }
.panel { border: 1px solid var(--line); background: var(--panel); border-radius: ${density === "dense" ? "14" : "22"}px; box-shadow: 0 24px 80px rgba(0,0,0,.35); backdrop-filter: blur(${density === "glass" ? "26" : "10"}px); }
.sidebar { padding: 22px; display: flex; flex-direction: column; gap: 18px; }
.brand { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.mark { width: 40px; height: 40px; border-radius: 14px; background: var(--accent); box-shadow: 0 0 32px color-mix(in srgb, var(--accent) 58%, transparent); display:grid; place-items:center; font-weight:800; color:#05070b; }
h1 { margin: 0; font-size: 32px; line-height: 1.05; letter-spacing: 0; }
h2 { margin: 0; font-size: 16px; letter-spacing: 0; }
p { margin: 0; color: var(--muted); line-height: 1.5; }
.nav, .tasks, .right { display: grid; gap: 12px; }
.nav div, .task, .metric, .calendar { border: 1px solid var(--line); border-radius: 14px; background: rgba(255,255,255,.045); padding: 13px 14px; }
.nav div:first-child { color: #fff; background: color-mix(in srgb, var(--accent) 18%, rgba(255,255,255,.06)); border-color: color-mix(in srgb, var(--accent) 48%, var(--line)); }
.main { padding: 24px; display:flex; flex-direction:column; gap:18px; }
.top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
.badge { border:1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); color:#fff; background: color-mix(in srgb, var(--accent) 20%, transparent); padding:8px 11px; border-radius:999px; font-size:12px; }
.board { display:grid; grid-template-columns: ${compact ? "1fr" : "repeat(3, 1fr)"}; gap:14px; flex:1; min-height:0; }
.column { border:1px solid var(--line); border-radius:18px; background:rgba(255,255,255,.035); padding:14px; display:flex; flex-direction:column; gap:12px; }
.column header { display:flex; justify-content:space-between; align-items:center; color:#cbd5e1; font-size:13px; }
.task { display:grid; gap:10px; padding:14px; }
.task strong { font-size:14px; line-height:1.25; }
.meta { display:flex; flex-wrap:wrap; gap:7px; }
.chip { font-size:11px; color:#dbeafe; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.055); border-radius:999px; padding:5px 8px; }
.priority { color:#fff; background: color-mix(in srgb, var(--accent) 22%, rgba(255,255,255,.06)); border-color: color-mix(in srgb, var(--accent) 46%, var(--line)); }
.right { padding:22px; align-content:start; }
.metric { display:grid; gap:8px; }
.metric b { font-size:28px; }
.calendar { display:grid; grid-template-columns: repeat(7, 1fr); gap:7px; }
.calendar span { display:grid; place-items:center; height:32px; border-radius:10px; color:#cbd5e1; background:rgba(255,255,255,.04); font-size:12px; }
.calendar .hot { color:#05070b; background:var(--accent); font-weight:800; }
.features { display:flex; flex-wrap:wrap; gap:8px; }
.shortcut { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; display:flex; justify-content:space-between; gap:10px; color:#cbd5e1; font-size:12px; }
${tablet ? ".right { display: none; }" : ""}
${compact ? ".sidebar { padding: 16px; } .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .nav div { padding: 10px; } .main { padding: 18px; } .top { display: grid; } .top .badge { width: fit-content; } h1 { font-size: 26px; } .right { display: none; } .column:nth-child(n+3) { display: none; }" : ""}
</style>
</head>
<body>
<main class="shell">
  <aside class="panel sidebar">
    <div class="brand"><div class="mark">${escapeHtml(String.fromCharCode(65 + index))}</div><span class="badge">${label}</span></div>
    <div>
      <h2>Direction</h2>
      <p>${description}</p>
    </div>
    <div class="nav">
      <div>Overview</div><div>Primary flow</div><div>Details</div><div>Timeline</div><div>Output</div>
    </div>
    <div class="features">${safeFeatures.map((feature) => `<span class="chip">${feature}</span>`).join("")}</div>
    <div class="shortcut"><span>⌘K command</span><span>G then B</span></div>
  </aside>
  <section class="panel main">
    <div class="top">
      <div><h1>${label}</h1><p>${sourcePrompt}</p></div>
      <span class="badge">${compact ? "Mobile" : tablet ? "Tablet" : "Desktop"} concept · live data</span>
    </div>
    <div class="board">
      <section class="column"><header><span>Focus</span><b>4</b></header>
        <article class="task"><strong>${cardTitles[0]}</strong><div class="meta"><span class="chip priority">Primary</span><span class="chip">Now</span><span class="chip">Fast path</span></div></article>
        <article class="task"><strong>${cardTitles[1]}</strong><div class="meta"><span class="chip">Detail view</span><span class="chip">Shortcut E</span></div></article>
      </section>
      <section class="column"><header><span>Build</span><b>6</b></header>
        <article class="task"><strong>${cardTitles[2]}</strong><div class="meta"><span class="chip priority">P2</span><span class="chip">Flow</span></div></article>
        <article class="task"><strong>${cardTitles[3]}</strong><div class="meta"><span class="chip">Inline edit</span><span class="chip">Next</span></div></article>
      </section>
      <section class="column"><header><span>Ready</span><b>12</b></header>
        <article class="task"><strong>${cardTitles[4]}</strong><div class="meta"><span class="chip">Complete</span><span class="chip">Motion ready</span></div></article>
      </section>
    </div>
  </section>
  <aside class="panel right">
    <h2>Progress</h2>
    <div class="metric"><p>Current flow</p><b>68%</b><p>Representative state for this direction</p></div>
    <h2>Timeline</h2>
    <div class="calendar">${Array.from({ length: 14 }, (_, day) => `<span class="${day === 4 || day === 9 ? "hot" : ""}">${day + 1}</span>`).join("")}</div>
    <h2>Key moments</h2>
    <div class="tasks">
      <div class="task"><strong>${safeFeatures[0] ?? "Primary workflow"}</strong><div class="meta"><span class="chip priority">Hero</span><span class="chip">45m</span></div></div>
      <div class="task"><strong>${safeFeatures[1] ?? "Polished interaction"}</strong><div class="meta"><span class="chip">Motion</span><span class="chip">⌘ Enter</span></div></div>
    </div>
  </aside>
</main>
</body>
</html>`;
}

function placeVariantScreens(screens: VariantScreen[]) {
  const placements: CanvasFramePlacement[] = [];
  const columns = Math.min(MAX_COLUMNS, Math.max(1, screens.length));
  let rowY = 0;

  for (let rowStart = 0; rowStart < screens.length; rowStart += columns) {
    const row = screens.slice(rowStart, rowStart + columns);
    let x = 0;
    let rowHeight = 0;

    for (const [offset, screen] of row.entries()) {
      placements.push({
        fileId: screen.id,
        filename: screen.filename,
        x,
        y: rowY,
        width: screen.width,
        height: screen.height,
        z: rowStart + offset,
      });
      x += screen.width + VARIANT_GAP;
      rowHeight = Math.max(rowHeight, screen.height);
    }

    rowY += rowHeight + VARIANT_GAP;
  }

  return placements;
}

export default defineAction({
  description:
    "Present generated design directions as normal screens on the Design " +
    "overview board and ask the user to choose one with inline chat buttons. " +
    "Provide 2-5 variants (3 is the sweet spot). Use this for design " +
    "exploration before follow-up refinement. After the user's choice, keep " +
    "the chosen screen, delete the other generated variant screens, and " +
    "call get-design-snapshot with fileId for the kept screen before " +
    "calling edit-design on that same fileId in a bounded pass. Use " +
    '`mode: "replace-file"` when expanding the representative placeholder ' +
    "into a complete but compact product UI in the chosen direction. Do not call generate-design after a " +
    "variant pick. Stop after the first successful edit-design save. For " +
    "complex apps, " +
    "make each variant a " +
    "compact representative screen; pass concise labels/descriptions/features " +
    "and omit content when full HTML would be too large. Design will render " +
    "compact screens from the direction data. Expand the chosen direction " +
    "after the user picks. Screens from an earlier variant set are never " +
    "deleted automatically: if you are knowingly replacing your own earlier " +
    "set that the user never picked from or discussed, pass its set id in " +
    "deleteSupersededSetIds; otherwise leave old sets in place.",
  schema: z.object({
    designId: z.string().describe("Design project ID to show variants for"),
    prompt: z
      .string()
      .optional()
      .describe("Caption shown in chat above the variant choice buttons"),
    variants: z
      .array(variantSchema)
      .min(2)
      .max(5)
      .describe(
        "2-5 concise, visually distinct generated design options to place as overview screens (3 is the sweet spot). Prefer short label/description/features for each direction; include inline HTML content only when it is compact enough to finish.",
      ),
    deleteSupersededSetIds: z
      .array(z.string())
      .optional()
      .describe(
        "OPT-IN permanent deletion of earlier variant sets you are knowingly " +
          "replacing. Pass a previous variantSetId ONLY when you created that " +
          "set yourself and the user never picked, kept, or discussed any of " +
          "its screens (e.g. the user asked for a completely different set of " +
          "directions). If the user may have picked a screen — even if the " +
          "losing screens have not been deleted yet — do NOT pass the set id: " +
          "deletion is permanent and would destroy the picked screen. Ids are " +
          "only honored for sets provably untouched by any delete-file call.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design directions",
      description:
        "Open the Design editor with generated directions on the overview board.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open screen overview",
      height: 720,
    }),
  },
  run: async ({ designId, prompt, variants, deleteSupersededSetIds }) => {
    await assertAccess("design", designId, "editor");

    // Non-destructive bookkeeping: flag earlier still-complete variant sets
    // as superseded. Files are NEVER deleted automatically — a user's pick
    // exists only as a chat instruction until the agent's delete-file turn
    // runs, so an automatic sweep here could destroy the picked screen. Real
    // deletion happens only for set ids the caller explicitly opts into via
    // `deleteSupersededSetIds` below (and only when the set is provably
    // untouched by any delete-file call).
    await markSupersededVariantSets(designId);
    const variantSetCleanup =
      deleteSupersededSetIds && deleteSupersededSetIds.length > 0
        ? await deleteVariantSetsByIds(designId, deleteSupersededSetIds)
        : { removedSetIds: [], removedFileIds: [] };

    const db = getDb();
    const now = new Date().toISOString();
    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));
    const usedFilenames = new Set(existingFiles.map((file) => file.filename));
    const variantSetId = nanoid();
    const screens: VariantScreen[] = [];

    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index]!;
      const label = variant.label.trim() || optionName(index);
      const slug = slugify(label, `option-${index + 1}`);
      let filename = uniqueFilename(`variant-${slug}.html`, usedFilenames);
      let fileId = nanoid();
      const providedContent = variant.content?.trim();
      const initialSize = inferVariantSize(variant, prompt);
      const rawContent =
        providedContent ||
        fallbackVariantContent(variant, index, prompt, initialSize);
      const { width, height } = providedContent
        ? inferVariantSize({ ...variant, content: rawContent })
        : initialSize;
      // Stamp missing data-agent-native-node-id attributes before persisting
      // so each variant screen is fully addressable by id-keyed editor
      // operations as soon as it lands on the overview board.
      const content = annotateScreenHtmlForPersist(rawContent, "html");

      // `usedFilenames` is a snapshot taken once at the top of run(), so a
      // concurrent present-design-variants call (an agent retry after a
      // timeout is the common trigger) can independently compute the same
      // (designId, filename) pair and win the insert first. The
      // `design_files_design_filename_unique_idx` unique index (see
      // server/plugins/db.ts) turns the loser's insert into a constraint
      // error instead of a silently duplicated screen; recover by refreshing
      // the real filename list from the DB, picking a fresh unique name, and
      // retrying — bounded so a persistent non-race failure still surfaces.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await db.insert(schema.designFiles).values({
            id: fileId,
            designId,
            filename,
            fileType: "html",
            content,
            createdAt: now,
            updatedAt: now,
          });
          break;
        } catch (err) {
          if (
            !isUniqueConstraintViolation(err) ||
            attempt >= MAX_FILENAME_INSERT_ATTEMPTS
          ) {
            throw err;
          }
          const freshFiles = await db
            .select({ filename: schema.designFiles.filename })
            .from(schema.designFiles)
            .where(eq(schema.designFiles.designId, designId));
          for (const file of freshFiles) usedFilenames.add(file.filename);
          filename = uniqueFilename(`variant-${slug}.html`, usedFilenames);
          fileId = nanoid();
        }
      }
      await seedFromText(fileId, content);

      screens.push({
        id: fileId,
        variantId: variant.id,
        label,
        filename,
        width,
        height,
      });
    }

    const placements = placeVariantScreens(screens);
    await mutateDesignData({
      designId,
      mutate: (current, { updatedAt }) => {
        const mergedFrames = mergeCanvasFramePlacements({
          existing: current.canvasFrames,
          placements,
          resolveFileId: (placement) => placement.fileId,
        });
        const previousMetadata = isRecord(current.screenMetadata)
          ? { ...current.screenMetadata }
          : {};
        const previousVariantSets = isRecord(current.designVariantSets)
          ? { ...current.designVariantSets }
          : {};
        for (const screen of screens) {
          previousMetadata[screen.id] = {
            sourceType: "inline",
            previewState: "preview",
            title: screen.label,
            width: screen.width,
            height: screen.height,
            variantSetId,
            variantId: screen.variantId,
          };
        }
        previousVariantSets[variantSetId] = {
          id: variantSetId,
          prompt: prompt ?? "Pick a direction",
          createdAt: now,
          // Immutable record of how many screens this set started with, so a
          // later present-design-variants call can prove no delete-file call
          // has ever resolved against any of this set's screens — see
          // markSupersededVariantSets / isUntouchedVariantSet above.
          // delete-file.ts's pruneDesignVariantSets only ever shortens or
          // removes `screens`; it never rewrites this field.
          screenCount: screens.length,
          screens: screens.map((screen) => ({
            id: screen.id,
            variantId: screen.variantId,
            label: screen.label,
            filename: screen.filename,
            width: screen.width,
            height: screen.height,
          })),
        };

        return {
          ...current,
          canvasFrames: mergedFrames.canvasFrames,
          screenMetadata: previousMetadata,
          designVariantSets: previousVariantSets,
          ...(hasBreakpointSet(current.breakpointSet)
            ? {}
            : {
                breakpointSet: {
                  id: "generated-responsive",
                  breakpoints: DEFAULT_RESPONSIVE_BREAKPOINTS,
                },
                breakpointSetUpdatedAt: updatedAt,
              }),
          updatedAt,
        };
      },
      isApplied: (current) => {
        const canvasFrames = isRecord(current.canvasFrames)
          ? current.canvasFrames
          : {};
        const metadata = isRecord(current.screenMetadata)
          ? current.screenMetadata
          : {};
        const variantSets = isRecord(current.designVariantSets)
          ? current.designVariantSets
          : {};
        const set = isRecord(variantSets[variantSetId])
          ? variantSets[variantSetId]
          : null;
        const persistedScreens = Array.isArray(set?.screens) ? set.screens : [];
        return (
          hasBreakpointSet(current.breakpointSet) &&
          screens.every(
            (screen) =>
              isRecord(canvasFrames[screen.id]) &&
              isRecord(metadata[screen.id]) &&
              persistedScreens.some(
                (persisted) =>
                  isRecord(persisted) && persisted.id === screen.id,
              ),
          )
        );
      },
    });

    await writeAppState("navigate", {
      view: "editor",
      designId,
      editorView: "overview",
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
    });
    await writeAppStateForCurrentTab("guided-questions", {
      title: prompt ?? "Pick a direction",
      description:
        "All options are on the board. Choose one to keep; I will delete the others, read only the kept screen, and turn that direction into the final requested screen.",
      submitLabel: "Use selected direction",
      submitMessage: VARIANT_PICK_SUBMIT_MESSAGE,
      skipLabel: "Show another set",
      skipMessage: "None of these directions are right.",
      questions: [
        {
          id: "variant",
          type: "text-options",
          question: "Which screen should I keep?",
          required: true,
          allowOther: false,
          includeExplore: false,
          includeDecide: false,
          submitOnSelect: true,
          options: screens.map((screen, index) => {
            const otherScreens = screens
              .filter((other) => other.id !== screen.id)
              .map(
                (other) =>
                  `${other.label} (${other.filename}, file id ${other.id})`,
              )
              .join("; ");
            return {
              label: screen.label || optionName(index),
              value:
                `Keep "${screen.label}" (${screen.filename}, file id ${screen.id}) ` +
                `from variant set ${variantSetId}. Delete each other variant screen at most once: ${otherScreens}. If delete-file says a screen is already missing, continue. ` +
                `Then call get-design-snapshot exactly once with designId ${designId} and fileId ${screen.id} (filename ${screen.filename}), then call edit-design with fileId ${screen.id} on that same kept file in a bounded single-file pass. Use mode "replace-file" to replace the representative direction screen with a complete but compact requested app/product UI in the chosen visual style. Prioritize the primary workflow; if the full feature list is too large for one reliable edit, render secondary details as visible controls, states, or affordances instead of expanding the action input. The final saved screen must be the actual usable UI requested by the user, not a direction board, variant brief, summary card, or description of the direction. Do not call generate-design after this variant pick, do not repeat delete/snapshot cycles, do not create index.html, and do not resend a huge payload. Stop after the first successful edit-design save.`,
            };
          }),
        },
      ],
    });
    await deleteAppState("design-variants").catch(() => false);

    return {
      designId,
      prompt: prompt ?? "Pick a direction",
      variantSetId,
      count: screens.length,
      screens,
      path: `/design/${encodeURIComponent(designId)}?view=overview`,
      embed: true,
      cleanedUpPreviousVariantScreens: variantSetCleanup.removedFileIds.length,
      deletedSupersededSetIds: variantSetCleanup.removedSetIds,
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      nextRequiredAction:
        'Wait for the user to pick a screen in chat. Then delete each unchosen variant screen with delete-file at most once, call get-design-snapshot exactly once with fileId for the chosen screen, and call edit-design with that same fileId in a bounded pass. Use mode "replace-file" to replace the representative direction screen with a complete but compact requested app/product UI in the chosen visual style. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the full feature list is too large for one reliable edit. Do not leave a direction board, variant brief, or summary card as the final result. Do not repeat delete/snapshot cycles. Do not call generate-design after a variant pick. Stop after the first successful edit-design save.',
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open screen overview",
      view: "editor",
    };
  },
});
