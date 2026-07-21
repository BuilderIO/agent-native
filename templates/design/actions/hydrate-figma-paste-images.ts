/**
 * Retroactively resolve unresolved Figma image fills for a screen that was
 * imported via the local-kiwi clipboard path.
 *
 * When a Figma paste is imported without an access token, IMAGE fills render as
 * `url("about:blank")` placeholders. The originating elements are annotated
 * with `data-figma-image-ref="hash1 hash2 …"` so this action can find them
 * without a full re-parse. Each Nth hash in the attribute maps to the Nth
 * `url(&quot;about:blank&quot;)` occurrence in the element's style attribute,
 * in the same fill-layer order the renderer used.
 *
 * This action:
 * 1. Reads the live file HTML (collab-aware).
 * 2. Collects all unique image-ref hashes across the file.
 * 3. Resolves CDN URLs via Figma's `/files/:key/images` endpoint, then mirrors
 *    them to durable blob storage.
 * 4. Replaces each placeholder with its durable URL and removes fully-resolved
 *    `data-figma-image-ref` attributes.
 * 5. Persists via `writeInlineSourceFile` (CAS + collab sync).
 * 6. Updates `screenMetadata[fileId].unresolvedImageRefs` in the design data.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { resolveImageFillRefs } from "../server/lib/figma-node-import.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const DATA_IMAGE_REF_ATTR_RE = /\sdata-figma-image-ref="([^"]*)"/;

export function collectImageRefHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const m of html.matchAll(/<[^>]+>/g)) {
    const ref = m[0].match(DATA_IMAGE_REF_ATTR_RE);
    if (ref?.[1]) {
      for (const h of ref[1].trim().split(/\s+/)) {
        if (h) hashes.add(h);
      }
    }
  }
  return Array.from(hashes);
}

/**
 * Replace `url(&quot;about:blank&quot;)` placeholders inside opening tags that
 * carry a `data-figma-image-ref` attribute. The Nth placeholder in each
 * element's style corresponds to the Nth hash in the space-separated attr value.
 *
 * Fully resolved elements have their `data-figma-image-ref` attr removed.
 * Partially resolved elements have it updated to the remaining hashes only.
 */
export function hydrateImageRefsInHtml(
  html: string,
  resolvedUrls: Map<string, string>,
): { html: string; resolved: number; missing: string[] } {
  let resolvedCount = 0;
  const missing: string[] = [];

  const newHtml = html.replace(/<[^>]+>/g, (tag) => {
    const refMatch = tag.match(DATA_IMAGE_REF_ATTR_RE);
    if (!refMatch?.[1]) return tag;

    const hashes = refMatch[1].trim().split(/\s+/).filter(Boolean);
    if (hashes.length === 0) return tag;

    const unresolvedHashes: string[] = [];
    let hashIdx = 0;

    let newTag = tag.replace(/url\(&quot;about:blank&quot;\)/g, () => {
      if (hashIdx >= hashes.length) return "url(&quot;about:blank&quot;)";
      const hash = hashes[hashIdx++]!;
      const durableUrl = resolvedUrls.get(hash);
      if (!durableUrl) {
        unresolvedHashes.push(hash);
        return "url(&quot;about:blank&quot;)";
      }
      resolvedCount++;
      const safeUrl = durableUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `url(&quot;${safeUrl}&quot;)`;
    });

    // Hashes beyond url() occurrences (shouldn't happen with our renderer).
    while (hashIdx < hashes.length) {
      unresolvedHashes.push(hashes[hashIdx++]!);
    }

    missing.push(...unresolvedHashes);

    if (unresolvedHashes.length === 0) {
      newTag = newTag.replace(/\s+data-figma-image-ref="[^"]*"/, "");
    } else if (unresolvedHashes.length < hashes.length) {
      newTag = newTag.replace(
        /data-figma-image-ref="[^"]*"/,
        `data-figma-image-ref="${unresolvedHashes.join(" ")}"`,
      );
    }

    return newTag;
  });

  return { html: newHtml, resolved: resolvedCount, missing };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    'Retroactively resolve unresolved Figma image fills for a screen imported via the no-token local-kiwi path (import-figma-clipboard returned strategy:"localKiwi"). Requires a saved FIGMA_ACCESS_TOKEN. Fetches CDN URLs from Figma\'s /files/:key/images endpoint, mirrors them to durable blob storage, and replaces every url("about:blank") placeholder stamped by the local-kiwi decoder with the real durable URL. Fully resolved elements have their data-figma-image-ref annotation removed; partially resolved elements retain it for a future retry. Returns resolved/missing/skipped counts. Call after connecting Figma in Settings to fill in images from a no-token paste.',
  schema: z.object({
    fileId: z
      .string()
      .describe(
        "ID of the design_files row to hydrate. Use the fileId returned by import-figma-clipboard.",
      ),
  }),
  run: async ({ fileId }) => {
    const db = getDb();

    const [row] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
        designData: schema.designs.data,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.id, fileId),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);

    if (!row) throw new Error(`File not found: ${fileId}`);
    if (row.fileType !== "html") {
      throw new Error("hydrate-figma-paste-images only supports HTML files.");
    }

    await assertAccess("design", row.designId, "editor");

    let figmaFileKey: string | undefined;
    try {
      const designData: unknown = row.designData
        ? JSON.parse(row.designData)
        : {};
      const screenMeta = (designData as Record<string, unknown>)
        ?.screenMetadata;
      if (screenMeta && typeof screenMeta === "object") {
        const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
        if (fileMeta && typeof fileMeta === "object") {
          const key = (fileMeta as Record<string, unknown>).figmaFileKey;
          if (typeof key === "string" && key) figmaFileKey = key;
        }
      }
    } catch {
      // JSON.parse failure — figmaFileKey stays undefined, error thrown below.
    }

    if (!figmaFileKey) {
      throw new Error(
        `No Figma file key found for file ${fileId}. This file may not have been imported via a Figma clipboard paste.`,
      );
    }

    const workspaceFile: SourceWorkspaceFile = {
      id: row.id,
      designId: row.designId,
      filename: row.filename,
      fileType: "html",
      content: row.content ?? "",
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);

    const hashesToResolve = collectImageRefHashes(live.content);
    if (hashesToResolve.length === 0) {
      return {
        fileId,
        resolved: 0,
        missing: 0,
        skipped: 0,
        message: "No unresolved image refs found in this file.",
      };
    }

    let resolvedUrls: Map<string, string>;
    try {
      resolvedUrls = await resolveImageFillRefs(figmaFileKey, hashesToResolve);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/quota cooldown|provider.*quota/i.test(msg)) {
        const retryAfterSeconds =
          (err as { retryAfterSeconds?: number }).retryAfterSeconds ?? 0;
        const waitHint =
          retryAfterSeconds > 0
            ? retryAfterSeconds >= 60
              ? `${Math.ceil(retryAfterSeconds / 60)} min`
              : `${retryAfterSeconds}s`
            : "~1 min";
        throw Object.assign(
          new Error(`Figma API rate limited — try again in ${waitHint}.`),
          { statusCode: 429 },
        );
      }
      throw err;
    }

    if (resolvedUrls.size === 0) {
      return {
        fileId,
        resolved: 0,
        missing: hashesToResolve.length,
        skipped: 0,
        message: `Figma returned no image URLs for ${hashesToResolve.length} hash${hashesToResolve.length === 1 ? "" : "es"}. The images may have been deleted from the Figma file or the access token lacks file_content:read scope.`,
      };
    }

    const {
      html: hydratedHtml,
      resolved,
      missing,
    } = hydrateImageRefsInHtml(live.content, resolvedUrls);

    agentEnterDocument(row.id);
    try {
      await writeInlineSourceFile({
        designId: row.designId,
        file: workspaceFile,
        content: hydratedHtml,
        expectedVersionHash: live.versionHash,
      });
    } finally {
      agentLeaveDocument(row.id);
    }

    if (resolved > 0) {
      const remainingHashes = Array.from(new Set(missing));
      await mutateDesignData({
        designId: row.designId,
        mutate: (current) => {
          const screenMeta = current.screenMetadata;
          if (!screenMeta || typeof screenMeta !== "object") return current;
          const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
          if (!fileMeta || typeof fileMeta !== "object") return current;
          const updatedFileMeta: Record<string, unknown> = {
            ...(fileMeta as Record<string, unknown>),
          };
          if (remainingHashes.length > 0) {
            updatedFileMeta.unresolvedImageRefs = remainingHashes;
          } else {
            delete updatedFileMeta.unresolvedImageRefs;
          }
          return {
            ...current,
            screenMetadata: {
              ...(screenMeta as Record<string, unknown>),
              [fileId]: updatedFileMeta,
            },
          };
        },
        isApplied: (persisted) => {
          const screenMeta = persisted.screenMetadata;
          if (!screenMeta || typeof screenMeta !== "object") return false;
          const fileMeta = (screenMeta as Record<string, unknown>)[fileId];
          if (!fileMeta || typeof fileMeta !== "object") return false;
          const refs = (fileMeta as Record<string, unknown>)
            .unresolvedImageRefs;
          return remainingHashes.length === 0
            ? refs === undefined || (Array.isArray(refs) && refs.length === 0)
            : Array.isArray(refs) && refs.length === remainingHashes.length;
        },
      });
    }

    return {
      fileId,
      resolved,
      missing: Array.from(new Set(missing)).length,
      skipped: hashesToResolve.length - resolvedUrls.size,
    };
  },
});
