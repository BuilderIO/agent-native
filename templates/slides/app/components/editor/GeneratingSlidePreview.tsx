import { renderableHtmlPrefix } from "@agent-native/core/client/generation-stream";
import { useT } from "@agent-native/core/client/i18n";
import { GeneratingFrame } from "@agent-native/toolkit/app/generation";

import SlideRenderer, {
  SlideStreamingContext,
} from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import { cn } from "@/lib/utils";

import type { DesignSystemData } from "../../../shared/api";

/**
 * The background the slide's outer element paints, read from its opening tag.
 * The draft hides that element until its frame has drawn, so the preview
 * surface has to be that color already or it flashes the default white.
 */
function slideRootBackground(html: string): string | undefined {
  const tagEnd = html.indexOf(">");
  if (tagEnd === -1 || typeof document === "undefined") return undefined;
  const template = document.createElement("template");
  template.innerHTML = html.slice(0, tagEnd + 1);
  const root = template.content.firstElementChild;
  if (!(root instanceof HTMLElement)) return undefined;
  const background = root.style.background || root.style.backgroundColor;
  if (!background) return undefined;
  // Slides often set the color through a custom property on the same element.
  const resolved = background.replace(
    /var\((--[\w-]+)\)/g,
    (match, name: string) => root.style.getPropertyValue(name).trim() || match,
  );
  return resolved.includes("var(") ? undefined : resolved;
}

export default function GeneratingSlidePreview({
  content,
  failed = false,
  settling = false,
  aspectRatio,
  thumbnail = true,
  className,
  designSystem,
  busy = true,
}: {
  /** The slide HTML streamed so far. */
  content?: string | null;
  /** The add-slide call errored; what streamed is not a slide. */
  failed?: boolean;
  /** The call has landed; let the draft finish before the saved slide shows. */
  settling?: boolean;
  aspectRatio?: AspectRatio;
  thumbnail?: boolean;
  className?: string;
  designSystem?: DesignSystemData;
  busy?: boolean;
}) {
  const t = useT();
  const cssRatio = (aspectRatio ?? "16:9").replace(":", " / ");
  const renderable = content ? renderableHtmlPrefix(content) : "";
  const surfaceClassName = cn(
    "w-full rounded-lg border border-border bg-muted/20",
    className,
  );

  if (!busy) {
    return (
      <div
        className={surfaceClassName}
        style={{ aspectRatio: cssRatio }}
        aria-hidden
      />
    );
  }

  const background = slideRootBackground(renderable);
  const previewSlide: Slide = {
    id: "generating-slide-preview",
    content: renderable,
    notes: "",
    layout: "blank",
    ...(background ? { background } : {}),
  };

  return (
    <GeneratingFrame
      status={
        failed
          ? "failed"
          : settling
            ? "done"
            : renderable
              ? "streaming"
              : "pending"
      }
      label={thumbnail ? undefined : t("editorSidebar.generatingSlide")}
      ariaLabel={thumbnail ? t("editorSidebar.generatingSlide") : undefined}
      surfaceClassName={surfaceClassName}
      surfaceStyle={{ aspectRatio: cssRatio }}
    >
      {renderable ? (
        <SlideStreamingContext.Provider value>
          <SlideRenderer
            slide={previewSlide}
            aspectRatio={aspectRatio}
            thumbnail={thumbnail}
            designSystem={designSystem}
            className="h-full w-full"
          />
        </SlideStreamingContext.Provider>
      ) : undefined}
    </GeneratingFrame>
  );
}
