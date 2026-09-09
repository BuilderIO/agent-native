import fs from "fs";
import path from "path";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { sanitizeCssValue } from "../app/lib/sanitize-slide-html.js";
import {
  safeGeneratedFilename,
  tenantExportDir,
} from "../server/lib/tenant-files.js";
import type { DesignSystemData } from "../shared/api.js";
import {
  type AspectRatio,
  getAspectRatioDims,
  ASPECT_RATIO_VALUES,
} from "../shared/aspect-ratios.js";
import {
  backgroundCssValue,
  DEFAULT_SLIDE_BACKGROUND,
} from "../shared/slide-background.js";

/**
 * Minimal server-side HTML sanitizer for exported slide content.
 * DOMParser is not available in Node/Nitro, so we use a regex pass to strip
 * scripts, event handlers, and dangerous URL schemes before embedding slide
 * HTML into the standalone export file.
 */
function sanitizeSlideContent(html: string): string {
  return html
    .replace(
      /<(script|iframe|object|embed|form|meta|base|link)\b[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /<(script|iframe|object|embed|form|meta|base|link)\b[^>]*\/?>/gi,
      "",
    )
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function safeCssToken(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const sanitized = sanitizeCssValue(value);
  if (!sanitized) return fallback;
  return sanitized.replace(/[{}<>;]/g, "").slice(0, 240) || fallback;
}

function standaloneDesignSystemVars(designSystem?: DesignSystemData): string {
  const colors = designSystem?.colors;
  const typography = designSystem?.typography;
  const borders = designSystem?.borders;
  return [
    `--ds-bg: ${safeCssToken(colors?.background, DEFAULT_SLIDE_BACKGROUND)}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-text: ${safeCssToken(colors?.text, "#1F2933")}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-text-muted: ${safeCssToken(colors?.textMuted, "#667085")}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-accent: ${safeCssToken(colors?.accent, "#2457D6")}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-primary: ${safeCssToken(colors?.primary, "#2457D6")}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-secondary: ${safeCssToken(colors?.secondary, "#C85C3A")}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-surface: ${safeCssToken(colors?.surface, "#FFFFFF")}`,
    `--ds-heading-font: ${safeCssToken(typography?.headingFont, "Inter, sans-serif")}`,
    `--ds-body-font: ${safeCssToken(typography?.bodyFont, "Inter, sans-serif")}`,
    `--ds-radius: ${safeCssToken(borders?.radius, "14px")}`,
  ].join("; ");
}

function buildStandaloneHtml(
  title: string,
  slides: Array<{
    id: string;
    content: string;
    notes?: string;
    background?: string;
  }>,
  aspectRatio?: AspectRatio,
  designSystem?: DesignSystemData,
): string {
  const dims = getAspectRatioDims(aspectRatio);
  const designSystemVars = standaloneDesignSystemVars(designSystem);
  const slideHtmlSections = slides
    .map(
      (slide, i) =>
        `<section class="slide" data-index="${i}" style="display: ${i === 0 ? "flex" : "none"}; background: ${safeCssToken(backgroundCssValue(slide.background), DEFAULT_SLIDE_BACKGROUND)}; ${designSystemVars}">${sanitizeSlideContent(slide.content)}</section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%; height: 100%;
      background: #111;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
    }

    .viewport {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .slide-container {
      width: ${dims.width}px;
      height: ${dims.height}px;
      position: relative;
      transform-origin: center center;
    }

    .slide {
      width: ${dims.width}px;
      height: ${dims.height}px;
      background: var(--ds-bg);
      color: var(--ds-text);
      font-family: var(--ds-body-font);
      overflow: hidden;
      position: absolute;
      top: 0;
      left: 0;
      align-items: stretch;
      justify-content: stretch;
    }

    .slide > * {
      width: 100%;
      height: 100%;
    }

    .fmd-slide {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: 64px 80px;
      display: flex;
      flex-direction: column;
      color: var(--ds-text);
      background: var(--ds-bg);
      font-family: var(--ds-body-font);
    }

    .fmd-slide h1, .fmd-slide h2, .fmd-slide h3 {
      color: var(--ds-text);
      font-family: var(--ds-heading-font);
    }

    .fmd-slide h1 { font-size: 56px; line-height: 1.05; }
    .fmd-slide h2 { font-size: 34px; line-height: 1.12; }
    .fmd-slide h3 { font-size: 24px; line-height: 1.2; }
    .fmd-slide p, .fmd-slide li { color: var(--ds-text-muted); }
    .fmd-slide strong { color: var(--ds-text); }
    .fmd-slide hr { border-color: var(--ds-accent); }

    .fmd-slide .fmd-img-placeholder {
      border-radius: var(--ds-radius);
      background: var(--ds-surface);
    }

    .bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);
      z-index: 100;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .viewport:hover .bottom-bar,
    .bottom-bar:hover {
      opacity: 1;
    }

    .slide-counter {
      font-variant-numeric: tabular-nums;
    }

    .controls {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .controls span {
      opacity: 0.6;
    }

    kbd {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 11px;
      font-family: inherit;
    }
  </style>
</head>
<body>
  <div class="viewport" id="viewport">
    <div class="slide-container" id="slideContainer">
      ${slideHtmlSections}
    </div>
    <div class="bottom-bar">
      <div class="slide-counter" id="counter">1 / ${slides.length}</div>
      <div class="controls">
        <span><kbd>&larr;</kbd> <kbd>&rarr;</kbd> navigate</span>
        <span><kbd>F</kbd> fullscreen</span>
        <span><kbd>Esc</kbd> exit</span>
      </div>
    </div>
  </div>
  <script>
    (function() {
      var currentSlide = 0;
      var totalSlides = ${slides.length};
      var slides = document.querySelectorAll('.slide');
      var counter = document.getElementById('counter');
      var container = document.getElementById('slideContainer');

      function showSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        slides[currentSlide].style.display = 'none';
        currentSlide = index;
        slides[currentSlide].style.display = 'flex';
        counter.textContent = (currentSlide + 1) + ' / ' + totalSlides;
      }

      function fitSlide() {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var scale = Math.min(vw / ${dims.width}, vh / ${dims.height});
        container.style.transform = 'scale(' + scale + ')';
      }

      window.addEventListener('resize', fitSlide);
      fitSlide();

      document.addEventListener('keydown', function(e) {
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
          case ' ':
            e.preventDefault();
            showSlide(currentSlide + 1);
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            showSlide(currentSlide - 1);
            break;
          case 'Home':
            e.preventDefault();
            showSlide(0);
            break;
          case 'End':
            e.preventDefault();
            showSlide(totalSlides - 1);
            break;
          case 'f':
          case 'F':
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(function() {});
            } else {
              document.exitFullscreen().catch(function() {});
            }
            break;
          case 'Escape':
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(function() {});
            }
            break;
        }
      });

      // Click to advance (left third = back, right two-thirds = forward)
      document.getElementById('viewport').addEventListener('click', function(e) {
        if (e.target.closest('.bottom-bar')) return;
        var rect = this.getBoundingClientRect();
        var x = e.clientX - rect.left;
        if (x < rect.width / 3) {
          showSlide(currentSlide - 1);
        } else {
          showSlide(currentSlide + 1);
        }
      });
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default defineAction({
  description:
    "Export a deck as a standalone HTML file with built-in keyboard navigation. Returns a download URL for the generated file.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
  }),
  run: async ({ deckId }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });

    const access = await resolveAccess("deck", deckId);
    if (!access)
      fail(`Deck not found: ${deckId}`, {
        errorCode: "deck_not_found",
        statusCode: 404,
      });

    const row = access.resource;
    const deckData = JSON.parse(row.data);
    const slides = deckData.slides || [];
    const rawAspectRatio = deckData.aspectRatio;
    const aspectRatio: AspectRatio | undefined = ASPECT_RATIO_VALUES.includes(
      rawAspectRatio,
    )
      ? rawAspectRatio
      : undefined;

    if (slides.length === 0) {
      fail("Cannot export empty deck", {
        errorCode: "empty_deck",
        statusCode: 400,
      });
    }

    const designSystemId = row.designSystemId ?? deckData.designSystemId;
    let designSystem: DesignSystemData | undefined;
    if (typeof designSystemId === "string" && designSystemId.trim()) {
      const designSystemAccess = await resolveAccess(
        "design-system",
        designSystemId,
      );
      const rawData = designSystemAccess?.resource?.data;
      if (typeof rawData === "string") {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            designSystem = parsed as DesignSystemData;
          }
        } catch {
          // Malformed optional style data keeps the export on its fallback tokens.
        }
      }
    }

    const html = buildStandaloneHtml(
      row.title,
      slides,
      aspectRatio,
      designSystem,
    );
    const filename = safeGeneratedFilename(row.title, ".html");

    // Disk write is only useful when the same process can later serve the
    // file. On serverless (Netlify / Vercel / Lambda), the function filesystem
    // vanishes between invocations, so `/api/exports/:filename` requests land
    // on a different container that doesn't have the file — the user sees
    // "file doesn't exist on site". Skip the disk write entirely on those
    // hosts; the route handler streams `html` directly. CLI and local-dev
    // still get a real file path.
    let filePath: string | undefined;
    if (!isServerless()) {
      const exportDir = tenantExportDir(userEmail);
      fs.mkdirSync(exportDir, { recursive: true });
      filePath = path.join(exportDir, filename);
      fs.writeFileSync(filePath, html);
    }

    return { html, filePath, filename, slideCount: slides.length };
  },
});

function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/"),
  );
}
