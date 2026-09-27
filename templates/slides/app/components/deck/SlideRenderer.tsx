import { captureError } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
  useId,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

import { Skeleton } from "@/components/ui/skeleton";
import type { Slide } from "@/context/DeckContext";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";
import { extractMermaidBlocks } from "@/lib/mermaid-blocks";
import {
  sanitizeCssValue,
  sanitizeSlideHtml,
  sanitizeSlideUrl,
} from "@/lib/sanitize-slide-html";
import {
  swapImageSourcesInPlace,
  takeSlideImageUploadProvenance,
  updateLiveImagesUnderEdit,
} from "@/lib/slide-image-replacement";
import {
  stampSlideSource,
  type RenderedSlideSource,
} from "@/lib/slide-source-map";

import type { DesignSystemData } from "../../../shared/api";
import {
  backgroundCssValue,
  resolveSlideBackground,
} from "../../../shared/slide-background";
import { ExcalidrawThumbnail, parseExcalidrawData } from "./ExcalidrawSlide";
import { MermaidRenderer } from "./MermaidRenderer";

interface SlideRendererProps {
  slide: Slide;
  className?: string;
  thumbnail?: boolean;
  designSystem?: DesignSystemData;
  aspectRatio?: AspectRatio;
  onOverflowChange?: (info: SlideOverflowInfo) => void;
  onAutofitSettled?: () => void;
  stampSource?: boolean;
}

export const layoutClasses: Record<string, string> = {
  title: "flex flex-col items-center justify-center text-center px-16",
  content: "flex flex-col justify-center text-left px-16 py-12",
  "two-column": "grid grid-cols-2 gap-8 items-center text-left px-16 py-12",
  image: "flex flex-col items-center justify-center px-12 py-8",
  section: "flex flex-col",
  statement: "flex flex-col",
  "full-image": "flex flex-col",
  blank: "flex flex-col",
};

function isDarkSlideBackground(value: string): boolean {
  if (
    /^(?:bg-black|bg-(?:slate|gray|zinc|neutral|stone)-(?:900|950))$/i.test(
      value,
    )
  ) {
    return true;
  }
  const match = value.match(/^#([\da-f]{3,8})$/i);
  if (!match) return /(?:^|-)black(?:$|\s)/i.test(value);
  const hex = match[1];
  const channels =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split("")
          .map((channel) => parseInt(channel + channel, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((channel) =>
          parseInt(channel, 16),
        );
  return channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114 < 128;
}

function LazyImage({
  src,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const safeSrc = sanitizeSlideUrl(src, "image", {
    allowBlob: typeof window !== "undefined",
  });

  if (src === "PLACEHOLDER_IMAGE" || !safeSrc) {
    return (
      <div className="w-full max-w-[600px] mx-auto">
        <Skeleton className="w-full aspect-video rounded-lg bg-white/[0.06]" />
      </div>
    );
  }

  return (
    <span className="relative block">
      {!loaded && !error && (
        <Skeleton className="w-full aspect-video rounded-lg bg-white/[0.06] absolute inset-0" />
      )}
      <img
        src={safeSrc}
        alt={alt || ""}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`max-w-full max-h-[60vh] mx-auto rounded-lg transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        {...props}
      />
    </span>
  );
}

const markdownComponents = {
  img: (props: any) => <LazyImage {...props} />,
  a: ({ href, children, ...props }: any) => {
    const safeHref = sanitizeSlideUrl(href, "link");
    if (!safeHref) return <>{children}</>;
    return (
      <a {...props} href={safeHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  code: ({ className, children, ...props }: any) => {
    const match = /language-mermaid/.exec(className || "");
    if (match) {
      return (
        <MermaidRenderer
          definition={String(children).replace(/\n$/, "")}
          className="my-4"
        />
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }: any) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (child?.props?.className === "language-mermaid") {
      return <>{children}</>;
    }
    return <pre {...props}>{children}</pre>;
  },
};

const MIN_AUTOFIT_SCALE = 0.65;
const VERTICAL_OVERFLOW_TOLERANCE_PX = 8;
const HORIZONTAL_OVERFLOW_TOLERANCE_PX = 8;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SlideFitTransform {
  scale: number;
  x: number;
  y: number;
  fitted: boolean;
  verticalOverflow: number;
  horizontalOverflow: number;
}

export function computeSlideFitTransform({
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  measuredHorizontalOverflow = 0,
  minX = 0,
  minY = 0,
  minScale = MIN_AUTOFIT_SCALE,
}: {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  minX?: number;
  minY?: number;
  minScale?: number;
  measuredHorizontalOverflow?: number;
}): SlideFitTransform {
  const safeContentWidth = Math.max(1, contentWidth);
  const rawHorizontalOverflow = Math.max(
    measuredHorizontalOverflow,
    contentWidth - viewportWidth,
    0,
  );
  const widthToFit =
    rawHorizontalOverflow > HORIZONTAL_OVERFLOW_TOLERANCE_PX
      ? safeContentWidth
      : Math.max(1, viewportWidth);
  const rawScale = Math.min(1, Math.max(1, viewportWidth) / widthToFit);
  const scale = Math.max(minScale, rawScale);

  const rawVerticalOverflow = Math.max(0, contentHeight - viewportHeight);
  const verticalOverflow =
    rawVerticalOverflow > VERTICAL_OVERFLOW_TOLERANCE_PX
      ? Math.round(rawVerticalOverflow)
      : 0;
  const horizontalOverflow =
    rawHorizontalOverflow > HORIZONTAL_OVERFLOW_TOLERANCE_PX
      ? Math.round(rawHorizontalOverflow)
      : 0;

  return {
    scale,
    x: minX < 0 ? -minX * scale : 0,
    y: minY < 0 ? -minY * scale : 0,
    fitted: rawScale < 0.999,
    verticalOverflow,
    horizontalOverflow,
  };
}

function ensureRawHtmlFitLayers(root: HTMLElement): HTMLElement[] {
  const fmdSlides = Array.from(
    root.querySelectorAll<HTMLElement>(".fmd-slide"),
  );

  return fmdSlides.map((slide) => {
    const existing = Array.from(slide.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.hasAttribute("data-fmd-autofit-content"),
    );
    if (existing) return existing;

    const layer = document.createElement("div");
    layer.setAttribute("data-fmd-autofit-content", "true");
    layer.className = "fmd-autofit-scale";

    const nonStyleChildren = Array.from(slide.childNodes).filter(
      (child) =>
        !(
          child instanceof HTMLElement &&
          child.tagName.toLowerCase() === "style"
        ),
    );

    for (const child of nonStyleChildren) {
      layer.appendChild(child);
    }
    slide.appendChild(layer);
    return layer;
  });
}

function measureContentBounds(target: HTMLElement): {
  contentWidth: number;
  contentHeight: number;
  horizontalOverflow: number;
  minX: number;
  minY: number;
} {
  const descendants = Array.from(
    target.querySelectorAll<HTMLElement>("*"),
  ).filter((element) => element.tagName.toLowerCase() !== "style");
  const isFreeformElement = (element: HTMLElement) => {
    let current: HTMLElement | null = element;
    while (current && current !== target) {
      const position =
        current.style.position || window.getComputedStyle(current).position;
      if (
        current.classList.contains("fmd-freeform-object") ||
        current.classList.contains("fmd-text-box") ||
        current.hasAttribute("data-slide-object-id") ||
        position === "absolute" ||
        position === "fixed"
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const targetRect = target.getBoundingClientRect();
  const cssWidth = target.clientWidth || target.scrollWidth || 0;
  const cssHeight = target.clientHeight || target.scrollHeight || 0;
  const invScaleX =
    targetRect.width > 0 && cssWidth > 0 ? cssWidth / targetRect.width : 1;
  const invScaleY =
    targetRect.height > 0 && cssHeight > 0 ? cssHeight / targetRect.height : 1;

  let minX = 0;
  let minY = 0;
  let flowMaxX = target.clientWidth;
  let flowMaxY = target.clientHeight;
  let contentMaxY = target.clientHeight;
  let contentMinX = 0;
  let contentMaxX = target.clientWidth;
  let hasFlowContent = false;

  for (const el of descendants) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const left = (rect.left - targetRect.left) * invScaleX;
    const top = (rect.top - targetRect.top) * invScaleY;
    const right = (rect.right - targetRect.left) * invScaleX;
    const bottom = (rect.bottom - targetRect.top) * invScaleY;

    const isFreeform = isFreeformElement(el);
    const hasDirectText = Array.from(el.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!isFreeform && el.children.length > 0 && !hasDirectText) continue;

    contentMinX = Math.min(contentMinX, left);
    contentMaxX = Math.max(contentMaxX, right);

    if (isFreeform) {
      contentMaxY = Math.max(contentMaxY, bottom);
      continue;
    }

    hasFlowContent = true;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    flowMaxX = Math.max(flowMaxX, right);
    flowMaxY = Math.max(flowMaxY, bottom);
    contentMaxY = Math.max(contentMaxY, bottom);
  }

  if (!hasFlowContent && descendants.length === 0) {
    contentMaxY = Math.max(contentMaxY, target.scrollHeight);
    contentMaxX = Math.max(contentMaxX, target.scrollWidth);
  }

  return {
    contentWidth: Math.max(target.clientWidth, flowMaxX - minX),
    contentHeight: Math.max(target.clientHeight, flowMaxY - minY, contentMaxY),
    horizontalOverflow: Math.max(
      0,
      -contentMinX,
      contentMaxX - target.clientWidth,
    ),
    minX,
    minY,
  };
}

export interface SlideOverflowInfo {
  verticalOverflow: number;
  horizontalOverflow: number;
  contentHeight: number;
  contentWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}

function useSlideAutofit(
  ref: React.RefObject<HTMLDivElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  fitKey: string,
  onOverflowChange?: (info: SlideOverflowInfo) => void,
  onAutofitSettled?: () => void,
) {
  const overflowCallbackRef = useRef(onOverflowChange);
  overflowCallbackRef.current = onOverflowChange;
  const autofitSettledRef = useRef(onAutofitSettled);
  autofitSettledRef.current = onAutofitSettled;

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    let disposed = false;
    const canDefer =
      typeof IntersectionObserver !== "undefined" &&
      !root.closest("[data-pdf-export-stage]");
    const isNearViewport = () => {
      const rect = root.getBoundingClientRect();
      const margin = 200;
      return (
        rect.bottom >= -margin &&
        rect.right >= -margin &&
        rect.top <= (window.innerHeight || 0) + margin &&
        rect.left <= (window.innerWidth || 0) + margin
      );
    };
    let visible = !canDefer || isNearViewport();
    let measurePending = false;

    const resetTarget = (target: HTMLElement) => {
      target.style.setProperty("--fmd-fit-scale", "1");
      target.style.setProperty("--fmd-fit-x", "0px");
      target.style.setProperty("--fmd-fit-y", "0px");
      target.removeAttribute("data-fmd-autofit-active");
    };

    const measureNow = () => {
      if (disposed) return;

      const isEditing = !!root.querySelector('[contenteditable="true"]');
      const rawTargets = ensureRawHtmlFitLayers(root);
      const targets =
        rawTargets.length > 0
          ? rawTargets
          : [root].filter((target) => target.scrollHeight > 0);

      let worstOverflow = 0;
      let worstHorizontalOverflow = 0;
      let worstInfo: SlideOverflowInfo | null = null;

      for (const target of targets) {
        if (isEditing) {
          continue;
        }

        resetTarget(target);
        const bounds = measureContentBounds(target);
        const viewportWidth = target.clientWidth || canvasWidth;
        const viewportHeight = target.clientHeight || canvasHeight;
        const transform = computeSlideFitTransform({
          ...bounds,
          measuredHorizontalOverflow: bounds.horizontalOverflow,
          viewportWidth,
          viewportHeight,
        });

        target.style.setProperty("--fmd-fit-scale", String(transform.scale));
        target.style.setProperty("--fmd-fit-x", `${transform.x}px`);
        target.style.setProperty("--fmd-fit-y", `${transform.y}px`);
        if (transform.fitted) {
          target.setAttribute("data-fmd-autofit-active", "true");
        }

        if (transform.verticalOverflow > worstOverflow) {
          worstOverflow = transform.verticalOverflow;
        }
        worstHorizontalOverflow = Math.max(
          worstHorizontalOverflow,
          transform.horizontalOverflow,
        );
        if (
          transform.verticalOverflow > 0 ||
          transform.horizontalOverflow > 0
        ) {
          worstInfo = {
            verticalOverflow: worstOverflow,
            horizontalOverflow: worstHorizontalOverflow,
            contentHeight: Math.round(bounds.contentHeight),
            contentWidth: Math.round(bounds.contentWidth),
            viewportHeight: Math.round(viewportHeight),
            viewportWidth: Math.round(viewportWidth),
          };
        }
      }

      if (!isEditing) {
        overflowCallbackRef.current?.(
          worstInfo ?? {
            verticalOverflow: 0,
            horizontalOverflow: 0,
            contentHeight: 0,
            contentWidth: 0,
            viewportHeight: 0,
            viewportWidth: 0,
          },
        );
        autofitSettledRef.current?.();
      }
    };

    const scheduleMeasure = () => {
      if (disposed) return;
      if (!visible) {
        measurePending = true;
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureNow);
    };

    scheduleMeasure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(root);

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["contenteditable", "class", "src"],
    });

    root.addEventListener("load", scheduleMeasure, true);
    document.fonts?.ready.then(scheduleMeasure).catch(() => {});
    document.fonts?.addEventListener("loadingdone", scheduleMeasure);

    const visibilityObserver = canDefer
      ? new IntersectionObserver(
          (entries) => {
            const isVisible = entries.some((entry) => entry.isIntersecting);
            if (isVisible === visible) return;
            visible = isVisible;
            if (visible && measurePending) {
              measurePending = false;
              scheduleMeasure();
            }
          },
          { rootMargin: "200px" },
        )
      : null;
    visibilityObserver?.observe(root);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      visibilityObserver?.disconnect();
      root.removeEventListener("load", scheduleMeasure, true);
      document.fonts?.removeEventListener("loadingdone", scheduleMeasure);
    };
  }, [canvasWidth, canvasHeight, fitKey, ref]);
}

function AutoFitContent({
  canvasWidth,
  canvasHeight,
  fitKey,
  className = "",
  contentScope,
  children,
  onOverflowChange,
  onAutofitSettled,
}: {
  canvasWidth: number;
  canvasHeight: number;
  fitKey: string;
  className?: string;
  contentScope?: string;
  children: ReactNode;
  onOverflowChange?: (info: SlideOverflowInfo) => void;
  onAutofitSettled?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSlideAutofit(
    ref,
    canvasWidth,
    canvasHeight,
    fitKey,
    onOverflowChange,
    onAutofitSettled,
  );

  return (
    <div
      ref={ref}
      data-slide-autofit-root="true"
      data-slide-content-scope={contentScope}
      className={`fmd-autofit-scale ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Whether the slide's own markup declares a text color.
 *
 * The `.slide-content <tag>` palette in global.css paints headings and body
 * text for the dark markdown decks. It is a per-element declaration, so it
 * beats any color the slide inherits from its own wrapper — a light slide
 * rendered white-on-cream, and no edit to the slide could repair it because
 * the color lives in the stylesheet. `data-slide-content-scope` turns that
 * palette off. The raw-HTML container always carries it; a markdown layout
 * (which renders the same agent HTML through rehype-raw) carries it exactly
 * when the slide took over colors, so a pure-markdown deck keeps its palette.
 *
 * Matches `color:` only inside a tag, so `background-color:`, `border-color:`,
 * a `--brand-color:` custom property, and prose that says "color:" don't trip
 * it.
 */
export function slideDeclaresTextColor(html: string): boolean {
  return /<[^>]*[^-\w]color\s*:/i.test(html);
}

const AUTHORED_COLOR_SCOPE = "authored-colors";

const VARIABLE_AXIS_GOOGLE_FONTS = [
  "Archivo",
  "Asap",
  "Catamaran",
  "Chivo",
  "DM Sans",
  "Epilogue",
  "Exo 2",
  "Geist",
  "Geist Mono",
  "Heebo",
  "Inter",
  "Jost",
  "League Spartan",
  "Lexend",
  "Libre Franklin",
  "Montserrat",
  "Noto Sans",
  "Noto Serif",
  "Onest",
  "Outfit",
  "Overpass",
  "Public Sans",
  "Raleway",
  "Roboto",
  "Roboto Condensed",
  "Roboto Slab",
  "Urbanist",
  "Work Sans",
];

const STATIC_WEIGHT_GOOGLE_FONTS = [
  "Abril Fatface",
  "Anton",
  "Arimo",
  "Assistant",
  "Barlow",
  "Barlow Condensed",
  "Bebas Neue",
  "Bodoni Moda",
  "Bricolage Grotesque",
  "Cabin",
  "Caveat",
  "Cormorant Garamond",
  "Cousine",
  "Crimson Text",
  "Dancing Script",
  "David Libre",
  "EB Garamond",
  "Figtree",
  "Fira Sans",
  "Hind",
  "Homemade Apple",
  "IBM Plex Sans",
  "Inconsolata",
  "Instrument Sans",
  "Josefin Sans",
  "JetBrains Mono",
  "Kanit",
  "Karla",
  "Lato",
  "Libre Baskerville",
  "Lora",
  "Manrope",
  "Merriweather",
  "Mulish",
  "Nova Square",
  "Nunito",
  "Nunito Sans",
  "Open Sans",
  "Oswald",
  "Oxygen",
  "PT Sans",
  "PT Serif",
  "Pacifico",
  "Playfair Display",
  "Plus Jakarta Sans",
  "Poppins",
  "Prompt",
  "Quicksand",
  "Red Hat Display",
  "Roboto Mono",
  "Rubik",
  "Schibsted Grotesk",
  "Sora",
  "Source Sans 3",
  "Space Grotesk",
  "Syne",
  "Teko",
  "Tinos",
  "Titillium Web",
  "Ubuntu",
  "Yanone Kaffeesatz",
];

const GOOGLE_FONT_ALIASES: Record<string, string> = {
  "source sans pro": "source sans 3",
  bodoni: "bodoni moda",
};

const FONT_WEIGHT_SUFFIX =
  /\s+(?:thin|extra ?light|ultra ?light|light|book|regular|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique)$/i;

const GOOGLE_FONTS = new Map<string, { family: string; href: string }>();
for (const [families, axis] of [
  [VARIABLE_AXIS_GOOGLE_FONTS, "ital,wght@0,100..900;1,100..900"],
  [STATIC_WEIGHT_GOOGLE_FONTS, "ital,wght@0,400;0,700;1,400;1,700"],
] as const) {
  for (const family of families) {
    GOOGLE_FONTS.set(family.toLowerCase(), {
      family,
      href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axis}&display=swap`,
    });
  }
}

export function resolveImportedFont(
  name: string,
): { family: string; href: string } | undefined {
  const key = name
    .replace(/["']/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!key) return undefined;
  const lookup = (candidate: string) =>
    GOOGLE_FONTS.get(GOOGLE_FONT_ALIASES[candidate] ?? candidate);
  return lookup(key) ?? lookup(key.replace(FONT_WEIGHT_SUFFIX, "").trim());
}

export function prepareImportedFonts(html: string): {
  html: string;
  hrefs: string[];
} {
  const hrefs = new Set<string>();
  const rewritten = html.replace(
    /(font-family:\s*)(["'])(.*?)\2/gi,
    (match, prefix: string, quote: string, name: string) => {
      const font = resolveImportedFont(name);
      if (!font) return match;
      hrefs.add(font.href);
      return `${prefix}${quote}${font.family}${quote}`;
    },
  );
  return { html: rewritten, hrefs: [...hrefs] };
}

const injectedFontHrefs = new Set<string>();

function loadImportedFonts(hrefs: string[]) {
  if (typeof document === "undefined") return;
  for (const href of hrefs) {
    if (injectedFontHrefs.has(href)) continue;
    injectedFontHrefs.add(href);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

const renderedSlideSources = new WeakMap<HTMLElement, RenderedSlideSource>();
const pendingSlideEditDrafts = new WeakMap<
  HTMLElement,
  Array<{ nonce: string; content: string }>
>();
const MAX_PENDING_SLIDE_EDIT_DRAFTS = 8;

// ponytail: cap delayed echoes at 8 drafts per canvas; raise it only if ordering proves insufficient.
export function noteSlideEditDraft(
  root: HTMLElement,
  nonce: string,
  content: string,
) {
  const drafts = pendingSlideEditDrafts.get(root) ?? [];
  const duplicate = drafts.findIndex(
    (draft) => draft.nonce === nonce && draft.content === content,
  );
  if (duplicate !== -1) drafts.splice(duplicate, 1);
  drafts.push({ nonce, content });
  if (drafts.length > MAX_PENDING_SLIDE_EDIT_DRAFTS) drafts.shift();
  pendingSlideEditDrafts.set(root, drafts);
}

function consumeSlideEditDraft(
  root: HTMLElement,
  nonce: string,
  content: string,
) {
  const drafts = pendingSlideEditDrafts.get(root);
  const index =
    drafts?.findIndex(
      (draft) => draft.nonce === nonce && draft.content === content,
    ) ?? -1;
  if (!drafts || index < 0) return false;
  drafts.splice(index, 1);
  return true;
}

export function getRenderedSlideSource(
  root: HTMLElement,
): RenderedSlideSource | undefined {
  return renderedSlideSources.get(root);
}

export const SLIDE_CONTENT_REPLACE_EVENT = "slides:before-content-replace";

export interface SlideContentReplaceDetail {
  content: string;
}

const EDITING_SELECTOR = '[contenteditable="true"]';

function registerRenderedSlideSource(
  root: HTMLElement,
  source: RenderedSlideSource | null,
) {
  if (source) renderedSlideSources.set(root, source);
  else renderedSlideSources.delete(root);
}

const LOGO_IMAGE_TAG =
  /(<img\s+(?=[^>]*src="[^"]*(?:brandfetch|logo\.dev)[^"]*")[^>]*)(\/?>)/gi;

export function renderRawSlideHtml(
  content: string,
  options: { scopeSelector: string; stampNonce?: string },
): {
  html: string;
  mermaidBlocks: string[];
  fontHrefs: string[];
  source: Omit<RenderedSlideSource, "base"> | null;
} {
  const stamped =
    options.stampNonce !== undefined
      ? stampSlideSource(content, options.stampNonce)
      : null;
  const { blocks, contentWithPlaceholders } = extractMermaidBlocks(
    stamped?.html ?? content,
  );

  const sanitized = sanitizeSlideHtml(
    contentWithPlaceholders.replace(
      LOGO_IMAGE_TAG,
      (_match, before: string, close: string) => {
        if (before.includes('style="')) {
          return (
            before.replace(
              'style="',
              'style="filter:brightness(0) invert(1);',
            ) + close
          );
        }
        return before + ' style="filter:brightness(0) invert(1);"' + close;
      },
    ),
    {
      scopeSelector: options.scopeSelector,
      allowBlobImages: typeof window !== "undefined",
    },
  );
  const { html, hrefs } = prepareImportedFonts(sanitized);
  return {
    html,
    mermaidBlocks: blocks,
    fontHrefs: hrefs,
    source:
      stamped && options.stampNonce !== undefined
        ? { stored: content, ranges: stamped.ranges, nonce: options.stampNonce }
        : null,
  };
}

function RawSlideHtmlContent({
  html,
  scopeId,
  slideId,
  source,
  mermaidBlocks,
}: {
  html: string;
  scopeId: string;
  slideId: string;
  source: RenderedSlideSource | null;
  mermaidBlocks: string[];
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const renderedHtmlRef = useRef(html);
  const dangerousHtmlRef = useRef({ __html: html });
  const [mermaidSlots, setMermaidSlots] = useState<HTMLElement[]>([]);

  useLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    if (renderedHtmlRef.current !== html) {
      const currentSource = getRenderedSlideSource(root);
      const sameSlide = currentSource?.nonce === source?.nonce;
      const isEditorDraftEcho =
        sameSlide &&
        source &&
        consumeSlideEditDraft(root, source.nonce, source.stored);
      if (isEditorDraftEcho && source && root.querySelector(EDITING_SELECTOR)) {
        renderedHtmlRef.current = html;
        registerRenderedSlideSource(root, source);
        return;
      }
      const uploadProvenance = source
        ? takeSlideImageUploadProvenance(slideId, source.stored)
        : null;
      if (root.querySelector(EDITING_SELECTOR)) {
        if (
          sameSlide &&
          source &&
          updateLiveImagesUnderEdit(
            root,
            renderedHtmlRef.current,
            html,
            uploadProvenance,
          )
        ) {
          renderedHtmlRef.current = html;
          registerRenderedSlideSource(root, source);
          return;
        }
        const detail: SlideContentReplaceDetail | null =
          sameSlide && source ? { content: source.stored } : null;
        root.dispatchEvent(
          new CustomEvent(SLIDE_CONTENT_REPLACE_EVENT, {
            bubbles: true,
            detail,
          }),
        );
      }
      if (root.querySelector(EDITING_SELECTOR)) {
        const error = new Error(
          "[slides] refused to re-render a slide while its text is being edited",
        );
        console.error(error);
        captureError(error, { tags: { area: "slides-save-boundary" } });
        return;
      }
      if (!swapImageSourcesInPlace(root, renderedHtmlRef.current, html)) {
        root.innerHTML = html;
      }
      renderedHtmlRef.current = html;
    }
    registerRenderedSlideSource(root, source);
    const slots =
      mermaidBlocks.length > 0
        ? Array.from(
            root.querySelectorAll<HTMLElement>("[data-mermaid-index]"),
          ).filter((el) => !el.parentElement?.closest("[data-mermaid-index]"))
        : [];
    setMermaidSlots((prev) =>
      prev.length === slots.length && prev.every((slot, i) => slot === slots[i])
        ? prev
        : slots,
    );
  }, [html, source, mermaidBlocks]);

  return (
    <>
      <div
        ref={contentRef}
        className="slide-content w-full block h-full"
        // guard:allow-raw-color - design-system text fallback for raw HTML
        style={{ color: "var(--ds-text, #1f2933)" }}
        data-slide-content-scope={scopeId}
        dangerouslySetInnerHTML={dangerousHtmlRef.current}
      />
      {mermaidSlots.map((slot) => {
        const index = Number(slot.getAttribute("data-mermaid-index"));
        return createPortal(
          <MermaidRenderer
            definition={mermaidBlocks[index] ?? ""}
            index={index}
            className="my-4 w-full"
          />,
          slot,
          `mermaid-${index}`,
        );
      })}
    </>
  );
}

function BlankSlideContent({
  content,
  slideId,
  stampNonce,
}: {
  content: string;
  slideId: string;
  stampNonce?: string;
}) {
  const scopeId = `slide-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scopeSelector = `[data-slide-content-scope="${scopeId}"]`;
  const nonce =
    stampNonce === undefined ? undefined : `${scopeId}.${stampNonce}`;
  const { mermaidBlocks, htmlWithPlaceholders, fontHrefs, source } =
    useMemo(() => {
      const rendered = renderRawSlideHtml(content, {
        scopeSelector,
        stampNonce: nonce,
      });
      return {
        mermaidBlocks: rendered.mermaidBlocks,
        htmlWithPlaceholders: rendered.html,
        fontHrefs: rendered.fontHrefs,
        source: rendered.source
          ? { ...rendered.source, base: rendered.html }
          : null,
      };
    }, [content, scopeSelector, nonce]);

  useEffect(() => {
    loadImportedFonts(fontHrefs);
  }, [fontHrefs]);

  return (
    <RawSlideHtmlContent
      html={htmlWithPlaceholders}
      scopeId={scopeId}
      slideId={slideId}
      source={source}
      mermaidBlocks={mermaidBlocks}
    />
  );
}

export function isRawHtmlSlide(slide: Pick<Slide, "content" | "layout">) {
  const content = typeof slide.content === "string" ? slide.content : "";
  const trimmedContent = content.trimStart();
  const isConvertedMarkdownImage =
    /^<img\b\s+data-markdown-image(?:\s*=\s*(?:"true"|'true'|true))?(?:\s|>)/i.test(
      trimmedContent,
    );
  return (
    content.includes('class="fmd-slide"') ||
    (trimmedContent.startsWith("<") && !isConvertedMarkdownImage) ||
    ["blank", "section", "statement", "full-image"].includes(slide.layout)
  );
}

export function SlideInner({
  slide,
  designSystem,
  aspectRatio,
  onOverflowChange,
  onAutofitSettled,
  stampSource,
}: {
  slide: Slide;
  designSystem?: DesignSystemData;
  aspectRatio?: AspectRatio;
  onOverflowChange?: (info: SlideOverflowInfo) => void;
  onAutofitSettled?: () => void;
  stampSource?: boolean;
}) {
  const t = useT();
  const dims = getAspectRatioDims(aspectRatio);
  const sizeStyle: React.CSSProperties = {
    width: dims.width,
    height: dims.height,
  };

  const bg = resolveSlideBackground(slide.background, designSystem);
  const isGradientClass = bg.startsWith("bg-");
  const cssBackground = isGradientClass ? backgroundCssValue(bg) : bg;
  const safeBackground = cssBackground ? sanitizeCssValue(cssBackground) : null;
  const bgStyle = safeBackground ? { background: safeBackground } : undefined;
  const bgClass = isGradientClass ? bg : "";
  const isCentered = slide.layout === "title";
  const darkSlide = isDarkSlideBackground(safeBackground ?? bg);

  const dsStyle = {
    "--ds-bg": safeBackground ?? "transparent",
    ...(designSystem
      ? {
          "--ds-accent": designSystem.colors.accent,
          "--ds-text": designSystem.colors.text,
          "--ds-text-muted": designSystem.colors.textMuted,
          "--ds-heading-font": designSystem.typography.headingFont,
          "--ds-body-font": designSystem.typography.bodyFont,
          "--ds-primary": designSystem.colors.primary,
          "--ds-secondary": designSystem.colors.secondary,
          // guard:allow-raw-color - safe placeholder surface fallback
          "--ds-surface":
            // guard:allow-raw-color - safe placeholder surface fallback
            sanitizeCssValue(designSystem.colors.surface) ?? "#FFFFFF",
          "--ds-radius": designSystem.borders.radius,
        }
      : {}),
  } as React.CSSProperties & Record<string, string>;
  if (
    darkSlide &&
    (!designSystem || isDarkSlideBackground(designSystem.colors.text))
  ) {
    // guard:allow-raw-color - readable Markdown defaults on explicit dark slides
    dsStyle["--ds-text"] = "#FFFFFF";
    // guard:allow-raw-color - readable Markdown defaults on explicit dark slides
    dsStyle["--ds-text-muted"] = "rgba(255, 255, 255, 0.72)";
  }

  const overflowByTargetRef = useRef(new Map<string, SlideOverflowInfo>());
  const reportTargetOverflow = useCallback(
    (targetKey: string, info: SlideOverflowInfo) => {
      overflowByTargetRef.current.set(targetKey, info);
      if (!onOverflowChange) return;
      const measurements = [...overflowByTargetRef.current.values()];
      onOverflowChange(
        measurements.reduce(
          (result, measurement) => ({
            verticalOverflow: Math.max(
              result.verticalOverflow,
              measurement.verticalOverflow,
            ),
            horizontalOverflow: Math.max(
              result.horizontalOverflow,
              measurement.horizontalOverflow,
            ),
            contentHeight: Math.max(
              result.contentHeight,
              measurement.contentHeight,
            ),
            contentWidth: Math.max(
              result.contentWidth,
              measurement.contentWidth,
            ),
            viewportHeight: Math.max(
              result.viewportHeight,
              measurement.viewportHeight,
            ),
            viewportWidth: Math.max(
              result.viewportWidth,
              measurement.viewportWidth,
            ),
          }),
          {
            verticalOverflow: 0,
            horizontalOverflow: 0,
            contentHeight: 0,
            contentWidth: 0,
            viewportHeight: 0,
            viewportWidth: 0,
          },
        ),
      );
    },
    [onOverflowChange],
  );

  useEffect(() => {
    overflowByTargetRef.current.clear();
  }, [slide.id, slide.content, slide.layoutFitRevision, aspectRatio]);

  const parsedExcalidrawData = slide.excalidrawData
    ? parseExcalidrawData(slide.excalidrawData)
    : null;
  const hasExcalidraw = Boolean(parsedExcalidrawData?.elements?.length);

  useEffect(() => {
    if (!hasExcalidraw) return;
    onOverflowChange?.({
      contentHeight: dims.height,
      contentWidth: dims.width,
      viewportHeight: dims.height,
      viewportWidth: dims.width,
      verticalOverflow: 0,
      horizontalOverflow: 0,
    });
    onAutofitSettled?.();
  }, [
    dims.height,
    dims.width,
    hasExcalidraw,
    onAutofitSettled,
    onOverflowChange,
    slide.excalidrawData,
    slide.id,
    slide.layoutFitRevision,
  ]);

  if (slide.excalidrawData && parsedExcalidrawData?.elements?.length) {
    return (
      <div
        className={`relative ${bgClass}`}
        style={{ ...sizeStyle, ...bgStyle, ...dsStyle }}
        data-slide-canvas={slide.id}
      >
        <ExcalidrawThumbnail data={slide.excalidrawData} />
      </div>
    );
  }

  const imageLoadingOverlay = slide.imageLoading && (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="flex flex-col items-center gap-3">
        <div className="w-48 h-32 rounded-lg overflow-hidden">
          <Skeleton className="w-full h-full bg-white/[0.06]" />
        </div>
        <span className="text-xs text-white/40 animate-pulse">
          {t("raw.generatingImage")}
        </span>
      </div>
    </div>
  );

  const content = typeof slide.content === "string" ? slide.content : "";
  const isRawHtml = isRawHtmlSlide(slide);

  if (!isRawHtml && slide.layout === "two-column") {
    const parts = content.split("---");
    const left = parts[0] || "";
    const right = parts[1] || "";

    return (
      <div
        className={`relative ${bgClass} ${layoutClasses[slide.layout]}`}
        style={{ ...sizeStyle, ...bgStyle, ...dsStyle, textAlign: "left" }}
        data-slide-canvas={slide.id}
      >
        {imageLoadingOverlay}
        <AutoFitContent
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          fitKey={`${slide.layoutFitRevision ?? ""}:${left}`}
          className="slide-content"
          {...(slideDeclaresTextColor(left)
            ? { contentScope: AUTHORED_COLOR_SCOPE }
            : {})}
          onOverflowChange={(info) => reportTargetOverflow("left", info)}
          onAutofitSettled={onAutofitSettled}
        >
          <ReactMarkdown
            components={markdownComponents}
            rehypePlugins={[rehypeRaw]}
          >
            {left.trim()}
          </ReactMarkdown>
        </AutoFitContent>
        <AutoFitContent
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          fitKey={`${slide.layoutFitRevision ?? ""}:${right}`}
          className="slide-content"
          {...(slideDeclaresTextColor(right)
            ? { contentScope: AUTHORED_COLOR_SCOPE }
            : {})}
          onOverflowChange={(info) => reportTargetOverflow("right", info)}
          onAutofitSettled={onAutofitSettled}
        >
          <ReactMarkdown
            components={markdownComponents}
            rehypePlugins={[rehypeRaw]}
          >
            {right.trim()}
          </ReactMarkdown>
        </AutoFitContent>
      </div>
    );
  }

  if (isRawHtml) {
    return (
      <div
        className={`${bgClass} ${layoutClasses.blank}`}
        style={{ ...sizeStyle, ...bgStyle, ...dsStyle }}
        data-slide-canvas={slide.id}
      >
        <AutoFitContent
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          fitKey={`${slide.layoutFitRevision ?? ""}:${content}`}
          className="h-full w-full"
          onOverflowChange={(info) => reportTargetOverflow("raw", info)}
          onAutofitSettled={onAutofitSettled}
        >
          <BlankSlideContent
            content={content}
            slideId={slide.id}
            stampNonce={stampSource ? slide.id : undefined}
          />
        </AutoFitContent>
      </div>
    );
  }

  return (
    <div
      className={`relative ${bgClass} ${layoutClasses[slide.layout] || layoutClasses.content}`}
      style={{
        ...sizeStyle,
        ...bgStyle,
        ...dsStyle,
        textAlign: isCentered ? "center" : "left",
      }}
      data-slide-canvas={slide.id}
    >
      {imageLoadingOverlay}
      <AutoFitContent
        canvasWidth={dims.width}
        canvasHeight={dims.height}
        fitKey={`${slide.layoutFitRevision ?? ""}:${content}`}
        className="slide-content w-full"
        {...(slideDeclaresTextColor(content)
          ? { contentScope: AUTHORED_COLOR_SCOPE }
          : {})}
        onOverflowChange={(info) => reportTargetOverflow("markdown", info)}
        onAutofitSettled={onAutofitSettled}
      >
        <ReactMarkdown
          components={markdownComponents}
          rehypePlugins={[rehypeRaw]}
        >
          {content}
        </ReactMarkdown>
      </AutoFitContent>
    </div>
  );
}

export default function SlideRenderer({
  slide,
  className = "",
  thumbnail = true,
  designSystem,
  aspectRatio,
  onOverflowChange,
  onAutofitSettled,
  stampSource,
}: SlideRendererProps) {
  const dims = getAspectRatioDims(aspectRatio);

  if (!thumbnail) {
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}
      >
        <div
          className="shrink-0 origin-center"
          style={{
            width: dims.width,
            height: dims.height,
            transform: "scale(var(--slide-scale, 1))",
          }}
        >
          <SlideInner
            slide={slide}
            designSystem={designSystem}
            aspectRatio={aspectRatio}
            onOverflowChange={onOverflowChange}
            onAutofitSettled={onAutofitSettled}
            stampSource={stampSource}
          />
        </div>
        <ScaleHelper
          targetWidth={dims.width}
          targetHeight={dims.height}
          mode="contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-lg overflow-hidden relative ${className}`}
      style={{ aspectRatio: `${dims.width} / ${dims.height}` }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: dims.width,
          height: dims.height,
          transform: "scale(var(--slide-scale, 0.25))",
        }}
      >
        <SlideInner
          slide={slide}
          designSystem={designSystem}
          aspectRatio={aspectRatio}
          onOverflowChange={onOverflowChange}
          onAutofitSettled={onAutofitSettled}
          stampSource={stampSource}
        />
      </div>
      <ScaleHelper targetWidth={dims.width} />
    </div>
  );
}

function ScaleHelper({
  targetWidth = 960,
  targetHeight,
  mode,
}: {
  targetWidth?: number;
  targetHeight?: number;
  mode?: "contain";
}) {
  const refCallback = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const parent = el.parentElement;
      if (!parent) return;

      const updateScale = () => {
        const rect = parent.getBoundingClientRect();
        const w = parent.offsetWidth || rect.width || window.innerWidth;
        const h = parent.offsetHeight || rect.height || window.innerHeight;
        if (!w || !h) return;
        if (mode === "contain" && targetHeight) {
          const scale = Math.min(w / targetWidth, h / targetHeight);
          parent.style.setProperty("--slide-scale", String(scale));
        } else {
          parent.style.setProperty("--slide-scale", String(w / targetWidth));
        }
      };

      updateScale();
      const raf = requestAnimationFrame(updateScale);

      const observer = new ResizeObserver(updateScale);
      observer.observe(parent);

      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    },
    [targetWidth, targetHeight, mode],
  );

  return (
    <div className="absolute inset-0 pointer-events-none" ref={refCallback} />
  );
}
