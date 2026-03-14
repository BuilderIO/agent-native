import { useParams, Navigate, useSearchParams } from "react-router-dom";
import { useDecks } from "@/context/DeckContext";
import PresentationView from "@/components/presentation/PresentationView";

export default function Presentation() {
  const { id } = useParams<{ id: string }>();
  const { getDeck, loading } = useDecks();

  const [searchParams] = useSearchParams();
  const deck = getDeck(id || "");

  if (loading) return <div className="h-screen bg-black" />;
  if (!deck || !id) return <Navigate to="/" replace />;

  const slideParam = searchParams.get("slide");
  const startSlide = slideParam ? Math.max(0, parseInt(slideParam, 10) - 1) : 0;

  return (
    <PresentationView
      slides={deck.slides}
      deckId={id}
      startIndex={startSlide}
    />
  );
}
