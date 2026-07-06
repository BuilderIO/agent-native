import { defineAction } from "@agent-native/core";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import {
  applyText,
  getText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
    .describe("Design file id. Defaults to the active editor file."),
  ownerId: z
    .string()
    .optional()
    .describe("Design editor selection owner token from current screen state."),
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

function appendNativeAssetMarkup(
  html: string,
  kind: DesignNativeAssetKind,
  nodeId: string,
): string {
  const snippet = nativeSnippet(kind, nodeId);
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
    fileId:
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

    let base = file.content ?? "";
    try {
      if (await hasCollabState(file.id)) {
        const live = await getText(file.id, "content");
        if (typeof live === "string") base = live;
      }
    } catch {
      // Collab read is best-effort; fall back to stored content.
    }

    const insertedNodeId = createInsertedNodeId("native");
    const content = appendNativeAssetMarkup(base, args.kind, insertedNodeId);
    const now = new Date().toISOString();
    await db
      .update(schema.designFiles)
      .set({ content, updatedAt: now })
      .where(eq(schema.designFiles.id, file.id));
    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));

    if (await hasCollabState(file.id)) {
      await applyText(file.id, content, "content", "agent");
    } else {
      await seedFromText(file.id, content);
    }

    return {
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      inserted: true,
      insertedNodeId,
      insertedSelector: `[data-agent-native-node-id="${insertedNodeId}"]`,
      source: "design-native",
      kind: args.kind,
    };
  },
});
