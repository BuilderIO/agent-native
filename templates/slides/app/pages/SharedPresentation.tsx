import { appBasePath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import type { SharedDeckResponse } from "@shared/api";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useLayoutEffect } from "react";
import { useParams, useSearchParams } from "react-router";

import { PresentationAccessGate } from "@/components/presentation/PresentationAccessGate";
import PresentationView from "@/components/presentation/PresentationView";
import type { Slide } from "@/context/DeckContext";
import { mergeDesignSystemData } from "@/hooks/use-deck-design-system";

type PresentationDeckResult =
  | { status: "ok"; deck: SharedDeckResponse }
  | { status: "restricted" };

/**
 * The live deck behind a `/p/:id` link. The page's HTML is a public shell the
 * CDN caches for every visitor, so the deck and the access decision are read
 * here, after load, never baked into that shell.
 */
export function PresentationLinkDeck({
  deckId,
  agentAccessToken,
}: {
  deckId: string;
  agentAccessToken?: string | null;
}) {
  const query = useActionQuery<PresentationDeckResult>(
    "get-presentation-deck",
    {
      deckId,
      ...(agentAccessToken ? { agentAccessToken } : {}),
    },
    { retry: false, resources: ["deck"] },
  );
  if (query.data?.status === "restricted") {
    return (
      <PresentationAccessGate
        deckId={deckId}
        onReload={() => void query.refetch()}
      />
    );
  }
  if (query.data) {
    return <SharedPresentation initialDeck={query.data.deck} />;
  }
  if (query.isError) {
    return <SharedPresentation initialError={query.error.message} />;
  }
  return <PresentationSkeleton />;
}

function PresentationSkeleton() {
  return (
    // guard:allow-raw-color — the presentation stage is black in both themes, like the slides it frames
    <div className="fixed inset-0 bg-black flex items-center justify-center p-8">
      <div className="skeleton-shimmer w-full max-w-5xl aspect-video rounded-xl bg-foreground/[0.04]" />
    </div>
  );
}

interface SharedPresentationProps {
  initialDeck?: SharedDeckResponse | null;
  initialError?: string;
}

export default function SharedPresentation({
  initialDeck = null,
  initialError = "",
}: SharedPresentationProps) {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [deck, setDeck] = useState<SharedDeckResponse | null>(initialDeck);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(!initialDeck && !initialError);
  // The public HTML is one shell cached per path, and the CDN ignores the query
  // string. A `?slide=` read during render would bake one slide into that shell
  // for every visitor, so the deep link is applied after the first client render.
  const [searchParams] = useSearchParams();
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  useLayoutEffect(() => {
    setDeepLinkReady(true);
  }, []);
  const slideParam = Number.parseInt(searchParams.get("slide") ?? "", 10);
  const startIndex =
    deepLinkReady && Number.isFinite(slideParam)
      ? Math.max(0, slideParam - 1)
      : 0;

  useEffect(() => {
    if (!deck) return;
    const nextTitle = `${normalizeDocumentTitle(deck.title, "Shared Presentation")} — Slides`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [deck]);

  useEffect(() => {
    if (initialDeck || initialError) {
      setDeck(initialDeck);
      setError(initialError);
      setLoading(false);
      return;
    }
    if (!token) return;

    fetch(`${appBasePath()}/api/share/${token}`)
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

  if (loading) return <PresentationSkeleton />;

  if (error || !deck) {
    return (
      <div className="fixed inset-0 bg-[hsl(240,6%,4%)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <IconAlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white/90">
            {t("raw.presentationNotFound")}
          </h1>
          <p className="text-sm text-white/50">
            {error || t("raw.sharedPresentationExpired")}
          </p>
        </div>
      </div>
    );
  }

  const slides: Slide[] = deck.slides.map((s) => ({
    ...s,
    layout: s.layout as Slide["layout"],
  }));
  const designSystem = deck.designSystem
    ? mergeDesignSystemData(deck.designSystem)
    : undefined;

  return (
    <PresentationView
      slides={slides}
      deckId={`__shared__/${token}`}
      startIndex={startIndex}
      aspectRatio={deck.aspectRatio}
      designSystem={designSystem}
      pdfExportTitle={token ? deck.title : undefined}
      pdfExportToken={token}
    />
  );
}
