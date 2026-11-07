import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  fetchFigmaRenderUrl,
  summarizeFigmaNode,
} from "../server/lib/figma-design-context.js";
import {
  FIGMA_IMPORT_ERROR_CODES,
  failFigmaImport,
  isFigmaPayloadTooLargeError,
} from "../server/lib/figma-import-errors.js";
import {
  fetchFigmaNodes,
  fetchFileStructure,
  openOutlineSections,
  type FigmaFileDepthNode,
} from "../server/lib/figma-node-import.js";
import type { FigmaNode } from "../server/lib/figma-node-to-html.js";
import { parseFigmaFileKey, parseFigmaNodeId } from "../shared/figma-url.js";

const schemaInput = z
  .object({
    figmaUrl: z
      .string()
      .trim()
      .optional()
      .describe(
        "Figma file/frame URL, e.g. https://www.figma.com/design/<fileKey>/<name>?node-id=<id>.",
      ),
    fileKey: z
      .string()
      .trim()
      .optional()
      .describe("Figma file key. Used when figmaUrl is omitted or has no key."),
    nodeId: z
      .string()
      .trim()
      .optional()
      .describe(
        "Figma node id (colon or dash form). Used when figmaUrl has no node-id. " +
          "Omit both to get an overview of the file's pages and top-level frames first.",
      ),
    depth: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(4)
      .describe(
        "How many levels of children to expand below the requested node before truncating (only applies when nodeId is resolved).",
      ),
    maxNodes: z.coerce
      .number()
      .int()
      .min(10)
      .max(1000)
      .default(300)
      .describe(
        "Safety cap on total nodes summarized, to bound response size.",
      ),
    includeScreenshot: z
      .boolean()
      .default(true)
      .describe(
        "Also fetch a rendered screenshot URL for the requested node via the Figma images REST endpoint.",
      ),
    screenshotFormat: z.enum(["png", "svg"]).default("png"),
    pagesOnly: z
      .boolean()
      .optional()
      .describe(
        "With no nodeId, list only the file's pages (frames: null), one small request even for very large files. Call again with a page id to list its frames.",
      ),
  })
  .refine((value) => value.figmaUrl || value.fileKey, {
    message: "Pass figmaUrl or fileKey.",
    path: ["figmaUrl"],
  });

function summarizeStructure(document: FigmaFileDepthNode) {
  function framesInSections(nodes: FigmaFileDepthNode[]): FigmaFileDepthNode[] {
    return nodes.flatMap((node) =>
      node.type === "SECTION" ? framesInSections(node.children ?? []) : [node],
    );
  }
  return (document.children ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    type: page.type,
    frames: framesInSections(page.children ?? []).map((frame) => ({
      id: frame.id,
      name: frame.name,
      type: frame.type,
      childCount: frame.children?.length ?? 0,
    })),
  }));
}

export default defineAction({
  description:
    "Answer 'what's in this Figma file/frame?' with a compact, LLM-friendly structural summary — the chat equivalent of the official Figma MCP's get_metadata + get_design_context (read-only, no screen is created; use import-figma-frame to actually bring a frame into Design as an editable screen). Pass only figmaUrl/fileKey to get an overview of the file's pages and top-level frames (like get_metadata with no node id); pass a nodeId (or a node-id link) to get a depth-limited node tree with box geometry, fills/strokes/effects/corner-radii, auto-layout, text/style, and (by default) a rendered screenshot URL for that node. Requires the saved FIGMA_ACCESS_TOKEN secret.",
  schema: schemaInput,
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const fileKey =
      parseFigmaFileKey(args.fileKey) ?? parseFigmaFileKey(args.figmaUrl);
    if (!fileKey) {
      failFigmaImport(
        "Could not find a Figma file key in the provided URL.",
        FIGMA_IMPORT_ERROR_CODES.urlInvalid,
      );
    }
    const nodeId =
      parseFigmaNodeId(args.nodeId) ?? parseFigmaNodeId(args.figmaUrl);

    if (!nodeId) {
      const listPages = async () => {
        const pagesOnly = await fetchFileStructure(fileKey, 1);
        return {
          source: "figma",
          fileKey,
          mode: "overview" as const,
          pages: (pagesOnly.children ?? []).map((page) => ({
            id: page.id,
            name: page.name,
            type: page.type,
            frames: null,
          })),
          guidance:
            "Only the file's pages are listed (frames: null means not listed, not empty). Call get-figma-design-context again with a page id as nodeId to list that page's frames.",
        };
      };
      if (args.pagesOnly) return listPages();
      let document: FigmaFileDepthNode;
      try {
        document = await fetchFileStructure(fileKey, 3);
      } catch (error) {
        if (!isFigmaPayloadTooLargeError(error)) throw error;
        // A large file's frames outgrow one response; its pages alone fit.
        return listPages();
      }
      return {
        source: "figma",
        fileKey,
        mode: "overview" as const,
        pages: summarizeStructure(document),
        guidance:
          "No nodeId was given, so this lists the file's pages and top-level frames, including frames within sections present in the depth-3 overview (get_metadata). Deeper section contents may not be included. Call get-figma-design-context again with a frame id or node-id link for its structural summary and screenshot.",
      };
    }

    // One bounded request serves both a page (its frames, sections opened)
    // and a frame (the summary reads `depth` levels; one more shows where it
    // was truncated). The summary needs no vector geometry.
    const node = await fetchBoundedNode(
      fileKey,
      nodeId,
      Math.max(2, args.depth + 1),
    );
    if (!node) {
      failFigmaImport(
        `Figma node ${nodeId} was not found in file ${fileKey}.`,
        FIGMA_IMPORT_ERROR_CODES.nodeNotFound,
        { statusCode: 404 },
      );
    }
    if (node.type === "CANVAS") {
      // A page link (Figma's "Copy link" with nothing selected) names a page,
      // which has no geometry to summarize; list its frames instead, up to
      // the same `maxNodes` cap a node summary honors.
      const summarized = summarizeStructure({ children: [node] });
      const pages = summarized.map((page) => ({
        ...page,
        frames: page.frames.slice(0, args.maxNodes),
      }));
      const total = summarized.reduce(
        (sum, page) => sum + page.frames.length,
        0,
      );
      const listed = pages.reduce((sum, page) => sum + page.frames.length, 0);
      return {
        source: "figma",
        fileKey,
        mode: "overview" as const,
        pages,
        ...(total > listed ? { truncated: true, totalFrames: total } : {}),
        guidance:
          total > listed
            ? `This link names a page with ${total} top-level layers; the first ${listed} are listed (maxNodes). Call again with a larger maxNodes to see more, or with a frame id for its structural summary and screenshot.`
            : "This link names a page, so this lists its top-level frames, with sections opened. Call get-figma-design-context again with a frame id for its structural summary and screenshot.",
      };
    }
    const {
      node: summary,
      nodeCount,
      truncated,
    } = summarizeFigmaNode(node, {
      maxDepth: args.depth,
      maxNodes: args.maxNodes,
    });
    const screenshotUrl = args.includeScreenshot
      ? await fetchFigmaRenderUrl(fileKey, nodeId, args.screenshotFormat)
      : null;

    return {
      source: "figma",
      fileKey,
      nodeId,
      mode: "node" as const,
      nodeCount,
      truncated,
      summary,
      screenshotUrl,
      guidance: truncated
        ? "This tree was truncated by depth or node-count limits (see truncatedDepth/truncatedChildren on individual nodes). Re-run with a larger depth/maxNodes, or target a nested nodeId directly, to see more. To bring this frame into Design as a real editable screen, use import-figma-frame instead of hand-reconstructing it from this summary."
        : "To bring this frame into Design as a real editable screen (not just this summary), use import-figma-frame.",
    };
  },
});

/**
 * A node read to `depth` levels. When that is too large and the node turns
 * out to be a page, shallower outlines still list its frames (two levels opens
 * sections; one level lists the page's top layers). Anything else too large
 * stays an error: a frame summary needs its real depth.
 */
async function fetchBoundedNode(
  fileKey: string,
  nodeId: string,
  depth: number,
): Promise<FigmaNode | undefined> {
  const read = async (levels: number) => {
    const node = Object.values(
      await fetchFigmaNodes(fileKey, [nodeId], false, levels),
    ).find((candidate) => candidate.id === nodeId);
    return node?.type === "CANVAS" && node.children
      ? {
          ...node,
          children: await openOutlineSections(fileKey, node.children),
        }
      : node;
  };
  try {
    return await read(depth);
  } catch (error) {
    if (!isFigmaPayloadTooLargeError(error)) throw error;
    for (const levels of [2, 1].filter((value) => value < depth)) {
      let outline: FigmaNode | undefined;
      try {
        outline = await read(levels);
      } catch (outlineError) {
        if (isFigmaPayloadTooLargeError(outlineError)) continue;
        throw outlineError;
      }
      if (outline?.type === "CANVAS") return outline;
      break;
    }
    throw error;
  }
}
