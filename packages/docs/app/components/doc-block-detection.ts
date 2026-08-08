/**
 * Detects syntax that can be parsed as a docs visual block without importing
 * the block registry. False positives are intentionally cheap: they only load
 * the optional renderer for an MDX-ish page.
 */
const BLOCK_FENCE_PATTERN = /^\s*`{3,}\s*(?:an-[\w-]+|mermaid)\b/m;
const MDX_COMPONENT_PATTERN = /^\s*<[A-Z][A-Za-z0-9-]*(?:\s|\/?>)/m;

export function hasDocBlockSyntax(markdown: string): boolean {
  return (
    BLOCK_FENCE_PATTERN.test(markdown) || MDX_COMPONENT_PATTERN.test(markdown)
  );
}
