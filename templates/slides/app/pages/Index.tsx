import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { IconPlus, IconStack2 } from "@tabler/icons-react";
import { useDecks } from "@/context/DeckContext";
import DeckCard from "@/components/deck/DeckCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import {
  agentNativePath,
  appBasePath,
  useSession,
} from "@agent-native/core/client";
import { extractGoogleDocUrls } from "@shared/google-docs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MAX_SOURCE_CONTEXT_CHARS = 60_000;
const NEW_DECK_DRAFT_SCOPE = "slides-new-deck";
const PENDING_PROMPT_KEY = "slides:pending-deck-prompt";

function summarizePromptForChat(prompt: string): string {
  const singleLine = prompt.trim().replace(/\s+/g, " ");
  if (!singleLine) return "new deck";
  if (singleLine.length <= 180) return singleLine;
  return `${singleLine.slice(0, 177)}...`;
}

function truncateSourceForContext(prompt: string): {
  text: string;
  truncated: boolean;
} {
  if (prompt.length <= MAX_SOURCE_CONTEXT_CHARS) {
    return { text: prompt, truncated: false };
  }
  return {
    text: prompt.slice(0, MAX_SOURCE_CONTEXT_CHARS),
    truncated: true,
  };
}

function describeUploadedFilesForAgent(
  files: UploadedFile[],
  deckId: string,
): string {
  if (files.length === 0) return "";
  const fileList = files
    .map(
      (f) =>
        `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`,
    )
    .join("\n");
  return [
    "",
    `The user uploaded ${files.length} file(s). These paths are real uploaded files; process them with import actions before using their contents:`,
    fileList,
    "",
    "File handling rules:",
    `- PPTX files: call \`import-pptx --filePath "<path>" --deckId ${deckId}\` before adding or editing slides.`,
    `- PDF, DOCX, and text-like files: call \`import-file --filePath "<path>" --format auto --deckId ${deckId}\` and use the returned content as source material.`,
    "- Image files: treat them as visual/reference assets only; do not claim to have processed a PPTX/PDF/DOCX unless the relevant import action succeeds.",
  ].join("\n");
}

async function waitForDeckServerRow(deckId: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${appBasePath()}/api/decks/${deckId}`);
      if (res.ok) return true;
      if (res.status !== 404) return false;
    } catch {
      // keep polling until the optimistic create either lands or times out
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export default function Index() {
  const { decks, createDeck, deleteDeck, updateDeck, loading } = useDecks();
  const { designSystems, defaultSystem } = useDesignSystems();
  const { session } = useSession();
  const navigate = useNavigate();
  const [deckToDelete, setDeckToDelete] = useState<string | null>(null);
  const [showNewDeckPrompt, setShowNewDeckPrompt] = useState(false);
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState("");
  const [showSignInDialog, setShowSignInDialog] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const duplicatingRef = useRef<string | null>(null);
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;
  const designSystemTitleById = useMemo(
    () => new Map(designSystems.map((ds) => [ds.id, ds.title])),
    [designSystems],
  );

  const openNewDeck = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      anchorElRef.current = e.currentTarget;
      setSelectedDesignSystemId(defaultSystem?.id ?? "");
      setShowNewDeckPrompt(true);
    },
    [defaultSystem?.id],
  );

  const setNewDeckPromptOpen = useCallback((open: boolean) => {
    setShowNewDeckPrompt(open);
    if (!open) setSelectedDesignSystemId("");
  }, []);

  useEffect(() => {
    if (!showNewDeckPrompt || selectedDesignSystemId) return;
    if (defaultSystem?.id) {
      setSelectedDesignSystemId(defaultSystem.id);
    } else if (designSystems.length > 0) {
      setSelectedDesignSystemId("none");
    }
  }, [
    defaultSystem?.id,
    designSystems.length,
    selectedDesignSystemId,
    showNewDeckPrompt,
  ]);

  // Restore a prompt that was held back when the user wasn't signed in:
  // we wrote the text to sessionStorage before redirecting to sign-in,
  // and now that they're back and authenticated, replay it into the
  // composer's localStorage draft and pop the new-deck dialog open so
  // they can hit submit without retyping.
  useEffect(() => {
    if (!session) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(PENDING_PROMPT_KEY);
    } catch {}
    if (!saved) return;
    try {
      const escaped = saved
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const paragraphs = escaped
        .split(/\n+/)
        .map((line) => `<p>${line || "<br/>"}</p>`)
        .join("");
      localStorage.setItem(
        `an-composer-draft:${encodeURIComponent(NEW_DECK_DRAFT_SCOPE)}`,
        paragraphs,
      );
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
    } catch {}
    setSelectedDesignSystemId(defaultSystem?.id ?? "none");
    setShowNewDeckPrompt(true);
  }, [defaultSystem?.id, session]);

  const handleCreateDeckBlank = () => {
    const selectedDesignSystem =
      selectedDesignSystemId && selectedDesignSystemId !== "none"
        ? designSystems.find((ds) => ds.id === selectedDesignSystemId)
        : undefined;
    let deck: ReturnType<typeof createDeck> | undefined;
    flushSync(() => {
      deck = createDeck(undefined, {
        designSystemId: selectedDesignSystem?.id ?? null,
      });
    });
    if (!deck) return;
    navigate(`/deck/${deck.id}`);
  };

  const handleCreateDeckWithPrompt = async (
    prompt: string,
    files: UploadedFile[],
  ) => {
    // Pre-flight auth check. The /api/decks POST returns 403 silently
    // when unauthenticated, leaving the user stuck on a deck page that
    // doesn't exist server-side and a small auth error in the chat
    // sidebar. Catch it here so the user sees a clear sign-in prompt
    // and the typed prompt isn't lost when they come back.
    if (!session) {
      try {
        sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      } catch {}
      setNewDeckPromptOpen(false);
      setShowSignInDialog(true);
      return;
    }

    const selectedDesignSystem =
      selectedDesignSystemId && selectedDesignSystemId !== "none"
        ? designSystems.find((ds) => ds.id === selectedDesignSystemId)
        : undefined;
    let deck: ReturnType<typeof createDeck> | undefined;
    flushSync(() => {
      deck = createDeck(undefined, {
        noDefaultSlides: true,
        designSystemId: selectedDesignSystem?.id ?? null,
      });
    });
    if (!deck) return;
    setNewDeckPromptOpen(false);
    navigate(`/deck/${deck.id}?generating=1`);

    const trimmedPrompt = prompt.trim();
    const sourceForContext = truncateSourceForContext(trimmedPrompt);
    const hasImportedGoogleDocContext = trimmedPrompt.includes("<google-doc ");
    const googleDocUrls = hasImportedGoogleDocContext
      ? []
      : extractGoogleDocUrls(trimmedPrompt);
    const fileContext = describeUploadedFilesForAgent(files, deck.id);
    const googleDocContext =
      googleDocUrls.length > 0
        ? [
            "",
            "The request includes Google Docs URL(s):",
            ...googleDocUrls.map((url) => `- ${url}`),
            "Before adding slides, call `import-google-doc` for each URL and use the returned text as source material.",
            "If the action cannot read a private document, tell the user the exact sharing step from the action error instead of generating from the URL alone.",
          ].join("\n")
        : "";
    const designSystemContext = selectedDesignSystem
      ? [
          "",
          "Design system selection:",
          `- Use "${selectedDesignSystem.title}" (id: ${selectedDesignSystem.id}).`,
          "- The deck has already been linked to this design system.",
          `- Before adding slides, call \`get-design-system --id ${selectedDesignSystem.id}\` and use its tokens for colors, typography, spacing, imagery, and slide defaults.`,
          "- Do not choose or apply a different design system.",
        ].join("\n")
      : [
          "",
          "Design system selection:",
          "- None selected. Do not apply a design system unless the user asks for one.",
        ].join("\n");

    const context = [
      `The user just created a new empty deck (id: "${deck.id}") and wants to fill it with slides.`,
      "The text below is the user's request and/or pasted source material for the deck. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
      trimmedPrompt
        ? `User request / source material:\n${sourceForContext.text}`
        : "User request / source material: create a new deck.",
      sourceForContext.truncated
        ? `The pasted source was longer than ${MAX_SOURCE_CONTEXT_CHARS} characters, so only the first ${MAX_SOURCE_CONTEXT_CHARS} characters were included to keep the agent request reliable.`
        : "",
      googleDocContext,
      fileContext,
      designSystemContext,
      "",
      "Start a `manage-progress` run so progress appears in the app header. Add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in.",
      "Add slides ONE AT A TIME using the `add-slide` action with --deckId=" +
        deck.id +
        ". Wait for each `add-slide` result before calling it again; do not batch or parallelize slide writes.",
      "If the user asked for a specific slide count, keep going sequentially until that count is reached unless a tool error blocks you.",
      "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels). Keep each slide within the density limits in AGENTS.md; split dense source material across more slides instead of packing it tightly.",
      "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
      "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, resource-read, or search-files.",
    ].join("\n");

    await waitForDeckServerRow(deck.id);
    agentSubmit(
      `Create deck: ${summarizePromptForChat(trimmedPrompt)}`,
      context,
    );
  };

  const handleConfirmDelete = () => {
    if (deckToDelete) {
      deleteDeck(deckToDelete);
      setDeckToDelete(null);
    }
  };

  const handleRename = useCallback(
    (id: string, newTitle: string) => {
      updateDeck(id, { title: newTitle });
    },
    [updateDeck],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      if (duplicatingRef.current) return;
      duplicatingRef.current = id;
      setDuplicating(id);
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/actions/duplicate-deck"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deckId: id }),
          },
        );
        if (res.ok) {
          const { id: newId } = await res.json();
          navigate(`/deck/${newId}`);
        }
      } finally {
        duplicatingRef.current = null;
        setDuplicating(null);
      }
    },
    [navigate],
  );

  useSetPageTitle("Decks");

  // Inject "New Deck" into the global header actions slot.
  useSetHeaderActions(
    useMemo(
      () => (
        <Button onClick={openNewDeck} size="sm" className="cursor-pointer">
          <IconPlus className="w-3.5 h-3.5" />
          New Deck
        </Button>
      ),
      [openNewDeck],
    ),
  );

  return (
    <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-10">
      {loading ? (
        <>
          <div className="flex items-center justify-end mb-4">
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <div className="aspect-video bg-muted/50 animate-pulse" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : decks.length === 0 ? (
        <EmptyState onCreateDeck={openNewDeck} />
      ) : (
        <>
          <div className="flex items-center justify-end mb-4">
            <span className="text-xs text-muted-foreground/70">
              {decks.length} deck{decks.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* New deck card */}
            <button
              onClick={openNewDeck}
              className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-left cursor-pointer"
            >
              <div className="aspect-video flex items-center justify-center bg-muted/30">
                <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                  <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                  New Deck
                </h3>
                <div className="text-xs text-muted-foreground/70 mt-1">
                  Create a deck
                </div>
              </div>
            </button>

            {[...decks].reverse().map((deck) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                onDelete={(id) => setDeckToDelete(id)}
                onRename={handleRename}
                onDuplicate={handleDuplicate}
                isDuplicating={duplicating === deck.id}
                designSystemTitle={
                  deck.designSystemId
                    ? designSystemTitleById.get(deck.designSystemId)
                    : null
                }
              />
            ))}
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deckToDelete}
        onOpenChange={(open) => !open && setDeckToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deck?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this deck and all its slides. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromptPopover
        open={showNewDeckPrompt}
        onOpenChange={setNewDeckPromptOpen}
        title="New deck"
        placeholder="Describe your deck..."
        onSkip={handleCreateDeckBlank}
        skipLabel="Skip prompt"
        onSubmit={handleCreateDeckWithPrompt}
        loading={generating}
        anchorRef={anchorRef}
        draftScope={NEW_DECK_DRAFT_SCOPE}
      >
        {designSystems.length > 0 && (
          <div className="border-t border-border px-3.5 py-2">
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Design system
            </label>
            <Select
              value={selectedDesignSystemId || "none"}
              onValueChange={setSelectedDesignSystemId}
            >
              <SelectTrigger className="h-8 w-full bg-accent/40 text-xs">
                <SelectValue placeholder="Choose a design system" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {designSystems.map((ds) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.title}
                    {ds.isDefault ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PromptPopover>

      {/* Sign-in required to create a deck. Shown when an unauthenticated
          user submits a prompt — the typed prompt is preserved in
          sessionStorage and replayed into the composer after sign-in. */}
      <AlertDialog open={showSignInDialog} onOpenChange={setShowSignInDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign in to create a deck</AlertDialogTitle>
            <AlertDialogDescription>
              You need to sign in before generating a deck. We've saved your
              prompt — once you're back, it'll be ready to go.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ret = window.location.pathname + window.location.search;
                window.location.href =
                  agentNativePath("/_agent-native/sign-in") +
                  `?return=${encodeURIComponent(ret)}`;
              }}
            >
              Sign in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Create your first deck
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
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
