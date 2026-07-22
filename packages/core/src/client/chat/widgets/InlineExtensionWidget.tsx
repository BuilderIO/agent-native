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

  return (
    <InlineExtensionFrame
      className="my-1.5"
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
  );
}
