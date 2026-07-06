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

const schemaInput = z.object({
  renderUrl: z
    .string()
    .url()
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Render URL must use http or https.")
    .describe(
      "Figma-rendered SVG/PNG URL returned by list-figma-library-assets.",
    ),
  fileKey: z.string().describe("Figma file key."),
  nodeId: z.string().optional().describe("Figma node id for this asset."),
  componentKey: z.string().optional().describe("Figma component key."),
  kind: z.enum(["component", "component_set"]).default("component"),
  name: z.string().optional().describe("Human-readable Figma asset name."),
  description: z.string().optional().describe("Figma asset description."),
  sourceUrl: z
    .string()
    .url()
    .optional()
    .describe("URL back to the Figma node."),
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createInsertedNodeId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `inserted-${prefix}-${random}`;
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

function optionalDataAttribute(name: string, value: string | undefined) {
  return value ? ` ${name}="${escapeHtml(value)}"` : "";
}

function appendFigmaAssetMarkup(
  html: string,
  args: z.infer<typeof schemaInput>,
  nodeId: string,
): string {
  const label = args.name?.trim() || "Figma library asset";
  const description = args.description?.trim();
  const sourceLink = args.sourceUrl
    ? `<a href="${escapeHtml(args.sourceUrl)}" target="_blank" rel="noreferrer" class="text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800">Open in Figma</a>`
    : "";
  const snippet = `
    <section class="mx-auto my-8 max-w-5xl px-4" data-agent-native-asset-source="figma" data-agent-native-figma-asset data-agent-native-node-id="${escapeHtml(nodeId)}" data-agent-native-layer-name="${escapeHtml(label)}" data-figma-file-key="${escapeHtml(args.fileKey)}"${optionalDataAttribute("data-figma-node-id", args.nodeId)}${optionalDataAttribute("data-figma-component-key", args.componentKey)} data-figma-asset-kind="${escapeHtml(args.kind)}">
      <figure class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <img src="${escapeHtml(args.renderUrl)}" alt="${escapeHtml(label)}" class="w-full rounded-t-2xl object-contain" />
        <figcaption class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm text-slate-600">
          <span class="font-medium text-slate-800">${escapeHtml(label)}</span>
          ${description ? `<span>${escapeHtml(description)}</span>` : ""}
          ${sourceLink}
        </figcaption>
      </figure>
    </section>`;

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
    "Insert a rendered Figma component or component set into a Design file, preserving Figma file/node/component provenance. Use list-figma-library-assets first to get renderUrl and metadata.",
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

    const insertedNodeId = createInsertedNodeId("figma");
    const content = appendFigmaAssetMarkup(base, args, insertedNodeId);
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
      source: "figma",
      fileKey: args.fileKey,
      nodeId: args.nodeId ?? null,
      componentKey: args.componentKey ?? null,
      renderUrl: args.renderUrl,
    };
  },
});
