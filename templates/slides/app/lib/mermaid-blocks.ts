/**
 * Extracts `<div class="mermaid">...</div>` blocks from raw slide HTML and
 * replaces them with `data-mermaid-index="N"` placeholders, BEFORE any
 * sanitization. The sanitizer round-trips HTML through DOMParser +
 * innerHTML, which HTML-escapes `>` in text nodes to `&gt;` — that mangles
 * diagram arrows like `A --> B` into `A --&gt; B` and breaks the mermaid
 * parser. The extracted definitions are the untouched source of truth for
 * re-rendering (SlideRenderer) and for restoring the original markup when
 * saving edits made elsewhere on the same slide (SlideEditor) — the live DOM
 * replaces each placeholder with a rendered SVG, which must never be
 * serialized back into slide.content or the diagram becomes permanently
 * inert raw SVG with no way to edit or regenerate it.
 */
export function extractMermaidBlocks(content: string): {
  blocks: string[];
  contentWithPlaceholders: string;
} {
  const blocks: string[] = [];
  const contentWithPlaceholders = content.replace(
    /<div\s+class="mermaid"[^>]*>([\s\S]*?)<\/div>/gi,
    (_, definition) => {
      blocks.push(String(definition).trim());
      return `<div data-mermaid-index="${blocks.length - 1}"></div>`;
    },
  );
  return { blocks, contentWithPlaceholders };
}
