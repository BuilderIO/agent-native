import { defineAction } from "@agent-native/core";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  DESIGN_NATIVE_ASSET_KINDS,
  type DesignNativeAssetKind,
} from "./list-design-native-assets.js";

const schemaInput = z.object({
  kind: z
    .enum(DESIGN_NATIVE_ASSET_KINDS)
    .describe("Design-native asset kind from list-design-native-assets."),
  designId: z
    .string()
    .optional()
    .describe("Design id. Defaults to the current editor navigation state."),
  fileId: z
    .string()
    .optional()
    .describe(
      "Design file id to insert into. Defaults to the active editor file. Also used as the fallback target when screenId is omitted or does not resolve.",
    ),
  screenId: z
    .string()
    .optional()
    .describe(
      "Screen/design-file id to insert into, when it differs from the currently active editor file (e.g. a drop captured on a non-active screen in overview mode). Falls back to fileId, then the active editor file, when omitted or unresolvable.",
    ),
  ownerId: z
    .string()
    .optional()
    .describe("Design editor selection owner token from current screen state."),
  x: z
    .number()
    .optional()
    .describe(
      "Drop position x, in the target screen's own content px (same coordinate space as committed canvas-primitive geometry — NOT viewport/client px). Optional; when omitted (or when y is omitted), the asset appends before </main>/</body> exactly as before this parameter existed.",
    ),
  y: z
    .number()
    .optional()
    .describe(
      "Drop position y, in the target screen's own content px. See x for the coordinate-space contract. Both x and y must be provided together for positioned insertion to take effect.",
    ),
});

function stringFromState(state: unknown, key: string): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function insertBeforeClosingTag(
  html: string,
  closingTag: "main" | "body",
  snippet: string,
): string | null {
  const pattern = new RegExp(`</${closingTag}>`, "i");
  if (!pattern.test(html)) return null;
  return html.replace(pattern, `${snippet}\n</${closingTag}>`);
}

/**
 * Whether a caller-supplied drop position should drive positioned insertion.
 * Both x and y must be finite and non-negative — matching
 * appendCanvasPrimitiveToHtml's own `Math.max(0, Math.round(geometry.x))`
 * clamp for committed canvas primitives (MultiScreenCanvas.tsx /
 * DesignEditor.tsx, not touched by this change) — so a caller that can only
 * produce a raw/unconvertible point (see DesignExtensionsPanel's
 * documented fallback contract) safely falls through to the exact
 * append-before-closing-tag behavior this action always had.
 */
function isUsableDropPosition(
  x: number | undefined,
  y: number | undefined,
): x is number {
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0
  );
}

/**
 * Wraps `snippet` in an absolutely-positioned container at `{x, y}`, in the
 * same coordinate space and CSS convention `appendCanvasPrimitiveToHtml` uses
 * for committed canvas primitives (DesignEditor.tsx, not modified by this
 * change): `position:absolute; left:{x}px; top:{y}px`. A wrapping `<div>`
 * (rather than trying to graft a style attribute onto whichever element in
 * `snippet` happens to carry `data-agent-native-node-id` — that element
 * varies by kind, e.g. "button"/"card" put it on an inner element, not the
 * outer section) keeps this correct regardless of the native asset kind's
 * own markup shape. The wrapper carries no size, so the snippet's own
 * classes (`max-w-*`, `mx-auto`, etc.) keep controlling its box — only its
 * top-left anchor point moves.
 */
function positionSnippetAt(snippet: string, x: number, y: number): string {
  const left = Math.round(x);
  const top = Math.round(y);
  return `\n    <div data-agent-native-positioned-wrapper style="position:absolute;left:${left}px;top:${top}px;">${snippet}\n    </div>`;
}

function createInsertedNodeId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `inserted-${prefix}-${random}`;
}

function nativeSnippet(kind: DesignNativeAssetKind, nodeId: string): string {
  const attrs = (componentName: string) =>
    `data-agent-native-native-asset data-agent-native-node-id="${nodeId}" data-agent-native-component="${componentName}" data-agent-native-layer-name="${componentName}"`;
  switch (kind) {
    case "section-frame":
      return `
    <section ${attrs("Frame")} class="mx-auto my-8 max-w-5xl rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-sm">
      <div class="text-sm font-medium uppercase text-slate-500">Frame</div>
      <div class="mt-3 min-h-24 rounded-xl border border-dashed border-slate-300 bg-slate-50"></div>
    </section>`;
    case "text-block":
      return `
    <section ${attrs("TextBlock")} class="mx-auto my-8 max-w-3xl px-4">
      <p class="text-sm font-medium uppercase text-slate-500">Eyebrow</p>
      <h2 class="mt-3 text-3xl font-semibold text-slate-950">Editable headline</h2>
      <p class="mt-3 text-base leading-7 text-slate-600">Use this text block as a native content primitive, then edit copy, spacing, and typography in Design.</p>
    </section>`;
    case "button":
      return `
    <section class="mx-auto my-8 max-w-5xl px-4">
      <button ${attrs("Button")} class="inline-flex h-11 items-center justify-center rounded-lg bg-slate-950 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2">
        Primary action
      </button>
    </section>`;
    case "card":
      return `
    <section class="mx-auto my-8 max-w-5xl px-4">
      <article ${attrs("Card")} class="max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">01</div>
        <h3 class="mt-4 text-lg font-semibold text-slate-950">Native card</h3>
        <p class="mt-2 text-sm leading-6 text-slate-600">A reusable content block with editable text, spacing, border, and action styling.</p>
        <button class="mt-4 text-sm font-medium text-slate-950">Learn more</button>
      </article>
    </section>`;
    case "input":
      return `
    <section class="mx-auto my-8 max-w-md px-4">
      <label ${attrs("Input")} class="block">
        <span class="text-sm font-medium text-slate-700">Email</span>
        <input class="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200" placeholder="you@example.com" />
        <span class="mt-2 block text-xs text-slate-500">Helper text can explain the field.</span>
      </label>
    </section>`;
    case "nav-bar":
      return `
    <nav ${attrs("NavBar")} class="mx-auto my-8 flex max-w-5xl items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div class="text-sm font-semibold text-slate-950">Product</div>
      <div class="hidden items-center gap-5 text-sm text-slate-600 sm:flex">
        <a href="#" class="hover:text-slate-950">Overview</a>
        <a href="#" class="hover:text-slate-950">Pricing</a>
        <a href="#" class="hover:text-slate-950">Docs</a>
      </div>
      <button class="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white">Start</button>
    </nav>`;
    case "hero":
      return `
    <section ${attrs("Hero")} class="mx-auto my-8 grid max-w-5xl gap-8 rounded-3xl bg-slate-950 px-6 py-10 text-white sm:grid-cols-[1.15fr_0.85fr] sm:px-8">
      <div>
        <p class="text-sm font-medium uppercase text-slate-300">Native hero</p>
        <h1 class="mt-4 text-4xl font-semibold">A clear product promise</h1>
        <p class="mt-4 max-w-xl text-base leading-7 text-slate-300">Drop in a complete editable section and reshape it with Design tools.</p>
        <button class="mt-6 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950">Get started</button>
      </div>
      <div class="min-h-48 rounded-2xl bg-white/10 ring-1 ring-white/15"></div>
    </section>`;
    case "feature-grid":
      return `
    <section ${attrs("FeatureGrid")} class="mx-auto my-8 max-w-5xl px-4">
      <div class="grid gap-3 sm:grid-cols-3">
        ${["Fast", "Flexible", "Observable"]
          .map(
            (
              title,
            ) => `<article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="text-base font-semibold text-slate-950">${title}</h3>
          <p class="mt-2 text-sm leading-6 text-slate-600">Edit this native component copy and styling directly.</p>
        </article>`,
          )
          .join("")}
      </div>
    </section>`;
  }
}

/**
 * Inserts a native-asset snippet into `html`. When `position` is provided
 * (both x and y finite/non-negative — see isUsableDropPosition), the snippet
 * is wrapped in an absolutely-positioned container anchored at that point
 * (positionSnippetAt), matching how appendCanvasPrimitiveToHtml positions
 * committed canvas primitives. Without a usable position, behavior is
 * UNCHANGED from before this parameter existed: append before </main>/</body>
 * (or at the end of the document as a last resort).
 */
function appendNativeAssetMarkup(
  html: string,
  kind: DesignNativeAssetKind,
  nodeId: string,
  position?: { x: number; y: number },
): string {
  const rawSnippet = nativeSnippet(kind, nodeId);
  const snippet = position
    ? positionSnippetAt(rawSnippet, position.x, position.y)
    : rawSnippet;
  return (
    insertBeforeClosingTag(html, "main", snippet) ??
    insertBeforeClosingTag(html, "body", snippet) ??
    `${html}\n${snippet}`
  );
}

async function resolveTarget(args: z.infer<typeof schemaInput>) {
  const [navigation, selection] = await Promise.all([
    readAppStateForCurrentTab("navigation").catch(() => null),
    readAppStateForCurrentTab("design-selection").catch(() => null),
  ]);
  const navigationDesignId = stringFromState(navigation, "designId");
  const selectionDesignId = stringFromState(selection, "designId");
  const selectionOwnerId = stringFromState(selection, "ownerId");
  const selectionMatchesOwner =
    Boolean(args.ownerId) && selectionOwnerId === args.ownerId;
  const designId =
    args.designId ??
    (selectionMatchesOwner ? selectionDesignId : undefined) ??
    navigationDesignId;
  const canUseSelection =
    selectionMatchesOwner &&
    Boolean(designId) &&
    selectionDesignId === designId;
  const navigationActiveFileId =
    designId && navigationDesignId === designId
      ? stringFromState(navigation, "activeFileId")
      : undefined;
  return {
    designId,
    // screenId (when the caller resolved a specific drop-target screen, e.g.
    // a drop captured on a non-active overview screen) wins over fileId, but
    // both are just candidates here — the run() below still validates the
    // resolved id is an actual HTML file in this design and falls back to
    // fileId/the active file exactly as before if it isn't (see the
    // requestedFileId lookup in run()).
    fileId:
      args.screenId ??
      args.fileId ??
      (canUseSelection
        ? stringFromState(selection, "activeFileId")
        : undefined) ??
      navigationActiveFileId,
  };
}

function isHtmlFile(file: {
  fileType: string | null;
  filename: string | null;
}): boolean {
  return file.fileType === "html" || file.filename?.endsWith(".html") === true;
}

export default defineAction({
  description:
    "Insert a Design-native reusable primitive/component into the active design file. Use list-design-native-assets first to choose a kind. Inserts editable HTML stamped with Design component and layer metadata.",
  schema: schemaInput,
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  run: async (args) => {
    const target = await resolveTarget(args);
    if (!target.designId) {
      throw new Error(
        "No active design found. Open a design or pass designId.",
      );
    }

    const db = getDb();
    const files = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.designId, target.designId),
          accessFilter(schema.designs, schema.designShares),
        ),
      );
    const requestedFile = files.find(
      (candidate) => candidate.id === target.fileId,
    );
    const file =
      requestedFile && isHtmlFile(requestedFile)
        ? requestedFile
        : (files.find(isHtmlFile) ?? null);
    if (!file) throw new Error("No editable HTML design file found.");
    await assertAccess("design", file.designId, "editor");

    // Read the LIVE base (collab text when present, else the SQL row) right
    // before transforming, and carry its versionHash through to the write
    // below. writeInlineSourceFile re-reads the live text immediately before
    // its own applyText/DB write and rejects if it no longer matches this
    // hash — closing the race window where a concurrent editor/agent write
    // lands between this read and the persist (the same stale-diff-base bug
    // fixed for update-file: a diff computed from a stale base, char-diffed
    // into a collab doc that has since moved on, corrupts or drops the
    // other writer's change). See update-file.ts and apply-source-edit.ts
    // for the identical pattern. writeInlineSourceFile/readLiveSourceFile
    // only ever dereference file.id (and content/filename for the read); the
    // createdAt/updatedAt fields aren't selected above and aren't needed.
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename ?? "",
      fileType: file.fileType ?? "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const base = live.content;

    const insertedNodeId = createInsertedNodeId("native");
    const position = isUsableDropPosition(args.x, args.y)
      ? { x: args.x, y: args.y as number }
      : undefined;
    const content = appendNativeAssetMarkup(
      base,
      args.kind,
      insertedNodeId,
      position,
    );

    await writeInlineSourceFile({
      designId: file.designId,
      file: workspaceFile,
      content,
      expectedVersionHash: live.versionHash,
    });

    return {
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      inserted: true,
      insertedNodeId,
      insertedSelector: `[data-agent-native-node-id="${insertedNodeId}"]`,
      source: "design-native",
      kind: args.kind,
      positioned: Boolean(position),
    };
  },
});
