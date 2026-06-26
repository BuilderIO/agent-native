/**
 * Renders markdown content as HTML with:
 * - Syntax-highlighted code blocks (via Shiki)
 * - Heading anchor links (clickable # on h2/h3)
 * - Tailwind Typography styling via .docs-content
 *
 * Uses the 'marked' library for markdown→HTML conversion.
 */

import { useT } from "@agent-native/core/client";
import { marked, type RendererThis, type Tokens } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";

interface Props {
  markdown: string;
}

interface HighlightedMarkdownHtml {
  sourceHtml: string;
  html: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const DOCS_IMAGE_DIMENSIONS: Record<string, ImageDimensions> = {
  "/screenshots/analytics.png": { width: 1400, height: 710 },
  "/screenshots/calendar.png": { width: 1400, height: 710 },
  "/screenshots/clips.png": { width: 1400, height: 710 },
  "/screenshots/content.png": { width: 1400, height: 710 },
  "/screenshots/dispatch.png": { width: 1400, height: 810 },
  "/screenshots/forms.png": { width: 1400, height: 710 },
  "/screenshots/mail.png": { width: 1400, height: 710 },
  "/screenshots/slides.png": { width: 1400, height: 710 },
  "/screenshots/chat.png": { width: 2434, height: 1440 },
  "/screenshots/videos.png": { width: 1400, height: 710 },
  "https://cdn.builder.io/api/v1/image/assets%2F348da13fcd8b414c87de9066196f7266%2F961bedb713a94463b834c1f2f4643bcf?format=webp&width=1200":
    { width: 1200, height: 947 },
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F769092170a14474f998cbca47384f891?format=webp&width=1200":
    { width: 1200, height: 947 },
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c9fe3b5b9494e33803cd3f494cba356?format=webp&width=1200":
    { width: 1200, height: 947 },
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdd73f749f8c54dbcb577420ab1a18788":
    { width: 2000, height: 1479 },
};

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

const LANGUAGE_ALIASES: Record<string, string> = {
  bq: "sql",
  docker: "dockerfile",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  yml: "yaml",
  zsh: "bash",
};

const GENERIC_LANGUAGES = new Set(["", "plain", "plaintext", "text", "txt"]);

function normalizeLanguage(lang: string | undefined): string {
  const raw = lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const withoutPrefix = raw.replace(/^language-/, "");
  return LANGUAGE_ALIASES[withoutPrefix] ?? withoutPrefix;
}

function looksLikeJson(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeMarkdown(code: string): boolean {
  const lines = code.split(/\r?\n/);
  let score = 0;

  if (/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/.test(code)) score += 2;
  if (/```/.test(code)) score += 2;
  if (/<!--\s*[^>]+\.md\s*-->/.test(code)) score += 4;
  if (/^\s{0,3}#{1,6}\s+\S/m.test(code)) score += 3;
  if (/^\s{0,3}>\s+\S/m.test(code)) score += 1;
  if (/\[[^\]\n]+]\([^)]+\)/.test(code)) score += 2;

  const listLines = lines.filter((line) =>
    /^\s{0,3}(?:[-*+]|\d+\.)\s+\S/.test(line),
  ).length;
  if (listLines >= 2) score += 2;

  return score >= 3;
}

function inferCodeBlockLanguage(code: string): string {
  const trimmed = code.trim();

  if (looksLikeMarkdown(trimmed)) return "markdown";
  if (looksLikeJson(trimmed)) return "json";
  if (/^\s*[{[][\s\S]*,\s*\/\/.+/m.test(trimmed)) return "jsonc";
  if (/^\s*<([a-z][\w:-]*)(?:\s|>|\/>)/i.test(trimmed)) return "html";
  if (
    /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/im.test(trimmed)
  ) {
    return "sql";
  }
  if (/^\s*(?:FROM|RUN|COPY|ENTRYPOINT|CMD|ENV|ARG|WORKDIR)\b/m.test(trimmed)) {
    return "dockerfile";
  }
  if (
    /^\s*(?:npm|pnpm|yarn|npx|bun|git|cd|curl|export|agent-native|wrangler)\b/m.test(
      trimmed,
    ) ||
    /^\s*[A-Z_][A-Z0-9_]*=.*$/m.test(trimmed)
  ) {
    return "bash";
  }
  if (/^\s*(?:import|export)\s/m.test(trimmed)) {
    return /\bfrom\s+["'][^"']+\.(?:tsx|jsx)["']/.test(trimmed) ||
      /<[A-Z][\w.]*(?:\s|>)/.test(trimmed)
      ? "tsx"
      : "typescript";
  }
  if (/^\s*(?:const|let|var|type|interface|function|class)\s/m.test(trimmed)) {
    return /<[A-Z][\w.]*(?:\s|>)/.test(trimmed) ? "tsx" : "typescript";
  }
  if (/^\s*[\w.-]+\s*:\s+\S/m.test(trimmed)) return "yaml";
  if (/^\s*[.#]?[\w:-]+(?:\s+[.#]?[\w:-]+)*\s*\{/m.test(trimmed)) {
    return "css";
  }

  return "text";
}

export function resolveCodeBlockLanguage(
  lang: string | undefined,
  code: string,
): string {
  const normalized = normalizeLanguage(lang);
  if (!GENERIC_LANGUAGES.has(normalized)) return normalized;
  return inferCodeBlockLanguage(code);
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

function imageDimensionsForHref(href: string): ImageDimensions | undefined {
  return DOCS_IMAGE_DIMENSIONS[decodeHtmlEntities(href).trim()];
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
    const dimensions = imageDimensionsForHref(token.href);
    const sizeAttributes = dimensions
      ? ` width="${dimensions.width}" height="${dimensions.height}"`
      : "";
    const image = `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}"${title} class="docs-image" loading="lazy" decoding="async"${sizeAttributes}>`;

    if (!dimensions) return image;

    return `<span class="docs-image-frame" style="aspect-ratio: ${dimensions.width} / ${dimensions.height};">${image}</span>`;
  };

  // Wrap code blocks in `.code-block` from the start so that the post-hydration
  // shiki swap only replaces the inner <pre> — no margin / structure change.
  renderer.code = function ({ text, lang }: Tokens.Code) {
    const resolvedLang = resolveCodeBlockLanguage(lang, text);
    const langClass = ` class="language-${escapeHtml(resolvedLang)}"`;
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

export function resolveRenderedMarkdownHtml(
  baseHtml: string,
  highlightedHtml: HighlightedMarkdownHtml | null,
) {
  return highlightedHtml?.sourceHtml === baseHtml
    ? highlightedHtml.html
    : baseHtml;
}

export default function MarkdownRenderer({ markdown }: Props) {
  const articleRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const [highlightedHtml, setHighlightedHtml] =
    useState<HighlightedMarkdownHtml | null>(null);

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
        if (!cancelled) setHighlightedHtml({ sourceHtml: html, html });
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
              // Emit BOTH --shiki-light and --shiki-dark CSS vars (no baked-in
              // default theme) so per-theme color rules work in both modes.
              defaultColor: false,
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

      if (!cancelled) setHighlightedHtml({ sourceHtml: html, html: result });
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

    const headings = el.querySelectorAll("h2[id], h3[id], h4[id]");
    for (const heading of headings) {
      if (heading.querySelector(".heading-anchor")) continue;
      const anchor = document.createElement("a");
      anchor.href = `#${(heading as HTMLElement).id}`;
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

  // Add copy buttons to code blocks after render
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;

    function handleCopyClick(e: MouseEvent) {
      const btn = (e.target as Element).closest<HTMLButtonElement>(
        "button.code-copy-btn",
      );
      if (!btn) return;
      const wrapper = btn.closest<HTMLElement>(".code-block");
      if (!wrapper) return;
      const codeEl = wrapper.querySelector("code");
      const text = codeEl?.textContent ?? "";
      navigator.clipboard.writeText(text).catch(() => undefined);

      const checkSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      const copySvg = btn.dataset.copySvg ?? "";
      btn.innerHTML = checkSvg;
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = copySvg;
        btn.disabled = false;
      }, 2000);
    }

    el.addEventListener("click", handleCopyClick);

    const copySvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    const blocks = el.querySelectorAll<HTMLElement>(".code-block");
    for (const block of blocks) {
      if (block.querySelector(".code-copy-btn")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy-btn";
      btn.setAttribute("aria-label", t("common.copyCode"));
      btn.dataset.copySvg = copySvg;
      btn.innerHTML = copySvg;
      block.appendChild(btn);
    }

    return () => {
      el.removeEventListener("click", handleCopyClick);
    };
  }, [highlightedHtml, t]);

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;

    const images = Array.from(
      el.querySelectorAll<HTMLImageElement>("img.docs-image"),
    );
    const cleanups: (() => void)[] = [];

    for (const image of images) {
      const markLoaded = () => {
        image.classList.add("is-loaded");
      };

      if (image.complete && image.naturalWidth > 0) {
        markLoaded();
        continue;
      }

      image.addEventListener("load", markLoaded);
      image.addEventListener("error", markLoaded);
      cleanups.push(() => {
        image.removeEventListener("load", markLoaded);
        image.removeEventListener("error", markLoaded);
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [baseHtml, highlightedHtml]);

  return (
    <div
      ref={articleRef}
      className="docs-content"
      dangerouslySetInnerHTML={{
        __html: resolveRenderedMarkdownHtml(baseHtml, highlightedHtml),
      }}
    />
  );
}
