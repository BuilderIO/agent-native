import { useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import { IconPlus, IconStack2 } from "@tabler/icons-react";
import { useDecks } from "@/context/DeckContext";
import DeckCard from "@/components/deck/DeckCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useAgentGenerating } from "@/hooks/use-agent-generating";

import { Button } from "@/components/ui/button";

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
      `The user just created a new empty deck (id: "${deck.id}") and wants to fill it with slides.`,
      `User request: "${prompt}"`,
      fileContext,
      "",
      "Add slides ONE AT A TIME using the `add-slide` action with --deckId=" +
        deck.id +
        ". You can fire multiple add-slide calls in parallel — they run concurrently and the user sees each slide appear as soon as it lands.",
      "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
      "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, resource-read, or search-files.",
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
    <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-10">
      {loading ? (
        <>
          <div className="flex items-center justify-between mb-6">
            <div className="h-5 w-32 rounded-md bg-white/[0.05] animate-pulse" />
            <div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
              >
                <div className="aspect-video bg-white/[0.03] animate-pulse" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-white/[0.05] animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-white/[0.05] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : decks.length === 0 ? (
        <EmptyState onCreateDeck={openNewDeck} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-semibold text-white/90">Your Decks</h1>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/30">
                {decks.length} deck{decks.length !== 1 ? "s" : ""}
              </span>
              <Button onClick={openNewDeck} size="sm">
                <IconPlus className="w-3.5 h-3.5" />
                New Deck
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* New deck card */}
            <button
              onClick={openNewDeck}
              className="group relative rounded-xl border border-dashed border-white/[0.08] bg-[hsl(240,5%,8%)] hover:border-white/[0.15] overflow-hidden text-left cursor-pointer"
            >
              <div className="aspect-video flex items-center justify-center bg-white/[0.02]">
                <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-white/[0.06]">
                  <IconPlus className="w-6 h-6 text-white/30 group-hover:text-white/50" />
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-medium text-sm text-white/50 group-hover:text-white/70">
                  New Deck
                </h3>
                <div className="text-xs text-white/30 mt-1">Create a deck</div>
              </div>
            </button>

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
              <Button variant="ghost" onClick={() => setDeckToDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete}>
                Delete
              </Button>
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
    </main>
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
        <IconStack2 className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-white/90 mb-2">
        Create your first deck
      </h2>
      <p className="text-sm text-white/40 max-w-sm mb-8 leading-relaxed">
        Build beautiful slide presentations with AI-powered generation, image
        creation, and a stunning presentation mode.
      </p>
      <Button
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          onCreateDeck(e as React.MouseEvent<HTMLElement>)
        }
      >
        <IconPlus className="w-4 h-4" />
        New Deck
      </Button>
    </div>
  );
}
