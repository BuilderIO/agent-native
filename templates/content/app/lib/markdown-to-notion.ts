import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import type { Content, PhrasingContent, ListItem } from "mdast";
import { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";

// Convert inline mdast nodes to Notion Rich Text array
function inlineToRichText(nodes: PhrasingContent[]): any[] {
  let richText: any[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      richText.push({
        type: "text",
        text: { content: node.value },
      });
    } else if (node.type === "strong") {
      const children = inlineToRichText(node.children);
      children.forEach((c) => {
        if (c.annotations) c.annotations.bold = true;
        else c.annotations = { bold: true };
      });
      richText.push(...children);
    } else if (node.type === "emphasis") {
      const children = inlineToRichText(node.children);
      children.forEach((c) => {
        if (c.annotations) c.annotations.italic = true;
        else c.annotations = { italic: true };
      });
      richText.push(...children);
    } else if (node.type === "delete") {
      const children = inlineToRichText(node.children);
      children.forEach((c) => {
        if (c.annotations) c.annotations.strikethrough = true;
        else c.annotations = { strikethrough: true };
      });
      richText.push(...children);
    } else if (node.type === "inlineCode") {
      richText.push({
        type: "text",
        text: { content: node.value },
        annotations: { code: true },
      });
    } else if (node.type === "link") {
      const children = inlineToRichText(node.children);
      children.forEach((c) => {
        c.text.link = { url: node.url };
      });
      richText.push(...children);
    } else if (node.type === "break") {
      // Notion treats \n as a line break in rich text
      richText.push({
        type: "text",
        text: { content: "\n" },
      });
    }
  }

  // Combine consecutive text nodes if they have the same annotations/links
  // (Simplified version: Notion API usually accepts un-merged, but sometimes it's cleaner)

  return richText.length ? richText : [{ type: "text", text: { content: "" } }];
}

function nodeToBlocks(node: Content): BlockObjectRequest[] {
  switch (node.type) {
    case "heading": {
      const depth = Math.min(Math.max(node.depth, 1), 3) as 1 | 2 | 3;
      const type = `heading_${depth}` as const;
      return [
        {
          type: type,
          [type]: {
            rich_text: inlineToRichText(node.children),
          },
        } as any as BlockObjectRequest,
      ];
    }

    case "paragraph": {
      // Handle images inside paragraphs
      if (node.children.length === 1 && node.children[0].type === "image") {
        const img = node.children[0];
        return [
          {
            type: "image",
            image: {
              type: "external",
              external: { url: img.url },
            },
          } as any as BlockObjectRequest,
        ];
      }

      // Mix of text and images is tricky in Notion, let's extract images into separate blocks
      const blocks: BlockObjectRequest[] = [];
      let currentText: PhrasingContent[] = [];

      for (const child of node.children) {
        if (child.type === "image") {
          if (currentText.length > 0) {
            blocks.push({
              type: "paragraph",
              paragraph: { rich_text: inlineToRichText(currentText) },
            } as any as BlockObjectRequest);
            currentText = [];
          }
          blocks.push({
            type: "image",
            image: { type: "external", external: { url: child.url } },
          } as any as BlockObjectRequest);
        } else {
          currentText.push(child);
        }
      }

      if (currentText.length > 0) {
        blocks.push({
          type: "paragraph",
          paragraph: { rich_text: inlineToRichText(currentText) },
        } as any as BlockObjectRequest);
      }

      return blocks;
    }

    case "blockquote": {
      // Collect all text from paragraphs within blockquote
      const richText = node.children.flatMap((child) => {
        if (child.type === "paragraph") return inlineToRichText(child.children);
        return [];
      });
      return [
        {
          type: "quote",
          quote: {
            rich_text: richText.length
              ? richText
              : [{ type: "text", text: { content: "" } }],
          },
        } as any as BlockObjectRequest,
      ];
    }

    case "code": {
      return [
        {
          type: "code",
          code: {
            rich_text: [{ type: "text", text: { content: node.value } }],
            language: (node.lang || "plain text") as any, // Needs mapping to Notion languages ideally
          },
        } as any as BlockObjectRequest,
      ];
    }

    case "list": {
      const isOrdered = node.ordered;
      return node.children.flatMap((li: ListItem) => {
        // We only support simple lists for now
        const richText = li.children.flatMap((child) => {
          if (child.type === "paragraph")
            return inlineToRichText(child.children);
          return [];
        });

        const type = isOrdered ? "numbered_list_item" : "bulleted_list_item";
        return [
          {
            type: type,
            [type]: {
              rich_text: richText.length
                ? richText
                : [{ type: "text", text: { content: "" } }],
            },
          } as any as BlockObjectRequest,
        ];
      });
    }

    case "thematicBreak": {
      return [{ type: "divider", divider: {} } as any as BlockObjectRequest];
    }

    case "table": {
      const rows = node.children; // tableRow nodes
      if (!rows || rows.length === 0) return [];

      // Determine column count from the first row
      const colCount = rows[0].children?.length || 1;

      const tableChildren = rows.map((row: any) => {
        const cells = (row.children || []).map((cell: any) => {
          // Each cell contains phrasing content (paragraph-like children)
          const cellContent = cell.children || [];
          // Flatten: tableCell children are inline phrasing nodes
          const richText = cellContent.flatMap((child: any) => {
            if (child.children) return inlineToRichText(child.children);
            if (child.type === "text")
              return [{ type: "text", text: { content: child.value } }];
            return [];
          });
          return richText.length
            ? richText
            : [{ type: "text", text: { content: "" } }];
        });

        // Pad cells if fewer than colCount
        while (cells.length < colCount) {
          cells.push([{ type: "text", text: { content: "" } }]);
        }

        return {
          type: "table_row",
          table_row: { cells },
        };
      });

      return [
        {
          type: "table",
          table: {
            table_width: colCount,
            has_column_header: true,
            children: tableChildren,
          },
        } as any as BlockObjectRequest,
      ];
    }

    default:
      return [];
  }
}

export function markdownToNotionBlocks(markdown: string): BlockObjectRequest[] {
  let cleanMarkdown = markdown;
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;
  const match = markdown.match(frontmatterRegex);
  if (match) {
    cleanMarkdown = markdown.slice(match[0].length);
  }

  const tree = fromMarkdown(cleanMarkdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const blocks: BlockObjectRequest[] = [];
  for (const node of tree.children) {
    blocks.push(...nodeToBlocks(node));
  }

  return blocks;
}
