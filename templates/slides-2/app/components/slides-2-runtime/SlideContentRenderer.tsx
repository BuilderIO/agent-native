import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";

import type { DesignSystemData } from "../../../shared/api";
import type { SlidePosition } from "../../../shared/slide-number";
import type { SlideRenderArtifact } from "./protocol";
import { SandboxedSlide, type FramePointer } from "./SandboxedSlide";
import { Slides2Canvas } from "./Slides2Canvas";

interface SlideContentRendererProps {
  slide: Slide;
  slidePosition?: SlidePosition;
  sourceDeckId?: string;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
}

function requiresSourceRuntime(slide: Slide): boolean {
  return (
    slide.sourceRuntimeRequired === true ||
    (typeof slide.sourceTsx === "string" &&
      Boolean(slide.sourceTsx.trim()) &&
      !slide.content.trim())
  );
}

export default function SlideContentRenderer({
  slide,
  slidePosition,
  sourceDeckId,
  aspectRatio,
  designSystem,
}: SlideContentRendererProps) {
  if (requiresSourceRuntime(slide)) {
    return (
      <SourceSlideRuntime
        slide={slide}
        slidePosition={slidePosition}
        sourceDeckId={sourceDeckId}
      />
    );
  }

  return (
    <SlideRenderer
      slide={slide}
      slidePosition={slidePosition}
      thumbnail={false}
      aspectRatio={aspectRatio}
      designSystem={designSystem}
    />
  );
}

function SourceSlideRuntime({
  slide,
  slidePosition,
  sourceDeckId,
}: Pick<
  SlideContentRendererProps,
  "slide" | "slidePosition" | "sourceDeckId"
>) {
  const t = useT();
  const render = useActionQuery(
    "get-slide-render",
    { deckId: sourceDeckId ?? "", slideId: slide.id },
    { enabled: Boolean(sourceDeckId) },
  );
  const artifact = render.data as SlideRenderArtifact | undefined;
  const artifactKey = artifact
    ? `${artifact.deckId}:${artifact.slideId}:${artifact.revision}:${artifact.sourceHash}`
    : `${sourceDeckId ?? ""}:${slide.id}`;
  const [sandboxError, setSandboxError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const onSandboxError = useCallback(
    (message: string) => setSandboxError({ key: artifactKey, message }),
    [artifactKey],
  );

  const unavailable = !sourceDeckId;
  const error =
    sandboxError?.key === artifactKey
      ? sandboxError.message
      : (actionErrorMessage(render.error) ??
        (!render.isLoading && !artifact && !unavailable
          ? t("presentation.loadFailed")
          : null));

  if (unavailable || error) {
    return (
      <div
        role={unavailable ? "status" : "alert"}
        className={
          /* guard:allow-raw-color — source slides render on the fixed black presentation stage. */ "absolute inset-0 flex items-center justify-center bg-black px-10 text-center text-white/80"
        }
      >
        {unavailable ? t("presentation.reactSlideUnavailable") : error}
      </div>
    );
  }

  if (render.isLoading || !artifact) {
    return (
      <div
        className="h-full w-full animate-pulse"
        aria-hidden="true"
        data-source-slide-loading={slide.id}
      />
    );
  }

  const onPointer = (_pointer: FramePointer) => {};

  return (
    <Slides2Canvas className="h-full w-full" flat>
      <SandboxedSlide
        artifact={artifact}
        title={t("slides2Presenter.slideLabel", {
          index: slidePosition?.number ?? 1,
        })}
        onNodes={() => {}}
        onPointer={onPointer}
        onError={onSandboxError}
      />
    </Slides2Canvas>
  );
}
