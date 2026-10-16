import { callAction } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  ComposerContextPickerDialog,
  ComposerRuntimeAdaptersProvider,
  type ComposerContextPickerConfig,
} from "@agent-native/toolkit/composer";
import {
  IconArrowLeft,
  IconBrandFigma,
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconFileTypePdf,
  IconPresentation,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { DesignSystemSetup } from "@/components/design-system/DesignSystemSetup";
import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deck, Slide } from "@/context/DeckContext";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import type { AspectRatio } from "@/lib/aspect-ratios";
import { getDeckListingPreviewFrameStyle } from "@/lib/deck-preview-frame";
import { resolveSelectableDesignSystemId } from "@/lib/design-system-selection";
import type {
  NewDeckReferenceSelection,
  NewDeckReferenceSource,
} from "@/lib/new-deck-reference-selection";
import { cn } from "@/lib/utils";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
export type {
  NewDeckReferenceSelection,
  NewDeckReferenceSource,
} from "@/lib/new-deck-reference-selection";

export interface ImportedReference {
  id: string;
  title: string;
  source: "pptx" | "pdf" | "docx" | "google-slides";
  referenceFilePaths?: string[];
  importedFilePath?: string;
}

type FileImportSource = Exclude<ImportedReference["source"], "google-slides">;

// Mirrors extractGoogleSlidesPresentationId in
// actions/import-google-slides-reference.ts: a bare Picker file ID, or a
// docs.google.com presentation URL. Keep both patterns in sync with that
// function if its accepted shapes ever change.
const GOOGLE_PICKER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const GOOGLE_SLIDES_PRESENTATION_PATH_PATTERN =
  /^\/presentation\/(?:u\/\d+\/)?d\/[a-zA-Z0-9_-]+(?:\/|$)/;

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    // coercion-ok: an unparseable string is a syntactically invalid URL, the
    // exact "null" this parse exists to report.
    return null;
  }
}

function isGoogleSlidesPresentationUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return Boolean(
    url &&
    url.hostname === "docs.google.com" &&
    GOOGLE_SLIDES_PRESENTATION_PATH_PATTERN.test(url.pathname),
  );
}

function isValidReferenceSourceValue(
  kind: NewDeckReferenceSource["kind"],
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (kind === "google-docs") {
    return (
      isGoogleSlidesPresentationUrl(trimmed) ||
      GOOGLE_PICKER_ID_PATTERN.test(trimmed)
    );
  }
  return Boolean(parseHttpUrl(trimmed));
}

interface DesignSystemOption {
  id: string;
  title: string;
  isDefault?: boolean;
}

interface NewDeckReferenceStepProps {
  open: boolean;
  designSystems: DesignSystemOption[];
  decks: Deck[];
  referenceOptionsLoaded: boolean;
  defaultDesignSystemId: string | null;
  onSelect: (selection: NewDeckReferenceSelection) => void | Promise<void>;
  onImport: (files: File[]) => Promise<ImportedReference | null>;
  onImportSource: (
    source: NewDeckReferenceSource,
  ) => Promise<ImportedReference | null>;
  onSkip: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  onDesignSystemsChanged: () => void;
  importing?: boolean;
  title: string;
  designSystemLabel: string;
  referenceDeckLabel: string;
  chooseDeckLabel: string;
  importingLabel: string;
  skipLabel: string;
  searchDecksLabel: string;
  promptSummary?: string;
}

export function NewDeckReferenceStep({
  open,
  designSystems,
  decks,
  referenceOptionsLoaded,
  defaultDesignSystemId,
  onSelect,
  onImport,
  onImportSource,
  onSkip,
  onOpenChange,
  onDesignSystemsChanged,
  importing = false,
  title,
  designSystemLabel,
  referenceDeckLabel,
  chooseDeckLabel,
  importingLabel,
  skipLabel,
  searchDecksLabel,
  promptSummary,
}: NewDeckReferenceStepProps) {
  const t = useT();
  const formatters = useFormatters();
  const storageQuery = useSlideFileStorageStatus(open);
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const systemsEnabled = useDesignSystemWorkflows();
  const [chosenDesignSystemId, setSelectedDesignSystemId] = useState<
    string | null
  >(resolveSelectableDesignSystemId(designSystems, defaultDesignSystemId));
  const selectedDesignSystemId = systemsEnabled ? chosenDesignSystemId : null;
  const [selectedReferenceDeckId, setSelectedReferenceDeckId] = useState<
    string | null
  >(null);
  const [selectedReferenceDeckTitle, setSelectedReferenceDeckTitle] =
    useState<string>();
  const [referenceDeckTouched, setReferenceDeckTouched] = useState(false);
  const [importedReference, setImportedReference] =
    useState<ImportedReference | null>(null);
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const [selectedSource, setSelectedSource] =
    useState<NewDeckReferenceSelection["referenceSource"]>(null);
  const [referenceDeckSearchOpen, setReferenceDeckSearchOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [importingSource, setImportingSource] =
    useState<FileImportSource | null>(null);
  const [showDesignSystemSetup, setShowDesignSystemSetup] = useState(false);
  const busy = importing || continuing;

  const designSystemAutoRef = useRef(true);
  const referenceDeckTriggerRef = useRef<HTMLButtonElement>(null);

  const selectedSourceValid = Boolean(
    selectedSource &&
    isValidReferenceSourceValue(selectedSource.kind, selectedSource.value),
  );
  const hasSelection = Boolean(
    selectedDesignSystemId ||
    selectedReferenceDeckId ||
    referenceDeckTouched ||
    selectedSourceValid ||
    (referenceOptionsLoaded &&
      !selectedSource &&
      designSystems.length === 0 &&
      decks.length === 0),
  );
  const canContinue = referenceOptionsLoaded && hasSelection;

  useEffect(() => {
    if (!open) return;
    designSystemAutoRef.current = true;
    setSelectedDesignSystemId(
      resolveSelectableDesignSystemId(designSystems, defaultDesignSystemId),
    );
    setSelectedReferenceDeckId(null);
    setSelectedReferenceDeckTitle(undefined);
    setReferenceDeckTouched(false);
    setImportedReference(null);
    setSelectedSource(null);
    setReferenceDeckSearchOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !designSystemAutoRef.current) return;
    setSelectedDesignSystemId(
      resolveSelectableDesignSystemId(designSystems, defaultDesignSystemId),
    );
  }, [open, designSystems, defaultDesignSystemId]);

  useEffect(() => {
    if (open) setContinuing(false);
  }, [open]);

  const handleImport = async (
    event: ChangeEvent<HTMLInputElement>,
    source: FileImportSource,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (!fileStorageConfigured) {
      setStoragePromptOpen(true);
      return;
    }
    setImportingSource(source);
    try {
      const imported = await onImport(files);
      if (imported) applyImportedReference(imported);
    } finally {
      setImportingSource(null);
    }
  };

  const applyImportedReference = (imported: ImportedReference) => {
    designSystemAutoRef.current = false;
    setSelectedDesignSystemId(null);
    setSelectedReferenceDeckId(imported.id);
    setSelectedReferenceDeckTitle(imported.title);
    setReferenceDeckTouched(true);
    setSelectedSource(null);
    setImportedReference(imported);
  };

  const handleContinue = async () => {
    if (busy || !canContinue) return;
    const trimmedSource =
      selectedSource && selectedSource.value.trim()
        ? { ...selectedSource, value: selectedSource.value.trim() }
        : null;

    setContinuing(true);
    try {
      if (trimmedSource?.kind === "google-docs") {
        const imported = await onImportSource(trimmedSource);
        if (imported) applyImportedReference(imported);
        return;
      }

      await onSelect({
        designSystemId: selectedDesignSystemId,
        referenceDeckId: selectedReferenceDeckId,
        referenceDeckIdSource: "selection",
        referenceSource: trimmedSource,
        ...(importedReference?.referenceFilePaths?.length
          ? { referenceFilePaths: importedReference.referenceFilePaths }
          : {}),
        ...(importedReference?.importedFilePath
          ? { importedReferenceFilePath: importedReference.importedFilePath }
          : {}),
      });
    } finally {
      setContinuing(false);
    }
  };

  const handleSkip = async () => {
    if (busy) return;
    setContinuing(true);
    try {
      await onSkip();
    } finally {
      setContinuing(false);
    }
  };

  const chooseSource = (
    kind: NonNullable<NewDeckReferenceSelection["referenceSource"]>["kind"],
  ) => {
    const isAlreadySelected =
      selectedSource?.kind === kind ||
      (kind === "google-docs" && importedReference?.source === "google-slides");
    if (isAlreadySelected) {
      setSelectedSource(null);
      if (importedReference) {
        setSelectedReferenceDeckId((current) =>
          current === importedReference.id ? null : current,
        );
        setSelectedReferenceDeckTitle(undefined);
        setImportedReference(null);
        setReferenceDeckTouched(false);
      }
      return;
    }
    setSelectedSource({ kind, value: "" });
    if (kind === "website" || kind === "figma") {
      designSystemAutoRef.current = false;
      setSelectedDesignSystemId(null);
    } else {
      setSelectedReferenceDeckId(null);
      setSelectedReferenceDeckTitle(undefined);
      setImportedReference(null);
    }
  };
  const selectedSourceLabel =
    selectedSource?.kind === "google-docs"
      ? t("home.googleSlidesReferenceTitle")
      : selectedSource?.kind === "website"
        ? "Website"
        : "Figma";
  const referenceDeckPicker = {
    presentation: { type: "dialog", mode: "single", layout: "gallery" },
    searchPlaceholder: searchDecksLabel,
    emptyMessage: t("home.noMatchingDecks"),
    selectedIds: selectedReferenceDeckId ? [selectedReferenceDeckId] : [],
    clearSelection: {
      label: t("home.none"),
      onSelect: () => {
        setSelectedReferenceDeckId(null);
        setSelectedReferenceDeckTitle(undefined);
        setReferenceDeckTouched(true);
        setImportedReference(null);
        setSelectedSource(null);
      },
    },
    load: async ({ search, cursor, signal }) => {
      const result = await callAction<{
        decks: Array<{
          id: string;
          title: string;
          previewSlide?: Slide;
          previewTooLarge?: boolean;
          aspectRatio?: AspectRatio;
          updatedAt: string;
        }>;
        nextCursor?: string;
      }>(
        "list-decks",
        { includePreview: "true", limit: 12, search, cursor },
        { method: "GET", signal },
      );
      return {
        hasMore: Boolean(result.nextCursor),
        nextCursor: result.nextCursor,
        items: result.decks.map((deck) => ({
          id: deck.id,
          title: deck.title,
          preview: deck.previewSlide ? (
            <div className="flex h-full items-center justify-center overflow-hidden">
              <div
                className="slide-reference-preview-frame relative h-full overflow-hidden"
                style={
                  {
                    "--reference-ratio": getDeckListingPreviewFrameStyle(
                      deck.aspectRatio,
                    ).aspectRatio,
                    "--reference-width": getDeckListingPreviewFrameStyle(
                      deck.aspectRatio,
                    ).width,
                  } as CSSProperties
                }
              >
                <SlideRenderer
                  slide={deck.previewSlide}
                  thumbnail
                  aspectRatio={deck.aspectRatio}
                />
              </div>
            </div>
          ) : deck.previewTooLarge ? (
            <div
              aria-hidden
              className="slide-reference-preview-fallback flex h-full items-center justify-center bg-muted text-muted-foreground"
            >
              <IconPresentation className="size-8" />
            </div>
          ) : null,
          metadata: (
            <time dateTime={deck.updatedAt}>
              {formatters.formatDate(deck.updatedAt, { dateStyle: "medium" })}
            </time>
          ),
        })),
      };
    },
    onSelect: (item) => {
      setSelectedReferenceDeckId(item.id);
      setSelectedReferenceDeckTitle(item.title);
      setReferenceDeckTouched(true);
      setImportedReference(null);
      setSelectedSource(null);
    },
  } satisfies ComposerContextPickerConfig;
  return open ? (
    <div
      className="fixed inset-0 z-[200] flex min-h-screen flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="flex h-14 shrink-0 items-center border-b border-border px-5 sm:px-8">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconArrowLeft className="size-4" />
          <span>{title}</span>
        </button>
      </header>

      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
            {t("home.chooseReferences")}
          </h1>
          {promptSummary?.trim() && (
            <p className="mt-2 max-w-xl truncate text-sm text-muted-foreground">
              “{promptSummary.trim()}”
            </p>
          )}
          <div className="mt-10 space-y-6">
            {systemsEnabled && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {designSystemLabel}
                  </span>
                  {designSystems.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setShowDesignSystemSetup(true)}
                      className="text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline"
                    >
                      {t("home.addDesignSystem")}
                    </button>
                  )}
                </div>
                <Select
                  value={selectedDesignSystemId ?? "none"}
                  onValueChange={(value) => {
                    designSystemAutoRef.current = false;
                    setSelectedDesignSystemId(value === "none" ? null : value);
                    setSelectedSource(null);
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    disabled={designSystems.length === 0 || busy}
                  >
                    <SelectValue placeholder={designSystemLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("home.none")}</SelectItem>
                    {designSystems.map((designSystem) => (
                      <SelectItem key={designSystem.id} value={designSystem.id}>
                        {designSystem.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {referenceDeckLabel}
              </span>
              <button
                ref={referenceDeckTriggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={referenceDeckSearchOpen}
                aria-label={referenceDeckLabel}
                disabled={!referenceOptionsLoaded || busy}
                onClick={() => setReferenceDeckSearchOpen(true)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="truncate">
                  {selectedReferenceDeckTitle ??
                    (referenceDeckTouched ? t("home.none") : chooseDeckLabel)}
                </span>
                <IconChevronDown className="size-4 shrink-0 opacity-50" />
              </button>
            </div>

            <div className="border-t border-border pt-5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("home.importFrom")}
              </span>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <FileImportOption
                  accept=".pptx"
                  icon={<IconPresentation className="size-4" />}
                  label="PPT"
                  imported={importedReference?.source === "pptx"}
                  importedLabel={t("home.imported")}
                  importing={importing && importingSource === "pptx"}
                  importingLabel={importingLabel}
                  storageConfigured={fileStorageConfigured}
                  disabled={busy}
                  onStorageRequired={() => setStoragePromptOpen(true)}
                  onChange={(event) => void handleImport(event, "pptx")}
                />
                <FileImportOption
                  accept=".pdf"
                  icon={<IconFileTypePdf className="size-4" />}
                  label="PDF"
                  imported={importedReference?.source === "pdf"}
                  importedLabel={t("home.imported")}
                  importing={importing && importingSource === "pdf"}
                  importingLabel={importingLabel}
                  storageConfigured={fileStorageConfigured}
                  disabled={busy}
                  onStorageRequired={() => setStoragePromptOpen(true)}
                  onChange={(event) => void handleImport(event, "pdf")}
                />
                <FileImportOption
                  accept=".docx"
                  icon={<IconFileText className="size-4" />}
                  label="DOCX"
                  imported={importedReference?.source === "docx"}
                  importedLabel={t("home.imported")}
                  importing={importing && importingSource === "docx"}
                  importingLabel={importingLabel}
                  storageConfigured={fileStorageConfigured}
                  disabled={busy}
                  onStorageRequired={() => setStoragePromptOpen(true)}
                  onChange={(event) => void handleImport(event, "docx")}
                />
                <ImportOption
                  icon={<IconBrandGoogle className="size-4" />}
                  label={t("home.googleSlidesImportLabel")}
                  confirmed={importedReference?.source === "google-slides"}
                  confirmedLabel={t("home.imported")}
                  selected={
                    selectedSource?.kind === "google-docs" ||
                    importedReference?.source === "google-slides"
                  }
                  disabled={busy}
                  onClick={() => chooseSource("google-docs")}
                />
                <ImportOption
                  icon={<IconWorld className="size-4" />}
                  label="Website"
                  confirmedLabel={t("home.imported")}
                  selected={selectedSource?.kind === "website"}
                  disabled={busy}
                  onClick={() => chooseSource("website")}
                />
                <ImportOption
                  icon={<IconBrandFigma className="size-4" />}
                  label="Figma"
                  confirmedLabel={t("home.imported")}
                  selected={selectedSource?.kind === "figma"}
                  disabled={busy}
                  onClick={() => chooseSource("figma")}
                />
              </div>
              <UploadStorageGate
                configured={fileStorageConfigured}
                unavailable={!storageQuery.isSuccess}
                open={storagePromptOpen}
                onOpenChange={setStoragePromptOpen}
                onRetry={() => void storageQuery.refetch()}
                onConnected={() => void storageQuery.refetch()}
              />
              {selectedSource && (
                <Input
                  autoFocus
                  className="mt-3"
                  value={selectedSource.value}
                  placeholder={`Paste a ${selectedSourceLabel} link`}
                  aria-label={`${selectedSourceLabel} link`}
                  disabled={busy}
                  onChange={(event) =>
                    setSelectedSource({
                      ...selectedSource,
                      value: event.target.value,
                    })
                  }
                />
              )}
              {selectedSource?.kind === "google-docs" && (
                <div
                  className={cn(
                    "mt-3",
                    busy && "pointer-events-none opacity-60",
                  )}
                >
                  <GoogleDriveConnectionCta />
                </div>
              )}
              {importedReference && (
                <div
                  className="mt-3 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm"
                  role="status"
                  aria-live="polite"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <IconCheck className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {t("home.referenceImportSuccess")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("home.referenceImportSelected", {
                        title: importedReference.title,
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-4 sm:px-8">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void handleSkip()}
          disabled={busy}
        >
          {skipLabel}
        </Button>
        <Button
          type="button"
          onClick={() => void handleContinue()}
          aria-busy={busy}
          disabled={
            busy ||
            !canContinue ||
            Boolean(selectedSource && !selectedSourceValid)
          }
        >
          {importing || continuing
            ? importingLabel
            : importedReference
              ? t("home.continueToGenerate")
              : t("home.continue")}
          <IconCheck className="ms-1.5 size-4" />
        </Button>
      </footer>

      <DesignSystemSetup
        open={showDesignSystemSetup}
        onClose={() => setShowDesignSystemSetup(false)}
        onComplete={() => {
          setShowDesignSystemSetup(false);
          onDesignSystemsChanged();
        }}
      />
      {referenceDeckSearchOpen && !busy && (
        <ComposerRuntimeAdaptersProvider
          adapters={{ translate: (key, options) => t(key, options) }}
        >
          <ComposerContextPickerDialog
            config={referenceDeckPicker}
            title={referenceDeckLabel}
            onClose={() => setReferenceDeckSearchOpen(false)}
            onRestoreFocus={() => referenceDeckTriggerRef.current?.focus()}
          />
        </ComposerRuntimeAdaptersProvider>
      )}
    </div>
  ) : null;
}

function FileImportOption({
  accept,
  icon,
  label,
  imported = false,
  importedLabel,
  importing,
  importingLabel,
  disabled = false,
  storageConfigured,
  onStorageRequired,
  onChange,
}: {
  accept: string;
  icon: ReactNode;
  label: string;
  imported?: boolean;
  importedLabel: string;
  importing: boolean;
  importingLabel: string;
  disabled?: boolean;
  storageConfigured: boolean;
  onStorageRequired: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={cn(
          "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
          (importing || disabled) && "pointer-events-none opacity-60",
        )}
        disabled={importing || disabled}
        aria-label={
          importing
            ? `${label} - ${importingLabel}`
            : imported
              ? `${label} - ${importedLabel}`
              : label
        }
        onClick={() => {
          if (storageConfigured) inputRef.current?.click();
          else onStorageRequired();
        }}
      >
        {imported ? <IconCheck className="size-4 text-primary" /> : icon}
        <span>{importing ? importingLabel : label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple
        disabled={importing || disabled || !storageConfigured}
        onChange={onChange}
      />
    </>
  );
}

function ImportOption({
  icon,
  label,
  confirmed = false,
  confirmedLabel,
  selected = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  confirmed?: boolean;
  confirmedLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/50 bg-primary/5 text-primary"
          : "border-border hover:bg-accent",
        disabled && "pointer-events-none opacity-60",
      )}
      aria-label={
        confirmed && confirmedLabel ? `${label} - ${confirmedLabel}` : label
      }
      aria-pressed={selected}
    >
      {confirmed ? <IconCheck className="size-4 text-primary" /> : icon}
      <span>{label}</span>
    </button>
  );
}
