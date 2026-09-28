import {
  type CodeLayerSource,
  type CodeLayerSourceEdit,
  ensureCodeLayerNodeIdsInHtml,
  wrapBareTextLeavesInHtml,
} from "./code-layer.js";

export function normalizeScreenHtml(
  html: string,
  options: {
    source?: CodeLayerSource;
    onSourceEdit?: (edit: CodeLayerSourceEdit) => void;
  } = {},
): { content: string; changed: boolean } {
  const wrapped = wrapBareTextLeavesInHtml(html, options);
  const stamped = ensureCodeLayerNodeIdsInHtml(wrapped.content, options);
  return {
    content: stamped.content,
    changed: wrapped.changed || stamped.changed,
  };
}

export function annotateScreenHtmlForPersist(
  content: string,
  fileType: string | null | undefined,
): string {
  if ((fileType ?? "html") !== "html") return content;
  if (typeof content !== "string" || !content.trim()) return content;
  try {
    return normalizeScreenHtml(content).content;
  } catch {
    return content;
  }
}
