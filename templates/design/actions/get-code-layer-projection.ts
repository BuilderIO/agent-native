import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  type CodeLayerSource,
} from "../shared/code-layer.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";

type ProjectionActionSource = CodeLayerSource & { html?: string };

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const sourceSchema = z.preprocess(
  parseJsonString,
  z.object({
    kind: z
      .enum(["design-file", "inline-html", "local-file", "remote-url"])
      .default("design-file"),
    sourceType: z.enum(["inline", "localhost", "fusion"]).optional(),
    designId: z.string().optional(),
    fileId: z.string().optional(),
    filename: z.string().optional().default("index.html"),
    path: z.string().optional(),
    url: z.string().optional(),
    connectionId: z.string().optional(),
    routeId: z.string().optional(),
    artboardId: z.string().optional(),
    bridgeUrl: z.string().optional(),
    revision: z.string().optional(),
    html: z.string().optional(),
  }),
);

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
    // The stored SQL content remains the deterministic fallback.
  }
  return storedContent;
}

async function resolveDesignFileSource(
  source: ProjectionActionSource,
): Promise<{
  html: string;
  source: CodeLayerSource;
}> {
  if (!source.fileId && !source.designId) {
    throw new Error(
      "source.designId or source.fileId is required for design-file.",
    );
  }

  const db = getDb();
  const conditions = [
    accessFilter(schema.designs, schema.designShares),
    source.fileId
      ? eq(schema.designFiles.id, source.fileId)
      : eq(schema.designFiles.designId, source.designId ?? ""),
  ];
  if (!source.fileId) {
    conditions.push(
      eq(schema.designFiles.filename, source.filename ?? "index.html"),
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
    throw new Error("Design HTML file not found.");
  }
  if (file.fileType !== "html") {
    throw new Error(`Code layer projection only supports HTML files for now.`);
  }

  return {
    html: await liveContent(file.id, file.content ?? ""),
    source: {
      kind: "design-file",
      sourceType: "inline",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      revision: source.revision,
    },
  };
}

export default defineAction({
  description:
    "Build a deterministic Code Layer Projection for an inline/SQL HTML design file. " +
    "The projection maps real source elements to selectable code-backed layer nodes with selectors, spans, layout context, and edit capabilities.",
  schema: z.object({
    source: sourceSchema.describe(
      "Projection source. Use kind=design-file with designId/filename or fileId for SQL-backed Design files; kind=inline-html with html for previews.",
    ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ source }) => {
    const actionSource = source as ProjectionActionSource;

    if (actionSource.kind === "inline-html") {
      const html = actionSource.html ?? "";
      const projectionSource: CodeLayerSource = {
        kind: "inline-html",
        sourceType: "inline",
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const projection = buildCodeLayerProjection(html, {
        source: projectionSource,
      });
      return {
        projection,
        layers: buildCodeLayerTree(projection),
      };
    }

    if (actionSource.kind !== "design-file") {
      const projectionSource: CodeLayerSource = {
        kind: actionSource.kind,
        sourceType:
          actionSource.sourceType ??
          normalizeDesignSourceType(actionSource.kind) ??
          undefined,
        path: actionSource.path,
        url: actionSource.url,
        connectionId: actionSource.connectionId,
        routeId: actionSource.routeId,
        artboardId: actionSource.artboardId,
        bridgeUrl: actionSource.bridgeUrl,
        filename: actionSource.filename,
        revision: actionSource.revision,
      };
      const projection = buildCodeLayerProjection("", {
        source: projectionSource,
      });
      return {
        projection,
        layers: buildCodeLayerTree(projection),
        unsupported: true,
        message:
          "Only inline-html and SQL design-file sources are supported by this action today.",
      };
    }

    const resolved = await resolveDesignFileSource(actionSource);
    const projection = buildCodeLayerProjection(resolved.html, {
      source: resolved.source,
    });
    return {
      projection,
      layers: buildCodeLayerTree(projection),
    };
  },
});
