import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { parseFigmaFileKey } from "../shared/figma-url.js";

const FigmaRenderFormatSchema = z.enum(["svg", "png"]).default("svg");

const schemaInput = z
  .object({
    fileUrl: z
      .string()
      .trim()
      .optional()
      .describe(
        "Figma file URL, for example https://www.figma.com/design/<fileKey>/...",
      ),
    fileKey: z
      .string()
      .trim()
      .optional()
      .describe("Figma file key. Used when fileUrl is omitted."),
    query: z
      .string()
      .trim()
      .optional()
      .describe("Optional case-insensitive search over names/descriptions."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(64)
      .default(48)
      .describe("Maximum number of Figma library assets to return."),
    renderFormat: FigmaRenderFormatSchema.describe(
      "Image format for insertable render URLs.",
    ),
  })
  .refine((value) => value.fileUrl || value.fileKey, {
    message: "Pass fileUrl or fileKey.",
    path: ["fileUrl"],
  });

type FigmaProviderEnvelope = {
  response?: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    json?: unknown;
    text?: string;
  };
};

type FigmaAssetKind = "component" | "component_set";

type FigmaComponentRecord = {
  key?: unknown;
  file_key?: unknown;
  node_id?: unknown;
  name?: unknown;
  description?: unknown;
  thumbnail_url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  containing_frame?: unknown;
  user?: unknown;
};

type FigmaImageResponse = {
  images?: Record<string, string | null | undefined>;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function figmaNodeUrl(
  fileKey: string,
  nodeId: string,
  fileUrl?: string,
): string {
  const nodeParam = nodeId.replace(/:/g, "-");
  try {
    const url = new URL(fileUrl || `https://www.figma.com/design/${fileKey}`);
    url.searchParams.set("node-id", nodeParam);
    return url.href;
  } catch {
    return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(
      nodeParam,
    )}`;
  }
}

function recordSearchText(record: FigmaComponentRecord): string {
  const frame =
    record.containing_frame &&
    typeof record.containing_frame === "object" &&
    "name" in record.containing_frame
      ? stringValue((record.containing_frame as { name?: unknown }).name)
      : null;
  return [stringValue(record.name), stringValue(record.description), frame]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuery(record: FigmaComponentRecord, query: string | undefined) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  return recordSearchText(record).includes(normalized);
}

function normalizeFigmaRecords(
  value: unknown,
  kind: FigmaAssetKind,
): FigmaComponentRecord[] {
  if (!value || typeof value !== "object") return [];
  const meta = (value as { meta?: unknown }).meta;
  const key = kind === "component" ? "components" : "component_sets";
  const records =
    meta && typeof meta === "object"
      ? (meta as Record<string, unknown>)[key]
      : undefined;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is FigmaComponentRecord =>
      !!record && typeof record === "object",
  );
}

function providerJson(envelope: unknown, label: string): unknown {
  const response = (envelope as FigmaProviderEnvelope | null)?.response;
  if (!response) throw new Error(`Figma ${label} response was empty.`);
  if (response.ok === false) {
    const detail =
      stringValue(response.text) ||
      response.statusText ||
      `HTTP ${response.status ?? "error"}`;
    throw new Error(`Figma ${label} request failed: ${detail}`);
  }
  return response.json;
}

async function figmaGet(path: string, query?: Record<string, unknown>) {
  return executeProviderApiRequest({
    provider: "figma",
    method: "GET",
    path,
    query,
    maxBytes: 2 * 1024 * 1024,
  });
}

export default defineAction({
  description:
    "List reusable assets from a Figma file for the Design asset panel. Returns components and component sets with thumbnails, insertable render URLs, and source provenance. Requires a saved FIGMA_ACCESS_TOKEN secret.",
  schema: schemaInput,
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const fileKey =
      parseFigmaFileKey(args.fileKey) ?? parseFigmaFileKey(args.fileUrl);
    if (!fileKey) {
      throw new Error("Could not find a Figma file key in the provided URL.");
    }

    const limit = numberOrDefault(args.limit, 48);
    const [componentsEnvelope, componentSetsEnvelope] = await Promise.all([
      figmaGet(`/files/${fileKey}/components`),
      figmaGet(`/files/${fileKey}/component_sets`),
    ]);
    const componentRecords = normalizeFigmaRecords(
      providerJson(componentsEnvelope, "components"),
      "component",
    )
      .filter((record) => matchesQuery(record, args.query))
      .map((record) => ({ kind: "component" as const, record }));
    const componentSetRecords = normalizeFigmaRecords(
      providerJson(componentSetsEnvelope, "component sets"),
      "component_set",
    )
      .filter((record) => matchesQuery(record, args.query))
      .map((record) => ({ kind: "component_set" as const, record }));

    const rawItems = [...componentRecords, ...componentSetRecords].slice(
      0,
      limit,
    );
    const renderIds = rawItems
      .map((item) => stringValue(item.record.node_id))
      .filter((id): id is string => !!id);
    let rendered: Record<string, string | null | undefined> = {};
    if (renderIds.length > 0) {
      const imagesEnvelope = await figmaGet(`/images/${fileKey}`, {
        ids: renderIds.join(","),
        format: args.renderFormat,
        svg_include_id: true,
      });
      const images = providerJson(
        imagesEnvelope,
        "images",
      ) as FigmaImageResponse;
      rendered = images.images ?? {};
    }

    const assets = rawItems
      .map(({ kind, record }) => {
        const nodeId = stringValue(record.node_id);
        const key = stringValue(record.key);
        const name = stringValue(record.name) ?? "Untitled Figma asset";
        const description = stringValue(record.description);
        const thumbnailUrl = stringValue(record.thumbnail_url);
        const renderUrl = nodeId ? stringValue(rendered[nodeId]) : null;
        const containingFrame =
          record.containing_frame && typeof record.containing_frame === "object"
            ? {
                name:
                  stringValue(
                    (record.containing_frame as { name?: unknown }).name,
                  ) ?? null,
                nodeId:
                  stringValue(
                    (record.containing_frame as { nodeId?: unknown }).nodeId,
                  ) ??
                  stringValue(
                    (record.containing_frame as { node_id?: unknown }).node_id,
                  ),
              }
            : null;

        return {
          id: `figma:${fileKey}:${nodeId ?? key ?? name}`,
          kind,
          fileKey,
          nodeId,
          componentKey: key,
          name,
          description,
          thumbnailUrl,
          renderUrl,
          insertUrl: renderUrl ?? thumbnailUrl,
          sourceUrl: nodeId
            ? figmaNodeUrl(fileKey, nodeId, args.fileUrl)
            : null,
          containingFrame,
          createdAt: stringValue(record.created_at),
          updatedAt: stringValue(record.updated_at),
        };
      })
      .filter((asset) => asset.nodeId || asset.componentKey);

    return {
      source: "figma",
      fileKey,
      query: args.query ?? null,
      renderFormat: args.renderFormat,
      total: componentRecords.length + componentSetRecords.length,
      returned: assets.length,
      assets,
      guidance:
        "Use renderUrl/insertUrl with insert-asset and preserve fileKey, nodeId, componentKey, and sourceUrl for provenance. Components/component sets are reusable Figma library assets; styles and variables belong in design-system token sync.",
    };
  },
});
