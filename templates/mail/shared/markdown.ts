export function normalizeMarkdownHardBreaks(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let inFence = false;
  let fenceChar: "`" | "~" | null = null;

  return lines
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0] as "`" | "~";
        if (!inFence) {
          inFence = true;
          fenceChar = marker;
        } else if (marker === fenceChar) {
          inFence = false;
          fenceChar = null;
        }
        return line;
      }

      if (inFence) return line;
      return line.endsWith("\\") ? line.slice(0, -1) : line;
    })
    .join("\n");
}

export function markdownPreviewSnippet(
  markdown: string,
  maxLength = 120,
): string {
  return normalizeMarkdownHardBreaks(markdown)
    .slice(0, maxLength)
    .replace(/\n/g, " ");
}
