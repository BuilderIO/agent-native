import { clearNativeFillFromHtml } from "@shared/native-effect-edits";
import {
  parseEffectsFromHtml,
  updateNativeInstanceInHtml,
} from "@shared/native-effects";

export type FillStyleIntent = "replace" | "hide" | "show";

export function applyFillStyleIntent(
  html: string,
  nodeId: string,
  intent: FillStyleIntent,
): string {
  if (intent === "replace") {
    const result = clearNativeFillFromHtml(html, nodeId);
    if (result.errors.length) throw new Error(result.errors.join("; "));
    return result.html;
  }
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
  let next = html;
  for (const instance of parsed.document?.instances ?? []) {
    if (instance.nodeId !== nodeId || instance.placement !== "fill") continue;
    const result = updateNativeInstanceInHtml(next, instance.id, {
      enabled: intent === "show",
    });
    if (result.errors.length) throw new Error(result.errors.join("; "));
    next = result.html;
  }
  return next;
}
