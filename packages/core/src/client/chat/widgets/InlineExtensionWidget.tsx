import { IconExternalLink, IconSparkles } from "@tabler/icons-react";

import { appPath } from "../../api-path.js";
import { InlineExtensionFrame } from "../../extensions/InlineExtensionFrame.js";
import type { ToolRendererContext } from "../tool-render-registry.js";
import { normalizeInlineExtensionToolResult } from "./inline-extension-result.js";

export {
  normalizeInlineExtensionToolResult,
  type InlineExtensionToolResult,
} from "./inline-extension-result.js";

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
