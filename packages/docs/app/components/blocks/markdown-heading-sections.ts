interface FenceMarker {
  char: "`" | "~";
  length: number;
}

function matchFenceOpen(line: string): FenceMarker | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { char: match[1][0] as "`" | "~", length: match[1].length };
}

function isFenceClose(line: string, opener: FenceMarker): boolean {
  const trimmed = line.trim();
  if (trimmed.length < opener.length) return false;
  for (const ch of trimmed) {
    if (ch !== opener.char) return false;
  }
  return true;
}

export function splitMarkdownHeadingSections(
  children: string,
): Array<{ title: string; body: string }> {
  const lines = children.split("\n");
  const sections: Array<{ title: string; body: string[] }> = [];
  let fence: FenceMarker | null = null;

  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line, fence)) fence = null;
    } else {
      const opened = matchFenceOpen(line);
      if (opened) fence = opened;
    }

    const headingMatch = !fence ? /^###\s+(.+)$/.exec(line) : null;
    if (headingMatch) {
      sections.push({ title: headingMatch[1].trim(), body: [] });
      continue;
    }

    sections[sections.length - 1]?.body.push(line);
  }

  return sections
    .filter((section) => section.title)
    .map((section) => ({
      title: section.title,
      body: section.body.join("\n").trim(),
    }));
}
