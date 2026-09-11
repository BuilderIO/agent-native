export interface NotionMarkdownSection {
  heading: string | null;
  headingLevel: number | null;
  markdown: string;
}

export interface NotionMarkdownResult {
  markdown: string;
  sections: NotionMarkdownSection[];
}

export function notionBlocksToMarkdown(
  blocks: readonly unknown[],
): NotionMarkdownResult {
  const sections: NotionMarkdownSection[] = [];
  let current: NotionMarkdownSection = {
    heading: null,
    headingLevel: null,
    markdown: "",
  };
  const flush = () => {
    const markdown = current.markdown.trim();
    if (markdown) sections.push({ ...current, markdown });
  };
  for (const value of blocks) {
    const block = asRecord(value);
    const type = stringValue(block?.type);
    if (!block || !type) continue;
    const line = notionBlockToMarkdown(block, type);
    if (!line) continue;
    const heading = type.match(/^heading_([1-3])$/);
    if (heading) {
      flush();
      const headingLevel = Number(heading[1]);
      current = {
        heading: richText(asRecord(block[type])?.rich_text),
        headingLevel,
        markdown: line,
      };
    } else {
      current.markdown += `${current.markdown ? "\n\n" : ""}${line}`;
    }
  }
  flush();
  return {
    markdown: sections.map((section) => section.markdown).join("\n\n"),
    sections,
  };
}

export function notionBlockToMarkdown(
  block: Record<string, unknown>,
  type = stringValue(block.type) ?? "",
): string {
  const payload = asRecord(block[type]) ?? {};
  const text = richText(payload.rich_text);
  switch (type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return `${"#".repeat(Number(type.slice(-1)))} ${text}`.trim();
    case "bulleted_list_item":
      return `- ${text}`.trim();
    case "numbered_list_item":
      return `1. ${text}`.trim();
    case "to_do":
      return `- [${payload.checked === true ? "x" : " "}] ${text}`.trim();
    case "quote":
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "code":
      return `\`\`\`${stringValue(payload.language) ?? ""}\n${text}\n\`\`\``;
    case "divider":
      return "---";
    case "bookmark":
    case "embed": {
      const url = stringValue(payload.url);
      return url ? `[${url}](${url})` : "";
    }
    case "child_page":
      return `## ${stringValue(payload.title) ?? "Untitled page"}`;
    case "image":
    case "video":
    case "audio":
    case "file":
    case "pdf": {
      const file = asRecord(payload.file) ?? asRecord(payload.external);
      const url = stringValue(file?.url);
      const caption = richText(payload.caption) || type;
      return url ? `![${caption}](${url})` : caption;
    }
    default:
      return text;
  }
}

function richText(value: unknown): string {
  return (Array.isArray(value) ? value : [])
    .map((part) => {
      const record = asRecord(part);
      return (
        stringValue(record?.plain_text) ??
        stringValue(asRecord(record?.text)?.content) ??
        ""
      );
    })
    .join("")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
