/**
 * Renders markdown content as HTML with:
 * - Syntax-highlighted code blocks (via Shiki)
 * - Heading anchor links (clickable # on h2/h3)
 * - Tailwind Typography styling via .docs-content
 *
 * Uses the 'marked' library for markdown→HTML conversion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { codeToHtml } from "shiki";

interface Props {
  markdown: string;
}

// Custom renderer to add IDs to headings and handle {#custom-id} syntax
function createRenderer() {
  const renderer = new marked.Renderer();

  renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
    // Extract custom ID from {#my-id} syntax
    const idMatch = text.match(/\s*\{#([\w-]+)\}\s*$/);
    let id: string;
    let displayText: string;
    if (idMatch) {
      id = idMatch[1];
      displayText = text.replace(/\s*\{#[\w-]+\}\s*$/, "");
    } else {
      displayText = text;
      const plain = text.replace(/<[^>]+>/g, "").replace(/`([^`]+)`/g, "$1");
      id = plain
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
    const tag = `h${depth}`;
    return `<${tag} id="${id}">${displayText}</${tag}>\n`;
  };

  return renderer;
}

export default function MarkdownRenderer({ markdown }: Props) {
  const articleRef = useRef<HTMLDivElement>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  // Convert markdown to HTML
  const baseHtml = useMemo(() => {
    const renderer = createRenderer();
    return marked(markdown, { renderer, async: false }) as string;
  }, [markdown]);

  // Highlight code blocks with Shiki after mount
  useEffect(() => {
    let cancelled = false;
    setHighlightedHtml(null);

    async function highlightCodeBlocks(html: string) {
      // Find all <pre><code class="language-xxx">...</code></pre> blocks
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

      // Replace code blocks with highlighted versions
      let result = html;
      // Replace from end to preserve indices
      for (let i = highlighted.length - 1; i >= 0; i--) {
        const h = highlighted[i];
        result =
          result.slice(0, h.index) +
          `<div class="code-block group relative">${h.html}</div>` +
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
