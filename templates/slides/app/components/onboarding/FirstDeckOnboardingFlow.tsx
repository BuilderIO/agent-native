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
  type NewDeckReferenceSelection,
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
  const { designSystems, defaultSystem } = useDesignSystems();
  const {
    referenceDeck: workspaceReferenceDeck,
    designSystem: workspaceDesignSystem,
  } = useWorkspaceDefaults();
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
  const workspaceReferenceDeckId =
    workspaceReferenceDeck && !workspaceReferenceDeck.unavailable
      ? workspaceReferenceDeck.id
      : null;
  const workspaceDesignSystemId =
    workspaceDesignSystem && !workspaceDesignSystem.unavailable
      ? workspaceDesignSystem.id
      : null;
  const initialDesignSystemId =
    designSystems.find((designSystem) => designSystem.isDefault)?.id ??
    workspaceDesignSystemId ??
    defaultSystem?.id ??
    null;

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
        selectedReferenceDeckId: workspaceReferenceDeckId,
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
      workspaceReferenceDeckId,
    ],
  );

  const handleReferenceSelect = useCallback(
    async (selection: NewDeckReferenceSelection) => {
      if (selection.designSystemId) {
        rememberReference({
          id: selection.designSystemId,
          kind: "design-system",
        });
      }
      if (selection.referenceDeckId) {
        rememberReference({ id: selection.referenceDeckId, kind: "deck" });
      }
      await startGeneration(promptFiles, selection);
    },
    [promptFiles, rememberReference, startGeneration],
  );

  const handleReferenceImport = useCallback(
    async (files: File[]) => {
      setReferenceImporting(true);
      try {
        const uploaded = await uploadPromptFiles(files);
        const pptxReference = uploaded.find((file) =>
          file.originalName.toLowerCase().endsWith(".pptx"),
        );
        let referenceSelection: NewDeckReferenceSelection = {
          designSystemId: null,
          referenceDeckId: null,
        };
        let generationFiles = uploaded;
        if (pptxReference) {
          const imported = (await callAction("import-pptx", {
            filePath: pptxReference.path,
          })) as { id?: unknown };
          if (typeof imported.id !== "string" || !imported.id) {
            throw new Error("The imported presentation did not create a deck.");
          }
          await reloadDecks();
          rememberReference({ id: imported.id, kind: "deck" });
          referenceSelection = {
            designSystemId: null,
            referenceDeckId: imported.id,
          };
          generationFiles = uploaded.filter((file) => file !== pptxReference);
        }
        await startGeneration(
          [...promptFiles, ...generationFiles],
          referenceSelection,
        );
      } catch (error) {
        toast.error(t("editorToolbar.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("editorToolbar.importFailedDescription"),
        });
      } finally {
        setReferenceImporting(false);
      }
    },
    [promptFiles, reloadDecks, rememberReference, startGeneration, t],
  );

  const handleReferenceSkip = useCallback(() => {
    void startGeneration(promptFiles, {
      designSystemId: null,
      referenceDeckId: null,
    });
  }, [promptFiles, startGeneration]);

  if (step === "references") {
    return (
      <NewDeckReferenceStep
        open
        decks={decks}
        designSystems={designSystems}
        defaultDesignSystemId={initialDesignSystemId}
        defaultReferenceDeckId={workspaceReferenceDeckId}
        recentReferences={recentReferences}
        onSelect={handleReferenceSelect}
        onImport={handleReferenceImport}
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
        defaultSuffix={t("home.defaultSuffix")}
        starredLabel={t("home.referenceDeckStarredGroup")}
        otherDecksLabel={t("home.referenceDeckOtherGroup")}
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
