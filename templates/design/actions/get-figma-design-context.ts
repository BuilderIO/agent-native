import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  fetchFigmaRenderUrl,
  summarizeFigmaNode,
} from "../server/lib/figma-design-context.js";
import {
  fetchFigmaNode,
  fetchFileStructure,
  type FigmaFileDepthNode,
} from "../server/lib/figma-node-import.js";
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
  })
  .refine((value) => value.figmaUrl || value.fileKey, {
    message: "Pass figmaUrl or fileKey.",
    path: ["figmaUrl"],
  });

function summarizeStructure(document: FigmaFileDepthNode) {
  return (document.children ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    type: page.type,
    frames: (page.children ?? []).map((frame) => ({
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
      throw new Error("Could not find a Figma file key in the provided URL.");
    }
    const nodeId =
      parseFigmaNodeId(args.nodeId) ?? parseFigmaNodeId(args.figmaUrl);

    if (!nodeId) {
      const document = await fetchFileStructure(fileKey, 3);
      const pages = summarizeStructure(document);
      return {
        source: "figma",
        fileKey,
        mode: "overview" as const,
        pages,
        guidance:
          "No nodeId was given, so this lists the file's pages and top-level frames only (mirrors the official Figma MCP's get_metadata with no node id). Call get-figma-design-context again with one of these frame ids (or a node-id link) for a full structural summary and screenshot of that frame.",
      };
    }

    const node = await fetchFigmaNode(fileKey, nodeId);
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
