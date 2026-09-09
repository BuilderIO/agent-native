/**
 * Shared parser for the `### Title` + body authoring shape used by
 * `Steps`/`Cards`/`Comparison`/`Accordion`. All four split their MDX children
 * into per-item sections the same way; this is the one implementation instead
 * of four copies of the same regex.
 *
 * Line-based rather than a single `split + regex` pass for two reasons a
 * regex split can't handle:
 *   - A `###` inside a fenced code block (a code sample showing markdown
 *     syntax, or a comment) must not start a new item.
 *   - An item with a genuinely empty body must still parse back after being
 *     serialized and reformatted — a regex that requires a literal `\n`
 *     after the heading drops the item when there's nothing after it.
 */
interface FenceMarker {
  char: "`" | "~";
  length: number;
}

function matchFenceOpen(line: string): FenceMarker | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { char: match[1][0] as "`" | "~", length: match[1].length };
}

/**
 * Per CommonMark, a fence only closes on a line that is (once trimmed)
 * nothing but the SAME fence character, repeated AT LEAST as many times as
 * the opener. A 4-backtick fence can safely contain a 3-backtick example; a
 * backtick fence can contain a literal `~~~` line. Checking only "does this
 * line look like some fence" (any char, any length >= 3) closes early on
 * either case and starts parsing the remaining example body as real
 * sections.
 */
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
