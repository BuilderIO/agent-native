import { callAction } from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";
import { useParams, Navigate, useSearchParams } from "react-router";

import PresentationView from "@/components/presentation/PresentationView";
import PresenterView from "@/components/presentation/PresenterView";
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

  if (!id) return <Navigate to="/" replace />;
  // "Not fetched yet" is not "not found": on a cold load of this URL the deck
  // context is empty and the fallback fetch has not run, so redirecting on a
  // falsy deck bounced every direct/presenter/share link back to the index.
  if (!deck && fallbackState !== "missing") {
    return <div className="h-screen bg-black" />;
  }
  if (!deck) {
    return <Navigate to="/" replace />;
  }

  const slideParam = searchParams.get("slide");
  const parsedSlide = slideParam ? parseInt(slideParam, 10) : 1;
  const startSlide = Number.isFinite(parsedSlide)
    ? Math.max(0, parsedSlide - 1)
    : 0;

  const View =
    searchParams.get("presenter") === "1" ? PresenterView : PresentationView;

  return (
    <View
      slides={Array.isArray(deck.slides) ? deck.slides : []}
      deckId={id}
      startIndex={startSlide}
      aspectRatio={deck.aspectRatio}
    />
  );
}
