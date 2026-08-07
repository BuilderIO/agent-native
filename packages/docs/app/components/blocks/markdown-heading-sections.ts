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
export function splitMarkdownHeadingSections(
  children: string,
): Array<{ title: string; body: string }> {
  const lines = children.split("\n");
  const sections: Array<{ title: string; body: string[] }> = [];
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fenceMarker) {
      fence = fence === null ? fenceMarker : null;
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
