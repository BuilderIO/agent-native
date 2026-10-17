export function mermaidBlockPattern(): RegExp {
  return /<div\s+class="mermaid"[^>]*>([\s\S]*?)<\/div>/gi;
}

export function extractMermaidBlocks(content: string): {
  blocks: string[];
  contentWithPlaceholders: string;
} {
  const blocks: string[] = [];
  const contentWithPlaceholders = content.replace(
    mermaidBlockPattern(),
    (_, definition) => {
      blocks.push(String(definition).trim());
      return `<div data-mermaid-index="${blocks.length - 1}"></div>`;
    },
  );
  return { blocks, contentWithPlaceholders };
}
