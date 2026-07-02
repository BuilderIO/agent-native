import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  findSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { buildCodeLayerProjection } from "../shared/code-layer.js";

function offsetToLineColumn(content: string, offset: number) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export default defineAction({
  description:
    "Resolve a selected Design canvas node to the best source file location. " +
    "Inline designs resolve to the containing design file and, when possible, " +
    "a line/column/snippet from the code-layer projection.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      path: z
        .string()
        .optional()
        .describe("Source path/filename, such as index.html"),
      fileId: z.string().optional().describe("Design file ID"),
      nodeId: z
        .string()
        .optional()
        .describe("data-agent-native-node-id or code-layer node id"),
      selector: z.string().optional().describe("CSS selector fallback"),
    })
    .refine((args) => args.path || args.fileId, {
      message: "Provide either path or fileId.",
      path: ["path"],
    }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, path, fileId, nodeId, selector }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: true,
    });
    const file = findSourceWorkspaceFile(workspace.files, { fileId, path });
    const live = await readLiveSourceFile(file);
    const projection = buildCodeLayerProjection(live.content, {
      source: {
        kind: "design-file",
        designId,
        fileId: file.id,
        filename: file.filename,
      },
    });
    const node =
      projection.nodes.find(
        (candidate) =>
          candidate.id === nodeId ||
          candidate.dataAttributes["data-agent-native-node-id"] === nodeId ||
          candidate.dataAttributes["data-code-layer-id"] === nodeId,
      ) ??
      projection.nodes.find((candidate) =>
        selector
          ? candidate.selector === selector ||
            candidate.path === selector ||
            candidate.selectors.includes(selector)
          : false,
      );

    const start = node?.source?.openStart ?? node?.source?.start;
    const location =
      typeof start === "number"
        ? offsetToLineColumn(live.content, start)
        : null;
    const snippet =
      node?.source && typeof node.source.start === "number"
        ? live.content.slice(node.source.start, node.source.end).slice(0, 1200)
        : undefined;

    return {
      designId,
      sourceType: workspace.sourceType,
      backendKind: "virtual-inline",
      path: file.filename,
      fileId: file.id,
      line: location?.line ?? null,
      column: location?.column ?? null,
      snippet,
      resolved: Boolean(node),
    };
  },
});
