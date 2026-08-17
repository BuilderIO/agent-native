import { useT } from "@agent-native/core/client/i18n";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Skeleton } from "@/components/ui/skeleton";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import { cn } from "@/lib/utils";

import type { DesignSystemData } from "../../../shared/api";

function SlideLoadingArtwork() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-muted/30 p-[14%]">
      <Skeleton className="h-[7%] w-[42%] bg-muted/70" />
      <Skeleton className="h-[4%] w-[68%] bg-muted/50" />
      <div className="mt-[5%] grid grid-cols-2 gap-[8%]">
        <Skeleton className="h-24 w-full bg-muted/50" />
        <Skeleton className="h-24 w-full bg-muted/40" />
      </div>
    </div>
  );
}

export default function GeneratingSlidePreview({
  content,
  aspectRatio,
  thumbnail = true,
  className,
  designSystem,
}: {
  content?: string | null;
  aspectRatio?: AspectRatio;
  thumbnail?: boolean;
  className?: string;
  designSystem?: DesignSystemData;
}) {
  const t = useT();
  const cssRatio = (aspectRatio ?? "16:9").replace(":", " / ");
  const previewSlide: Slide = {
    id: "generating-slide-preview",
    content: content ?? "",
    notes: "",
    layout: "blank",
  };

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border bg-muted/20",
        className,
      )}
      style={{ aspectRatio: cssRatio }}
      aria-busy="true"
      aria-label={t("editorSidebar.generatingSlide")}
    >
      {content ? (
        <SlideRenderer
          slide={previewSlide}
          aspectRatio={aspectRatio}
          thumbnail={thumbnail}
          designSystem={designSystem}
          className="h-full w-full"
        />
      ) : (
        <SlideLoadingArtwork />
      )}
    </div>
  );
}
