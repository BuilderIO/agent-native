import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import type { BuilderBlock } from "@shared/api";
import type { Content, PhrasingContent, ListItem } from "mdast";

let blockIdCounter = 0;
function genId(): string {
  blockIdCounter++;
  return `builder-${Date.now().toString(36)}-${blockIdCounter.toString(36)}`;
}

// AspectRatio in Builder is height / width
const DEFAULT_ASPECT_RATIO = 0.5625; // 16:9 => 9/16

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov"];

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Convert inline mdast nodes to HTML
function inlineToHtml(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "strong":
          return `<strong>${inlineToHtml(node.children)}</strong>`;
        case "emphasis":
          return `<em>${inlineToHtml(node.children)}</em>`;
        case "delete":
          return `<s>${inlineToHtml(node.children)}</s>`;
        case "inlineCode":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "link":
          return `<a href="${escapeAttr(node.url)}">${inlineToHtml(node.children)}</a>`;
        case "image":
          return `<img src="${escapeAttr(node.url)}" alt="${escapeAttr(node.alt || "")}" />`;
        case "break":
          return `<br />`;
        case "html":
          return node.value;
        default:
          return "";
      }
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function makeTextBlock(html: string, marginTop = 20): BuilderBlock {
  return {
    "@type": "@builder.io/sdk:Element",
    id: genId(),
    component: {
      name: "Text",
      options: { text: html },
    },
    responsiveStyles: {
      large: { marginTop: `${marginTop}px` },
    },
  };
}

function makeImageBlock(
  url: string,
  alt: string,
  aspectRatio: number
): BuilderBlock {
  return {
    "@type": "@builder.io/sdk:Element",
    id: genId(),
    component: {
      name: "Image",
      options: {
        image: url,
        aspectRatio,
        altText: alt || "",
        backgroundSize: "cover",
        backgroundPosition: "center",
        lazy: false,
        fitContent: true,
        lockAspectRatio: false,
      },
    },
    responsiveStyles: {
      large: { marginTop: "20px", position: "relative", overflow: "hidden" },
    },
  };
}

function makeVideoBlock(url: string, aspectRatio: number): BuilderBlock {
  return {
    "@type": "@builder.io/sdk:Element",
    id: genId(),
    component: {
      name: "Video",
      options: {
        video: url,
        aspectRatio,
        autoPlay: true,
        muted: true,
        loop: true,
        playsInline: true,
        fit: "cover",
        position: "center",
      },
    },
    responsiveStyles: {
      large: { marginTop: "20px" },
    },
  };
}

function makeCodeBlock(code: string, language: string): BuilderBlock {
  return {
    "@type": "@builder.io/sdk:Element",
    id: genId(),
    component: {
      name: "Code Block",
      options: {
        code,
        language: language || "javascript",
      },
    },
    responsiveStyles: {
      large: {
        marginTop: "20px",
        paddingLeft: "20px",
        borderRadius: "4px",
        paddingRight: "20px",
        backgroundColor: "rgba(40,44,52,1)",
        boxShadow: "0 2px 6px 0 rgba(0,0,0,0.27)",
      },
    },
  };
}

// Convert a list node to HTML
function listToHtml(node: { type: "list"; ordered?: boolean | null; children: ListItem[] }): string {
  const tag = node.ordered ? "ol" : "ul";
  const items = node.children
    .map((li) => {
      const parts = li.children
        .map((child) => {
          if (child.type === "paragraph") {
            return inlineToHtml(child.children);
          }
          if (child.type === "list") {
            return listToHtml(child as any);
          }
          return "";
        })
        .join("");
      return `<li>${parts}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

// Convert a table node to HTML
function tableToHtml(node: { children: any[] }): string {
  const rows = node.children;
  if (!rows.length) return "";

  let html = "<table>";
  rows.forEach((row: any, rowIdx: number) => {
    html += "<tr>";
    const cells = row.children || [];
    cells.forEach((cell: any) => {
      const tag = rowIdx === 0 ? "th" : "td";
      const content = cell.children
        ? inlineToHtml(cell.children)
        : "";
      html += `<${tag}>${content}</${tag}>`;
    });
    html += "</tr>";
  });
  html += "</table>";
  return html;
}

function makeTableBlock(node: { children: any[], align?: Array<string | null> }): BuilderBlock {
  const rows = node.children;
  if (!rows.length) return makeTextBlock("");

  // Store alignments if they exist
  const alignments = node.align || [];

  const headColumns = (rows[0].children || []).map((cell: any, i: number) => {
    const col: any = {
      label: cell.children ? inlineToHtml(cell.children).replace(/<[^>]+>/g, '') : "" // Strip HTML for labels
    };
    if (alignments[i]) {
      col.align = alignments[i];
    }
    return col;
  });

  const bodyRows = rows.slice(1).map((row: any) => ({
    columns: (row.children || []).map((cell: any) => ({
      content: [
        {
          "@type": "@builder.io/sdk:Element",
          "@version": 2,
          id: genId(),
          component: {
            name: "Text",
            options: {
              text: cell.children ? `<p>${inlineToHtml(cell.children)}</p>` : "<p></p>"
            },
            isRSC: null
          }
        }
      ]
    }))
  }));

  return {
    "@type": "@builder.io/sdk:Element",
    id: genId(),
    component: {
      name: "Material Table",
      options: {
        headColumns,
        bodyRows,
        density: "comfortable"
      },
    },
    responsiveStyles: {
      large: { marginTop: "20px" },
    },
  };
}

// Get image dimensions by loading in browser — returns aspect ratio (h/w)
async function getImageAspectRatio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";

    let isResolved = false;
    let timer: NodeJS.Timeout;

    const handleResolve = (ratio: number) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ratio);
    };

    img.onload = () => {
      if (img.naturalWidth > 0) {
        handleResolve(img.naturalHeight / img.naturalWidth);
      } else {
        handleResolve(DEFAULT_ASPECT_RATIO);
      }
    };
    img.onerror = () => handleResolve(DEFAULT_ASPECT_RATIO);

    // Timeout after 5s
    timer = setTimeout(() => handleResolve(DEFAULT_ASPECT_RATIO), 5000);

    img.src = url;
  });
}

// Cache for image aspect ratios
const aspectRatioCache = new Map<string, number>();

async function getCachedAspectRatio(url: string): Promise<number> {
  if (aspectRatioCache.has(url)) {
    return aspectRatioCache.get(url)!;
  }
  const ratio = await getImageAspectRatio(url);
  aspectRatioCache.set(url, ratio);
  return ratio;
}

// Convert a single MDAST node to Builder blocks
async function nodeToBlocks(node: Content): Promise<BuilderBlock[]> {
  switch (node.type) {
    case "heading": {
      const tag = `h${node.depth}`;
      const html = `<${tag}>${inlineToHtml(node.children)}</${tag}>`;
      return [makeTextBlock(html)];
    }

    case "paragraph": {
      // Check if this paragraph is just an image or video
      if (
        node.children.length === 1 &&
        node.children[0].type === "image"
      ) {
        const imgNode = node.children[0];
        if (isVideoUrl(imgNode.url)) {
          return [makeVideoBlock(imgNode.url, DEFAULT_ASPECT_RATIO)];
        }
        const ratio = await getCachedAspectRatio(imgNode.url);
        return [makeImageBlock(imgNode.url, imgNode.alt || "", ratio)];
      }

      // Check if paragraph consists entirely of HTML nodes that form a single video tag
      const textVal = inlineToHtml(node.children).trim();
      const videoMatch = textVal.match(/^<video\s+[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/video>$/i);
      if (videoMatch) {
        return [makeVideoBlock(videoMatch[1], DEFAULT_ASPECT_RATIO)];
      }

      // Handle paragraphs that contain a mix of images and text
      // We should split them into multiple blocks to avoid inline images in Text blocks
      const hasImages = node.children.some(c => c.type === "image");
      if (hasImages && node.children.length > 1) {
        const blocks: BuilderBlock[] = [];
        let currentTextNodes: PhrasingContent[] = [];

        for (const child of node.children) {
          if (child.type === "image") {
            // Flush any accumulated text before the image
            if (currentTextNodes.length > 0) {
              const html = `<p>${inlineToHtml(currentTextNodes)}</p>`;
              blocks.push(makeTextBlock(html));
              currentTextNodes = [];
            }

            // Add the image block
            if (isVideoUrl(child.url)) {
              blocks.push(makeVideoBlock(child.url, DEFAULT_ASPECT_RATIO));
            } else {
              const ratio = await getCachedAspectRatio(child.url);
              blocks.push(makeImageBlock(child.url, child.alt || "", ratio));
            }
          } else {
            // Accumulate text nodes
            currentTextNodes.push(child);
          }
        }

        // Flush any remaining text after the last image
        if (currentTextNodes.length > 0) {
          // If it's just empty text/spaces, skip it
          const html = inlineToHtml(currentTextNodes).trim();
          if (html) {
            blocks.push(makeTextBlock(`<p>${html}</p>`));
          }
        }

        return blocks;
      }

      // Check for standalone link that might be a video
      if (
        node.children.length === 1 &&
        node.children[0].type === "link" &&
        isVideoUrl(node.children[0].url)
      ) {
        return [makeVideoBlock(node.children[0].url, DEFAULT_ASPECT_RATIO)];
      }

      const html = `<p>${inlineToHtml(node.children)}</p>`;
      return [makeTextBlock(html)];
    }

    case "blockquote": {
      const innerHtml = (
        await Promise.all(
          node.children.map(async (child) => {
            if (child.type === "paragraph") {
              return `<p>${inlineToHtml(child.children)}</p>`;
            }
            return "";
          })
        )
      ).join("");
      const block: BuilderBlock = {
        "@type": "@builder.io/sdk:Element",
        id: genId(),
        component: {
          name: "Text",
          options: { text: `<blockquote>${innerHtml}</blockquote>` },
        },
        responsiveStyles: {
          large: {
            marginTop: "20px",
            paddingLeft: "20px",
            borderLeft: "4px solid rgba(150,150,150,0.5)",
          },
        },
      };
      return [block];
    }

    case "code": {
      return [makeCodeBlock(node.value, node.lang || "")];
    }

    case "list": {
      const html = listToHtml(node as any);
      return [makeTextBlock(html)];
    }

    case "table": {
      return [makeTableBlock(node)];
    }

    case "thematicBreak": {
      return [
        {
          "@type": "@builder.io/sdk:Element",
          id: genId(),
          component: {
            name: "Text",
            options: { text: "<hr />" },
          },
          responsiveStyles: {
            large: { marginTop: "20px" },
          },
        },
      ];
    }

    case "html": {
      if (node.value.trim()) {
        const match = node.value.match(/^<video\s+[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/video>$/i);
        if (match) {
          return [makeVideoBlock(match[1], DEFAULT_ASPECT_RATIO)];
        }
        return [makeTextBlock(node.value)];
      }
      return [];
    }

    default:
      return [];
  }
}

export interface MarkdownConversionResult {
  blocks: BuilderBlock[];
  title: string;
  firstParagraph: string;
  wordCount: number;
  imageUrls: string[];
  videoUrls: string[];
}

const conversionCache = new Map<string, Promise<MarkdownConversionResult>>();

export async function markdownToBuilder(
  markdown: string
): Promise<MarkdownConversionResult> {
  if (conversionCache.has(markdown)) {
    return conversionCache.get(markdown)!;
  }

  const promise = (async () => {
    blockIdCounter = 0;

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

    let title = "";
    let firstParagraph = "";
    const imageUrls: string[] = [];
    const videoUrls: string[] = [];

    // First pass: extract metadata
    for (const node of tree.children) {
      if (node.type === "heading" && !title) {
        title = toString(node);
      }
      if (node.type === "paragraph" && !firstParagraph) {
        firstParagraph = toString(node);
      }
      // Collect image/video URLs
      if (node.type === "paragraph") {
        for (const child of node.children) {
          if (child.type === "image") {
            const url = child.url;
            if (isVideoUrl(url)) {
              videoUrls.push(url);
            } else {
              imageUrls.push(url);
            }
          }
        }
      }
    }

    // Pre-fetch all aspect ratios in parallel
    const uniqueUrls = new Set(imageUrls);
    await Promise.all(
      Array.from(uniqueUrls).map(url => getCachedAspectRatio(url))
    );

    // Second pass: convert to blocks
    const rawBlocks: BuilderBlock[] = [];
    for (const node of tree.children) {
      const nodeBlocks = await nodeToBlocks(node);
      rawBlocks.push(...nodeBlocks);
    }

    // Post-processing: Merge consecutive standard Text blocks
    const blocks: BuilderBlock[] = [];
    let currentTextHtml: string[] = [];

    for (const block of rawBlocks) {
      const isText = block.component?.name === "Text";
      const textHtml = isText ? (block.component?.options?.text as string || "") : "";

      // Skip blockquotes as they have custom styling
      const isStandardText = isText && !textHtml.startsWith("<blockquote");

      if (isStandardText) {
        currentTextHtml.push(textHtml);
      } else {
        // Flush current text block if exists
        if (currentTextHtml.length > 0) {
          blocks.push(makeTextBlock(currentTextHtml.join("\n")));
          currentTextHtml = [];
        }
        blocks.push(block);
      }
    }
    // Flush any remaining
    if (currentTextHtml.length > 0) {
      blocks.push(makeTextBlock(currentTextHtml.join("\n")));
    }

    // Word count
    const plainText = toString(tree);
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    return {
      blocks,
      title,
      firstParagraph,
      wordCount,
      imageUrls,
      videoUrls,
    };
  })().catch((error) => {
    conversionCache.delete(markdown);
    throw error;
  });

  conversionCache.set(markdown, promise);

  // Clean up cache periodically or just keep it since it's bounded by edited content
  // Actually, let's limit the cache size to prevent memory leaks
  if (conversionCache.size > 20) {
    const firstKey = conversionCache.keys().next().value;
    if (firstKey) conversionCache.delete(firstKey);
  }

  return promise;
}

// Utility: generate a URL-safe handle from title
export function titleToHandle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Utility: estimate read time (words / 225, rounded up)
export function estimateReadTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 225));
}

// Keyword-based topic/tag detection
const TOPIC_KEYWORDS: Record<string, { keywords: string[]; tags: string[] }> = {
  "AI": {
    keywords: ["ai", "artificial intelligence", "machine learning", "llm", "gpt", "claude", "chatgpt", "copilot", "agent", "prompt", "neural", "deep learning", "generative"],
    tags: ["AI"],
  },
  "Developer Tools": {
    keywords: ["developer", "coding", "programming", "ide", "terminal", "cli", "devtools", "sdk", "api", "framework", "library", "npm", "typescript", "javascript", "react", "nextjs", "vite", "webpack"],
    tags: ["Developer"],
  },
  "Design": {
    keywords: ["design", "figma", "ui", "ux", "visual", "layout", "typography", "color", "mockup", "prototype", "wireframe", "css", "tailwind", "styling"],
    tags: ["Design"],
  },
  "Performance": {
    keywords: ["performance", "speed", "lighthouse", "core web vitals", "lcp", "cls", "fid", "optimization", "lazy load", "bundle size", "caching"],
    tags: ["Performance"],
  },
  "CMS": {
    keywords: ["cms", "headless", "content management", "builder.io", "contentful", "sanity", "strapi", "wordpress"],
    tags: ["CMS"],
  },
  "Product Management": {
    keywords: ["product manager", "pm", "prd", "roadmap", "sprint", "agile", "stakeholder", "user research", "feature", "backlog", "jira", "linear"],
    tags: ["Product"],
  },
};

export function detectTopicAndTags(title: string, content: string): { topic: string; tags: string[] } {
  const text = `${title} ${content}`.toLowerCase();
  const scores: Record<string, number> = {};
  const allTags = new Set<string>();

  for (const [topic, { keywords, tags }] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      // Count occurrences
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      const matches = text.match(regex);
      if (matches) score += matches.length;
    }
    if (score > 0) {
      scores[topic] = score;
      tags.forEach((t) => allTags.add(t));
    }
  }

  // Pick the highest-scoring topic
  const topTopic = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  return {
    topic: topTopic?.[0] || "",
    tags: Array.from(allTags),
  };
}
