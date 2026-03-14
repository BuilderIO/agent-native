import {
  BlockObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";

function richTextToMarkdown(richText: any[]): string {
  if (!richText || richText.length === 0) return "";

  return richText
    .map((t) => {
      let text = t.plain_text || t.text?.content || "";
      if (t.annotations) {
        if (t.annotations.code) text = `\`${text}\``;
        if (t.annotations.bold) text = `**${text}**`;
        if (t.annotations.italic) text = `*${text}*`;
        if (t.annotations.strikethrough) text = `~~${text}~~`;
      }
      const href = t.href || t.text?.link?.url;
      if (href) {
        text = `[${text}](${href})`;
      }
      return text;
    })
    .join("");
}

export function notionBlocksToMarkdown(blocks: any[]): string {
  let markdown = "";
  let listLevel = 0;
  let inListType: "bulleted" | "numbered" | null = null;

  for (const block of blocks) {
    // Basic newline between blocks unless they are consecutive list items
    if (
      block.type !== "bulleted_list_item" &&
      block.type !== "numbered_list_item"
    ) {
      if (inListType) {
        markdown += "\n";
        inListType = null;
      }
    }

    switch (block.type) {
      case "paragraph":
        markdown += richTextToMarkdown(block.paragraph.rich_text) + "\n\n";
        break;
      case "heading_1":
        markdown += `# ${richTextToMarkdown(block.heading_1.rich_text)}\n\n`;
        break;
      case "heading_2":
        markdown += `## ${richTextToMarkdown(block.heading_2.rich_text)}\n\n`;
        break;
      case "heading_3":
        markdown += `### ${richTextToMarkdown(block.heading_3.rich_text)}\n\n`;
        break;
      case "bulleted_list_item":
        inListType = "bulleted";
        markdown += `- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}\n`;
        break;
      case "numbered_list_item":
        inListType = "numbered";
        markdown += `1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}\n`;
        break;
      case "quote":
        markdown += `> ${richTextToMarkdown(block.quote.rich_text)}\n\n`;
        break;
      case "code":
        markdown += `\`\`\`${block.code.language}\n${richTextToMarkdown(block.code.rich_text)}\n\`\`\`\n\n`;
        break;
      case "image":
        const url =
          block.image.type === "external"
            ? block.image.external.url
            : block.image.file?.url;
        markdown += `![](${url})\n\n`;
        break;
      case "divider":
        markdown += `---\n\n`;
        break;
      case "table": {
        // Notion tables have children (table_row blocks) embedded via the API
        const rows: any[] = block.table?.children || block.children || [];
        if (rows.length === 0) break;
        const hasHeader = block.table?.has_column_header ?? true;

        const tableRows: string[][] = rows.map((row: any) => {
          const cells: any[] = row.table_row?.cells || [];
          return cells.map((cell: any) => richTextToMarkdown(cell));
        });

        for (let i = 0; i < tableRows.length; i++) {
          markdown += "| " + tableRows[i].join(" | ") + " |\n";
          // Add separator after the first row (header)
          if (i === 0) {
            markdown +=
              "| " + tableRows[i].map(() => "-----").join(" | ") + " |\n";
          }
        }
        markdown += "\n";
        break;
      }
      case "table_row":
        // table_row blocks are handled inside the "table" case above
        break;
      default:
        // Ignore unsupported blocks
        break;
    }
  }

  return markdown.trim();
}
