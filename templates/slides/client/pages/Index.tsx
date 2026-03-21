import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Plus, Layers, Settings } from "lucide-react";
import { useDecks } from "@/context/DeckContext";
import DeckCard from "@/components/deck/DeckCard";
import BuilderLogo from "@/components/deck/BuilderLogo";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { FeedbackButton } from "@/components/FeedbackButton";

export default function Index() {
  const { decks, createDeck, deleteDeck, loading } = useDecks();
  const navigate = useNavigate();
  const [deckToDelete, setDeckToDelete] = useState<string | null>(null);
  const [showNewDeckPrompt, setShowNewDeckPrompt] = useState(false);
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const openNewDeck = useCallback((e: React.MouseEvent<HTMLElement>) => {
    anchorElRef.current = e.currentTarget;
    setShowNewDeckPrompt(true);
  }, []);

  const handleCreateDeckBlank = () => {
    const deck = createDeck();
    navigate(`/deck/${deck.id}`);
  };

  const handleCreateDeckWithPrompt = (
    prompt: string,
    files: UploadedFile[],
  ) => {
    const deck = createDeck(undefined, { noDefaultSlides: true });
    const fileContext =
      files.length > 0
        ? `\n\nThe user uploaded ${files.length} file(s) for context:\n${files.map((f) => `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`).join("\n")}`
        : "";

    const context = [
      `Create slides for a new deck "${deck.title}" (id: ${deck.id}).`,
      `User request: "${prompt}"`,
      fileContext,
      "",
      "Generate slide content and populate this deck. The deck already exists with default slides — replace them with the generated content.",
    ].join("\n");

    agentSubmit(`Create deck: ${prompt}`, context);
    setShowNewDeckPrompt(false);
    navigate(`/deck/${deck.id}?generating=1`);
  };

  const handleConfirmDelete = () => {
    if (deckToDelete) {
      deleteDeck(deckToDelete);
      setDeckToDelete(null);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(240,6%,4%)]">
      {/* Header */}
      <header className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BuilderLogo className="w-5 h-5" />
            <span className="text-sm font-semibold text-white/90 tracking-tight">
              Deck Generator
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FeedbackButton />
            <a
              href="/settings"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/50 hover:text-white/80 transition-all"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={openNewDeck}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-white/80 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New Deck
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-sm text-white/30">Loading decks...</div>
          </div>
        ) : decks.length === 0 ? (
          <EmptyState onCreateDeck={openNewDeck} />
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-lg font-semibold text-white/90">
                Your Decks
              </h1>
              <span className="text-xs text-white/30">
                {decks.length} deck{decks.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New deck card */}
              <button
                onClick={openNewDeck}
                className="aspect-[4/3] rounded-xl border border-dashed border-white/[0.08] hover:border-[#609FF8]/30 hover:bg-white/[0.02] transition-all flex flex-col items-center justify-center gap-3 group"
              >
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] group-hover:bg-[#609FF8]/10 flex items-center justify-center transition-colors">
                  <Plus className="w-5 h-5 text-white/30 group-hover:text-[#609FF8] transition-colors" />
                </div>
                <span className="text-xs text-white/30 group-hover:text-white/50 transition-colors">
                  New Deck
                </span>
              </button>

              {/* Deck cards */}
              {[...decks].reverse().map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  onDelete={(id) => setDeckToDelete(id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      {deckToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setDeckToDelete(null)}
          />
          <div className="relative bg-[hsl(240,5%,8%)] border border-white/[0.08] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-base font-semibold text-white/90 mb-2">
              Delete Deck?
            </h3>
            <p className="text-sm text-white/50 mb-5">
              This will permanently delete this deck and all its slides. This
              action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeckToDelete(null)}
                className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-sm text-white/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm text-white font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <PromptPopover
        open={showNewDeckPrompt}
        onOpenChange={setShowNewDeckPrompt}
        title="New deck"
        placeholder="Describe your deck..."
        onSkip={handleCreateDeckBlank}
        skipLabel="Skip prompt"
        onSubmit={handleCreateDeckWithPrompt}
        loading={generating}
        anchorRef={anchorRef}
      />
    </div>
  );
}

function EmptyState({
  onCreateDeck,
}: {
  onCreateDeck: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <Layers className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-white/90 mb-2">
        Create your first deck
      </h2>
      <p className="text-sm text-white/40 max-w-sm mb-8 leading-relaxed">
        Build beautiful slide presentations with AI-powered generation, image
        creation, and a stunning presentation mode.
      </p>
      <button
        onClick={onCreateDeck as any}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#609FF8] hover:bg-[#7AB2FA] text-black text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Deck
      </button>
    </div>
  );
}
