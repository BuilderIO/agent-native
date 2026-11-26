import type { PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";

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
