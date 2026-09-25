import { useT } from "@agent-native/core/client/i18n";
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
import type { ChangeEvent, ReactNode } from "react";

import { DesignSystemSetup } from "@/components/design-system/DesignSystemSetup";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deck } from "@/context/DeckContext";
import { sortDecksByRecency } from "@/lib/deck-sorting";
import { resolveSelectableDesignSystemId } from "@/lib/design-system-selection";
import { cn } from "@/lib/utils";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
export interface NewDeckReferenceSelection {
  designSystemId?: string | null;
  referenceDeckId?: string | null;
  referenceFilePaths?: string[];
  /**
   * The one uploaded document that became `referenceDeckId`. The import
   * controls accept multiple files but only import one, so the rest of
   * `referenceFilePaths` still needs hydrating.
   */
  importedReferenceFilePath?: string;
  referenceSource?: {
    kind: "google-docs" | "website" | "figma";
    value: string;
  } | null;
}

export type NewDeckReferenceSource = NonNullable<
  NewDeckReferenceSelection["referenceSource"]
>;

export interface ImportedReference {
  id: string;
  title: string;
  source: "pptx" | "pdf" | "docx" | "google-slides";
  referenceFilePaths?: string[];
  /** The uploaded document this reference deck was built from, when any. */
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
  defaultDesignSystemId: string | null;
  defaultReferenceDeckId: string | null;
  onSelect: (selection: NewDeckReferenceSelection) => void | Promise<void>;
  onImport: (files: File[]) => Promise<ImportedReference | null>;
  onImportSource: (
    source: NewDeckReferenceSource,
  ) => Promise<ImportedReference | null>;
  onSkip: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /** Called after the inline "create a design system" dialog completes, so
   * the caller can refetch the list and surface the new option. */
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
  defaultDesignSystemId,
  defaultReferenceDeckId,
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
  const [selectedDesignSystemId, setSelectedDesignSystemId] = useState<
    string | null
  >(resolveSelectableDesignSystemId(designSystems, defaultDesignSystemId));
  const [selectedReferenceDeckId, setSelectedReferenceDeckId] = useState<
    string | null
  >(defaultReferenceDeckId);
  const [referenceDeckTouched, setReferenceDeckTouched] = useState(
    defaultReferenceDeckId !== null,
  );
  const [importedReference, setImportedReference] =
    useState<ImportedReference | null>(null);
  const [selectedSource, setSelectedSource] =
    useState<NewDeckReferenceSelection["referenceSource"]>(null);
  const [referenceDeckSearchOpen, setReferenceDeckSearchOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [importingSource, setImportingSource] =
    useState<FileImportSource | null>(null);
  const [showDesignSystemSetup, setShowDesignSystemSetup] = useState(false);
  const busy = importing || continuing;

  // True while the picker still reflects an auto-applied default rather than
  // an explicit user choice, so a default that resolves after this step is
  // already open can still land - see the hydration effects below.
  const designSystemAutoRef = useRef(true);
  const referenceDeckAutoRef = useRef(true);

  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  const sortedDecks = sortDecksByRecency(decks);
  const selectedReferenceDeck = selectedReferenceDeckId
    ? deckById.get(selectedReferenceDeckId)
    : undefined;
  const selectedSourceValid = Boolean(
    selectedSource &&
    isValidReferenceSourceValue(selectedSource.kind, selectedSource.value),
  );
  const hasSelection = Boolean(
    selectedDesignSystemId || selectedReferenceDeckId || selectedSourceValid,
  );

  useEffect(() => {
    if (!open) return;
    designSystemAutoRef.current = true;
    referenceDeckAutoRef.current = true;
    setSelectedDesignSystemId(
      resolveSelectableDesignSystemId(designSystems, defaultDesignSystemId),
    );
    setSelectedReferenceDeckId(defaultReferenceDeckId);
    setReferenceDeckTouched(defaultReferenceDeckId !== null);
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
    if (!open || !referenceDeckAutoRef.current) return;
    setSelectedReferenceDeckId(defaultReferenceDeckId);
    setReferenceDeckTouched(defaultReferenceDeckId !== null);
  }, [open, decks, defaultReferenceDeckId]);

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
    referenceDeckAutoRef.current = false;
    setSelectedDesignSystemId(null);
    setSelectedReferenceDeckId(imported.id);
    setReferenceDeckTouched(true);
    setSelectedSource(null);
    setImportedReference(imported);
  };

  const handleContinue = async () => {
    if (busy || !hasSelection) return;
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
        // The import also set the reference deck. Leaving that id behind would
        // submit a deck the UI no longer shows as selected.
        setSelectedReferenceDeckId((current) =>
          current === importedReference.id ? null : current,
        );
        setImportedReference(null);
      }
      return;
    }
    setSelectedSource({ kind, value: "" });
    if (kind === "website" || kind === "figma") {
      designSystemAutoRef.current = false;
      setSelectedDesignSystemId(null);
    } else {
      referenceDeckAutoRef.current = false;
      setSelectedReferenceDeckId(null);
      setReferenceDeckTouched(true);
      setImportedReference(null);
    }
  };
  const selectedSourceLabel =
    selectedSource?.kind === "google-docs"
      ? t("home.googleSlidesReferenceTitle")
      : selectedSource?.kind === "website"
        ? "Website"
        : "Figma";
  const selectedReferenceDeckTitle =
    selectedReferenceDeck?.title ??
    (selectedReferenceDeckId === importedReference?.id
      ? importedReference.title
      : undefined);
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

            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {referenceDeckLabel}
              </span>
              <Popover
                open={referenceDeckSearchOpen && !busy}
                onOpenChange={(open) =>
                  !busy && setReferenceDeckSearchOpen(open)
                }
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={referenceDeckSearchOpen}
                    aria-label={referenceDeckLabel}
                    disabled={decks.length === 0 || busy}
                    className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="truncate">
                      {selectedReferenceDeckTitle ??
                        (referenceDeckTouched
                          ? t("home.none")
                          : chooseDeckLabel)}
                    </span>
                    <IconChevronDown className="size-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[--radix-popover-trigger-width] p-0"
                >
                  <Command
                    filter={(value, search) =>
                      value.toLowerCase().includes(search.toLowerCase().trim())
                        ? 1
                        : 0
                    }
                  >
                    <CommandInput
                      placeholder={searchDecksLabel}
                      disabled={busy}
                    />
                    <CommandList className="max-h-72">
                      <CommandEmpty>{t("home.noMatchingDecks")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={`none ${t("home.none")}`}
                          disabled={busy}
                          onSelect={() => {
                            referenceDeckAutoRef.current = false;
                            setSelectedReferenceDeckId(null);
                            setReferenceDeckTouched(true);
                            setImportedReference(null);
                            setSelectedSource(null);
                            setReferenceDeckSearchOpen(false);
                          }}
                        >
                          <IconCheck
                            className={cn(
                              "me-2 size-4",
                              selectedReferenceDeckId === null
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          <span className="truncate">{t("home.none")}</span>
                        </CommandItem>
                        {sortedDecks.map((deck) => (
                          <CommandItem
                            key={deck.id}
                            value={`${deck.title} ${deck.id}`}
                            disabled={busy}
                            onSelect={() => {
                              referenceDeckAutoRef.current = false;
                              setSelectedReferenceDeckId(deck.id);
                              setReferenceDeckTouched(true);
                              setImportedReference(null);
                              setSelectedSource(null);
                              setReferenceDeckSearchOpen(false);
                            }}
                          >
                            <IconCheck
                              className={cn(
                                "me-2 size-4",
                                selectedReferenceDeckId === deck.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">{deck.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
                  disabled={busy}
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
                  disabled={busy}
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
                  disabled={busy}
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
            !hasSelection ||
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
          // Most sources hand off to the agent and complete before the row
          // exists, so this can be a no-op; it only helps the synchronous
          // edit/GitHub-only paths. The dropdown still catches up once the
          // agent-created row lands, via the shared action-query sync in
          // useDbSync (see root.tsx), not through this call.
          onDesignSystemsChanged();
        }}
      />
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
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
        (importing || disabled) && "pointer-events-none opacity-60",
      )}
      aria-label={
        importing
          ? `${label} - ${importingLabel}`
          : imported
            ? `${label} - ${importedLabel}`
            : label
      }
    >
      {imported ? <IconCheck className="size-4 text-primary" /> : icon}
      <span>{importing ? importingLabel : label}</span>
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple
        disabled={importing || disabled}
        onChange={onChange}
      />
    </label>
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
