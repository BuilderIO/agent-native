import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Slide } from "@/context/DeckContext";
import { Skeleton } from "@/components/ui/skeleton";
import { MermaidRenderer } from "./MermaidRenderer";
import { ExcalidrawThumbnail, parseExcalidrawData } from "./ExcalidrawSlide";
import type { DesignSystemData } from "../../../shared/api";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";
import {
  sanitizeCssValue,
  sanitizeSlideHtml,
  sanitizeSlideUrl,
} from "@/lib/sanitize-slide-html";

interface SlideRendererProps {
  slide: Slide;
  className?: string;
  /** If true, renders at full slide resolution and scales down via CSS to fit the container */
  thumbnail?: boolean;
  /** Design system to inject as CSS custom properties */
  designSystem?: DesignSystemData;
  /** Deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
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

/** Custom image component that shows skeleton while loading */
function LazyImage({
  src,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const safeSrc = sanitizeSlideUrl(src, "image");

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
    // If the child is a mermaid code block, don't wrap in <pre>
    const child = Array.isArray(children) ? children[0] : children;
    if (child?.props?.className === "language-mermaid") {
      return <>{children}</>;
    }
    return <pre {...props}>{children}</pre>;
  },
};

const MIN_AUTOFIT_SCALE = 0.65;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SlideFitTransform {
  scale: number;
  x: number;
  y: number;
  fitted: boolean;
}

export function computeSlideFitTransform({
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
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
}): SlideFitTransform {
  const safeContentWidth = Math.max(1, contentWidth);
  const safeContentHeight = Math.max(1, contentHeight);
  const rawScale = Math.min(
    1,
    Math.max(1, viewportWidth) / safeContentWidth,
    Math.max(1, viewportHeight) / safeContentHeight,
  );
  const scale = Math.max(minScale, rawScale);

  return {
    scale,
    x: minX < 0 ? -minX * scale : 0,
    y: minY < 0 ? -minY * scale : 0,
    fitted: rawScale < 0.999,
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
  minX: number;
  minY: number;
} {
  const targetRect = target.getBoundingClientRect();
  let minX = 0;
  let minY = 0;
  let maxX = target.scrollWidth;
  let maxY = target.scrollHeight;

  for (const el of Array.from(target.querySelectorAll<HTMLElement>("*"))) {
    if (el.tagName.toLowerCase() === "style") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    minX = Math.min(minX, rect.left - targetRect.left);
    minY = Math.min(minY, rect.top - targetRect.top);
    maxX = Math.max(maxX, rect.right - targetRect.left);
    maxY = Math.max(maxY, rect.bottom - targetRect.top);
  }

  return {
    contentWidth: Math.max(target.scrollWidth, maxX - minX),
    contentHeight: Math.max(target.scrollHeight, maxY - minY),
    minX,
    minY,
  };
}

function useSlideAutofit(
  ref: React.RefObject<HTMLDivElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  fitKey: string,
) {
  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    let raf = 0;
    let disposed = false;

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

      for (const target of targets) {
        if (isEditing) {
          resetTarget(target);
          continue;
        }

        resetTarget(target);
        const bounds = measureContentBounds(target);
        const viewportWidth = target.clientWidth || canvasWidth;
        const viewportHeight = target.clientHeight || canvasHeight;
        const transform = computeSlideFitTransform({
          ...bounds,
          viewportWidth,
          viewportHeight,
        });

        target.style.setProperty("--fmd-fit-scale", String(transform.scale));
        target.style.setProperty("--fmd-fit-x", `${transform.x}px`);
        target.style.setProperty("--fmd-fit-y", `${transform.y}px`);
        if (transform.fitted) {
          target.setAttribute("data-fmd-autofit-active", "true");
        }
      }
    };

    const scheduleMeasure = () => {
      if (disposed) return;
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

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      root.removeEventListener("load", scheduleMeasure, true);
    };
  }, [canvasWidth, canvasHeight, fitKey, ref]);
}

function AutoFitContent({
  canvasWidth,
  canvasHeight,
  fitKey,
  className = "",
  children,
}: {
  canvasWidth: number;
  canvasHeight: number;
  fitKey: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSlideAutofit(ref, canvasWidth, canvasHeight, fitKey);

  return (
    <div
      ref={ref}
      data-slide-autofit-root="true"
      className={`fmd-autofit-scale ${className}`}
    >
      {children}
    </div>
  );
}

/** Renders blank slide HTML content and applies white filter to logo images */
function BlankSlideContent({ content }: { content: string }) {
  // Memoize derived strings + the dangerouslySetInnerHTML object on `content` so
  // the prop value has a stable reference across re-renders. React 19 only checks
  // reference equality on `dangerouslySetInnerHTML` and unconditionally re-assigns
  // `domElement.innerHTML` when the object reference differs — a fresh `{ __html }`
  // literal each render therefore wipes any DOM mutations made on children. That
  // includes the per-block `contentEditable="true"` set by SlideEditor's
  // double-click-to-edit flow, which made inline text editing appear to do nothing.
  const { mermaidBlocks, htmlWithPlaceholders, dangerousHtml } = useMemo(() => {
    // Apply white filter to all logo images (brandfetch, logo.dev, etc.) for dark backgrounds
    const processed = sanitizeSlideHtml(
      content.replace(
        /(<img\s+(?=[^>]*src="[^"]*(?:brandfetch|logo\.dev)[^"]*")[^>]*)(\/?>)/gi,
        (_match, before, close) => {
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
    );

    // Extract mermaid blocks from HTML content for React-based rendering
    const blocks: string[] = [];
    const withPlaceholders = processed.replace(
      /<div\s+class="mermaid"[^>]*>([\s\S]*?)<\/div>/gi,
      (_, definition) => {
        blocks.push(definition.trim());
        return `<div data-mermaid-index="${blocks.length - 1}"></div>`;
      },
    );

    return {
      mermaidBlocks: blocks,
      htmlWithPlaceholders: withPlaceholders,
      dangerousHtml: { __html: processed },
    };
  }, [content]);

  if (mermaidBlocks.length > 0) {
    return (
      <div className="slide-content text-white/90 w-full block h-full">
        <MermaidHtmlContent
          html={htmlWithPlaceholders}
          mermaidBlocks={mermaidBlocks}
        />
      </div>
    );
  }

  return (
    <div
      className="slide-content text-white/90 w-full block h-full"
      dangerouslySetInnerHTML={dangerousHtml}
    />
  );
}

/** Renders HTML content with mermaid placeholders replaced by React MermaidRenderer */
function MermaidHtmlContent({
  html,
  mermaidBlocks,
}: {
  html: string;
  mermaidBlocks: string[];
}) {
  // Split on mermaid placeholders and interleave HTML + MermaidRenderer
  const parts = html.split(/(<div data-mermaid-index="\d+"><\/div>)/);

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/data-mermaid-index="(\d+)"/);
        if (match) {
          const idx = parseInt(match[1], 10);
          return (
            <MermaidRenderer
              key={`mermaid-${i}`}
              definition={mermaidBlocks[idx]}
              className="my-4 w-full"
            />
          );
        }
        if (!part.trim()) return null;
        return <div key={i} dangerouslySetInnerHTML={{ __html: part }} />;
      })}
    </>
  );
}

/** Core slide rendering at the deck's aspect-ratio resolution - used by both thumbnails and presentation */
export function SlideInner({
  slide,
  designSystem,
  aspectRatio,
}: {
  slide: Slide;
  designSystem?: DesignSystemData;
  aspectRatio?: AspectRatio;
}) {
  const dims = getAspectRatioDims(aspectRatio);
  const sizeStyle: React.CSSProperties = {
    width: dims.width,
    height: dims.height,
  };

  const bg = slide.background || "bg-[#000000]";
  const isGradientClass = bg.startsWith("bg-");
  const safeBackground = !isGradientClass ? sanitizeCssValue(bg) : null;
  const bgStyle = safeBackground ? { background: safeBackground } : undefined;
  const bgClass = isGradientClass ? bg : "";
  const isCentered = slide.layout === "title";

  const dsStyle = designSystem
    ? ({
        "--ds-accent": designSystem.colors.accent,
        "--ds-bg": designSystem.colors.background,
        "--ds-text": designSystem.colors.text,
        "--ds-text-muted": designSystem.colors.textMuted,
        "--ds-heading-font": designSystem.typography.headingFont,
        "--ds-body-font": designSystem.typography.bodyFont,
        "--ds-primary": designSystem.colors.primary,
        "--ds-radius": designSystem.borders.radius,
      } as React.CSSProperties)
    : {};

  // If slide has excalidraw data, render it as a static SVG thumbnail
  if (
    slide.excalidrawData &&
    parseExcalidrawData(slide.excalidrawData)?.elements?.length
  ) {
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
          Generating image...
        </span>
      </div>
    </div>
  );

  // Slides with fmd-slide class use inline styles — render as raw HTML to avoid layout conflicts
  const content = typeof slide.content === "string" ? slide.content : "";
  const isRawHtml =
    content.includes('class="fmd-slide"') ||
    ["blank", "section", "statement", "full-image"].includes(slide.layout);

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
          fitKey={left}
          className="slide-content text-white/90"
        >
          <ReactMarkdown components={markdownComponents}>
            {left.trim()}
          </ReactMarkdown>
        </AutoFitContent>
        <AutoFitContent
          canvasWidth={dims.width}
          canvasHeight={dims.height}
          fitKey={right}
          className="slide-content text-white/90"
        >
          <ReactMarkdown components={markdownComponents}>
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
          fitKey={content}
          className="h-full w-full"
        >
          <BlankSlideContent content={content} />
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
        fitKey={content}
        className="slide-content text-white/90 w-full"
      >
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
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
}: SlideRendererProps) {
  const dims = getAspectRatioDims(aspectRatio);

  if (!thumbnail) {
    // Full-size rendering (for presentation mode) — same intrinsic canvas scaled to fill
    return (
      <div className={`w-full h-full overflow-hidden relative ${className}`}>
        <div
          className="absolute top-0 left-0 origin-top-left"
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

  // Thumbnail mode: render at intrinsic resolution and scale down to fit
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
        />
      </div>
      <ScaleHelper targetWidth={dims.width} />
    </div>
  );
}

/** Sets --slide-scale CSS variable on the parent based on container size */
function ScaleHelper({
  targetWidth = 960,
  targetHeight,
  mode,
}: {
  targetWidth?: number;
  targetHeight?: number;
  mode?: "contain";
}) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      ref={(el) => {
        if (!el) return;
        const parent = el.parentElement;
        if (!parent) return;

        const updateScale = () => {
          const w = parent.offsetWidth;
          const h = parent.offsetHeight;
          if (mode === "contain" && targetHeight) {
            // Scale to contain both dimensions (no cropping)
            const scale = Math.min(w / targetWidth, h / targetHeight);
            parent.style.setProperty("--slide-scale", String(scale));
          } else {
            // Scale to fit width
            parent.style.setProperty("--slide-scale", String(w / targetWidth));
          }
        };
        updateScale();

        const observer = new ResizeObserver(updateScale);
        observer.observe(parent);

        (el as any).__cleanup = () => observer.disconnect();
      }}
    />
  );
}
