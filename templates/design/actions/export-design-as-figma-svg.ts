
import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { trySaveExportFile } from "../server/lib/design-export.js";
import {
  isMissingRootSelectorError,
  renderDesignToFigmaSvg,
  safeFigmaSvgFilename,
} from "../server/lib/design-to-figma-svg.js";
import { isMissingBrowserError } from "../server/lib/playwright-runtime.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import { parseCanvasFrameGeometryById } from "../shared/canvas-frames.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import { buildFigmaNodeSpec } from "../shared/figma-node-spec.js";
import "../server/db/index.js";

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  return (
    await readLiveSourceFile({
      id: fileId,
      designId: "",
      filename: "index.html",
      fileType: "html",
      content: storedContent,
      createdAt: null,
      updatedAt: null,
    })
  ).content;
}

export function chromiumUnavailableReason(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    "A headless Chromium browser is not available in this environment, so the " +
    "vector SVG export cannot run here (this is expected in hosted/serverless " +
    "deploys, which do not bundle a Chromium binary). Fall back to `export-svg` " +
    "(a foreignObject-wrapped HTML snapshot — not Figma-importable as vectors, " +
    "but still a usable static preview) or `export-html`. " +
    `(${detail})`
  );
}

export function figmaSvgNodeSelector(nodeId: string): string {
  const escaped = nodeId
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\a ");
  return `[data-agent-native-node-id="${escaped}"]`;
}

export interface FigmaSvgNodeResolution {
  rootSelector: string | null;
  warning?: string;
}

export function resolveFigmaSvgNodeSelector(
  html: string,
  nodeId: string,
  source: { designId?: string; fileId?: string; filename?: string },
): FigmaSvgNodeResolution {
  const projection = buildCodeLayerProjection(html, {
    source: {
      kind: "design-file",
      designId: source.designId,
      fileId: source.fileId,
      filename: source.filename,
    },
  });
  const node = projection.nodes.find(
    (candidate) =>
      candidate.id === nodeId ||
      candidate.dataAttributes["data-agent-native-node-id"] === nodeId ||
      candidate.dataAttributes["data-code-layer-id"] === nodeId,
  );
  if (!node) {
    return {
      rootSelector: null,
      warning:
        `nodeId "${nodeId}" did not resolve to any element in this screen's ` +
        "current content (it may be a stale live-DOM selection, or the " +
        "screen changed since it was captured) — exported the whole screen " +
        "instead.",
    };
  }
  const persistedId = node.dataAttributes["data-agent-native-node-id"];
  return {
    rootSelector: persistedId ? figmaSvgNodeSelector(persistedId) : node.path,
  };
}

export default defineAction({
  description:
    "Export a design screen (or a selected element's subtree via nodeId) as a " +
    "genuinely vector SVG document — real <rect>/<path>/<text>/<image> markup " +
    "with <linearGradient>/<radialGradient>/<filter> defs, which Figma imports " +
    "as normal EDITABLE layers (unlike `export-svg`'s foreignObject wrapper, " +
    "which Figma cannot import as vectors). Returns the SVG string plus an " +
    "export report classifying each element as vectorized, approximated, " +
    "rasterized, or omitted. Note: Figma imports SVG <text> as live, editable " +
    "type, but its importer reads only font family, size and a coarse bold " +
    "weight — letter spacing is dropped and weights above 700 resolve to " +
    "Bold, so tracked or extra-bold text lands at a different width; see the " +
    "report's `vectorizedTextCaveat`. Pass `autoLayout: true` to ALSO get " +
    "`nodeSpec`, a Figma node tree with real auto-layout frames for the " +
    "Plugin API path — that path has neither the SVG importer's text limits " +
    "nor its inability to express layout.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe("Design project id. Required unless fileId is provided."),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to export. Takes priority over designId/filename.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe(
        "Filename to export when fileId is not provided. Defaults to index.html.",
      ),
    nodeId: z
      .string()
      .optional()
      .describe(
        "Scope the export to one element's subtree via its data-agent-native-node-id, " +
          "instead of the whole screen.",
      ),
    autoLayout: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Also return `nodeSpec`: a Figma NODE tree with real auto-layout " +
          "(layoutMode/itemSpacing/padding/layoutGrow/layoutSizing), for " +
          "materializing through the Figma Plugin API instead of importing " +
          "the SVG. SVG cannot express auto-layout at all, so the SVG path " +
          "always lands as absolutely-positioned geometry. `nodeSpecReport` " +
          "names every container that could not be represented as a Figma " +
          "auto-layout frame and why.",
      ),
    embedImages: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Fetch and inline http(s) image sources/background-images as data: URIs, so the " +
          "SVG is self-contained for clipboard paste. Set false to keep absolute URLs.",
      ),
    width: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Render viewport width in px. Defaults to the screen's natural width or 1440.",
      ),
    height: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Render viewport height in px. Defaults to the screen's natural height or 1200.",
      ),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({
    designId,
    fileId,
    filename,
    nodeId,
    autoLayout,
    embedImages,
    width,
    height,
  }) => {
    if (!designId && !fileId) {
      throw new Error("designId or fileId is required.");
    }

    const db = getDb();
    const conditions = [
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.designId, designId ?? ""),
    ];
    if (!fileId) {
      conditions.push(
        eq(schema.designFiles.filename, filename ?? "index.html"),
      );
    }

    const [file] = await db
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
      .where(and(...conditions))
      .limit(1);

    if (!file) {
      const err = new Error("Design file not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    if (file.fileType !== "html") {
      throw new Error(
        `export-design-as-figma-svg only supports HTML files (got "${file.fileType}").`,
      );
    }

    const [designRow] = await db
      .select({ title: schema.designs.title, data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, file.designId))
      .limit(1);

    const html = await liveContent(file.id, file.content ?? "");

    let canvasFrameWidth: number | undefined;
    let canvasFrameHeight: number | undefined;
    if (designRow?.data) {
      try {
        const parsed = JSON.parse(designRow.data) as {
          canvasFrames?: unknown;
        };
        const frame = parseCanvasFrameGeometryById(parsed?.canvasFrames)[
          file.id
        ];
        canvasFrameWidth = frame?.width;
        canvasFrameHeight = frame?.height;
      } catch {
        // Malformed/legacy `data` — fall through to the hardcoded default.
      }
    }
    const resolvedWidth = width ?? canvasFrameWidth ?? 1440;
    const resolvedHeight = height ?? canvasFrameHeight ?? 1200;

    const warnings: string[] = [];
    let rootSelector: string | null = null;
    if (nodeId) {
      const resolution = resolveFigmaSvgNodeSelector(html, nodeId, {
        designId: file.designId,
        fileId: file.id,
        filename: file.filename,
      });
      rootSelector = resolution.rootSelector;
      if (resolution.warning) warnings.push(resolution.warning);
    }

    let result: Awaited<ReturnType<typeof renderDesignToFigmaSvg>>;
    try {
      result = await renderDesignToFigmaSvg({
        html,
        width: resolvedWidth,
        height: resolvedHeight,
        title: designRow?.title ?? file.filename,
        rootSelector,
        embedImages: embedImages ?? true,
      });
    } catch (err) {
      if (isMissingBrowserError(err)) {
        return { ok: false, reason: chromiumUnavailableReason(err) };
      }
      if (rootSelector && isMissingRootSelectorError(err)) {
        warnings.push(
          `The resolved selector for nodeId "${nodeId}" did not match the ` +
            "rendered screen — exported the whole screen instead.",
        );
        result = await renderDesignToFigmaSvg({
          html,
          width: resolvedWidth,
          height: resolvedHeight,
          title: designRow?.title ?? file.filename,
          rootSelector: null,
          embedImages: embedImages ?? true,
        });
      } else {
        throw err;
      }
    }

    if (warnings.length > 0) {
      result.report.warnings.push(...warnings);
    }

    const filenameOut = safeFigmaSvgFilename(designRow?.title ?? file.filename);
    const saveResult = await trySaveExportFile(filenameOut, result.svg);

    const nodes = autoLayout ? buildFigmaNodeSpec(result.scene) : null;

    return {
      ok: true,
      designId: file.designId,
      fileId: file.id,
      filename: filenameOut,
      svg: result.svg,
      report: result.report,
      nodeSpec: nodes?.root,
      nodeSpecReport: nodes?.report,
      ...saveResult,
    };
  },
});
