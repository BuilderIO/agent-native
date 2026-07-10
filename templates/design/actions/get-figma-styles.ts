import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { parseFigmaFileKey } from "../shared/figma-url.js";

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

type FigmaStyleRecord = {
  key?: unknown;
  node_id?: unknown;
  style_type?: unknown;
  name?: unknown;
  description?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export default defineAction({
  description:
    "Summarize a Figma file's published styles (fill/text/effect/grid) by name, description, and node id. This is the file's Styles panel, NOT the Enterprise Variables API — reusable design-system extraction routes through index-design-system-with-builder or the Design System Setup .fig upload. Requires the saved FIGMA_ACCESS_TOKEN secret.",
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

    const envelope = await executeProviderApiRequest({
      provider: "figma",
      method: "GET",
      path: `/files/${fileKey}/styles`,
      maxBytes: 2 * 1024 * 1024,
    });
    const json = providerJson(envelope, "styles") as {
      meta?: { styles?: unknown };
    };
    const records = Array.isArray(json.meta?.styles)
      ? (json.meta!.styles as FigmaStyleRecord[])
      : [];

    const styles = records
      .filter((record) => record && typeof record === "object")
      .map((record) => ({
        key: stringValue(record.key),
        nodeId: stringValue(record.node_id),
        styleType: stringValue(record.style_type),
        name: stringValue(record.name) ?? "Untitled style",
        description: stringValue(record.description),
      }));

    const byType = styles.reduce<Record<string, number>>((acc, style) => {
      const type = style.styleType ?? "UNKNOWN";
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});

    return {
      source: "figma",
      fileKey,
      total: styles.length,
      byType,
      styles,
      guidance:
        "These are the file's published FILL/TEXT/EFFECT/GRID styles (name, description, node id), not the Enterprise Variables API. For reusable design-system extraction use index-design-system-with-builder or the Design System Setup .fig upload instead of hand-mapping these style records.",
    };
  },
});
