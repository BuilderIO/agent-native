/**
 * export-design-as-figma-svg — export a design screen (or a selected
 * subtree) as a genuinely VECTOR SVG document that Figma imports as
 * editable layers (rect/path/gradients/filters stay editable; `<text>` is
 * vectorized to outline paths on import — see the returned report's
 * `vectorizedTextCaveat`). This is a different artifact from `export-svg`,
 * which wraps the standalone HTML in a `foreignObject` for the editor's own
 * "Download SVG" parity — Figma cannot import that as vectors at all, it
 * stays an opaque embedded HTML blob.
 *
 * Resolution mirrors `take-design-screenshot.ts`: a single HTML screen
 * (`fileId`, or `designId` + `filename` defaulting to `index.html`), using
 * live collab content when the screen is actively being edited. `nodeId`
 * additionally scopes the export to one selected element's subtree via its
 * `data-agent-native-node-id` — the same attribute the editor stamps on
 * selectable layers.
 */

import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
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
import { parseCanvasFrameGeometryById } from "../shared/canvas-frames.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // SQL content is the deterministic fallback.
  }
  return storedContent;
}

/** Model-actionable message when no headless Chromium binary is available. */
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

/**
 * Resolves a caller-supplied `nodeId` against the PERSISTED html this export
 * actually renders, before ever touching a browser. Canvas selections mint
 * live-DOM code-layer ids like `html:<hash>` (see `shared/code-layer.ts`'s
 * `nodeIdFor`) that never literally exist in stored markup as a
 * `data-agent-native-node-id` attribute — passing one straight into
 * `figmaSvgNodeSelector` builds a selector that matches nothing in the
 * rendered page, which previously surfaced as an unhandled 500
 * ("No element matched rootSelector ..."). Re-parsing the SAME persisted
 * HTML through the same code-layer projection (mirrors
 * `resolve-selection-source.ts` / `apply-visual-edit`'s target resolution)
 * recomputes the same deterministic ids/selectors, so a live id minted from
 * this content resolves to the same node without needing a live browser for
 * this step. Returns `rootSelector: null` (whole-screen export) with a
 * `warning` when the id can't be resolved at all — callers should surface
 * that warning in the export report instead of throwing.
 */
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
    "rasterized, or omitted. Note: Figma converts all imported SVG <text> to " +
    "outlined vector paths on paste/drag-import — geometry stays pixel-exact " +
    "but the text is no longer live/editable type in Figma; see the report's " +
    "`vectorizedTextCaveat`.",
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
    embedImages,
    width,
    height,
  }) => {
    if (!designId && !fileId) {
      throw new Error("designId or fileId is required.");
    }

    const db = getDb();
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
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

    // Prefer the screen's own saved canvas-frame dimensions (the overview
    // board's per-file width/height) over the 1440x1200 legacy fallback, so
    // the render viewport matches the actual screen frame instead of
    // stretching layout-container widths (e.g. <body>) to an oversized
    // viewport. An explicit `width`/`height` argument still wins.
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

    // A `nodeId` may be a persisted `data-agent-native-node-id` value OR a
    // live-DOM code-layer id (`html:<hash>`) minted by the canvas/bridge,
    // which never exists verbatim in the persisted HTML. Resolve it against
    // the same content this export renders before ever touching a browser,
    // and fail soft (whole-screen export + report warning) instead of
    // letting an unresolved id 500 the render.
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
      // Defense in depth: even a selector resolved above can still miss the
      // live-rendered DOM (e.g. collab content drifted since resolution).
      // Never surface that as a 500 — retry once against the whole screen.
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

    return {
      ok: true,
      designId: file.designId,
      fileId: file.id,
      filename: filenameOut,
      svg: result.svg,
      report: result.report,
      ...saveResult,
    };
  },
});
