import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { useParams, Navigate, useSearchParams } from "react-router";

import PresentationView from "@/components/presentation/PresentationView";
import PresenterView from "@/components/presentation/PresenterView";
import { useDecks } from "@/context/DeckContext";
import type { Deck } from "@/context/DeckContext";

export default function Presentation() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { getDeck, loading } = useDecks();
  const [fallbackDeck, setFallbackDeck] = useState<Deck | null>(null);
  // "missing" is the server saying this deck does not exist; "failed" is not
  // being able to ask. Collapsing them sent every timed-out or 5xx load back to
  // the index as if the deck were gone — the failure local dev hits most, since
  // a request can sit queued behind the origin's held streams.
  const [fallbackState, setFallbackState] = useState<
    "idle" | "loading" | "missing" | "failed"
  >("idle");
  const [reloadKey, setReloadKey] = useState(0);

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
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | undefined)?.status;
        setFallbackState(status === 404 ? "missing" : "failed");
      });

    return () => {
      cancelled = true;
    };
  }, [contextDeck, id, loading, reloadKey]);

  if (!id) return <Navigate to="/" replace />;
  if (!deck && fallbackState === "failed") {
    // The presentation viewport is black in both themes; these share it with
    // the loading state below rather than flashing a themed panel first.
    const viewport =
      "flex h-screen flex-col items-center justify-center gap-4 bg-black text-white"; // guard:allow-raw-color — deliberate presentation surface
    const retry =
      "cursor-pointer rounded-md border border-white/30 px-4 py-2 text-sm hover:bg-white/10"; // guard:allow-raw-color — reads on that surface
    return (
      <div className={viewport}>
        <p className="text-sm opacity-80">{t("presentation.loadFailed")}</p>
        <button
          type="button"
          className={retry}
          onClick={() => {
            setFallbackState("loading");
            setReloadKey((key) => key + 1);
          }}
        >
          {t("presentation.tryAgain")}
        </button>
      </div>
    );
  }
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
