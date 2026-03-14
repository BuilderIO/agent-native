import type { BuilderBlock } from "@shared/api";
import TurndownService from "turndown";

// Initialize turndown (HTML to Markdown converter)
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});

function wrapEmphasis(content: string, delimiter: string): string {
  if (!content.trim()) return content;

  const leadingSpace = content.match(/^\s*/)?.[0] || '';
  const trailingSpace = content.match(/\s*$/)?.[0] || '';
  const trimmed = content.trim();

  return `${leadingSpace}${delimiter}${trimmed}${delimiter}${trailingSpace}`;
}

turndownService.addRule('emphasis', {
  filter: ['em', 'i'],
  replacement: function (content, node, options) {
    return wrapEmphasis(content, options.emDelimiter as string);
  }
});

turndownService.addRule('strong', {
  filter: ['strong', 'b'],
  replacement: function (content, node, options) {
    return wrapEmphasis(content, options.strongDelimiter as string);
  }
});

// Keep video tags in markdown instead of stripping them
turndownService.keep(['video', 'iframe', 'kbd', 'details', 'summary', 'figure', 'figcaption']);

// Custom rule for preserving line breaks
turndownService.addRule("lineBreak", {
  filter: "br",
  replacement: () => "  \n",
});

// Fix list formatting
turndownService.addRule('listItems', {
  filter: 'li',
  replacement: function (content, node, options) {
    content = content
      .replace(/^\n+/, '') // remove leading newlines
      .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
      .replace(/\n/gm, '\n    '); // indent

    let prefix = options.bulletListMarker + ' ';
    const parent = node.parentNode as HTMLElement | null;
    if (parent?.nodeName === 'OL') {
      const start = parent.getAttribute('start');
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = (start ? Number(start) + index : index + 1) + '. ';
    }

    return (
      prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
    );
  }
});

/**
 * Convert a Builder.io block array back to Markdown
 */
export function builderToMarkdown(blocks: BuilderBlock[]): string {
  const markdownParts: string[] = [];

  for (const block of blocks) {
    const component = block.component?.name;
    const options = block.component?.options;

    if (!component || !options) {
      continue;
    }

    switch (component) {
      case "Text": {
        let html = options.text as string;
        if (!html) break;

        // If the *previous* block was an Image block, Builder might have left the original
        // <img> tag inside this Text block. Let's strip out any <img> tags from the START
        // of the text block to prevent duplication on the round-trip.
        // We only strip images from the very beginning of the paragraph/block.
        html = html.replace(/^(<p>)?\s*<img[^>]+>\s*/i, '$1');

        // Convert HTML back to Markdown
        const markdown = turndownService.turndown(html);
        markdownParts.push(markdown);
        break;
      }

      case "Image": {
        const url = options.image as string;
        const alt = (options.altText as string) || "";
        if (!url) break;

        markdownParts.push(`![${alt}](${url})`);
        break;
      }

      case "Video": {
        const url = options.video as string;
        if (!url) break;

        // Use HTML video tag for videos (Markdown doesn't have native video support)
        // Add controls="" to match what turndown produces when round-tripping Text blocks
        markdownParts.push(`<video src="${url}" controls=""></video>`);
        break;
      }

      case "Code Block": {
        const code = options.code as string;
        const language = (options.language as string) || "";
        if (!code) break;

        markdownParts.push(`\`\`\`${language}\n${code}\n\`\`\``);
        break;
      }

      case "Material Table": {
        const headColumns = (options.headColumns as any[]) || [];
        const bodyRows = (options.bodyRows as any[]) || [];

        if (headColumns.length === 0 && bodyRows.length === 0) break;

        let tableMd = "";

        // Headers
        const headers = headColumns.map(col => col.label || "");
        tableMd += `| ${headers.join(" | ")} |\n`;

        // Separator
        const separators = headColumns.map((col: any) => {
          if (col.align === "left") return ":---";
          if (col.align === "right") return "---:";
          if (col.align === "center") return ":---:";
          return "---";
        });
        tableMd += `| ${separators.join(" | ")} |\n`;

        // Rows
        for (const row of bodyRows) {
          const cells = (row.columns as any[]) || [];
          const cellTexts = cells.map(cell => {
            // Content is an array of BuilderBlocks (usually Text blocks)
            const contentBlocks = (cell.content as BuilderBlock[]) || [];
            // We can reuse the builderToMarkdown function recursively to convert the cell content
            // However, we need to strip newlines and pipes to avoid breaking the markdown table
            let text = builderToMarkdown(contentBlocks);
            text = text.replace(/\n\n/g, "<br>").replace(/\n/g, " ").replace(/\|/g, "\\|");
            return text;
          });

          // Pad row with empty cells if it's shorter than headers
          while (cellTexts.length < headers.length) {
            cellTexts.push("");
          }

          tableMd += `| ${cellTexts.join(" | ")} |\n`;
        }

        markdownParts.push(tableMd.trimEnd());
        break;
      }

      default:
        // For unknown components, try to extract text if available
        if (options.text) {
          const markdown = turndownService.turndown(options.text as string);
          markdownParts.push(markdown);
        }
    }
  }

  // Join with double newlines between blocks
  return markdownParts.join("\n\n");
}

/**
 * Extract the article title from Builder blocks (first h1)
 */
export function extractTitleFromBlocks(blocks: BuilderBlock[]): string {
  for (const block of blocks) {
    if (block.component?.name === "Text") {
      const html = block.component.options?.text as string;
      if (!html) continue;

      // Check if this is an h1
      const h1Match = html.match(/<h1>(.*?)<\/h1>/i);
      if (h1Match) {
        // Convert HTML to plain text
        const title = turndownService.turndown(h1Match[1]);
        return title;
      }
    }
  }
  return "";
}

/**
 * Remove the title block from the blocks array (if you want to store title separately)
 */
export function removeTitleBlock(blocks: BuilderBlock[]): BuilderBlock[] {
  const result = [...blocks];
  
  for (let i = 0; i < result.length; i++) {
    if (result[i].component?.name === "Text") {
      const html = result[i].component?.options?.text as string;
      if (html?.match(/<h1>/i)) {
        result.splice(i, 1);
        break;
      }
    }
  }
  
  return result;
}
