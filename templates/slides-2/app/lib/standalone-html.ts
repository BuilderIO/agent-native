import type { Slides2Design } from "../../server/lib/slide-worker-runtime.js";
import type { DesignSystemData } from "../../shared/api.js";
import {
  type AspectRatio,
  getAspectRatioDims,
} from "../../shared/aspect-ratios.js";
import {
  backgroundCssValue,
  DEFAULT_SLIDE_BACKGROUND,
  resolveSlideBackground,
} from "../../shared/slide-background.js";
import type {
  SlideDesignTokens,
  SlideFontAsset,
} from "../../shared/slide-design-tokens.js";
import {
  SLIDE_NUMBER_CSS,
  slideNumberInlineStyle,
} from "../../shared/slide-number.js";
import { buildSlideFontFaceCss } from "../components/slides-2-runtime/protocol.js";
import { sanitizeCssValue, sanitizeSlideHtml } from "./sanitize-slide-html.js";

export type StandaloneHtmlSlide = {
  id: string;
  content?: string | null;
  notes?: string | null;
  background?: string | null;
  styles?: readonly string[];
  designTokens?: SlideDesignTokens;
  design?: Slides2Design;
  fontAssets?: readonly SlideFontAsset[];
};

export type StandaloneHtmlDesignSystem = {
  colors?: Partial<DesignSystemData["colors"]>;
  typography?: Partial<Omit<DesignSystemData["typography"], "headingSizes">> & {
    headingSizes?: Partial<DesignSystemData["typography"]["headingSizes"]>;
  };
  spacing?: Partial<DesignSystemData["spacing"]>;
  borders?: Partial<DesignSystemData["borders"]>;
  slideDefaults?: Partial<DesignSystemData["slideDefaults"]>;
  logos?: DesignSystemData["logos"];
  customCSS?: string;
};

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
  designSystem: StandaloneHtmlDesignSystem | undefined,
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
  // Must match SlideRenderer: publishing a token an unlinked deck never chose
  // overrides the theme baked into its slide HTML.
  const token = (name: string, value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const resolved = safeCssToken(value, "", builderTokenValues);
    return resolved ? `${name}: ${resolved}` : null;
  };
  const designSystemTokens = designSystem
    ? [
        token("--ds-text", colors?.text),
        token("--ds-text-muted", colors?.textMuted),
        token("--ds-accent", colors?.accent),
        token("--ds-primary", colors?.primary),
        token("--ds-secondary", colors?.secondary),
        token("--ds-surface", colors?.surface),
        token("--ds-heading-font", typography?.headingFont),
        token("--ds-body-font", typography?.bodyFont),
        token("--ds-radius", borders?.radius),
      ].filter((entry): entry is string => entry !== null)
    : [];
  const needsDarkTextOverride =
    darkBackground &&
    (!colors?.text || isDarkStandaloneBackground(colors.text));
  return [
    `--ds-bg: ${safeBackground}`,
    ...designSystemTokens,
    ...(needsDarkTextOverride
      ? // guard:allow-raw-color - readable defaults on explicit dark backgrounds
        [`--ds-text: #FFFFFF`, `--ds-text-muted: rgba(255, 255, 255, 0.72)`]
      : []),
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

function standaloneSlideVars(slide: StandaloneHtmlSlide): string {
  const declarations: string[] = [];
  const tokens = slide.designTokens;
  if (tokens) {
    const background = safeCssToken(
      tokens.background,
      DEFAULT_SLIDE_BACKGROUND,
    );
    const text = safeCssToken(tokens.text, "var(--ds-text)");
    declarations.push(
      `--deck-bg: ${background}`,
      `--deck-ink: ${text}`,
      `--deck-accent: ${safeCssToken(tokens.accent, "var(--ds-accent)")}`,
      `--deck-heading-font: ${safeCssToken(tokens.displayFont, "sans-serif")}`,
      `--deck-body-font: ${safeCssToken(tokens.bodyFont, "sans-serif")}`,
      `--deck-hero-scale: ${safeCssToken(String(tokens.heroScale), "1")}`,
      `--deck-body-scale: ${safeCssToken(String(tokens.bodyScale), "1")}`,
      `--deck-radius: ${safeCssToken(String(tokens.radius), "0")}px`,
      `background-color: ${background}`,
      `color: ${text}`,
    );
  }

  const design = slide.design;
  if (design) {
    declarations.push(
      `--slides2-bg: ${safeCssToken(design.palette.bg, DEFAULT_SLIDE_BACKGROUND)}`,
      `--slides2-text: ${safeCssToken(design.palette.text, "var(--ds-text)")}`,
      `--slides2-accent: ${safeCssToken(design.palette.accent, "var(--ds-accent)")}`,
      `--slides2-font-display: ${safeCssToken(design.fonts.display, "sans-serif")}`,
      `--slides2-font-body: ${safeCssToken(design.fonts.body, "sans-serif")}`,
      `--slides2-size-hero: ${safeCssToken(String(design.typeScale.hero), "56")}px`,
      `--slides2-size-body: ${safeCssToken(String(design.typeScale.body), "24")}px`,
      `--slides2-radius: ${safeCssToken(String(design.radius), "0")}px`,
    );
  }

  return declarations.join("; ");
}

export function buildStandaloneHtml(
  title: string,
  slides: StandaloneHtmlSlide[],
  aspectRatio?: AspectRatio,
  designSystem?: StandaloneHtmlDesignSystem,
  builderTokenValues?: Record<string, string>,
): string {
  const dims = getAspectRatioDims(aspectRatio);
  const slideHeadStyles: string[] = [];
  const slideHtmlSections = slides
    .map((slide, i) => {
      const rootSelector = `[data-standalone-slide-root="${i}"]`;
      const sanitizedContent = sanitizeSlideHtml(slide.content ?? "", {
        scopeSelector: rootSelector,
      });
      const slideContent = sanitizedContent.replace(
        /<style>([\s\S]*?)<\/style>/gi,
        (_match, css: string) => {
          if (css.trim()) slideHeadStyles.push(css);
          return "";
        },
      );
      for (const css of slide.styles ?? []) {
        const scopedCss = css.replaceAll("#slide-root", rootSelector);
        if (scopedCss.trim()) slideHeadStyles.push(scopedCss);
      }
      const fontCss = buildSlideFontFaceCss(slide.fontAssets ?? []);
      if (fontCss) slideHeadStyles.push(fontCss);

      const slideBackground = resolveSlideBackground(
        slide.background ?? undefined,
        designSystem,
      );
      const position = { number: i + 1, count: slides.length };
      const style = `display: ${i === 0 ? "flex" : "none"}; background: ${safeCssToken(standaloneBackgroundCssValue(slideBackground), DEFAULT_SLIDE_BACKGROUND, builderTokenValues)}; ${standaloneDesignSystemVars(designSystem, slideBackground, builderTokenValues)}; ${standaloneSlideVars(slide)}; ${slideNumberInlineStyle(position)}`;
      return `<section class="slide" data-index="${i}" data-slide-index="${position.number}" data-slide-count="${position.count}" data-standalone-slide-root="${i}" style="${escapeHtml(style)}">${slideContent}</section>`;
    })
    .join("\n");
  const slideStyles = slideHeadStyles
    .map(
      (css, index) =>
        `<style data-slide-style="${index}">${escapeStyleContent(css)}</style>`,
    )
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${[
    googleFontHref(designSystem?.typography?.headingFont),
    googleFontHref(designSystem?.typography?.bodyFont),
    ...slides.flatMap((slide) => [
      googleFontHref(slide.designTokens?.displayFont),
      googleFontHref(slide.designTokens?.bodyFont),
      googleFontHref(slide.design?.fonts.display),
      googleFontHref(slide.design?.fonts.body),
    ]),
  ]
    .filter(
      (href, index, all): href is string =>
        Boolean(href) && all.indexOf(href) === index,
    )
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("\n  ")}
  ${slideStyles}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100%; height: 100%;
      background: #111; /* guard:allow-raw-color — standalone exported presentation controls use fixed colors. */
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

    ${SLIDE_NUMBER_CSS}

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
      background: rgba(0, 0, 0, 0.7); /* guard:allow-raw-color — standalone exported presentation controls use fixed colors. */
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5); /* guard:allow-raw-color — standalone exported presentation controls use fixed colors. */
      z-index: 100;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .viewport:hover .bottom-bar,
    .bottom-bar:hover,
    .bottom-bar:focus-within {
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

    .controls button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      min-height: 32px;
      padding: 0 4px;
    }

    .controls button:hover,
    .controls button:focus-visible { text-decoration: underline; }
    .controls button:focus-visible { outline: 2px solid currentColor; }
    .controls button:disabled { opacity: 0.4; cursor: default; }

    @media (hover: none), (any-pointer: coarse) {
      .bottom-bar { opacity: 1; }
    }

    kbd {
      background: rgba(255, 255, 255, 0.1); /* guard:allow-raw-color — standalone exported presentation controls use fixed colors. */
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
        <button type="button" id="previousSlide" aria-label="Previous slide"><kbd>&larr;</kbd></button>
        <button type="button" id="nextSlide" aria-label="Next slide"><kbd>&rarr;</kbd></button>
        <button type="button" id="fullscreenButton"><kbd>F</kbd> fullscreen</button>
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
      var previousButton = document.getElementById('previousSlide');
      var nextButton = document.getElementById('nextSlide');
      var fullscreenButton = document.getElementById('fullscreenButton');

      function showSlide(index) {
        if (index < 0 || index >= totalSlides) return;
        slides[currentSlide].querySelectorAll('video').forEach(function(video) { video.pause(); });
        slides[currentSlide].style.display = 'none';
        currentSlide = index;
        slides[currentSlide].style.display = 'flex';
        counter.textContent = (currentSlide + 1) + ' / ' + totalSlides;
        previousButton.disabled = currentSlide === 0;
        nextButton.disabled = currentSlide === totalSlides - 1;
      }

      previousButton.addEventListener('click', function() { showSlide(currentSlide - 1); });
      nextButton.addEventListener('click', function() { showSlide(currentSlide + 1); });
      fullscreenButton.addEventListener('click', function() {
        if (document.fullscreenElement) {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(function(error) { console.error('Fullscreen exit failed', error); });
          }
        } else if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(function(error) { console.error('Fullscreen request failed', error); });
        }
      });
      previousButton.disabled = true;
      nextButton.disabled = totalSlides < 2;

      function fitSlide() {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var scale = Math.min(vw / ${dims.width}, vh / ${dims.height});
        container.style.transform = 'scale(' + scale + ')';
      }

      window.addEventListener('resize', fitSlide);
      fitSlide();

      function isMediaKeyboardEvent(e) {
        if (e.target instanceof Element && e.target.closest('video, audio')) return true;
        if (typeof e.composedPath === 'function' && e.composedPath().some(function(node) {
          return node instanceof Element && node.closest('video, audio');
        })) return true;
        var active = document.activeElement;
        return active instanceof Element && !!active.closest('video, audio');
      }

      function isMediaPlaybackKey(key) {
        return (
          key === ' ' ||
          key === 'ArrowRight' ||
          key === 'ArrowDown' ||
          key === 'ArrowLeft' ||
          key === 'ArrowUp' ||
          key === 'Home' ||
          key === 'End'
        );
      }

      document.addEventListener('keydown', function(e) {
        if (isMediaKeyboardEvent(e) && isMediaPlaybackKey(e.key)) return;
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
          case ' ':
            if (e.key === ' ' && e.target instanceof Element && e.target.closest('button')) break;
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
              if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(function(error) { console.error('Fullscreen request failed', error); });
              }
            } else if (document.exitFullscreen) {
              document.exitFullscreen().catch(function(error) { console.error('Fullscreen exit failed', error); });
            }
            break;
          case 'Escape':
            if (document.fullscreenElement && document.exitFullscreen) {
              document.exitFullscreen().catch(function() {}); // coercion-ok: fullscreen cleanup is best-effort and does not affect exported slide data.
            }
            break;
        }
      });

      // Click to advance (left third = back, right two-thirds = forward)
      document.getElementById('viewport').addEventListener('click', function(e) {
        if (e.target.closest('.bottom-bar')) return;
        if (e.target instanceof Element && e.target.closest('video, audio')) return;
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

function escapeStyleContent(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}
