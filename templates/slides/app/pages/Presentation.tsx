import { callAction } from "@agent-native/core/client";
import { useEffect, useState } from "react";
import { useParams, Navigate, useSearchParams } from "react-router";

import PresentationView from "@/components/presentation/PresentationView";
import { useDecks } from "@/context/DeckContext";
import type { Deck } from "@/context/DeckContext";

export default function Presentation() {
  const { id } = useParams<{ id: string }>();
  const { getDeck, loading } = useDecks();
  const [fallbackDeck, setFallbackDeck] = useState<Deck | null>(null);
  const [fallbackState, setFallbackState] = useState<
    "idle" | "loading" | "missing"
  >("idle");

  const [searchParams] = useSearchParams();
  const contextDeck = getDeck(id || "");
  const deck = contextDeck ?? fallbackDeck;

  useEffect(() => {
    if (!id || loading || contextDeck) {
      if (contextDeck) {
        setFallbackDeck(null);
        setFallbackState("idle");
      }
      return;
    }

    let cancelled = false;
    setFallbackState("loading");
    callAction<Deck>("get-deck", { id }, { method: "GET" })
      .then((data) => {
        if (!cancelled) {
          setFallbackDeck(data);
          setFallbackState("idle");
        }
      })
      .catch(() => {
        if (!cancelled) setFallbackState("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [contextDeck, id, loading]);

  if (loading || fallbackState === "loading") {
    return <div className="h-screen bg-black" />;
  }
  if (!deck || !id || fallbackState === "missing") {
    return <Navigate to="/" replace />;
  }

  const slideParam = searchParams.get("slide");
  const parsedSlide = slideParam ? parseInt(slideParam, 10) : 1;
  const startSlide = Number.isFinite(parsedSlide)
    ? Math.max(0, parsedSlide - 1)
    : 0;

  return (
    <PresentationView
      slides={Array.isArray(deck.slides) ? deck.slides : []}
      deckId={id}
      startIndex={startSlide}
      aspectRatio={deck.aspectRatio}
    />
  );
}
