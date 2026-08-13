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
import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

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
import { cn } from "@/lib/utils";

import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";

export interface NewDeckReferenceSelection {
  designSystemId?: string | null;
  referenceDeckId?: string | null;
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
  source: "pptx" | "pdf" | "google-slides";
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
  >(defaultDesignSystemId);
  const [selectedReferenceDeckId, setSelectedReferenceDeckId] = useState<
    string | null
  >(defaultReferenceDeckId);
  const [importedReference, setImportedReference] =
    useState<ImportedReference | null>(null);
  const [selectedSource, setSelectedSource] =
    useState<NewDeckReferenceSelection["referenceSource"]>(null);
  const [referenceDeckSearchOpen, setReferenceDeckSearchOpen] = useState(false);

  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  const sortedDecks = sortDecksByRecency(decks);
  const selectedReferenceDeck = selectedReferenceDeckId
    ? deckById.get(selectedReferenceDeckId)
    : undefined;

  useEffect(() => {
    if (!open) return;
    setSelectedDesignSystemId(defaultDesignSystemId);
    setSelectedReferenceDeckId(defaultReferenceDeckId);
    setImportedReference(null);
    setSelectedSource(null);
    setReferenceDeckSearchOpen(false);
  }, [open, defaultDesignSystemId, defaultReferenceDeckId]);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const imported = await onImport(files);
    if (imported) applyImportedReference(imported);
  };

  const applyImportedReference = (imported: ImportedReference) => {
    setSelectedDesignSystemId(null);
    setSelectedReferenceDeckId(imported.id);
    setSelectedSource(null);
    setImportedReference(imported);
  };

  const handleContinue = async () => {
    const trimmedSource =
      selectedSource && selectedSource.value.trim()
        ? { ...selectedSource, value: selectedSource.value.trim() }
        : null;

    if (trimmedSource?.kind === "google-docs") {
      const imported = await onImportSource(trimmedSource);
      if (imported) applyImportedReference(imported);
      return;
    }

    onSelect({
      designSystemId: selectedDesignSystemId,
      referenceDeckId: selectedReferenceDeckId,
      referenceSource: trimmedSource,
    });
  };

  const chooseSource = (
    kind: NonNullable<NewDeckReferenceSelection["referenceSource"]>["kind"],
  ) => {
    const isAlreadySelected =
      selectedSource?.kind === kind ||
      (kind === "google-docs" && importedReference?.source === "google-slides");
    if (isAlreadySelected) {
      setSelectedSource(null);
      setImportedReference(null);
      return;
    }
    setSelectedSource({ kind, value: "" });
    if (kind === "website" || kind === "figma") {
      setSelectedDesignSystemId(null);
    } else {
      setSelectedReferenceDeckId(null);
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
                  <a
                    href="/design-systems"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline"
                  >
                    {t("home.addDesignSystem")}
                  </a>
                )}
              </div>
              <Select
                value={selectedDesignSystemId ?? "none"}
                onValueChange={(value) => {
                  setSelectedDesignSystemId(value === "none" ? null : value);
                  setSelectedSource(null);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  disabled={designSystems.length === 0}
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
                open={referenceDeckSearchOpen}
                onOpenChange={setReferenceDeckSearchOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={referenceDeckSearchOpen}
                    aria-label={referenceDeckLabel}
                    disabled={decks.length === 0}
                    className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="truncate">
                      {selectedReferenceDeckTitle ?? chooseDeckLabel}
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
                    <CommandInput placeholder={searchDecksLabel} />
                    <CommandList className="max-h-72">
                      <CommandEmpty>{t("home.noMatchingDecks")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value={`none ${t("home.none")}`}
                          onSelect={() => {
                            setSelectedReferenceDeckId(null);
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
                            onSelect={() => {
                              setSelectedReferenceDeckId(deck.id);
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
                  importing={importing}
                  importingLabel={importingLabel}
                  onChange={handleImport}
                />
                <FileImportOption
                  accept=".pdf"
                  icon={<IconFileTypePdf className="size-4" />}
                  label="PDF"
                  imported={importedReference?.source === "pdf"}
                  importedLabel={t("home.imported")}
                  importing={importing}
                  importingLabel={importingLabel}
                  onChange={handleImport}
                />
                <FileImportOption
                  accept=".docx"
                  icon={<IconFileText className="size-4" />}
                  label="DOCX"
                  imported={false}
                  importedLabel={t("home.imported")}
                  importing={importing}
                  importingLabel={importingLabel}
                  onChange={handleImport}
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
                  onClick={() => chooseSource("google-docs")}
                />
                <ImportOption
                  icon={<IconWorld className="size-4" />}
                  label="Website"
                  confirmedLabel={t("home.imported")}
                  selected={selectedSource?.kind === "website"}
                  onClick={() => chooseSource("website")}
                />
                <ImportOption
                  icon={<IconBrandFigma className="size-4" />}
                  label="Figma"
                  confirmedLabel={t("home.imported")}
                  selected={selectedSource?.kind === "figma"}
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
                  onChange={(event) =>
                    setSelectedSource({
                      ...selectedSource,
                      value: event.target.value,
                    })
                  }
                />
              )}
              {selectedSource?.kind === "google-docs" && (
                <div className="mt-3">
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
          onClick={onSkip}
          disabled={importing}
        >
          {skipLabel}
        </Button>
        <Button
          type="button"
          onClick={() => void handleContinue()}
          aria-busy={importing}
          disabled={
            importing || Boolean(selectedSource && !selectedSource.value.trim())
          }
        >
          {importing
            ? importingLabel
            : importedReference
              ? t("home.continueToGenerate")
              : t("home.continue")}
          <IconCheck className="ms-1.5 size-4" />
        </Button>
      </footer>
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
  onChange,
}: {
  accept: string;
  icon: ReactNode;
  label: string;
  imported?: boolean;
  importedLabel: string;
  importing: boolean;
  importingLabel: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
        importing && "pointer-events-none opacity-60",
      )}
      aria-label={imported ? `${label} - ${importedLabel}` : label}
    >
      {imported ? <IconCheck className="size-4 text-primary" /> : icon}
      <span>{importing ? importingLabel : label}</span>
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple
        disabled={importing}
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  confirmed?: boolean;
  confirmedLabel?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/50 bg-primary/5 text-primary"
          : "border-border hover:bg-accent",
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
