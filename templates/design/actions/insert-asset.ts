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

const schemaInput = z.object({
  assetUrl: z
    .string()
    .url()
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Asset URL must use http or https.")
    .describe("Chosen asset image/video URL."),
  assetId: z.string().optional().describe("Chosen Assets asset id."),
  title: z.string().optional().describe("Human-readable asset title."),
  altText: z.string().optional().describe("Alt text for an image asset."),
  mediaType: z.enum(["image", "video"]).default("image"),
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
  targetNodeId: z
    .string()
    .optional()
    .describe(
      "data-agent-native-node-id of an existing element to target. Required " +
        'for mode "replace-src" and "background-fill". Ignored for the ' +
        'default "figure" mode.',
    ),
  mode: z
    .enum(["figure", "replace-src", "background-fill"])
    .optional()
    .default("figure")
    .describe(
      'How to place the asset. "figure" (default) appends a new figure/section ' +
        "at the end of the file, styled with the design's own tokens — use " +
        'this when there is no existing element to target. "replace-src" sets ' +
        "the src of the <img>/<video> at targetNodeId (e.g. filling a hero " +
        'image placeholder). "background-fill" sets a background-image style ' +
        "on the element at targetNodeId (e.g. filling a hero/section background). " +
        'Both "replace-src" and "background-fill" require targetNodeId.',
    ),
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

/**
 * Prepare a URL for embedding inside a single-quoted CSS `url('...')` value
 * that itself lives inside an HTML attribute. A literal `'` in the URL would
 * otherwise close the CSS string early — and depending on whether the
 * surrounding HTML attribute is single- or double-quoted, everything after it
 * becomes live CSS or, worse, live HTML/JS in the script-enabled preview
 * iframe. Percent-encoding the quote/backslash characters that are meaningful
 * to the CSS string-literal grammar keeps the URL functionally identical
 * (browsers resolve %27/%22/%5C the same as the raw characters) while making
 * it impossible to break out of the `url('...')` string. HTML-escape on top
 * so the value is also safe as an HTML attribute (covers the "..." case).
 */
function cssUrlValue(value: string): string {
  const cssSafe = value
    .replace(/\\/g, "%5C")
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return escapeHtml(cssSafe);
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

function appendAssetMarkup(
  html: string,
  args: z.infer<typeof schemaInput>,
  nodeId: string,
): string {
  const label = args.title?.trim() || args.altText?.trim() || "Generated asset";
  const escapedUrl = escapeHtml(args.assetUrl);
  const escapedLabel = escapeHtml(label);
  const assetIdAttr = args.assetId
    ? ` data-asset-id="${escapeHtml(args.assetId)}"`
    : "";
  const media =
    args.mediaType === "video"
      ? `<video src="${escapedUrl}" controls class="w-full rounded-[var(--radius,0.75rem)] object-cover"></video>`
      : `<img src="${escapedUrl}" alt="${escapeHtml(args.altText?.trim() || label)}" class="w-full rounded-[var(--radius,0.75rem)] object-cover" />`;
  const snippet = `
    <section class="mx-auto my-8 max-w-5xl px-4" data-agent-native-asset data-agent-native-node-id="${escapeHtml(nodeId)}" data-agent-native-layer-name="${escapedLabel}"${assetIdAttr}>
      <figure class="overflow-hidden rounded-[var(--radius,1rem)] border border-[var(--color-border,rgba(0,0,0,0.1))] bg-[var(--color-surface,#fff)] shadow-sm">
        ${media}
        <figcaption class="px-4 py-3 text-sm text-[var(--color-text-muted,#64748b)]">${escapedLabel}</figcaption>
      </figure>
    </section>`;

  return (
    insertBeforeClosingTag(html, "main", snippet) ??
    insertBeforeClosingTag(html, "body", snippet) ??
    `${html}\n${snippet}`
  );
}

/** Find the raw tag string for the element carrying the given node id. */
function findTagByNodeId(html: string, nodeId: string): string | null {
  const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<[a-zA-Z][a-zA-Z0-9:-]*\\b[^>]*data-agent-native-node-id\\s*=\\s*(?:"${escapedId}"|'${escapedId}')[^>]*>`,
  );
  const match = html.match(pattern);
  return match ? match[0] : null;
}

/** Replace the src attribute of the <img>/<video> tag at targetNodeId. */
function replaceSrcAtNode(
  html: string,
  args: z.infer<typeof schemaInput>,
): string {
  const nodeId = args.targetNodeId!;
  const tag = findTagByNodeId(html, nodeId);
  if (!tag) {
    throw new Error(
      `No element found with data-agent-native-node-id="${nodeId}".`,
    );
  }
  const escapedUrl = escapeHtml(args.assetUrl);
  let nextTag: string;
  if (/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i.test(tag)) {
    nextTag = tag.replace(
      /\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i,
      `src="${escapedUrl}"`,
    );
  } else {
    nextTag = tag.replace(/\/?>\s*$/, ` src="${escapedUrl}">`);
  }
  if (args.altText?.trim()) {
    const escapedAlt = escapeHtml(args.altText.trim());
    nextTag = /\balt\s*=\s*(?:"[^"]*"|'[^']*')/i.test(nextTag)
      ? nextTag.replace(
          /\balt\s*=\s*(?:"[^"]*"|'[^']*')/i,
          `alt="${escapedAlt}"`,
        )
      : nextTag.replace(/\/?>\s*$/, ` alt="${escapedAlt}">`);
  }
  if (args.assetId?.trim()) {
    const escapedAssetId = escapeHtml(args.assetId.trim());
    nextTag = /\bdata-asset-id\s*=/.test(nextTag)
      ? nextTag.replace(
          /\bdata-asset-id\s*=\s*(?:"[^"]*"|'[^']*')/i,
          `data-asset-id="${escapedAssetId}"`,
        )
      : nextTag.replace(/\/?>\s*$/, ` data-asset-id="${escapedAssetId}">`);
  }
  return html.replace(tag, nextTag);
}

/** Set a background-image inline style on the element at targetNodeId. */
function backgroundFillAtNode(
  html: string,
  args: z.infer<typeof schemaInput>,
): string {
  const nodeId = args.targetNodeId!;
  const tag = findTagByNodeId(html, nodeId);
  if (!tag) {
    throw new Error(
      `No element found with data-agent-native-node-id="${nodeId}".`,
    );
  }
  const cssUrl = cssUrlValue(args.assetUrl);
  const bgDeclaration = `background-image: url('${cssUrl}'); background-size: cover; background-position: center;`;
  let nextTag: string;
  if (/\bstyle\s*=\s*"/.test(tag)) {
    nextTag = tag.replace(
      /\bstyle\s*=\s*"([^"]*)"/i,
      (_match, existing: string) => {
        const trimmed = existing.trim();
        const withoutBgImage = trimmed.replace(
          /background-image\s*:[^;]*;?\s*/gi,
          "",
        );
        const joined = withoutBgImage
          ? `${withoutBgImage.replace(/;\s*$/, "")}; ${bgDeclaration}`
          : bgDeclaration;
        return `style="${joined}"`;
      },
    );
  } else if (/\bstyle\s*=\s*'/.test(tag)) {
    nextTag = tag.replace(
      /\bstyle\s*=\s*'([^']*)'/i,
      (_match, existing: string) => {
        const trimmed = existing.trim();
        const withoutBgImage = trimmed.replace(
          /background-image\s*:[^;]*;?\s*/gi,
          "",
        );
        const joined = withoutBgImage
          ? `${withoutBgImage.replace(/;\s*$/, "")}; ${bgDeclaration}`
          : bgDeclaration;
        return `style='${joined}'`;
      },
    );
  } else {
    nextTag = tag.replace(/\/?>\s*$/, ` style="${bgDeclaration}">`);
  }
  if (args.assetId?.trim()) {
    const escapedAssetId = escapeHtml(args.assetId.trim());
    nextTag = /\bdata-asset-id\s*=/.test(nextTag)
      ? nextTag.replace(
          /\bdata-asset-id\s*=\s*(?:"[^"]*"|'[^']*')/i,
          `data-asset-id="${escapedAssetId}"`,
        )
      : nextTag.replace(/\/?>\s*$/, ` data-asset-id="${escapedAssetId}">`);
  }
  return html.replace(tag, nextTag);
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
  // Prefer the owner-matched selection over generic navigation so a tab-scoped
  // picker handoff lands in the design that produced it.
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
    "Insert a chosen Assets image or video URL into a Design file. Use this " +
    "after the Assets picker returns chooseAsset/chooseImage context; pass " +
    "designId/fileId directly when known, or pass ownerId from " +
    "view-screen.designSelection when targeting the current editor selection. " +
    'Default `mode: "figure"` appends a new tokened figure/section at the end ' +
    "of the file — use this when there is no existing element to fill. Use " +
    '`mode: "replace-src"` with `targetNodeId` to set the src of an existing ' +
    "<img>/<video> (e.g. filling a hero image placeholder), or " +
    '`mode: "background-fill"` with `targetNodeId` to set a background-image ' +
    "style on an existing element (e.g. filling a hero/section background). " +
    "Both of those require targetNodeId (a data-agent-native-node-id) from " +
    "get-code-layer-projection or the current selection.",
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

    const mode = args.mode ?? "figure";
    let content: string;
    let insertedNodeId: string;
    if (mode === "replace-src") {
      if (!args.targetNodeId) {
        throw new Error('targetNodeId is required for mode "replace-src".');
      }
      insertedNodeId = args.targetNodeId;
      content = replaceSrcAtNode(base, args);
    } else if (mode === "background-fill") {
      if (!args.targetNodeId) {
        throw new Error('targetNodeId is required for mode "background-fill".');
      }
      insertedNodeId = args.targetNodeId;
      content = backgroundFillAtNode(base, args);
    } else {
      insertedNodeId = createInsertedNodeId("asset");
      content = appendAssetMarkup(base, args, insertedNodeId);
    }

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
      mode,
      insertedNodeId,
      insertedSelector: `[data-agent-native-node-id="${insertedNodeId}"]`,
      assetId: args.assetId ?? null,
      assetUrl: args.assetUrl,
    };
  },
});
