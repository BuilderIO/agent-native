import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import type { Slide } from "@/context/DeckContext";
import { Skeleton } from "@/components/ui/skeleton";
import { MermaidRenderer } from "./MermaidRenderer";
import { ExcalidrawThumbnail, parseExcalidrawData } from "./ExcalidrawSlide";
import type { DesignSystemData } from "../../../shared/api";
import { type AspectRatio, getAspectRatioDims } from "@/lib/aspect-ratios";

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

  if (src === "PLACEHOLDER_IMAGE" || !src) {
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
        src={src}
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

/** Renders blank slide HTML content and applies white filter to logo images */
function BlankSlideContent({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply white filter to all logo images (brandfetch, logo.dev, etc.) for dark backgrounds
  const processedContent = content.replace(
    /(<img\s+(?=[^>]*src="[^"]*(?:brandfetch|logo\.dev)[^"]*")[^>]*)(\/?>)/gi,
    (match, before, close) => {
      if (before.includes('style="')) {
        return (
          before.replace('style="', 'style="filter:brightness(0) invert(1);') +
          close
        );
      }
      return before + ' style="filter:brightness(0) invert(1);"' + close;
    },
  );

  // Extract mermaid blocks from HTML content for React-based rendering
  const mermaidBlocks: string[] = [];
  const htmlWithPlaceholders = processedContent.replace(
    /<div\s+class="mermaid"[^>]*>([\s\S]*?)<\/div>/gi,
    (_, definition) => {
      mermaidBlocks.push(definition.trim());
      return `<div data-mermaid-index="${mermaidBlocks.length - 1}"></div>`;
    },
  );

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
      ref={containerRef}
      className="slide-content text-white/90 w-full block h-full"
      dangerouslySetInnerHTML={{ __html: processedContent }}
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
  const bgStyle = !isGradientClass ? { background: bg } : undefined;
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
        <div className="slide-content text-white/90">
          <ReactMarkdown
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
            {left.trim()}
          </ReactMarkdown>
        </div>
        <div className="slide-content text-white/90">
          <ReactMarkdown
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
            {right.trim()}
          </ReactMarkdown>
        </div>
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
        <BlankSlideContent content={content} />
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
      <div className="slide-content text-white/90 w-full">
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
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
