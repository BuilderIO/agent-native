import { IconExternalLink, IconSparkles } from "@tabler/icons-react";

import { extensionPath } from "../../../extensions/path.js";
import { appPath } from "../../api-path.js";
import { InlineExtensionFrame } from "../../extensions/InlineExtensionFrame.js";
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

export function InlineExtensionWidget({
  context,
}: {
  context: ToolRendererContext;
}) {
  const result = normalizeInlineExtensionToolResult(context);
  if (!result) return null;

  const href = result.path ? appPath(result.path) : undefined;

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconSparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{result.name}</div>
          {result.description ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {result.description}
            </div>
          ) : null}
        </div>
        {href ? (
          <a
            href={href}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Open extension"
          >
            <IconExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
      <InlineExtensionFrame
        extensionId={result.mode === "persisted" ? result.id : undefined}
        extension={{
          id: result.id,
          name: result.name,
          description: result.description,
          content: result.mode === "transient" ? result.content : undefined,
          updatedAt: result.updatedAt,
          mode: result.mode,
        }}
        context={result.context}
        initialHeight={result.initialHeight ?? 260}
      />
    </div>
  );
}
