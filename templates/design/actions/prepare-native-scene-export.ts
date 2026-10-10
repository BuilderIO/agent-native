import { resolve } from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  DeclarativeExportError,
  buildDeclarativeNativeExport,
  prepareDeclarativeNativeSource,
} from "../server/lib/design-declarative-export.js";
import {
  ExportAssetError,
  loadPublicExportAssets,
  processExportAssetReferences,
} from "../server/lib/design-export-assets.js";
import {
  ExportLiveSourceError,
  loadLiveExportFiles,
} from "../server/lib/design-export-source.js";
import { isLocalFigmaQaUploadEnabled } from "../server/lib/local-figma-qa-upload.js";
import { NativeExportAssetError } from "../server/lib/native-export-assets.js";
import {
  loadSelectedSourceWorkspaceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../shared/native-effect-presets.js";
import {
  NativeEffectApprovalStateError,
  NativeSceneAuthorizationError,
  nativeSceneExecutableHashes,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import { parseEffectsFromHtml } from "../shared/native-effects.js";

const MAX_SOURCE_FILES = 32;
const MAX_SOURCE_BYTES = 3_000_000;

export default defineAction({
  description:
    "Prepare one selected inline Design HTML scene's live declarative native shader source for a local deterministic frame export. Returns bounded HTML, exact source versions, and scene-scoped executable hashes from exact builtins or viewer approvals. Scripted or unsupported scene content fails explicitly.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      fileId: z.string().describe("Selected HTML scene file ID"),
      viewportWidth: z.coerce.number().int().min(1).max(4096),
      viewportHeight: z.coerce.number().int().min(1).max(4096),
      pixelRatio: z
        .union([z.number(), z.string().min(1)])
        .transform(Number)
        .pipe(z.number().finite().gt(0).max(4)),
    })
    .refine((args) => args.viewportWidth * args.viewportHeight <= 8_388_608, {
      message: "Native export viewport exceeds the 8 megapixel limit.",
      path: ["viewportWidth"],
    })
    .refine(
      (args) => {
        const width = Math.ceil(args.viewportWidth * args.pixelRatio);
        const height = Math.ceil(args.viewportHeight * args.pixelRatio);
        return width <= 4096 && height <= 4096 && width * height <= 8_388_608;
      },
      {
        message: "Native export physical frame exceeds the 8 megapixel limit.",
        path: ["pixelRatio"],
      },
    ),
  readOnly: true,
  http: { method: "GET" },
  run: async ({
    designId,
    fileId,
    viewportWidth,
    viewportHeight,
    pixelRatio,
  }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: false,
      includeBoard: true,
    });
    if (workspace.sourceType !== "inline")
      fail("Native frame export requires an inline Design source.", {
        errorCode: "native_export_source_unsupported",
        statusCode: 422,
      });
    const selected = workspace.files.find((file) => file.id === fileId);
    if (!selected || selected.fileType !== "html")
      fail("Selected HTML scene was not found.", {
        errorCode: "native_export_screen_not_found",
        statusCode: 404,
      });
    const relevantFiles = [
      selected,
      ...workspace.files.filter((file) => file.fileType === "css"),
    ];
    if (relevantFiles.length > MAX_SOURCE_FILES)
      fail("Native export has too many source files.", {
        errorCode: "native_export_source_too_large",
        statusCode: 413,
      });

    try {
      const storedFiles = [];
      for (const file of relevantFiles) {
        const stored = await loadSelectedSourceWorkspaceFile(file);
        if (!stored)
          fail("Design source file changed during export preparation.", {
            errorCode: "native_export_source_conflict",
            statusCode: 409,
          });
        storedFiles.push(stored);
      }
      const liveFiles = await loadLiveExportFiles(storedFiles);
      const sourceBytes = liveFiles.reduce(
        (total, file) =>
          total + new TextEncoder().encode(file.content).byteLength,
        0,
      );
      if (sourceBytes > MAX_SOURCE_BYTES)
        fail("Native export source exceeds the 3 MB limit.", {
          errorCode: "native_export_source_too_large",
          statusCode: 413,
        });
      const tailwindSource = prepareDeclarativeNativeSource(
        liveFiles[0].content,
      );
      const staticFiles = liveFiles.map((file, index) =>
        index === 0 ? { ...file, content: tailwindSource.content } : file,
      );
      const scanned = processExportAssetReferences(staticFiles);
      const assets = await loadPublicExportAssets(
        resolve(process.cwd(), "public"),
        [...scanned.references.localPaths, ...scanned.references.externalUrls],
        { ownerEmail: getRequestUserEmail() },
      );
      const bundled = processExportAssetReferences(staticFiles, assets);
      const fontLicenses = Object.entries(assets)
        .filter(([, asset]) => asset.licenseText !== undefined)
        .map(([path, asset]) => ({ path, text: asset.licenseText! }));
      const bundledScene = bundled.files[0];
      if (!bundledScene || bundledScene.content === null)
        fail("Selected scene changed during native export preparation.", {
          errorCode: "native_export_source_conflict",
          statusCode: 409,
        });
      const sourceManifest = parseEffectsFromHtml(bundledScene.content);
      if (
        sourceManifest.errors.length ||
        !sourceManifest.document?.instances.length
      )
        fail("Selected scene has no valid native effect instances.", {
          errorCode: "native_export_manifest_unreadable",
          statusCode: 422,
        });
      const viewerApprovedHashes = parseNativeEffectApprovalState(
        await readAppState(nativeEffectApprovalKey(designId)),
      ).hashes;
      const approvedDefinitionHashes = await nativeSceneExecutableHashes(
        sourceManifest.document,
        viewerApprovedHashes,
        NATIVE_EFFECT_DEFINITION_CATALOG,
      );
      const html = await buildDeclarativeNativeExport({
        title: selected.filename,
        files: bundled.files,
        approvedDefinitionHashes,
        fontLicenses,
        tailwindSource,
        pixelRatio,
      });
      const manifest = parseEffectsFromHtml(html);
      if (manifest.errors.length || !manifest.document?.instances.length)
        fail("Selected scene has no valid native effect instances.", {
          errorCode: "native_export_manifest_unreadable",
          statusCode: 422,
        });
      if (
        JSON.stringify(manifest.document) !==
        JSON.stringify(sourceManifest.document)
      )
        fail("Selected scene changed during native export preparation.", {
          errorCode: "native_export_source_conflict",
          statusCode: 409,
        });
      return {
        designId,
        fileId,
        viewport: { width: viewportWidth, height: viewportHeight },
        initialPixelRatio: pixelRatio,
        html,
        approvedDefinitionHashes,
        instanceTargets: manifest.document.instances
          .filter((instance) => instance.enabled)
          .map((instance) => ({
            instanceId: instance.id,
            nodeId: instance.nodeId,
          })),
        sourceVersions: liveFiles.map((file) => ({
          fileId: file.id,
          filename: file.filename,
          versionHash: file.versionHash,
        })),
        localQaSinkEnabled: isLocalFigmaQaUploadEnabled(),
      };
    } catch (error) {
      if (error instanceof ExportLiveSourceError)
        fail(error.message, {
          errorCode: error.actionErrorCode,
          statusCode: error.statusCode,
        });
      if (error instanceof DeclarativeExportError)
        fail(error.message, {
          errorCode: `native_export_${error.code.replace(/-/g, "_")}`,
          statusCode: error.code === "package-too-large" ? 413 : 422,
        });
      if (error instanceof ExportAssetError)
        fail(error.message, {
          errorCode: `native_export_asset_${error.code.replace(/-/g, "_")}`,
          statusCode: error.code === "limit" ? 413 : 422,
        });
      if (error instanceof NativeExportAssetError)
        fail(error.message, {
          errorCode: `native_export_asset_${error.code.replace(/-/g, "_")}`,
          statusCode: error.code === "limit" ? 413 : 422,
        });
      if (error instanceof NativeEffectApprovalStateError)
        fail(error.message, {
          errorCode: "native_export_approvals_unreadable",
          statusCode: 422,
        });
      if (error instanceof NativeSceneAuthorizationError)
        fail(error.message, {
          errorCode: `native_export_authorization_${error.code.replace(/-/g, "_")}`,
          statusCode:
            error.code === "limit"
              ? 413
              : error.code === "catalog-conflict"
                ? 500
                : 422,
        });
      throw error;
    }
  },
});
