import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { IconAlertCircle } from "@tabler/icons-react";
import type { SharedDeckResponse } from "@shared/api";
import type { Slide } from "@/context/DeckContext";
import PresentationView from "@/components/presentation/PresentationView";

interface SharedPresentationProps {
  initialDeck?: SharedDeckResponse | null;
  initialError?: string;
}

export default function SharedPresentation({
  initialDeck = null,
  initialError = "",
}: SharedPresentationProps) {
  const { token } = useParams<{ token: string }>();
  const [deck, setDeck] = useState<SharedDeckResponse | null>(initialDeck);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(!initialDeck && !initialError);

  useEffect(() => {
    if (!token) return;
    if (initialDeck || initialError) {
      setDeck(initialDeck);
      setError(initialError);
      setLoading(false);
      return;
    }

    fetch(`/api/share/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to load presentation");
        }
        return res.json();
      })
      .then((data: SharedDeckResponse) => {
        setDeck(data);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, initialDeck, initialError]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-8">
        <div className="w-full max-w-5xl aspect-video rounded-xl bg-white/[0.04] animate-pulse" />
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="fixed inset-0 bg-[hsl(240,6%,4%)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <IconAlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white/90">
            Presentation Not Found
          </h1>
          <p className="text-sm text-white/50">
            {error || "This shared presentation doesn't exist or has expired."}
          </p>
        </div>
      </div>
    );
  }

  const slides: Slide[] = deck.slides.map((s) => ({
    ...s,
    layout: s.layout as Slide["layout"],
  }));

  // Use a fake deckId that routes "exit" back to the share page itself
  return (
    <PresentationView
      slides={slides}
      deckId={`__shared__/${token}`}
      aspectRatio={deck.aspectRatio}
    />
  );
}
