import { PromptComposer } from "@agent-native/core/client/composer";
import { callAction, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { FirstRunOnboardingExtensionProps } from "@agent-native/core/client/onboarding";
import { IconArrowLeft } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  NewDeckReferenceStep,
  type ImportedReference,
  type NewDeckReferenceSelection,
  type NewDeckReferenceSource,
} from "@/components/editor/NewDeckReferenceStep";
import {
  uploadPromptFiles,
  type UploadedFile,
} from "@/components/editor/PromptDialog";
import {
  describeDeckPersistenceFailure,
  useDecks,
} from "@/context/DeckContext";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useWorkspaceDefaults } from "@/hooks/use-workspace-defaults";
import { startDeckGeneration } from "@/lib/create-deck-generation";
import {
  forgetRecentReference,
  readRecentReferences,
  rememberRecentReference,
  type RecentReference,
} from "@/lib/recent-references";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";

type FirstDeckStep = "prompt" | "references";

export function FirstDeckOnboardingFlow({
  onComplete,
  onSkip,
}: FirstRunOnboardingExtensionProps) {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useSession();
  const { decks, createDeck, ensureDeckPersisted, deleteDeck, reloadDecks } =
    useDecks();
  const { designSystems } = useDesignSystems();
  const { designSystem: workspaceDesignSystem } = useWorkspaceDefaults();
  const { submit: agentSubmit } = useAgentGenerating();
  const [step, setStep] = useState<FirstDeckStep>("prompt");
  const [prompt, setPrompt] = useState("");
  const [promptFiles, setPromptFiles] = useState<UploadedFile[]>([]);
  const [promptInitialText, setPromptInitialText] = useState<string>();
  const [promptInitialTextKey, setPromptInitialTextKey] = useState<number>();
  const [uploading, setUploading] = useState(false);
  const [referenceImporting, setReferenceImporting] = useState(false);
  const [recentReferences, setRecentReferences] = useState<RecentReference[]>(
    [],
  );

  const initialPrompt = searchParams.get("initialPrompt")?.trim() ?? "";
  const workspaceDesignSystemId =
    workspaceDesignSystem && !workspaceDesignSystem.unavailable
      ? workspaceDesignSystem.id
      : null;
  const lastUsedDesignSystemId =
    recentReferences.find(
      (reference) =>
        reference.kind === "design-system" &&
        designSystems.some((designSystem) => designSystem.id === reference.id),
    )?.id ?? null;
  const lastUsedReferenceDeckId =
    recentReferences.find(
      (reference) =>
        reference.kind === "deck" &&
        decks.some((deck) => deck.id === reference.id),
    )?.id ?? null;
  const initialDesignSystemId =
    lastUsedDesignSystemId ?? workspaceDesignSystemId;
  const initialReferenceDeckId = lastUsedReferenceDeckId;

  useEffect(() => {
    const result = readRecentReferences();
    if (result.readable) setRecentReferences(result.items);
  }, []);

  useEffect(() => {
    if (!initialPrompt) return;
    setPromptInitialText(initialPrompt);
    setPromptInitialTextKey(Date.now());
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("initialPrompt");
        return next;
      },
      { replace: true },
    );
  }, [initialPrompt, setSearchParams]);

  const rememberReference = useCallback(
    (reference: Omit<RecentReference, "lastUsedAt">) => {
      const result = rememberRecentReference(reference);
      if (result.readable) setRecentReferences(result.items);
    },
    [],
  );
  const forgetReference = useCallback((kind: RecentReference["kind"]) => {
    const result = forgetRecentReference(kind);
    if (result.readable) setRecentReferences(result.items);
  }, []);

  const handlePromptSubmit = useCallback(
    async (text: string, files: File[]) => {
      setUploading(true);
      try {
        const uploaded = await uploadPromptFiles(files);
        setPrompt(text.trim());
        setPromptFiles(uploaded);
        setStep("references");
      } catch (error) {
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
      } finally {
        setUploading(false);
      }
    },
    [t],
  );

  const startGeneration = useCallback(
    async (
      files: UploadedFile[],
      selection: NewDeckReferenceSelection = {},
    ) => {
      const result = await startDeckGeneration({
        session,
        prompt,
        files,
        referenceSelection: selection,
        selectedDesignSystemId: initialDesignSystemId,
        selectedReferenceDeckId: initialReferenceDeckId,
        designSystems,
        createDeck,
        ensureDeckPersisted,
        deleteDeck,
        navigate,
        agentSubmit,
        onPromptClosed: () => undefined,
        onUnauthenticated: () => {
          toast.error(t("home.signInTitle"));
        },
        onPersistenceFailure: (failedPrompt, _failedFiles, failure) => {
          setPromptInitialText(failedPrompt);
          setPromptInitialTextKey(Date.now());
          setStep("prompt");
          toast.error(t("home.generationStartFailed"), {
            description: describeDeckPersistenceFailure(
              failure,
              t("home.generationStartFailedDescription"),
            ),
          });
        },
        onSetupFailure: (failedPrompt, _failedFiles, failure) => {
          setPromptInitialText(failedPrompt);
          setPromptInitialTextKey(Date.now());
          setStep("prompt");
          toast.error(t("home.generationStartFailed"), {
            description:
              failure instanceof Error
                ? failure.message
                : t("home.generationStartFailedDescription"),
          });
        },
      });
      if (result === "started") onComplete();
    },
    [
      agentSubmit,
      createDeck,
      deleteDeck,
      designSystems,
      ensureDeckPersisted,
      initialDesignSystemId,
      navigate,
      onComplete,
      prompt,
      session,
      t,
      initialReferenceDeckId,
    ],
  );

  const handleReferenceSelect = useCallback(
    async (selection: NewDeckReferenceSelection) => {
      if (selection.designSystemId !== undefined) {
        if (selection.designSystemId) {
          rememberReference({
            id: selection.designSystemId,
            kind: "design-system",
          });
        } else {
          forgetReference("design-system");
        }
      }
      if (selection.referenceDeckId !== undefined) {
        if (selection.referenceDeckId) {
          rememberReference({ id: selection.referenceDeckId, kind: "deck" });
        } else {
          forgetReference("deck");
        }
      }
      await startGeneration(promptFiles, selection);
    },
    [forgetReference, promptFiles, rememberReference, startGeneration],
  );

  const handleReferenceImport = useCallback(
    async (files: File[]): Promise<ImportedReference | null> => {
      setReferenceImporting(true);
      try {
        const uploaded = await uploadPromptFiles(files);
        const pptxReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".pptx"),
        );
        const pdfReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".pdf"),
        );
        let importedReference: ImportedReference | null = null;
        let generationFiles = uploaded;
        if (pptxReference) {
          const imported = (await callAction("import-pptx", {
            filePath: pptxReference.path,
          })) as {
            id?: unknown;
            imported?: unknown;
            slideCount?: unknown;
            title?: unknown;
          };
          if (
            typeof imported.id !== "string" ||
            !imported.id ||
            imported.imported !== true ||
            typeof imported.slideCount !== "number" ||
            imported.slideCount < 1
          ) {
            throw new Error("The imported presentation did not create a deck.");
          }
          importedReference = {
            id: imported.id,
            title:
              typeof imported.title === "string" && imported.title
                ? imported.title
                : t("home.importedReferenceDeck"),
            source: "pptx",
          };
          generationFiles = uploaded.filter((file) => file !== pptxReference);
        } else if (pdfReference) {
          const referenceDeck = createDeck(undefined, {
            noDefaultSlides: true,
          });
          const persisted = await ensureDeckPersisted(referenceDeck.id);
          if (!persisted.persisted) {
            deleteDeck(referenceDeck.id);
            throw new Error(
              describeDeckPersistenceFailure(
                persisted,
                "The PDF reference deck could not be saved.",
              ),
            );
          }
          try {
            const imported = (await callAction("import-file", {
              filePath: pdfReference.path,
              format: "pdf",
              deckId: referenceDeck.id,
              importIntoDeck: true,
            })) as {
              imported?: unknown;
              deckId?: unknown;
              pageCount?: unknown;
              title?: unknown;
            };
            if (
              imported.imported !== true ||
              imported.deckId !== referenceDeck.id ||
              typeof imported.pageCount !== "number" ||
              imported.pageCount < 1
            ) {
              throw new Error("The PDF reference deck could not be imported.");
            }
            importedReference = {
              id: referenceDeck.id,
              title:
                typeof imported.title === "string" && imported.title
                  ? imported.title
                  : t("home.importedReferenceDeck"),
              source: "pdf",
            };
            generationFiles = uploaded.filter((file) => file !== pdfReference);
          } catch (error) {
            deleteDeck(referenceDeck.id);
            throw error;
          }
        }
        setPromptFiles((current) => [...current, ...generationFiles]);
        if (importedReference) {
          await reloadDecks();
        }
        return importedReference;
      } catch (error) {
        toast.error(t("editorToolbar.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("editorToolbar.importFailedDescription"),
        });
        return null;
      } finally {
        setReferenceImporting(false);
      }
    },
    [callAction, createDeck, deleteDeck, ensureDeckPersisted, reloadDecks, t],
  );

  const handleReferenceSourceImport = useCallback(
    async (
      source: NewDeckReferenceSource,
    ): Promise<ImportedReference | null> => {
      if (source.kind !== "google-docs") return null;
      setReferenceImporting(true);
      try {
        const imported = (await callAction("import-google-slides-reference", {
          presentationUrl: source.value,
        })) as {
          id?: unknown;
          imported?: unknown;
          slideCount?: unknown;
          title?: unknown;
        };
        if (
          typeof imported.id !== "string" ||
          !imported.id ||
          imported.imported !== true ||
          typeof imported.slideCount !== "number" ||
          imported.slideCount < 1
        ) {
          throw new Error(
            "The Google Slides presentation did not create a deck.",
          );
        }
        const importedReference: ImportedReference = {
          id: imported.id,
          title:
            typeof imported.title === "string" && imported.title
              ? imported.title
              : t("home.importedReferenceDeck"),
          source: "google-slides",
        };
        await reloadDecks();
        return importedReference;
      } catch (error) {
        toast.error(t("editorToolbar.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("editorToolbar.importFailedDescription"),
        });
        return null;
      } finally {
        setReferenceImporting(false);
      }
    },
    [callAction, reloadDecks, t],
  );

  const handleReferenceSkip = useCallback(() => {
    forgetReference("design-system");
    forgetReference("deck");
    void startGeneration(promptFiles, {
      designSystemId: null,
      referenceDeckId: null,
    });
  }, [forgetReference, promptFiles, startGeneration]);

  if (step === "references") {
    return (
      <NewDeckReferenceStep
        open
        decks={decks}
        designSystems={designSystems}
        defaultDesignSystemId={initialDesignSystemId}
        defaultReferenceDeckId={initialReferenceDeckId}
        onSelect={handleReferenceSelect}
        onImport={handleReferenceImport}
        onImportSource={handleReferenceSourceImport}
        onSkip={handleReferenceSkip}
        onOpenChange={(open) => {
          if (!open) setStep("prompt");
        }}
        importing={referenceImporting}
        title={t("home.newDeck")}
        designSystemLabel={t("home.designSystem")}
        referenceDeckLabel={t("home.referenceDeck")}
        chooseDeckLabel={t("home.referenceDeckPlaceholder")}
        importingLabel={t("raw.uploading")}
        skipLabel={t("home.referenceDeckNone")}
        searchDecksLabel={t("root.searchDecks")}
        promptSummary={prompt}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex min-h-screen flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={t("home.firstDeckPromptTitle")}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5 sm:px-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconArrowLeft className="size-4" />
          <span>{t("home.newDeck")}</span>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("home.firstDeckSkip")}
        </button>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10 sm:px-8">
        <div className="w-full max-w-xl">
          <h1 className="text-center text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
            {t("home.firstDeckPromptTitle")}
          </h1>
          <PromptComposer
            className="mt-8"
            autoFocus
            attachmentsEnabled
            maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
            documentAttachmentLimitLabel="Slides reference files"
            disabled={uploading}
            placeholder={t("home.newDeckPlaceholder")}
            onSubmit={handlePromptSubmit}
            draftScope="slides-first-deck"
            initialText={promptInitialText}
            initialTextKey={promptInitialTextKey}
          />
        </div>
      </main>
    </div>
  );
}

export default FirstDeckOnboardingFlow;
