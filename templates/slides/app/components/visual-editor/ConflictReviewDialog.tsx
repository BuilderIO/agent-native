import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isAgentSlideContent,
  useDecks,
  type DeckContentConflict,
  type DeckContentConflictChoice,
  type DeckFieldConflict,
  type Slide,
} from "@/context/DeckContext";
import { useDeckDesignSystem } from "@/hooks/use-deck-design-system";
import type { AspectRatio } from "@/lib/aspect-ratios";

export type ReviewableConflict =
  | { kind: "content"; conflict: DeckContentConflict }
  | { kind: "field"; conflict: DeckFieldConflict };

interface ConflictReviewDialogProps {
  deckId: string;
  review: ReviewableConflict;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConflictReviewDialog({
  deckId,
  review,
  open,
  onOpenChange,
}: ConflictReviewDialogProps) {
  const t = useT();
  const { getDeck, resolveDeckContentConflict, resolveDeckFieldConflict } =
    useDecks();
  const deck = getDeck(deckId);
  const { designSystem } = useDeckDesignSystem(
    open ? deck?.designSystemId : null,
    deckId,
  );
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(false);

  const { slideId } = review.conflict;
  const slides = deck?.slides ?? [];
  const index = slides.findIndex((slide) => slide.id === slideId);
  const baseSlide = index < 0 ? undefined : slides.at(index);
  const number = Math.max(1, index + 1);
  const byAgent =
    review.kind === "content" &&
    typeof review.conflict.remoteContent === "string" &&
    isAgentSlideContent(deckId, slideId, review.conflict.remoteContent);
  const notes = review.kind === "field" && review.conflict.field === "notes";

  const title = notes
    ? t(
        byAgent
          ? "editorToolbar.conflictNotesTitleAgent"
          : "editorToolbar.conflictNotesTitleSomeone",
        { number },
      )
    : t(
        byAgent
          ? "editorToolbar.conflictTitleAgent"
          : "editorToolbar.conflictTitleSomeone",
        { number },
      );

  const versionSlide = (side: "local" | "remote"): Slide | null => {
    if (!baseSlide) return null;
    if (review.kind === "content") {
      const content =
        side === "local"
          ? review.conflict.localContent
          : review.conflict.remoteContent;
      return typeof content === "string" ? { ...baseSlide, content } : null;
    }
    const value =
      side === "local"
        ? review.conflict.localValue
        : review.conflict.remoteValue;
    const slide: Slide = { ...baseSlide };
    if (value === undefined || value === null) {
      Reflect.deleteProperty(slide, review.conflict.field);
    } else {
      Object.assign(slide, { [review.conflict.field]: value });
    }
    return slide;
  };

  const resolve = async (choice: DeckContentConflictChoice) => {
    if (resolving) return;
    setResolving(true);
    setFailed(false);
    try {
      const result =
        review.kind === "content"
          ? await resolveDeckContentConflict(deckId, slideId, choice)
          : await resolveDeckFieldConflict(
              deckId,
              slideId,
              review.conflict.field,
              choice,
            );
      if (result.status === "resolved") onOpenChange(false);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setResolving(false);
    }
  };

  const renderVersion = (side: "local" | "remote") => {
    const slide = versionSlide(side);
    return (
      <figure className="min-w-0 space-y-1.5">
        <figcaption className="text-xs font-medium text-muted-foreground">
          {side === "local"
            ? t("editorToolbar.conflictYourVersion")
            : t(
                byAgent
                  ? "editorToolbar.conflictAgentVersion"
                  : "editorToolbar.conflictTheirVersion",
              )}
        </figcaption>
        {notes ? (
          <p
            data-conflict-version={side}
            className="max-h-48 min-h-24 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 text-sm"
          >
            {typeof slide?.notes === "string" && slide.notes
              ? slide.notes
              : t("editorToolbar.conflictNoNotes")}
          </p>
        ) : slide ? (
          <div data-conflict-version={side}>
            <SlideRenderer
              slide={slide}
              thumbnail
              designSystem={designSystem}
              aspectRatio={deck?.aspectRatio as AspectRatio | undefined}
              slidePosition={{ number, count: slides.length }}
              className="border border-border"
            />
          </div>
        ) : (
          <div
            data-conflict-version={side}
            className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
          >
            {t("editorToolbar.conflictSlideDeleted")}
          </div>
        )}
      </figure>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !resolving && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {renderVersion("local")}
          {renderVersion("remote")}
        </div>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("editorToolbar.conflictResolveFailed")}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={resolving}
            onClick={() => void resolve("use-latest")}
          >
            {t(
              byAgent
                ? "editorToolbar.conflictKeepAgentVersion"
                : "editorToolbar.conflictKeepTheirVersion",
            )}
          </Button>
          <Button
            type="button"
            disabled={resolving}
            onClick={() => void resolve("keep-mine")}
          >
            {t("editorToolbar.conflictKeepMyVersion")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
