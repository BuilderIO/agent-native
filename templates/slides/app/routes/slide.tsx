import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { IconExternalLink } from "@tabler/icons-react";
import { isInAgentEmbed, postNavigate } from "@agent-native/core/client";
import SlideRenderer from "@/components/deck/SlideRenderer";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";

export function meta() {
  return [{ title: "Slide Preview" }];
}

export function HydrateFallback() {
  return <div className="h-screen w-screen bg-black" />;
}

function SlideError({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <div className="text-center">
        <div className="text-sm font-medium text-white/60">
          Slide unavailable
        </div>
        <div className="mt-1 text-xs text-white/35">{message}</div>
      </div>
    </div>
  );
}

export default function SlideRoute() {
  const [params] = useSearchParams();
  const deckId = params.get("deckId");
  const slideIndexParam = params.get("slideIndex");

  const [slide, setSlide] = useState<Slide | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const slideIndex =
    slideIndexParam !== null ? parseInt(slideIndexParam, 10) : 0;
  const inEmbed = isInAgentEmbed();

  useEffect(() => {
    if (!deckId) {
      setError("Missing deckId parameter.");
      setLoading(false);
      return;
    }
    if (slideIndexParam !== null && isNaN(slideIndex)) {
      setError("slideIndex must be a number.");
      setLoading(false);
      return;
    }

    fetch(`/api/decks/${deckId}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Deck not found.");
          throw new Error(`Failed to load deck (HTTP ${res.status}).`);
        }
        return res.json();
      })
      .then((deck) => {
        const slides: Slide[] = deck.slides ?? [];
        if (slides.length === 0) {
          throw new Error("This deck has no slides.");
        }
        const idx = Math.max(0, Math.min(slideIndex, slides.length - 1));
        setSlide(slides[idx]);
        setAspectRatio(deck.aspectRatio);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load slide.");
        setLoading(false);
      });
  }, [deckId, slideIndex, slideIndexParam]);

  if (loading) {
    return <div className="h-screen w-screen bg-black" />;
  }

  if (error || !slide) {
    return <SlideError message={error ?? "Slide not found."} />;
  }

  function handleOpenInApp() {
    postNavigate(`/deck/${deckId}/present?slide=${slideIndex + 1}`);
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <SlideRenderer
        slide={slide}
        thumbnail={false}
        aspectRatio={aspectRatio}
      />

      {inEmbed && (
        <button
          onClick={handleOpenInApp}
          className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm hover:bg-white/20 hover:text-white"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
          Open in app
        </button>
      )}
    </div>
  );
}
