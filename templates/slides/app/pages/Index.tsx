import {
  agentNativePath,
  askUserQuestion,
  callAction,
  useSession,
  useT,
} from "@agent-native/core/client";
import { extractGoogleDocUrls } from "@shared/google-docs";
import { IconPlus, IconStack2, IconUserCircle } from "@tabler/icons-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";

import DeckCard from "@/components/deck/DeckCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDecks } from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { toast } from "@/hooks/use-toast";
import { savePromptToComposerDraft } from "@/lib/composer-draft";

const MAX_SOURCE_CONTEXT_CHARS = 60_000;
const NEW_DECK_DRAFT_SCOPE = "slides-new-deck";
const PENDING_PROMPT_KEY = "slides:pending-deck-prompt";

function savePromptForRetry(
  prompt: string,
  options: { persistAcrossSignIn?: boolean } = {},
) {
  let signInHandoffSaved = !options.persistAcrossSignIn;
  if (options.persistAcrossSignIn) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      signInHandoffSaved = true;
    } catch {}
  }
  const draftSaved = savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, prompt);
  return signInHandoffSaved && draftSaved;
}

function clearPendingPromptForRetry() {
  try {
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
  } catch {}
}

function mergeUploadedFilesForRetry(
  savedFiles: UploadedFile[],
  newFiles: UploadedFile[],
): UploadedFile[] {
  const seen = new Set<string>();
  return [...savedFiles, ...newFiles].filter((file) => {
    const key = file.path || file.url || file.filename;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
        `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}${f.url ? `; embeddable URL: ${f.url}` : ""}`,
    )
    .join("\n");
  return [
    "",
    `The user uploaded ${files.length} file(s). These paths are real uploaded files; process them with import actions before using their contents:`,
    fileList,
    "",
    "File handling rules:",
    `- PPTX files: call \`import-pptx --filePath "<path>" --deckId ${deckId}\` before adding or editing slides.`,
    `- PDF and DOCX files: call \`import-file --filePath "<path>" --format auto --deckId ${deckId}\` and use the returned extracted text as source material. The returned text is capped for reliability; re-run with maxChars only if more context is needed.`,
    "- Text-like files: use the uploaded-text-file blocks already included in the prompt; do not call import-file for them.",
    '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
    "- Image files without a URL are visual/reference assets only; do not claim to have processed a PPTX/PDF/DOCX unless the relevant import action succeeds.",
  ].join("\n");
}

export default function Index() {
  const t = useT();
  const {
    decks,
    createDeck,
    ensureDeckPersisted,
    deleteDeck,
    updateDeck,
    loading,
  } = useDecks();
  const { designSystems, defaultSystem } = useDesignSystems();
  const { session } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deckToDelete, setDeckToDelete] = useState<string | null>(null);
  const [showNewDeckPrompt, setShowNewDeckPrompt] = useState(false);
  const [newDeckInitialPrompt, setNewDeckInitialPrompt] = useState<{
    text: string;
    key: number;
  } | null>(null);
  const [newDeckRetryFiles, setNewDeckRetryFiles] = useState<UploadedFile[]>(
    [],
  );
  const [signInPromptHadFiles, setSignInPromptHadFiles] = useState(false);
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState("");
  const [showSignInDialog, setShowSignInDialog] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const duplicatingRef = useRef<string | null>(null);
  const { generating, submit: agentSubmit } = useAgentGenerating();
  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;
  const designSystemTitleById = useMemo<Map<string, string>>(
    () => new Map(designSystems.map((ds) => [ds.id, ds.title])),
    [designSystems],
  );
  const deckFilter = searchParams.get("createdBy") === "me" ? "mine" : "all";
  const visibleDecks = useMemo(
    () =>
      deckFilter === "mine" ? decks.filter((deck) => deck.createdByMe) : decks,
    [deckFilter, decks],
  );
  const setDeckFilter = useCallback(
    (value: string) => {
      const nextFilter = value === "mine" ? "mine" : "all";
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextFilter === "mine") {
            next.set("createdBy", "me");
          } else {
            next.delete("createdBy");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const openNewDeck = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      anchorElRef.current = e.currentTarget;
      setSelectedDesignSystemId(defaultSystem?.id ?? "");
      setShowNewDeckPrompt(true);
    },
    [defaultSystem?.id],
  );

  const setNewDeckPromptOpen = useCallback(
    (open: boolean, options: { clearInitialPrompt?: boolean } = {}) => {
      setShowNewDeckPrompt(open);
      if (!open) {
        setSelectedDesignSystemId("");
        if (options.clearInitialPrompt !== false) {
          setNewDeckInitialPrompt(null);
          setNewDeckRetryFiles([]);
        }
      }
    },
    [],
  );

  const preservePromptForSignIn = useCallback(
    (prompt: string, options: { hadFiles?: boolean } = {}) => {
      if (!savePromptForRetry(prompt, { persistAcrossSignIn: true })) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryFiles([]);
      setSignInPromptHadFiles(Boolean(options.hadFiles));
      setNewDeckPromptOpen(false, { clearInitialPrompt: false });
      setShowSignInDialog(true);
    },
    [setNewDeckPromptOpen],
  );

  const setSignInDialogOpen = useCallback((open: boolean) => {
    setShowSignInDialog(open);
    if (!open) {
      setSignInPromptHadFiles(false);
    }
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
    if (savePromptToComposerDraft(NEW_DECK_DRAFT_SCOPE, saved)) {
      clearPendingPromptForRetry();
      setNewDeckInitialPrompt(null);
    } else {
      clearPendingPromptForRetry();
      setNewDeckInitialPrompt({ text: saved, key: Date.now() });
    }
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
      preservePromptForSignIn(prompt, { hadFiles: files.length > 0 });
      return;
    }

    const filesForGeneration = mergeUploadedFilesForRetry(
      newDeckRetryFiles,
      files,
    );
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

    // One quick, skippable decision so the agent doesn't guess the deck size.
    const deckLength = await askUserQuestion({
      question: t("home.deckLengthQuestion"),
      header: t("home.deckLengthHeader"),
      options: [
        { label: t("home.deckLengthShort"), value: "3–5 slides" },
        {
          label: t("home.deckLengthMedium"),
          value: "6–10 slides",
          recommended: true,
        },
        { label: t("home.deckLengthLong"), value: "11+ slides" },
        {
          label: t("home.deckLengthSingleVisual"),
          value: "a single standalone visual slide",
        },
      ],
      allowFreeText: false,
    });
    const deckLengthContext =
      typeof deckLength === "string" && deckLength
        ? `Target length: aim for ${deckLength} unless the user's request clearly specifies a different count.`
        : "";

    const trimmedPrompt = prompt.trim();
    const sourceForContext = truncateSourceForContext(trimmedPrompt);
    const hasImportedGoogleDocContext = trimmedPrompt.includes("<google-doc ");
    const googleDocUrls = hasImportedGoogleDocContext
      ? []
      : extractGoogleDocUrls(trimmedPrompt);
    const fileContext = describeUploadedFilesForAgent(
      filesForGeneration,
      deck.id,
    );
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
      `The user just created a new empty deck (id: "${deck.id}") and wants to create a presentation or standalone visual.`,
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
      deckLengthContext,
      "Start a `manage-progress` run so progress appears in the app header. Add the first slide as soon as it is ready, then continue one slide at a time so the editor visibly fills in.",
      "If the user asks for a standalone visual, diagram, hero, one-pager, poster, or a couple of visuals, create only the requested one/few polished visual slides. Do not pad the result into a full presentation.",
      "Add slides ONE AT A TIME using the `add-slide` action with --deckId=" +
        deck.id +
        ". Wait for each `add-slide` result before calling it again; do not batch or parallelize slide writes.",
      "If the user asked for a specific slide count, keep going sequentially until that count is reached unless a tool error blocks you.",
      "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels). Keep each slide within the density limits in AGENTS.md; split dense source material across more slides instead of packing it tightly.",
      "Each slide's --content must be full HTML. Slide HTML templates are in your AGENTS.md.",
      "Do NOT use create-deck (the deck already exists). Do NOT call db-schema, the resources tool, or search-files.",
    ].join("\n");

    const persisted = await ensureDeckPersisted(deck.id);
    if (!persisted) {
      if (!savePromptForRetry(prompt)) {
        setNewDeckInitialPrompt({ text: prompt, key: Date.now() });
      }
      setNewDeckRetryFiles(filesForGeneration);
      deleteDeck(deck.id);
      toast({
        title: t("home.generationStartFailed"),
        description: t("home.generationStartFailedDescription"),
      });
      setShowNewDeckPrompt(true);
      return;
    }

    clearPendingPromptForRetry();
    setNewDeckInitialPrompt(null);
    setNewDeckRetryFiles([]);
    agentSubmit(
      `Create deck: ${summarizePromptForChat(trimmedPrompt)}`,
      context,
    );
    navigate(`/deck/${deck.id}?generating=1`);
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
        const { id: newId } = await callAction("duplicate-deck", {
          deckId: id,
        });
        navigate(`/deck/${newId}`);
      } finally {
        duplicatingRef.current = null;
        setDuplicating(null);
      }
    },
    [navigate],
  );

  useSetPageTitle(t("home.decksTitle"));

  // Inject "New Deck" into the global header actions slot.
  useSetHeaderActions(
    useMemo(
      () => (
        <Button onClick={openNewDeck} size="sm" className="cursor-pointer">
          <IconPlus className="w-3.5 h-3.5" />
          {t("home.newDeck")}
        </Button>
      ),
      [openNewDeck, t],
    ),
  );

  return (
    <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-10">
      {loading ? (
        <>
          <div className="flex items-center justify-end mb-4">
            <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          </div>
          <div className="deck-grid-container">
            <div className="deck-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="aspect-video animate-pulse bg-muted/50" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : decks.length === 0 ? (
        <EmptyState onCreateDeck={openNewDeck} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              type="single"
              value={deckFilter}
              onValueChange={(value) => value && setDeckFilter(value)}
              className="w-fit rounded-lg border border-border bg-card p-0.5"
              size="sm"
            >
              <ToggleGroupItem
                value="all"
                aria-label={t("home.showAllDecks")}
                className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
              >
                <IconStack2 className="me-1.5 h-3.5 w-3.5" />
                {t("home.all")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="mine"
                aria-label={t("home.showMineDecks")}
                className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
              >
                <IconUserCircle className="me-1.5 h-3.5 w-3.5" />
                {t("home.mine")}
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-xs text-muted-foreground/70">
              {deckFilter === "mine"
                ? `${visibleDecks.length} of ${decks.length}`
                : decks.length}{" "}
              {t("home.deckCount", {
                count:
                  deckFilter === "mine" ? visibleDecks.length : decks.length,
              })}
            </span>
          </div>
          <div className="deck-grid-container">
            <div className="deck-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {/* New deck card */}
              <button
                onClick={openNewDeck}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-dashed border-border bg-card text-start hover:border-foreground/15"
              >
                <div className="flex aspect-video items-center justify-center bg-muted/30">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/50 group-hover:bg-accent">
                    <IconPlus className="h-6 w-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-muted-foreground group-hover:text-foreground/70">
                    {t("home.newDeck")}
                  </h3>
                  <div className="mt-1 text-xs text-muted-foreground/70">
                    {t("home.createDeckOrVisual")}
                  </div>
                </div>
              </button>

              {[...visibleDecks].reverse().map((deck) => (
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
              {visibleDecks.length === 0 && (
                <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                  {t("home.noMineDecks")}
                </div>
              )}
            </div>
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
            <AlertDialogTitle>{t("home.deleteDeckTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDeckDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromptPopover
        open={showNewDeckPrompt}
        onOpenChange={setNewDeckPromptOpen}
        title={t("home.newDeckPromptTitle")}
        placeholder={t("home.newDeckPlaceholder")}
        onSkip={handleCreateDeckBlank}
        skipLabel={t("home.skipPrompt")}
        onSubmit={handleCreateDeckWithPrompt}
        onBeforeUpload={(prompt, files) => {
          if (session) return true;
          preservePromptForSignIn(prompt, { hadFiles: files.length > 0 });
          return false;
        }}
        loading={generating}
        anchorRef={anchorRef}
        draftScope={NEW_DECK_DRAFT_SCOPE}
        initialText={newDeckInitialPrompt?.text}
        initialTextKey={newDeckInitialPrompt?.key}
      >
        {designSystems.length > 0 && (
          <div className="border-t border-border px-3.5 py-2">
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              {t("home.designSystem")}
            </label>
            <Select
              value={selectedDesignSystemId || "none"}
              onValueChange={setSelectedDesignSystemId}
            >
              <SelectTrigger className="h-8 w-full bg-accent/40 text-xs">
                <SelectValue placeholder={t("raw.chooseDesignSystem")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("home.none")}</SelectItem>
                {designSystems.map((ds) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.title}
                    {ds.isDefault ? t("home.defaultSuffix") : ""}
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
      <AlertDialog open={showSignInDialog} onOpenChange={setSignInDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.signInTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {signInPromptHadFiles
                ? t("home.signInDescriptionWithFiles")
                : t("home.signInDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ret = window.location.pathname + window.location.search;
                window.location.href =
                  agentNativePath("/_agent-native/sign-in") +
                  `?return=${encodeURIComponent(ret)}`;
              }}
            >
              {t("home.signIn")}
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
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconStack2 className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {t("home.emptyTitle")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        {t("home.emptyDescription")}
      </p>
      <Button
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          onCreateDeck(e as React.MouseEvent<HTMLElement>)
        }
      >
        <IconPlus className="w-4 h-4" />
        {t("home.newDeck")}
      </Button>
    </div>
  );
}
