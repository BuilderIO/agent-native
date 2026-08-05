import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBrandFigma,
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconFileTypePdf,
  IconPalette,
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
import type { RecentReference } from "@/lib/recent-references";
import { cn } from "@/lib/utils";

export interface NewDeckReferenceSelection {
  designSystemId?: string | null;
  referenceDeckId?: string | null;
  referenceSource?: {
    kind: "google-docs" | "website" | "figma";
    value: string;
  } | null;
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
  recentReferences: RecentReference[];
  onSelect: (selection: NewDeckReferenceSelection) => void;
  onImport: (files: File[]) => Promise<void>;
  onSkip: () => void;
  onOpenChange: (open: boolean) => void;
  importing?: boolean;
  title: string;
  designSystemLabel: string;
  referenceDeckLabel: string;
  chooseDeckLabel: string;
  importingLabel: string;
  skipLabel: string;
  defaultSuffix: string;
  starredLabel: string;
  otherDecksLabel: string;
  searchDecksLabel: string;
  promptSummary?: string;
}

export function NewDeckReferenceStep({
  open,
  designSystems,
  decks,
  defaultDesignSystemId,
  defaultReferenceDeckId,
  recentReferences,
  onSelect,
  onImport,
  onSkip,
  onOpenChange,
  importing = false,
  title,
  designSystemLabel,
  referenceDeckLabel,
  chooseDeckLabel,
  importingLabel,
  skipLabel,
  defaultSuffix,
  starredLabel,
  otherDecksLabel,
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
  const [selectedSource, setSelectedSource] =
    useState<NewDeckReferenceSelection["referenceSource"]>(null);
  const [referenceDeckSearchOpen, setReferenceDeckSearchOpen] = useState(false);

  const designSystemById = new Map(
    designSystems.map((designSystem) => [designSystem.id, designSystem]),
  );
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  const recentOptions = recentReferences
    .map((reference) => {
      const item =
        reference.kind === "design-system"
          ? designSystemById.get(reference.id)
          : deckById.get(reference.id);
      return item ? { reference, item } : null;
    })
    .filter(
      (
        value,
      ): value is {
        reference: RecentReference;
        item: DesignSystemOption | Deck;
      } => value !== null,
    );
  const visibleRecentOptions = recentOptions.filter(({ reference }) =>
    reference.kind === "design-system"
      ? reference.id !== selectedDesignSystemId
      : reference.id !== selectedReferenceDeckId,
  );
  const starredDecks = decks.filter((deck) => deck.starred);
  const otherDecks = decks.filter((deck) => !deck.starred);
  const selectedDesignSystem = selectedDesignSystemId
    ? designSystemById.get(selectedDesignSystemId)
    : undefined;
  const selectedReferenceDeck = selectedReferenceDeckId
    ? deckById.get(selectedReferenceDeckId)
    : undefined;

  useEffect(() => {
    if (!open) return;
    setSelectedDesignSystemId(defaultDesignSystemId);
    setSelectedReferenceDeckId(defaultReferenceDeckId);
    setSelectedSource(null);
    setReferenceDeckSearchOpen(false);
  }, [open, defaultDesignSystemId, defaultReferenceDeckId]);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await onImport(files);
  };

  const handleContinue = () => {
    onSelect({
      designSystemId: selectedDesignSystemId,
      referenceDeckId: selectedReferenceDeckId,
      referenceSource:
        selectedSource && selectedSource.value.trim()
          ? { ...selectedSource, value: selectedSource.value.trim() }
          : null,
    });
  };

  const chooseSource = (
    kind: NonNullable<NewDeckReferenceSelection["referenceSource"]>["kind"],
  ) => {
    setSelectedSource({ kind, value: "" });
    if (kind === "website" || kind === "figma") {
      setSelectedDesignSystemId(null);
    } else {
      setSelectedReferenceDeckId(null);
    }
  };
  const selectedSourceLabel =
    selectedSource?.kind === "google-docs"
      ? "Google Slides"
      : selectedSource?.kind === "website"
        ? "Website"
        : "Figma";
  const selectedSourceIcon =
    selectedSource?.kind === "google-docs" ? (
      <IconBrandGoogle className="size-4" />
    ) : selectedSource?.kind === "website" ? (
      <IconWorld className="size-4" />
    ) : (
      <IconBrandFigma className="size-4" />
    );

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

          {(selectedDesignSystem || selectedSource) && (
            <div className="mt-8 space-y-2">
              {selectedDesignSystem && (
                <ReferenceRow
                  icon={<IconPalette className="size-4" />}
                  label={selectedDesignSystem.title}
                  meta={`${designSystemLabel}${defaultDesignSystemId === selectedDesignSystem.id ? defaultSuffix : ""}`}
                  selected
                  onClick={() => setSelectedDesignSystemId(null)}
                />
              )}
              {selectedSource && (
                <ReferenceRow
                  icon={selectedSourceIcon}
                  label={selectedSourceLabel}
                  meta={selectedSource.value || "Add a link below"}
                  selected
                  onClick={() => setSelectedSource(null)}
                />
              )}
            </div>
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
                value={selectedDesignSystemId ?? undefined}
                onValueChange={(value) => {
                  setSelectedDesignSystemId(value);
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
                      {selectedReferenceDeck?.title ?? chooseDeckLabel}
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
                      {starredDecks.length > 0 && (
                        <CommandGroup heading={starredLabel}>
                          {starredDecks.map((deck) => (
                            <CommandItem
                              key={deck.id}
                              value={`${deck.title} ${deck.id}`}
                              onSelect={() => {
                                setSelectedReferenceDeckId(deck.id);
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
                      )}
                      {otherDecks.length > 0 && (
                        <CommandGroup heading={otherDecksLabel}>
                          {otherDecks.map((deck) => (
                            <CommandItem
                              key={deck.id}
                              value={`${deck.title} ${deck.id}`}
                              onSelect={() => {
                                setSelectedReferenceDeckId(deck.id);
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
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {visibleRecentOptions.length > 0 && (
              <div className="border-t border-border pt-5">
                <span className="text-xs font-medium text-muted-foreground">
                  Recent
                </span>
                <div className="mt-2 space-y-2">
                  {visibleRecentOptions.map(({ reference, item }) => (
                    <ReferenceRow
                      key={`${reference.kind}:${reference.id}`}
                      compact
                      icon={
                        reference.kind === "design-system" ? (
                          <IconPalette className="size-4" />
                        ) : (
                          <IconPresentation className="size-4" />
                        )
                      }
                      label={item.title}
                      meta={
                        reference.kind === "design-system"
                          ? designSystemLabel
                          : referenceDeckLabel
                      }
                      onClick={() => {
                        if (reference.kind === "design-system") {
                          setSelectedDesignSystemId(reference.id);
                        } else {
                          setSelectedReferenceDeckId(reference.id);
                        }
                        setSelectedSource(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border pt-5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("home.importFrom")}
              </span>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <FileImportOption
                  accept=".pptx"
                  icon={<IconPresentation className="size-4" />}
                  label="PPT"
                  importing={importing}
                  importingLabel={importingLabel}
                  onChange={handleImport}
                />
                <FileImportOption
                  accept=".pdf"
                  icon={<IconFileTypePdf className="size-4" />}
                  label="PDF"
                  importing={importing}
                  importingLabel={importingLabel}
                  onChange={handleImport}
                />
                <ImportOption
                  icon={<IconBrandGoogle className="size-4" />}
                  label="GSlides"
                  selected={selectedSource?.kind === "google-docs"}
                  onClick={() => chooseSource("google-docs")}
                />
                <ImportOption
                  icon={<IconWorld className="size-4" />}
                  label="Website"
                  selected={selectedSource?.kind === "website"}
                  onClick={() => chooseSource("website")}
                />
                <ImportOption
                  icon={<IconBrandFigma className="size-4" />}
                  label="Figma"
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
            </div>
          </div>
        </div>
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-4 sm:px-8">
        <Button type="button" variant="ghost" onClick={onSkip}>
          {skipLabel}
        </Button>
        <Button
          type="button"
          onClick={handleContinue}
          disabled={
            importing || Boolean(selectedSource && !selectedSource.value.trim())
          }
        >
          Continue
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
  importing,
  importingLabel,
  onChange,
}: {
  accept: string;
  icon: ReactNode;
  label: string;
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
    >
      {icon}
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
  selected = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
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
      aria-pressed={selected}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ReferenceRow({
  icon,
  label,
  meta,
  selected = false,
  compact = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  selected?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg border px-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "py-2.5" : "py-3.5",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-card/40 hover:border-foreground/30 hover:bg-accent/40",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          selected
            ? "bg-primary/10 text-primary"
            : "bg-accent text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      {selected && <IconCheck className="size-4 shrink-0 text-primary" />}
    </button>
  );
}
