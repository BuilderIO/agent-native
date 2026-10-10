import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designDataForAccessRole } from "../server/lib/design-data-access.js";
import {
  ExportAssetError,
  loadPublicExportAssets,
  processExportAssetReferences,
} from "../server/lib/design-export-assets.js";
import {
  ExportLiveSourceError,
  loadLiveExportFiles,
} from "../server/lib/design-export-source.js";
import {
  exportFilename,
  injectHiddenLayerExportStyle,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { NativeExportAssetError } from "../server/lib/native-export-assets.js";
import { isBoardFile } from "../shared/board-file.js";
import "../server/db/index.js";

const METADATA_ARCHIVE_DIR = "agent-native-metadata";

function safeArchivePath(filename: string, fallback: string): string {
  const normalized = filename
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || fallback;
}

export default defineAction({
  description:
    "Export a design project as a ZIP file containing all design files and a README. " +
    "Returns the ZIP as a base64 string and suggested filename.",
  schema: z.object({
    id: z.string().describe("Design ID to export"),
  }),
  run: async ({ id }, ctx) => {
    const access = await resolveAccess("design", id);
    if (!access)
      fail("Design not found.", { errorCode: "not_found", statusCode: 404 });

    const row = access.resource;
    const db = getDb();

    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));
    let liveFiles: typeof files;
    try {
      liveFiles = await loadLiveExportFiles(files);
    } catch (error) {
      if (error instanceof ExportLiveSourceError)
        fail(error.message, {
          errorCode: error.actionErrorCode,
          statusCode: error.statusCode,
        });
      throw error;
    }
    const exportFiles = liveFiles.filter((file) => !isBoardFile(file.filename));
    let bundledFiles: ReturnType<typeof processExportAssetReferences>["files"] =
      exportFiles;
    let nativeAssetEntries: Array<{
      sourceUrl: string;
      archivePath: string;
      sha256: string;
      bytes: Uint8Array;
    }> = [];
    try {
      const scanned = processExportAssetReferences(exportFiles);
      const assets = await loadPublicExportAssets(
        resolve(process.cwd(), "public"),
        scanned.references.localPaths,
        { ownerEmail: getRequestUserEmail() },
      );
      bundledFiles = processExportAssetReferences(exportFiles, assets).files;
      let nativeBytes = 0;
      nativeAssetEntries = scanned.references.nativeAssetPaths.map(
        (sourceUrl) => {
          const asset = assets[sourceUrl];
          if (!asset)
            throw new ExportAssetError(
              "Native texture bytes are unavailable for ZIP export.",
              "unavailable",
            );
          nativeBytes += asset.bytes.byteLength;
          if (asset.bytes.byteLength > 1_000_000 || nativeBytes > 4_000_000)
            throw new ExportAssetError(
              "Native texture ZIP bytes exceed the bounded export limit.",
              "limit",
            );
          const filename = sourceUrl.slice(
            "/api/design-native-texture/".length,
          );
          if (!/^[a-f0-9-]+\.(?:png|jpg|webp)$/.test(filename))
            throw new ExportAssetError(
              "Native texture ZIP reference is malformed.",
              "invalid-reference",
            );
          return {
            sourceUrl,
            archivePath: `native-textures/${filename}`,
            sha256: createHash("sha256").update(asset.bytes).digest("hex"),
            bytes: asset.bytes,
          };
        },
      );
    } catch (error) {
      if (
        error instanceof ExportAssetError ||
        error instanceof NativeExportAssetError
      )
        fail(error.message, {
          errorCode: `design_export_asset_${error.code.replace(/-/g, "_")}`,
          statusCode: error.code === "unreadable" ? 502 : 422,
        });
      throw error;
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const readme = [
      `# ${row.title}`,
      "",
      row.description ? `${row.description}` : "",
      "",
      `Project Type: ${row.projectType}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      "## Files",
      "",
      ...exportFiles.map((f) => `- ${f.filename} (${f.fileType})`),
    ].join("\n");

    zip.file(`${METADATA_ARCHIVE_DIR}/README.md`, readme);

    for (const [index, file] of bundledFiles.entries()) {
      const filename = safeArchivePath(
        file.filename,
        `design-file-${index + 1}.txt`,
      );
      const content =
        file.fileType === "html"
          ? injectHiddenLayerExportStyle(file.content ?? "")
          : (file.content ?? "");
      zip.file(filename, content);
    }

    if (nativeAssetEntries.length) {
      for (const entry of nativeAssetEntries)
        zip.file(entry.archivePath, entry.bytes);
      zip.file(
        `${METADATA_ARCHIVE_DIR}/native-textures.json`,
        JSON.stringify(
          nativeAssetEntries.map(({ sourceUrl, archivePath, sha256 }) => ({
            sourceUrl,
            archivePath,
            sha256,
          })),
        ),
      );
    }

    // Add design data if present. Public/viewer exports keep render metadata
    // but must never serialize a localhost bridge token into the archive.
    const exportDesignData = designDataForAccessRole(
      row.data ?? null,
      access.role,
    );
    if (typeof exportDesignData === "string") {
      zip.file(`${METADATA_ARCHIVE_DIR}/design-data.json`, exportDesignData);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipBase64 = zipBuffer.toString("base64");

    const filename = exportFilename(row.title, "zip");
    const saveResult = await trySaveExportFile(filename, zipBuffer);

    track(
      "design_exported",
      {
        app_name: "design",
        template_name: "design",
        output_id: id,
        output_type: "design",
        export_format: "zip",
        file_count: exportFiles.length,
      },
      ctx,
    );

    return {
      zipBase64,
      filename,
      ...saveResult,
      fileCount: exportFiles.length,
    };
  },
});
