import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
  buildStandaloneHtml,
  exportFilename,
  hasRenderableBoardArtwork,
  trySaveExportFile,
} from "../server/lib/design-export.js";
import { NativeExportAssetError } from "../server/lib/native-export-assets.js";
import { isBoardFile } from "../shared/board-file.js";
import {
  NativeEffectApprovalStateError,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Export a design project's live source as standalone HTML, preserving existing Tailwind/Alpine sources and bundling native GPU runtime and owned SVG assets when used. " +
    "Bundles renderable board artwork and all HTML, CSS, and JSX files into one page. " +
    "Returns the HTML string and suggested filename. Native effects remain live, but this server-only action cannot capture a static GPU poster; nativeStaticFallback reports that limit.",
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
    let html: string;
    let exportFiles: typeof files;
    let unresolvedExternalAssets: string[];
    let approvedDefinitionHashes: string[];
    let nativeStaticFallback: "not-required" | "not-captured" = "not-required";
    try {
      const liveFiles = await loadLiveExportFiles(files);
      exportFiles = liveFiles.filter(
        (file) =>
          !isBoardFile(file.filename) ||
          hasRenderableBoardArtwork(file.content),
      );
      for (const file of exportFiles) {
        if (!file.filename.toLowerCase().endsWith(".html")) continue;
        const parsed = parseEffectsFromHtml(file.content);
        if (parsed.errors.length) {
          fail("Native effect metadata is unreadable for HTML export.", {
            errorCode: "design_export_invalid_source",
            statusCode: 422,
          });
        }
        if (parsed.document?.instances.some((instance) => instance.enabled))
          nativeStaticFallback = "not-captured";
      }
      approvedDefinitionHashes = parseNativeEffectApprovalState(
        await readAppState(nativeEffectApprovalKey(id)),
      ).hashes;
      const scanned = processExportAssetReferences(exportFiles);
      const runtimeLibraryUrl = (url: string) =>
        /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@tailwindcss\/browser@|alpinejs@)/i.test(
          url,
        );
      const assets = await loadPublicExportAssets(
        resolve(process.cwd(), "public"),
        [
          ...scanned.references.localPaths,
          ...scanned.references.externalUrls.filter(
            (url) => !runtimeLibraryUrl(url),
          ),
        ],
        { ownerEmail: getRequestUserEmail() },
      );
      const fontLicenses = Object.entries(assets)
        .filter(([, asset]) => asset.licenseText !== undefined)
        .map(([path, asset]) => ({ path, text: asset.licenseText! }));
      const bundled = processExportAssetReferences(exportFiles, assets);
      const require = createRequire(import.meta.url);
      const [tailwindBrowser, alpine] = await Promise.all([
        readFile(require.resolve("@tailwindcss/browser"), "utf8"),
        readFile(require.resolve("alpinejs/dist/cdn.min.js"), "utf8"),
      ]);
      html = buildStandaloneHtml({
        title: row.title,
        files: bundled.files,
        screenLayout: "stacked",
        runtimeLibraries: { tailwindBrowser, alpine },
        approvedDefinitionHashes,
        fontLicenses,
      });
      unresolvedExternalAssets = bundled.references.externalUrls.filter(
        (url) => !assets[url] && !runtimeLibraryUrl(url),
      );
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Standalone HTML export failed.",
        {
          errorCode:
            error instanceof ExportLiveSourceError
              ? error.actionErrorCode
              : error instanceof NativeEffectApprovalStateError
                ? "native_effect_approvals_unreadable"
                : error instanceof NativeExportAssetError
                  ? `design_export_native_asset_${error.code.replace(/-/g, "_")}`
                  : error instanceof ExportAssetError
                    ? `design_export_asset_${error.code.replace(/-/g, "_")}`
                    : "design_export_invalid_source",
          statusCode:
            error instanceof ExportLiveSourceError
              ? error.statusCode
              : error instanceof NativeExportAssetError &&
                  error.code === "limit"
                ? 413
                : error instanceof ExportAssetError && error.code === "limit"
                  ? 413
                : 422,
        },
      );
    }

    const filename = exportFilename(row.title, "html");
    const saveResult = await trySaveExportFile(filename, html);

    track(
      "design_exported",
      {
        app_name: "design",
        template_name: "design",
        output_id: id,
        output_type: "design",
        export_format: "html",
        file_count: exportFiles.length,
      },
      ctx,
    );

    return {
      html,
      filename,
      ...saveResult,
      fileCount: exportFiles.length,
      unresolvedExternalAssets,
      approvedDefinitionHashes,
      nativeStaticFallback,
    };
  },
});
