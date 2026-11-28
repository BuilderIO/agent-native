import { defineAction, fail } from "@agent-native/core/action";
import {
  accessFilter,
  roleSatisfies,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import "../server/db/index.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import {
  buildCodeLayerProjection,
  type CodeLayerSource,
} from "../shared/code-layer.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import type { DesignCapabilityName } from "../shared/design-source-capabilities.js";
import type {
  DesignSurfaceIndex,
  DesignSurfaceNode,
  DesignSurfaceComponent,
  DesignSurfaceToken,
  DesignSurfaceState,
  DesignBreakpoint,
  DesignStateKind,
} from "../shared/design-surface-index.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

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

function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

function extractNodes(
  html: string,
  codeLayerSource: CodeLayerSource,
  selectedNodeId?: string,
): Record<string, DesignSurfaceNode> {
  const projection = buildCodeLayerProjection(html, {
    source: codeLayerSource,
  });

  const nodeMap: Record<string, DesignSurfaceNode> = {};
  for (const node of projection.nodes) {
    nodeMap[node.id] = {
      nodeId: node.id,
      layerName: node.layerName,
      tag: node.tag,
      selector: node.selector,
      parentNodeId: node.parentId,
      childNodeIds: node.children,
      selected: selectedNodeId ? node.id === selectedNodeId : undefined,
    };
  }
  return nodeMap;
}

function extractAlpineComponents(
  html: string,
  codeLayerSource: CodeLayerSource,
): DesignSurfaceComponent[] {
  const projection = buildCodeLayerProjection(html, {
    source: codeLayerSource,
  });

  const componentMap: Map<string, DesignSurfaceComponent> = new Map();

  for (const node of projection.nodes) {
    const compAttr =
      node.dataAttributes["data-agent-native-component"] ??
      node.attributes["data-agent-native-component"];
    const compName = typeof compAttr === "string" ? compAttr : undefined;
    if (!compName) continue;

    const existing = componentMap.get(compName);
    if (existing) {
      existing.instanceNodeIds.push(node.id);
    } else {
      componentMap.set(compName, {
        componentId: `alpine-${compName.toLowerCase().replace(/\s+/g, "-")}`,
        kind: "alpine-annotation",
        name: compName,
        instanceNodeIds: [node.id],
      });
    }
  }

  return Array.from(componentMap.values());
}

function guessTokenKind(
  varName: string,
):
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "motion"
  | "other" {
  const n = varName.toLowerCase();
  if (
    n.includes("color") ||
    n.includes("bg") ||
    n.includes("fill") ||
    n.includes("accent") ||
    n.includes("brand") ||
    n.includes("primary") ||
    n.includes("secondary") ||
    n.includes("muted") ||
    n.includes("foreground") ||
    n.includes("background")
  )
    return "color";
  if (
    n.includes("font") ||
    n.includes("text") ||
    n.includes("size") ||
    n.includes("weight") ||
    n.includes("line-height") ||
    n.includes("letter")
  )
    return "typography";
  if (n.includes("radius") || n.includes("rounded")) return "radius";
  if (
    n.includes("spacing") ||
    n.includes("gap") ||
    n.includes("padding") ||
    n.includes("margin")
  )
    return "spacing";
  if (n.includes("shadow")) return "shadow";
  if (
    n.includes("duration") ||
    n.includes("delay") ||
    n.includes("ease") ||
    n.includes("animation") ||
    n.includes("transition")
  )
    return "motion";
  return "other";
}

function friendlyLabel(cssVar: string): string {
  return cssVar
    .replace(/^--/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function extractTokensFromHtml(html: string): DesignSurfaceToken[] {
  const tokens: DesignSurfaceToken[] = [];
  const rootBlocks = html.match(/:root\s*\{([^}]*)\}/g) ?? [];
  const seen = new Set<string>();

  for (const block of rootBlocks) {
    const inner = block.replace(/:root\s*\{/, "").replace(/\}$/, "");
    const declarations = inner.match(/--[a-zA-Z0-9_-]+\s*:[^;]+;/g) ?? [];
    for (const decl of declarations) {
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) continue;
      const varName = decl.slice(0, colonIdx).trim();
      const value = decl
        .slice(colonIdx + 1)
        .replace(/;$/, "")
        .trim();
      if (!varName.startsWith("--") || seen.has(varName)) continue;
      seen.add(varName);
      tokens.push({
        tokenId: varName,
        kind: guessTokenKind(varName),
        label: friendlyLabel(varName),
        cssVar: varName,
        resolvedValue: value,
      });
    }
  }
  return tokens;
}

async function fetchDesignStates(
  db: ReturnType<typeof getDb>,
  designId: string,
): Promise<DesignSurfaceState[]> {
  // guard:allow-unscoped — run() resolves design access via
  // resolveAccess("design", designId) and throws on null before calling this
  // helper; rows are scoped by designId (design states are children of the
  // design, not independently shareable).
  const rows = await db
    .select({
      id: schema.designState.id,
      kind: schema.designState.kind,
      name: schema.designState.name,
      breakpoint: schema.designState.breakpoint,
      route: schema.designState.route,
      fixtureData: schema.designState.fixtureData,
      captureData: schema.designState.captureData,
      previewRef: schema.designState.previewRef,
    })
    .from(schema.designState)
    .where(eq(schema.designState.designId, designId));

  return rows.map((row) => ({
    stateId: row.id,
    kind: (row.kind ?? "state") as DesignStateKind,
    name: row.name,
    breakpoint: (row.breakpoint ?? "auto") as DesignBreakpoint,
    route: row.route ?? undefined,
    hasData: Boolean(row.fixtureData ?? row.captureData),
    previewRef: row.previewRef ?? undefined,
  }));
}

export default defineAction({
  description:
    "Return a lazily-built DesignSurfaceIndex for a design and its active " +
    "source/screen.  The index normalizes the code-layer projection (nodes), " +
    "CSS-var tokens and design states/captures " +
    "into one queryable surface that UI panels and " +
    "agent actions read. " +
    "Components are extracted from Alpine data-agent-native-component annotations " +
    "for inline designs; for real-app sources the index is populated by the " +
    "index-components action. " +
    "Pass includeNodes=false to skip the full node map when you only need tokens " +
    "or capabilities. No cache — always built fresh from the live source.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Design file ID to read HTML from (defaults to index.html when omitted).",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe("Filename to resolve when fileId is not provided."),
    selectedNodeId: z
      .string()
      .optional()
      .describe(
        "Currently selected node id — marks the matching node as selected in the index.",
      ),
    includeNodes: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Include the full node map derived from the code-layer projection. " +
          "Set to false when you only need tokens/states/capabilities.",
      ),
  }),
  readOnly: true,
  dedupe: false,
  http: { method: "GET" },
  mcpTool: "search",
  run: async ({ designId, fileId, filename, selectedNodeId, includeNodes }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      fail("Design not found", { errorCode: "not_found", statusCode: 404 });
    }

    const db = getDb();

    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const capabilities = resolveSourceCapabilities(sourceType);
    const availableCapabilities = Object.entries(capabilities)
      .filter(([, entry]) => entry.status === "available")
      .map(([name]) => name as DesignCapabilityName);

    const fileConditions = [
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.designId, designId),
    ];
    if (!fileId) {
      fileConditions.push(
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
      .where(and(...fileConditions))
      .limit(1);

    if (!file) {
      throw new Error("Design HTML file not found.");
    }

    const html = await liveContent(file.id, file.content ?? "");
    const hash = contentHash(html);

    const codeLayerSource: CodeLayerSource = {
      kind: "design-file",
      sourceType: "inline",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
    };

    const [designStates] = await Promise.all([
      roleSatisfies(access.role, "editor")
        ? fetchDesignStates(db, designId)
        : Promise.resolve([]),
    ]);

    let nodes: Record<string, DesignSurfaceNode> | undefined;
    let components: DesignSurfaceComponent[] | undefined;
    let tokens: DesignSurfaceToken[] | undefined;

    if (sourceType === "inline" && file.fileType === "html") {
      if (includeNodes) {
        nodes = extractNodes(html, codeLayerSource, selectedNodeId);
      }
      components = extractAlpineComponents(html, codeLayerSource);
      if (hasCapability(capabilities, "indexTokens")) {
        tokens = extractTokensFromHtml(html);
      }
    }

    const index: DesignSurfaceIndex = {
      version: 1,
      source: {
        sourceType,
        sourceRef: file.id,
        contentHash: hash,
        indexedAt: new Date().toISOString(),
        availableCapabilities,
      },
      ...(nodes !== undefined ? { nodes } : {}),
      ...(components !== undefined && components.length > 0
        ? { components }
        : {}),
      ...(tokens !== undefined && tokens.length > 0 ? { tokens } : {}),
      ...(designStates.length > 0 ? { states: designStates } : {}),
    };

    return {
      index,
      designId,
      fileId: file.id,
      filename: file.filename,
      sourceType,
      availableCapabilities,
      summary: {
        nodeCount: nodes ? Object.keys(nodes).length : null,
        componentCount: components?.length ?? 0,
        tokenCount: tokens?.length ?? 0,
        stateCount: designStates.length,
      },
    };
  },
});
