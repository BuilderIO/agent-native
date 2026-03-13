import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import type { SharedDeckResponse } from "@shared/api";
import type { Slide } from "@/context/DeckContext";
import PresentationView from "@/components/presentation/PresentationView";

export default function SharedPresentation() {
  const { token } = useParams<{ token: string }>();
  const [deck, setDeck] = useState<SharedDeckResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

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
  }, [token]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#609FF8] animate-spin" />
          <span className="text-sm text-white/50">Loading presentation...</span>
        </div>
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="fixed inset-0 bg-[hsl(240,6%,4%)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-white/90">Presentation Not Found</h1>
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
  return <PresentationView slides={slides} deckId={`__shared__/${token}`} />;
}
