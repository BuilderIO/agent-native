/**
 * Detects syntax that can be parsed as a docs visual block without importing
 * the block registry. Keep this parser fence-aware: JSX-looking examples in a
 * fenced code sample must not promote an ordinary page to the block path.
 */
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
const VISUAL_FENCE_PATTERN = /^\s*`{3,}\s*(?:an-[\w-]+|mermaid)\b/;
const MDX_COMPONENT_PATTERN = /^\s*<[A-Z][A-Za-z0-9-]*(?:\s|\/?>|$)/;

export function hasDocBlockSyntax(markdown: string): boolean {
  let fenceCharacter: "`" | "~" | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fence = FENCE_PATTERN.exec(line)?.[1];
    if (fence) {
      if (!fenceCharacter) {
        if (VISUAL_FENCE_PATTERN.test(line)) return true;
        fenceCharacter = fence[0] as "`" | "~";
      } else if (fence[0] === fenceCharacter) {
        fenceCharacter = null;
      }
      continue;
    }

    if (!fenceCharacter && MDX_COMPONENT_PATTERN.test(line)) return true;
  }

  return false;
}
