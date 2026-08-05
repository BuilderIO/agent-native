import {
  IconArrowRight,
  IconPalette,
  IconPresentation,
  IconUpload,
} from "@tabler/icons-react";
import type { ChangeEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Deck } from "@/context/DeckContext";
import type { RecentReference } from "@/lib/recent-references";
import { cn } from "@/lib/utils";

export interface NewDeckReferenceSelection {
  designSystemId?: string | null;
  referenceDeckId?: string | null;
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
  importFileLabel: string;
  importingLabel: string;
  skipLabel: string;
  defaultSuffix: string;
  starredLabel: string;
  otherDecksLabel: string;
  description: string;
  promptNote?: string;
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
  importFileLabel,
  importingLabel,
  skipLabel,
  defaultSuffix,
  starredLabel,
  otherDecksLabel,
  description,
  promptNote,
}: NewDeckReferenceStepProps) {
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
  const defaultReferenceKeys = new Set(
    [
      defaultDesignSystemId ? `design-system:${defaultDesignSystemId}` : null,
      defaultReferenceDeckId ? `deck:${defaultReferenceDeckId}` : null,
    ].filter((value): value is string => value !== null),
  );
  const visibleRecentOptions = recentOptions.filter(
    ({ reference }) =>
      !defaultReferenceKeys.has(`${reference.kind}:${reference.id}`),
  );
  const starredDecks = decks.filter((deck) => deck.starred);
  const otherDecks = decks.filter((deck) => !deck.starred);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await onImport(files);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-32px))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {(defaultDesignSystemId || defaultReferenceDeckId) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {defaultDesignSystemId &&
                designSystemById.has(defaultDesignSystemId) && (
                  <ReferenceCard
                    icon={<IconPalette className="size-4" />}
                    label={
                      designSystemById.get(defaultDesignSystemId)?.title ??
                      designSystemLabel
                    }
                    meta={`${designSystemLabel}${defaultSuffix}`}
                    onClick={() =>
                      onSelect({
                        designSystemId: defaultDesignSystemId,
                        referenceDeckId: null,
                      })
                    }
                  />
                )}
              {defaultReferenceDeckId &&
                deckById.has(defaultReferenceDeckId) && (
                  <ReferenceCard
                    icon={<IconPresentation className="size-4" />}
                    label={deckById.get(defaultReferenceDeckId)?.title ?? ""}
                    meta={`${referenceDeckLabel}${defaultSuffix}`}
                    onClick={() =>
                      onSelect({
                        designSystemId: null,
                        referenceDeckId: defaultReferenceDeckId,
                      })
                    }
                  />
                )}
            </div>
          )}

          {visibleRecentOptions.length > 0 && (
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleRecentOptions.map(({ reference, item }) => (
                  <ReferenceCard
                    key={`${reference.kind}:${reference.id}`}
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
                    onClick={() =>
                      onSelect(
                        reference.kind === "design-system"
                          ? {
                              designSystemId: reference.id,
                              referenceDeckId: null,
                            }
                          : {
                              designSystemId: null,
                              referenceDeckId: reference.id,
                            },
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {decks.length > 0 && (
            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {referenceDeckLabel}
              </span>
              <Select
                onValueChange={(value) =>
                  onSelect({ designSystemId: null, referenceDeckId: value })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={chooseDeckLabel} />
                </SelectTrigger>
                <SelectContent>
                  {starredDecks.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{starredLabel}</SelectLabel>
                      {starredDecks.map((deck) => (
                        <SelectItem key={deck.id} value={deck.id}>
                          {deck.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {otherDecks.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{otherDecksLabel}</SelectLabel>
                      {otherDecks.map((deck) => (
                        <SelectItem key={deck.id} value={deck.id}>
                          {deck.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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
          </div>
        </div>

        {promptNote && (
          <p className="truncate border-t border-border pt-3 text-xs text-muted-foreground">
            {promptNote}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onSkip}>
            {skipLabel}
          </Button>
          <IconArrowRight className="size-4 text-muted-foreground" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceCard({
  icon,
  label,
  meta,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-start transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
      </span>
      <IconArrowRight className="ms-auto size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
