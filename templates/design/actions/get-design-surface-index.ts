import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
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
  DesignSurfaceMotionTimeline,
  DesignSurfaceMotionTrack,
  DesignSurfaceState,
  DesignSurfaceReview,
  DesignBreakpoint,
  DesignStateKind,
} from "../shared/design-surface-index.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    // Collab reads are best-effort; SQL content is the deterministic fallback.
  }
  return storedContent;
}

/** Lightweight hash for change detection — djb2 over the UTF-16 code units. */
function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h |= 0; // coerce to int32
  }
  return (h >>> 0).toString(16);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Node extraction from projection ─────────────────────────────────────────

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

// ─── Alpine component extraction ──────────────────────────────────────────────

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

// ─── Token extraction from CSS :root vars ─────────────────────────────────────

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
  // Match :root { ... } block(s) and parse CSS custom-property declarations.
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

// ─── Motion timeline extraction ───────────────────────────────────────────────

async function fetchMotionTimelines(
  db: ReturnType<typeof getDb>,
  designId: string,
  fileId?: string,
): Promise<Record<string, DesignSurfaceMotionTimeline>> {
  // guard:allow-unscoped — run() resolves design access via
  // resolveAccess("design", designId) and throws on null before calling this
  // helper; rows are scoped by designId (motion timelines are children of the
  // design, not independently shareable).
  const rows = await db
    .select({
      id: schema.motionTimeline.id,
      sourceRef: schema.motionTimeline.sourceRef,
      tracks: schema.motionTimeline.tracks,
      durationMs: schema.motionTimeline.durationMs,
      compiledHash: schema.motionTimeline.compiledHash,
    })
    .from(schema.motionTimeline)
    .where(eq(schema.motionTimeline.designId, designId));

  const result: Record<string, DesignSurfaceMotionTimeline> = {};
  for (const row of rows) {
    // Optionally filter to the active file's source ref when provided.
    if (fileId && row.sourceRef && row.sourceRef !== fileId) continue;

    const rawTracks = parseJson<
      Array<{
        target_node_id?: string;
        targetNodeId?: string;
        property?: string;
        keyframes?: unknown[];
      }>
    >(row.tracks, []);

    const tracks: DesignSurfaceMotionTrack[] = rawTracks
      .filter(
        (t) =>
          (t.target_node_id ?? t.targetNodeId) !== undefined &&
          t.property !== undefined,
      )
      .map((t) => ({
        targetNodeId: String(t.target_node_id ?? t.targetNodeId ?? ""),
        property: String(t.property ?? ""),
        keyframeCount: Array.isArray(t.keyframes) ? t.keyframes.length : 0,
      }));

    result[row.id] = {
      timelineId: row.id,
      sourceRef: row.sourceRef ?? fileId ?? "",
      durationMs: row.durationMs ?? 300,
      tracks,
      compiledHash: row.compiledHash ?? undefined,
    };
  }
  return result;
}

// ─── Design state extraction ──────────────────────────────────────────────────

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

// ─── Review snapshot extraction ───────────────────────────────────────────────

async function fetchLatestReview(
  db: ReturnType<typeof getDb>,
  designId: string,
): Promise<DesignSurfaceReview | undefined> {
  // guard:allow-unscoped — run() resolves design access via
  // resolveAccess("design", designId) and throws on null before calling this
  // helper; rows are scoped by designId (review snapshots are children of the
  // design, not independently shareable).
  const rows = await db
    .select({
      id: schema.designReviewSnapshot.id,
      a11yFindings: schema.designReviewSnapshot.a11yFindings,
      baseVersionId: schema.designReviewSnapshot.baseVersionId,
      compareVersionId: schema.designReviewSnapshot.compareVersionId,
      createdAt: schema.designReviewSnapshot.createdAt,
      status: schema.designReviewSnapshot.status,
    })
    .from(schema.designReviewSnapshot)
    .where(
      and(
        eq(schema.designReviewSnapshot.designId, designId),
        eq(schema.designReviewSnapshot.status, "ready"),
      ),
    )
    .limit(1);

  if (!rows.length) return undefined;

  const row = rows[0];
  const rawFindings = parseJson<
    Array<{
      id?: string;
      severity?: string;
      kind?: string;
      message?: string;
      nodeId?: string;
      selector?: string;
      fixAvailable?: boolean;
    }>
  >(row.a11yFindings ?? null, []);

  return {
    snapshotId: row.id,
    auditedAt: row.createdAt ?? null,
    findings: rawFindings.map((f, idx) => ({
      findingId: f.id ?? `finding-${idx}`,
      severity: (f.severity as "error" | "warning" | "info") ?? "info",
      kind:
        (f.kind as
          | "contrast"
          | "tap-target"
          | "focus-visibility"
          | "missing-alt"
          | "missing-label"
          | "missing-role"
          | "reduced-motion"
          | "other") ?? "other",
      message: f.message ?? "",
      nodeId: f.nodeId,
      selector: f.selector,
      fixAvailable: Boolean(f.fixAvailable),
    })),
    baseVersionId: row.baseVersionId ?? undefined,
    compareVersionId: row.compareVersionId ?? undefined,
  };
}

// ─── Action definition ────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Return a lazily-built DesignSurfaceIndex for a design and its active " +
    "source/screen.  The index normalizes the code-layer projection (nodes), " +
    "CSS-var tokens, motion timelines, design states/captures, and the most " +
    "recent accessibility review into one queryable surface that UI panels and " +
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
    includeReview: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include the most recent accessibility review snapshot if one exists. " +
          "Omitted by default for speed.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({
    designId,
    fileId,
    filename,
    selectedNodeId,
    includeNodes,
    includeReview,
  }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const db = getDb();

    // ── Resolve source type ──────────────────────────────────────────────────
    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const capabilities = resolveSourceCapabilities(sourceType);
    const availableCapabilities = Object.entries(capabilities)
      .filter(([, entry]) => entry.status === "available")
      .map(([name]) => name as DesignCapabilityName);

    // ── Resolve HTML file ────────────────────────────────────────────────────
    const fileConditions = [
      accessFilter(schema.designs, schema.designShares),
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

    // ── Build sections in parallel ───────────────────────────────────────────
    const [motionTimelines, designStates, review] = await Promise.all([
      fetchMotionTimelines(db, designId, file.id),
      fetchDesignStates(db, designId),
      includeReview
        ? fetchLatestReview(db, designId)
        : Promise.resolve(undefined),
    ]);

    // Nodes and tokens parse from HTML — only for inline sources today.
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
      ...(Object.keys(motionTimelines).length > 0
        ? { motion: motionTimelines }
        : {}),
      ...(designStates.length > 0 ? { states: designStates } : {}),
      ...(review !== undefined ? { review } : {}),
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
        timelineCount: Object.keys(motionTimelines).length,
        stateCount: designStates.length,
        hasReview: review !== undefined,
        reviewFindingCount: review?.findings.length ?? 0,
      },
    };
  },
});
