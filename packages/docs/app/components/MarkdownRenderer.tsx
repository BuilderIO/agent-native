/**
 * Renders markdown content as HTML with:
 * - Syntax-highlighted code blocks (via Shiki)
 * - Heading anchor links (clickable # on h2/h3)
 * - Tailwind Typography styling via .docs-content
 *
 * Uses the 'marked' library for markdown→HTML conversion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { marked, type RendererThis, type Tokens } from "marked";
import { codeToHtml } from "shiki";

interface Props {
  markdown: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n")
    .replace(/&amp;?/gi, "&");
}

function isSafeUrl(rawUrl: string, kind: "link" | "image"): boolean {
  const decoded = decodeHtmlEntities(rawUrl).trim();
  if (!decoded) return false;

  const normalized = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("//")
  ) {
    return false;
  }

  if (kind === "image" && lower.startsWith("data:image/")) {
    return /^data:image\/(?:gif|png|jpe?g|webp|avif);base64,/i.test(decoded);
  }

  if (decoded.startsWith("/") || decoded.startsWith("#")) return true;
  if (decoded.startsWith("./") || decoded.startsWith("../")) return true;

  try {
    const url = new URL(decoded);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return !/^[a-z][a-z\d+.-]*:/i.test(lower);
  }
}

// Custom renderer to add IDs to headings and handle {#custom-id} syntax
function createRenderer() {
  const renderer = new marked.Renderer();

  renderer.html = function ({ text }: Tokens.HTML) {
    // Strip HTML comments entirely (used by the docs build for screenshot
    // metadata, e.g. `<!-- screenshot: url=... -->` — should never render).
    // Escape everything else for safety.
    if (/^\s*<!--[\s\S]*?-->\s*$/.test(text)) return "";
    return escapeHtml(text);
  };

  renderer.link = function (this: RendererThis, token: Tokens.Link) {
    const text = this.parser.parseInline(token.tokens);
    if (!isSafeUrl(token.href, "link")) return text;
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<a href="${escapeHtml(token.href)}"${title}>${text}</a>`;
  };

  renderer.image = function (token: Tokens.Image) {
    if (!isSafeUrl(token.href, "image")) return "";
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title}>`;
  };

  // Wrap code blocks in `.code-block` from the start so that the post-hydration
  // shiki swap only replaces the inner <pre> — no margin / structure change.
  renderer.code = function ({ text, lang }: Tokens.Code) {
    const langClass = lang
      ? ` class="language-${escapeHtml(lang)}"`
      : ` class="language-text"`;
    return `<div class="code-block group relative"><pre><code${langClass}>${escapeHtml(text)}</code></pre></div>\n`;
  };

  renderer.heading = function (
    this: RendererThis,
    { tokens, depth }: Tokens.Heading,
  ) {
    // Render inline tokens to HTML so backticks, links, etc. work in headings.
    // marked v9+ passes raw markdown source as `text`; we need parseInline.
    const rendered = this.parser.parseInline(tokens);
    // Extract custom ID from {#my-id} syntax (lives in the rendered text)
    const idMatch = rendered.match(/\s*\{#([\w-]+)\}\s*$/);
    let id: string;
    let displayHtml: string;
    if (idMatch) {
      id = idMatch[1];
      displayHtml = rendered.replace(/\s*\{#[\w-]+\}\s*$/, "");
    } else {
      displayHtml = rendered;
      const plain = rendered.replace(/<[^>]+>/g, "");
      id = plain
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
    const tag = `h${depth}`;
    return `<${tag} id="${id}">${displayHtml}</${tag}>\n`;
  };

  return renderer;
}

export function renderMarkdownToHtml(markdown: string): string {
  const renderer = createRenderer();
  return marked(markdown, { renderer, async: false }) as string;
}

export default function MarkdownRenderer({ markdown }: Props) {
  const articleRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  // Convert markdown to HTML
  const baseHtml = useMemo(() => {
    return renderMarkdownToHtml(markdown);
  }, [markdown]);

  // Highlight code blocks with Shiki after mount
  useEffect(() => {
    let cancelled = false;
    setHighlightedHtml(null);

    async function highlightCodeBlocks(html: string) {
      // Match the inner <pre><code class="language-xxx">...</code></pre> emitted
      // by `renderer.code`. The surrounding `<div class="code-block">` wrapper
      // stays put — we only swap the <pre> contents so margins don't shift.
      const codeBlockPattern =
        /<pre><code class="language-([\w-]+)">([\s\S]*?)<\/code><\/pre>/g;
      const matches: {
        full: string;
        lang: string;
        code: string;
        index: number;
      }[] = [];
      let match;
      while ((match = codeBlockPattern.exec(html)) !== null) {
        matches.push({
          full: match[0],
          lang: match[1],
          code: match[2],
          index: match.index,
        });
      }

      if (matches.length === 0) {
        if (!cancelled) setHighlightedHtml(html);
        return;
      }

      // Highlight all code blocks in parallel
      const highlighted = await Promise.all(
        matches.map(async (m) => {
          const decoded = m.code
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
          try {
            const result = await codeToHtml(decoded, {
              lang: m.lang,
              themes: {
                light: "github-light-default",
                dark: "github-dark-default",
              },
            });
            return { ...m, html: result };
          } catch {
            // Fallback: keep original
            return { ...m, html: m.full };
          }
        }),
      );

      // Replace inner <pre> only — the `.code-block` wrapper from the renderer
      // already lives in the markup, so we don't add another one.
      let result = html;
      for (let i = highlighted.length - 1; i >= 0; i--) {
        const h = highlighted[i];
        result =
          result.slice(0, h.index) +
          h.html +
          result.slice(h.index + h.full.length);
      }

      if (!cancelled) setHighlightedHtml(result);
    }

    highlightCodeBlocks(baseHtml);
    return () => {
      cancelled = true;
    };
  }, [baseHtml]);

  // Add anchor links to headings after render
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;

    const headings = el.querySelectorAll("h2[id], h3[id]");
    for (const heading of headings) {
      if (heading.querySelector(".heading-anchor")) continue;
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.className = "heading-anchor";
      while (heading.firstChild) {
        anchor.appendChild(heading.firstChild);
      }
      const hash = document.createElement("span");
      hash.className = "heading-anchor-hash";
      hash.textContent = "#";
      anchor.appendChild(hash);
      heading.appendChild(anchor);
    }
  }, [highlightedHtml]);

  return (
    <div
      ref={articleRef}
      className="docs-content"
      dangerouslySetInnerHTML={{ __html: highlightedHtml || baseHtml }}
    />
  );
}
