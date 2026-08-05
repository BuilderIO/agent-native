import {
  IconArrowRight,
  IconCheck,
  IconPalette,
  IconPresentation,
  IconSearch,
  IconStar,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import type { ChangeEvent, ReactNode } from "react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Deck } from "@/context/DeckContext";
import { cn } from "@/lib/utils";

import { GoogleSlidesReferenceImport } from "./GoogleSlidesReferenceImport";

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
  selectedDesignSystemId: string | null;
  selectedReferenceDeckId: string | null;
  onSelectDesignSystem: (designSystemId: string | null) => void;
  onSelectReferenceDeck: (referenceDeckId: string | null) => void;
  onImport: (files: File[]) => Promise<void>;
  onContinue: () => void;
  onSkip: () => void;
  onOpenChange: (open: boolean) => void;
  onGoogleSlidesImported: (imported: {
    id: string;
    title: string;
  }) => void | Promise<void>;
  importing?: boolean;
  title: string;
  description: string;
  designSystemLabel: string;
  referenceDeckLabel: string;
  noneLabel: string;
  importFileLabel: string;
  importingLabel: string;
  continueLabel: string;
  skipLabel: string;
  defaultSuffix: string;
  starredLabel: string;
  otherDecksLabel: string;
  promptNote?: string;
  searchDecksLabel: string;
  chooseAnotherDeckLabel: string;
  noMatchingDecksLabel: string;
  googleSlidesTitle: string;
  googleSlidesConnectLabel: string;
  googleSlidesChooseLabel: string;
  googleSlidesPickingLabel: string;
  googleSlidesConnectedLabel: string;
  googleSlidesUnavailableLabel: string;
}

export function NewDeckReferenceStep({
  open,
  designSystems,
  decks,
  defaultDesignSystemId,
  defaultReferenceDeckId,
  selectedDesignSystemId,
  selectedReferenceDeckId,
  onSelectDesignSystem,
  onSelectReferenceDeck,
  onImport,
  onContinue,
  onSkip,
  onOpenChange,
  onGoogleSlidesImported,
  importing = false,
  title,
  description,
  designSystemLabel,
  referenceDeckLabel,
  noneLabel,
  importFileLabel,
  importingLabel,
  continueLabel,
  skipLabel,
  defaultSuffix,
  starredLabel,
  otherDecksLabel,
  promptNote,
  searchDecksLabel,
  chooseAnotherDeckLabel,
  noMatchingDecksLabel,
  googleSlidesTitle,
  googleSlidesConnectLabel,
  googleSlidesChooseLabel,
  googleSlidesPickingLabel,
  googleSlidesConnectedLabel,
  googleSlidesUnavailableLabel,
}: NewDeckReferenceStepProps) {
  const [query, setQuery] = useState("");
  const [googleSlidesBusy, setGoogleSlidesBusy] = useState(false);
  const designSystemById = useMemo(
    () =>
      new Map(
        designSystems.map((designSystem) => [designSystem.id, designSystem]),
      ),
    [designSystems],
  );
  const deckById = useMemo(
    () => new Map(decks.map((deck) => [deck.id, deck])),
    [decks],
  );

  const filteredDecks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return {
        starred: decks.filter((deck) => deck.starred),
        other: decks.filter((deck) => !deck.starred),
        flat: [] as Deck[],
      };
    }
    const flat = decks.filter((deck) =>
      deck.title.toLowerCase().includes(normalized),
    );
    return { starred: [], other: [], flat };
  }, [decks, query]);

  const currentDesignSystem = selectedDesignSystemId
    ? (designSystemById.get(selectedDesignSystemId) ?? null)
    : null;
  const selectedDesignSystemLabel =
    currentDesignSystem?.title ?? designSystemLabel;
  const selectedReferenceDeckLabel =
    (selectedReferenceDeckId
      ? deckById.get(selectedReferenceDeckId)?.title
      : null) ?? referenceDeckLabel;
  const selectedDesignSystemIsDefault =
    !!selectedDesignSystemId &&
    selectedDesignSystemId === defaultDesignSystemId;
  const selectedReferenceDeckIsDefault =
    !!selectedReferenceDeckId &&
    selectedReferenceDeckId === defaultReferenceDeckId;

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await onImport(files);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(88vh,880px)] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{promptNote ?? ""}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
          <div className="grid gap-4">
            <Card className="border-border/70">
              <CardHeader className="space-y-1 pb-3">
                <CardTitle className="text-sm">{designSystemLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {defaultDesignSystemId
                    ? `${designSystemLabel}${defaultSuffix}`
                    : noneLabel}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={selectedDesignSystemId ?? "none"}
                  onValueChange={(value) =>
                    onSelectDesignSystem(value === "none" ? null : value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={designSystemLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{designSystemLabel}</SelectLabel>
                      <SelectItem value="none">{noneLabel}</SelectItem>
                      {designSystems.map((designSystem) => (
                        <SelectItem
                          key={designSystem.id}
                          value={designSystem.id}
                        >
                          {designSystem.title}
                          {designSystem.isDefault ? defaultSuffix : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <SelectionSummary
                  icon={<IconPalette className="size-4" />}
                  label={
                    selectedDesignSystemId
                      ? selectedDesignSystemLabel
                      : noneLabel
                  }
                  meta={
                    selectedDesignSystemIsDefault
                      ? `${designSystemLabel}${defaultSuffix}`
                      : selectedDesignSystemId
                        ? designSystemLabel
                        : noneLabel
                  }
                  onClear={
                    selectedDesignSystemId
                      ? () => onSelectDesignSystem(null)
                      : undefined
                  }
                />
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="space-y-1 pb-3">
                <CardTitle className="text-sm">{googleSlidesTitle}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {googleSlidesConnectedLabel}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <GoogleSlidesReferenceImport
                  onImported={onGoogleSlidesImported}
                  onBusyChange={setGoogleSlidesBusy}
                  title={googleSlidesTitle}
                  chooseLabel={googleSlidesChooseLabel}
                  connectLabel={googleSlidesConnectLabel}
                  pickingLabel={googleSlidesPickingLabel}
                  connectedLabel={googleSlidesConnectedLabel}
                  unavailableLabel={googleSlidesUnavailableLabel}
                />

                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                    importing && "pointer-events-none opacity-60",
                  )}
                >
                  <IconUpload className="size-4" />
                  {importing ? importingLabel : importFileLabel}
                  <input
                    type="file"
                    className="sr-only"
                    accept=".pptx,.pdf,.docx"
                    multiple
                    disabled={importing}
                    onChange={(event) => void handleImport(event)}
                  />
                </label>
              </CardContent>
            </Card>
          </div>

          <Card className="min-h-0 border-border/70">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="text-sm">
                {chooseAnotherDeckLabel}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {searchDecksLabel}
              </p>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={searchDecksLabel}
                  placeholder={searchDecksLabel}
                  className="ps-9"
                />
              </div>

              <ScrollArea className="max-h-[430px] pr-3">
                <div className="space-y-4">
                  {query.trim() ? (
                    filteredDecks.flat.length > 0 ? (
                      <div className="space-y-2">
                        {filteredDecks.flat.map((deck) => (
                          <DeckRow
                            key={deck.id}
                            deck={deck}
                            selected={deck.id === selectedReferenceDeckId}
                            onSelect={() => onSelectReferenceDeck(deck.id)}
                            starredLabel={starredLabel}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                        {noMatchingDecksLabel}
                      </div>
                    )
                  ) : (
                    <>
                      {filteredDecks.starred.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {starredLabel}
                          </div>
                          {filteredDecks.starred.map((deck) => (
                            <DeckRow
                              key={deck.id}
                              deck={deck}
                              selected={deck.id === selectedReferenceDeckId}
                              onSelect={() => onSelectReferenceDeck(deck.id)}
                              starredLabel={starredLabel}
                            />
                          ))}
                        </div>
                      )}
                      {filteredDecks.other.length > 0 && (
                        <div className="space-y-2">
                          {filteredDecks.starred.length > 0 && (
                            <Separator className="my-1" />
                          )}
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {otherDecksLabel}
                          </div>
                          {filteredDecks.other.map((deck) => (
                            <DeckRow
                              key={deck.id}
                              deck={deck}
                              selected={deck.id === selectedReferenceDeckId}
                              onSelect={() => onSelectReferenceDeck(deck.id)}
                              starredLabel={starredLabel}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>

              <Separator />
              <SelectionSummary
                icon={<IconPresentation className="size-4" />}
                label={
                  selectedReferenceDeckId
                    ? selectedReferenceDeckLabel
                    : noneLabel
                }
                meta={
                  selectedReferenceDeckIsDefault
                    ? `${referenceDeckLabel}${defaultSuffix}`
                    : selectedReferenceDeckId
                      ? referenceDeckLabel
                      : noneLabel
                }
                onClear={
                  selectedReferenceDeckId
                    ? () => onSelectReferenceDeck(null)
                    : undefined
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col-reverse items-stretch justify-between gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={importing || googleSlidesBusy}
          >
            {skipLabel}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onContinue}
              disabled={importing || googleSlidesBusy}
            >
              {continueLabel}
            </Button>
            <IconArrowRight className="size-4 text-muted-foreground" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectionSummary({
  icon,
  label,
  meta,
  onClear,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  onClear?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      {onClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClear}
          aria-label={`Remove ${label}`}
        >
          <IconX className="size-4" />
        </Button>
      )}
    </div>
  );
}

function DeckRow({
  deck,
  selected,
  onSelect,
  starredLabel,
}: {
  deck: Deck;
  selected: boolean;
  onSelect: () => void;
  starredLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-start transition-colors",
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border/70 bg-background hover:border-foreground/20 hover:bg-accent/35",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        {deck.starred ? (
          <IconStar className="size-4" />
        ) : (
          <IconPresentation className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {deck.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {deck.starred ? starredLabel : ""}
        </span>
      </span>
      {selected ? (
        <IconCheck className="size-4 shrink-0 text-primary" />
      ) : (
        <IconArrowRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
