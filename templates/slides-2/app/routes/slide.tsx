import { callActionWithRetry } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  isInAgentEmbed,
  postNavigate,
} from "@agent-native/core/client/navigation";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import { IconExternalLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import SlideContentRenderer from "@/components/slides-2-runtime/SlideContentRenderer";
import { Button } from "@/components/ui/button";
import type { Slide } from "@/context/DeckContext";
import { useDeckDesignSystem } from "@/hooks/use-deck-design-system";
import messages from "@/i18n/en-US";
import type { AspectRatio } from "@/lib/aspect-ratios";

import type { SlidePosition } from "../../shared/slide-number";

export function meta() {
  return [{ title: messages.raw.slidePreviewTitle }];
}

function SlideError({ message }: { message: string }) {
  const t = useT();
  return (
    <div
      className={
        /* guard:allow-raw-color — slide preview errors remain on the fixed black stage. */ "flex h-screen w-screen items-center justify-center bg-black"
      }
    >
      <div className="text-center">
        <div
          className={
            /* guard:allow-raw-color — slide preview error copy contrasts with the fixed black stage. */ "text-sm font-medium text-white/60"
          }
        >
          {t("raw.slideUnavailable")}
        </div>
        <div
          className={
            /* guard:allow-raw-color — slide preview error copy contrasts with the fixed black stage. */ "mt-1 text-xs text-white/35"
          }
        >
          {message}
        </div>
      </div>
    </div>
  );
}

export default function SlideRoute() {
  const t = useT();
  const [params] = useSearchParams();
  const deckId = params.get("deckId");
  const slideNumberParam = params.get("slideNumber");
  const slideIndexParam = params.get("slideIndex");
  const stepParams = params.getAll("step");
  const stepParam = stepParams[0] ?? null;
  const parsedStep =
    stepParam !== null && /^\d+$/.test(stepParam) ? Number(stepParam) : null;
  const invalidStep =
    stepParams.length > 1 ||
    (stepParam !== null &&
      (parsedStep === null ||
        !Number.isSafeInteger(parsedStep) ||
        parsedStep > 500));
  const stepNumber = invalidStep ? null : parsedStep;

  const [slide, setSlide] = useState<Slide | null>(null);
  const [slidePosition, setSlidePosition] = useState<SlidePosition | undefined>(
    undefined,
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | undefined>(
    undefined,
  );
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  const [deckTitle, setDeckTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);

  const slideNumber =
    slideNumberParam !== null ? parseInt(slideNumberParam, 10) : null;
  const slideIndex =
    slideNumber !== null
      ? slideNumber - 1
      : slideIndexParam !== null
        ? parseInt(slideIndexParam, 10)
        : 0;
  const previewKey = JSON.stringify([
    deckId,
    slideNumberParam,
    slideIndexParam,
  ]);
  const previewMatchesRoute = loadedPreviewKey === previewKey;
  const currentDeckTitle = previewMatchesRoute ? deckTitle : null;
  const { designSystem } = useDeckDesignSystem(
    previewMatchesRoute ? designSystemId : null,
    deckId,
  );
  const inEmbed = isInAgentEmbed();

  useEffect(() => {
    const nextTitle = currentDeckTitle
      ? `${normalizeDocumentTitle(currentDeckTitle, t("styleInspector.slide"))} — ${t("navigation.brand")}`
      : t("raw.slidePreviewTitle");
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [currentDeckTitle, t]);

  useEffect(() => {
    if (invalidStep) return;

    let cancelled = false;
    setSlide(null);
    setSlidePosition(undefined);
    setAspectRatio(undefined);
    setDesignSystemId(null);
    setDeckTitle(null);
    setError(null);
    setLoadedPreviewKey(null);
    setLoading(true);

    const showError = (message: string) => {
      if (cancelled) return;
      setError(message);
      setLoadedPreviewKey(previewKey);
      setLoading(false);
    };

    const loadPreview = async () => {
      if (!deckId) {
        showError(t("raw.missingDeckId"));
        return;
      }
      if (
        slideNumberParam !== null &&
        (slideNumber === null || isNaN(slideNumber) || slideNumber < 1)
      ) {
        showError(t("raw.invalidSlideNumber"));
        return;
      }
      if (slideIndexParam !== null && isNaN(slideIndex)) {
        showError(t("raw.invalidSlideIndex"));
        return;
      }
      try {
        const deck = await callActionWithRetry<{
          title?: string;
          slides?: Slide[];
          aspectRatio?: AspectRatio;
          designSystemId?: string | null;
        }>("get-deck", { id: deckId }, { method: "GET" });
        if (cancelled) return;
        const slides: Slide[] = deck.slides ?? [];
        if (slides.length === 0) {
          throw new Error(t("raw.deckHasNoSlides"));
        }
        const idx = Math.max(0, Math.min(slideIndex, slides.length - 1));
        setSlide(slides[idx]);
        setSlidePosition({ number: idx + 1, count: slides.length });
        setDeckTitle(deck.title ?? null);
        setAspectRatio(deck.aspectRatio);
        setDesignSystemId(deck.designSystemId ?? null);
        setError(null);
        setLoadedPreviewKey(previewKey);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number } | undefined)?.status;
        if (status === 404) {
          showError(t("raw.deckNotFound"));
        } else if (status !== undefined) {
          showError(t("raw.deckLoadFailedStatus", { status }));
        } else {
          showError(
            err instanceof Error ? err.message : t("raw.couldNotLoadSlide"),
          );
        }
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [
    deckId,
    previewKey,
    slideIndex,
    slideIndexParam,
    slideNumber,
    slideNumberParam,
    invalidStep,
    t,
  ]);

  if (invalidStep) {
    return <SlideError message={t("raw.couldNotLoadSlide")} />;
  }

  if (loading || !previewMatchesRoute) {
    return (
      <div
        className={
          /* guard:allow-raw-color — preserve the fixed slide preview stage while loading. */ "h-screen w-screen bg-black"
        }
      />
    );
  }

  if (error || !slide || !deckId) {
    return <SlideError message={error ?? t("raw.slideNotFound")} />;
  }

  function handleOpenInApp() {
    postNavigate(`/deck/${deckId}/present?slide=${slideIndex + 1}`);
  }

  return (
    <div
      className={
        /* guard:allow-raw-color — shared slide preview uses a theme-independent black stage. */ "relative h-screen w-screen overflow-hidden bg-black"
      }
    >
      <SlideContentRenderer
        slide={slide}
        slidePosition={slidePosition}
        sourceDeckId={deckId}
        aspectRatio={aspectRatio}
        designSystem={designSystem}
        initialRevealedSteps={stepNumber}
      />

      {inEmbed && (
        <Button
          type="button"
          variant="ghost"
          onClick={handleOpenInApp}
          className={
            /* guard:allow-raw-color — preview control stays legible over the fixed black stage. */ "absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm hover:bg-white/20 hover:text-white"
          }
        >
          <IconExternalLink className="h-3.5 w-3.5" />
          {t("raw.openInApp")}
        </Button>
      )}
    </div>
  );
}
