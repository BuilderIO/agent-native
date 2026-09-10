import fs from "fs";
import path from "path";

import { defineAction, fail } from "@agent-native/core/action";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
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
  resolveSlideBackground,
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

function safeCssToken(
  value: unknown,
  fallback: string,
  builderTokenValues?: Record<string, string>,
): string {
  if (typeof value !== "string") return fallback;
  const sanitized = sanitizeCssValue(value);
  if (!sanitized) return fallback;
  const resolved = sanitized
    .replace(/[{}<>;]/g, "")
    .replace(/var\(\s*(--[a-zA-Z][\w-]*)\s*\)/g, (_, name: string) => {
      const replacement = builderTokenValues?.[name];
      const safeReplacement = replacement
        ? sanitizeCssValue(replacement)
        : null;
      return safeReplacement && !/[{}<>;]/.test(safeReplacement)
        ? safeReplacement
        : `var(${name})`;
    })
    .trim();
  const finalValue = sanitizeCssValue(resolved)?.replace(/[{}<>;]/g, "");
  return !finalValue || /var\(\s*--/i.test(finalValue)
    ? fallback
    : finalValue.slice(0, 240) || fallback;
}

const STANDALONE_TAILWIND_BACKGROUNDS: Record<string, string> = {
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-black": "#000000",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-white": "#FFFFFF",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-slate-900": "#0F172A",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-slate-950": "#020617",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-gray-900": "#111827",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-zinc-900": "#18181B",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-neutral-900": "#171717",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-stone-900": "#1C1917",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-red-500": "#EF4444",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-orange-500": "#F97316",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-amber-500": "#F59E0B",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-yellow-400": "#FACC15",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-lime-500": "#84CC16",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-green-500": "#22C55E",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-emerald-500": "#10B981",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-teal-500": "#14B8A6",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-cyan-500": "#06B6D4",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-sky-500": "#0EA5E9",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-blue-500": "#3B82F6",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-indigo-500": "#6366F1",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-indigo-950": "#1E1B4B",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-violet-500": "#8B5CF6",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-purple-600": "#9333EA",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-fuchsia-500": "#D946EF",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-pink-500": "#EC4899",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-rose-500": "#F43F5E",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-slate-700": "#334155",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-slate-800": "#1E293B",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-zinc-50": "#FAFAFA",
  // guard:allow-raw-color - standalone Tailwind background compatibility
  "bg-gray-100": "#F3F4F6",
};

const TAILWIND_GRADIENT_DIRECTIONS: Record<string, string> = {
  "bg-gradient-to-t": "to top",
  "bg-gradient-to-tr": "to top right",
  "bg-gradient-to-r": "to right",
  "bg-gradient-to-br": "to bottom right",
  "bg-gradient-to-b": "to bottom",
  "bg-gradient-to-bl": "to bottom left",
  "bg-gradient-to-l": "to left",
  "bg-gradient-to-tl": "to top left",
};

function standaloneBackgroundCssValue(value: string): string {
  const cssValue = backgroundCssValue(value);
  if (cssValue) return cssValue;
  const classes = value.split(/\s+/);
  const solidBackground = classes.find(
    (className) => STANDALONE_TAILWIND_BACKGROUNDS[className],
  );
  if (solidBackground) return STANDALONE_TAILWIND_BACKGROUNDS[solidBackground];
  const direction = classes.find(
    (className) => TAILWIND_GRADIENT_DIRECTIONS[className],
  );
  if (direction) {
    const stops = classes
      .filter((className) => /^(?:from|via|to)-/.test(className))
      .map((className) => {
        const [, color, shade] =
          className.match(/^(?:from|via|to)-([\w]+)-([\d]+)$/) ?? [];
        return color && shade
          ? STANDALONE_TAILWIND_BACKGROUNDS[`bg-${color}-${shade}`]
          : undefined;
      })
      .filter((stop): stop is string => Boolean(stop));
    if (stops.length >= 2) {
      return `linear-gradient(${TAILWIND_GRADIENT_DIRECTIONS[direction]}, ${stops.join(", ")})`;
    }
  }
  return STANDALONE_TAILWIND_BACKGROUNDS[value] ?? DEFAULT_SLIDE_BACKGROUND;
}

function isDarkStandaloneBackground(value: string): boolean {
  const colors = [
    ...value.matchAll(/#([\da-f]{3,8})\b/gi),
    ...value.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/gi),
  ];
  if (colors.length === 0) return false;
  return colors.every((match) => {
    const channels = match[0].startsWith("#")
      ? match[1].length === 3 || match[1].length === 4
        ? match[1]
            .slice(0, 3)
            .split("")
            .map((channel) => parseInt(channel + channel, 16))
        : [
            match[1].slice(0, 2),
            match[1].slice(2, 4),
            match[1].slice(4, 6),
          ].map((channel) => parseInt(channel, 16))
      : match.slice(1, 4).map(Number);
    return (
      channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114 < 128
    );
  });
}

function googleFontHref(font: unknown): string | undefined {
  if (typeof font !== "string") return undefined;
  const family = font.split(",", 1)[0]?.replace(/["']/g, "").trim();
  const supported = [
    "DM Sans",
    "Inter",
    "Manrope",
    "Montserrat",
    "Open Sans",
    "Poppins",
    "Plus Jakarta Sans",
    "Roboto",
    "Space Grotesk",
    "Work Sans",
  ];
  if (
    !family ||
    !supported.some(
      (candidate) => candidate.toLowerCase() === family.toLowerCase(),
    )
  ) {
    return undefined;
  }
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
}

function standaloneDesignSystemVars(
  designSystem: DesignSystemData | undefined,
  slideBackground: string,
  builderTokenValues?: Record<string, string>,
): string {
  const colors = designSystem?.colors;
  const typography = designSystem?.typography;
  const borders = designSystem?.borders;
  const standaloneBackground = standaloneBackgroundCssValue(slideBackground);
  const safeBackground = safeCssToken(
    standaloneBackground,
    DEFAULT_SLIDE_BACKGROUND,
    builderTokenValues,
  );
  const darkBackground = isDarkStandaloneBackground(safeBackground);
  return [
    `--ds-bg: ${safeBackground}`,
    // guard:allow-raw-color - standalone export fallback palette
    // guard:allow-raw-color - standalone export dark-background fallback
    `--ds-text: ${safeCssToken(colors?.text, darkBackground ? "#FFFFFF" : "#1F2933", builderTokenValues)}`,
    // guard:allow-raw-color - standalone export fallback palette
    // guard:allow-raw-color - standalone export dark-background fallback
    `--ds-text-muted: ${safeCssToken(colors?.textMuted, darkBackground ? "rgba(255, 255, 255, 0.72)" : "#667085", builderTokenValues)}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-accent: ${safeCssToken(colors?.accent, "#2457D6", builderTokenValues)}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-primary: ${safeCssToken(colors?.primary, "#2457D6", builderTokenValues)}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-secondary: ${safeCssToken(colors?.secondary, "#C85C3A", builderTokenValues)}`,
    // guard:allow-raw-color - standalone export fallback palette
    `--ds-surface: ${safeCssToken(colors?.surface, "#FFFFFF", builderTokenValues)}`,
    `--ds-heading-font: ${safeCssToken(typography?.headingFont, "Inter, sans-serif", builderTokenValues)}`,
    `--ds-body-font: ${safeCssToken(typography?.bodyFont, "Inter, sans-serif", builderTokenValues)}`,
    `--ds-radius: ${safeCssToken(borders?.radius, "14px", builderTokenValues)}`,
    ...Object.entries(builderTokenValues ?? {})
      .filter(
        ([name, value]) =>
          /^--[a-zA-Z][\w-]*$/.test(name) && typeof value === "string",
      )
      .map(
        ([name, value]) =>
          `${name}: ${safeCssToken(value, "initial", builderTokenValues)}`,
      ),
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
  builderTokenValues?: Record<string, string>,
): string {
  const dims = getAspectRatioDims(aspectRatio);
  const slideHtmlSections = slides
    .map((slide, i) => {
      const slideBackground = resolveSlideBackground(
        slide.background,
        designSystem,
      );
      const style = `display: ${i === 0 ? "flex" : "none"}; background: ${safeCssToken(standaloneBackgroundCssValue(slideBackground), DEFAULT_SLIDE_BACKGROUND, builderTokenValues)}; ${standaloneDesignSystemVars(designSystem, slideBackground, builderTokenValues)}`;
      return `<section class="slide" data-index="${i}" style="${escapeHtml(style)}">${sanitizeSlideContent(slide.content)}</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${[
    googleFontHref(designSystem?.typography?.headingFont),
    googleFontHref(designSystem?.typography?.bodyFont),
  ]
    .filter(
      (href, index, all): href is string =>
        Boolean(href) && all.indexOf(href) === index,
    )
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("\n  ")}
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

    .fmd-slide[data-imported-pptx="true"], .fmd-slide[data-imported-pdf="true"] { padding: 0; }

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

function parseStoredDesignSystem(
  rawData: string,
): DesignSystemData | undefined {
  try {
    const parsed = JSON.parse(rawData);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DesignSystemData)
      : undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
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
    let builderTokenValues: Record<string, string> | undefined;
    if (typeof designSystemId === "string" && designSystemId.trim()) {
      const designSystemAccess = await resolveAccess(
        "design-system",
        designSystemId,
      );
      const rawData = designSystemAccess?.resource?.data;
      if (typeof rawData === "string") {
        designSystem = parseStoredDesignSystem(rawData);
        const builderReference =
          parseBuilderDesignSystemProxyReference(rawData);
        if (builderReference) {
          try {
            builderTokenValues = (
              await hydrateBuilderDesignSystemReference(builderReference)
            ).tokenValues;
          } catch (error) {
            console.warn(
              "Builder design-system export hydration failed",
              error,
            );
          }
        }
      }
    }

    const html = buildStandaloneHtml(
      row.title,
      slides,
      aspectRatio,
      designSystem,
      builderTokenValues,
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
