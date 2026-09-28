import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";

export const SYSTEM_CONTEXT_KEY = "design-home-system";
export const TEMPLATE_CONTEXT_KEY = "design-home-template";

export function formatComposerContext(
  items: PromptComposerSubmitOptions["contextItems"],
): string {
  if (!items?.length) return "";
  return items
    .map((item) => item.context)
    .filter(Boolean)
    .join("\n\n");
}

export function hasComposerSystemContext(
  items: PromptComposerSubmitOptions["contextItems"],
): boolean {
  return Boolean(items?.some((item) => item.key === SYSTEM_CONTEXT_KEY));
}
