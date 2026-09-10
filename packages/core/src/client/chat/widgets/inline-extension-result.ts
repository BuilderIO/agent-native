import { extensionPath } from "../../../extensions/path.js";
import type { ToolRendererContext } from "../tool-render-registry.js";

export interface InlineExtensionToolResult {
  mode: "transient" | "persisted";
  id: string;
  name: string;
  description?: string;
  content?: string;
  path?: string;
  updatedAt?: string;
  context?: Record<string, unknown>;
  initialHeight?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function initialHeightValue(value: unknown): number | undefined {
  const height = Number(value);
  if (!Number.isFinite(height) || height <= 0) return undefined;
  return Math.min(Math.max(Math.round(height), 120), 1000);
}

function normalizeInlineExtension(
  value: unknown,
): InlineExtensionToolResult | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) return null;
  const mode = value.mode === "transient" ? "transient" : "persisted";
  const content = stringValue(value.content);
  if (mode === "transient" && !content) return null;
  return {
    mode,
    id,
    name,
    description: stringValue(value.description),
    content,
    path: stringValue(value.path),
    updatedAt: stringValue(value.updatedAt),
    context: recordValue(value.context),
    initialHeight: initialHeightValue(value.initialHeight),
  };
}

export function normalizeInlineExtensionToolResult(
  context: ToolRendererContext,
): InlineExtensionToolResult | null {
  const result = context.resultJson;
  if (!isRecord(result)) return null;

  const inline = normalizeInlineExtension(result.inlineExtension);
  if (inline) return inline;

  if (isRecord(result.extension)) {
    const id = stringValue(result.extension.id);
    const name = stringValue(result.extension.name);
    if (!id || !name) return null;
    return {
      mode: "persisted",
      id,
      name,
      description: stringValue(result.extension.description),
      path:
        stringValue(result.extension.path) ??
        stringValue(result.path) ??
        extensionPath(id, name),
      updatedAt: stringValue(result.extension.updatedAt),
      context: recordValue(result.context),
      initialHeight: initialHeightValue(result.initialHeight),
    };
  }

  return null;
}
