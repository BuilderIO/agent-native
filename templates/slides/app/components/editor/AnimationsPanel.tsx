import { useT } from "@agent-native/core/client/i18n";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconChevronDown,
  IconChevronRight,
  IconGripVertical,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getRenderedSlideSource } from "@/components/deck/SlideRenderer";
import { setBuildState } from "@/components/presentation/slide-build-steps";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AnimationType,
  Slide,
  SlideAnimation,
} from "@/context/DeckContext";
import {
  animationElementKey,
  getElementPreview,
  getSlideAnimationTargetKey,
  getSlideAnimationTargetPreview,
  resolveRevealSteps,
  revealStepsOf,
  storedOrdinalAtPath,
  type RevealUnresolvedReason,
  type SelectedAnimationTarget,
} from "@/lib/slide-animation-elements";

// How long each reveal stays on screen in Play before the next one starts.
const PREVIEW_STEP_MS = 450;

const REASON_LABEL_KEY: Record<RevealUnresolvedReason, string> = {
  "stale-path": "animations.issueStalePath",
  "missing-element": "animations.issueMissingElement",
  "duplicate-after-expansion": "animations.issueDuplicate",
};

// Same rule as server/lib/validate-slide-animations.ts: a reveal keeps its identity
// while its id and target stay the same.
function revealIdentity(animation: SlideAnimation): string {
  return JSON.stringify([
    animation.id,
    animation.elementIndex,
    animation.elementPath ?? null,
  ]);
}

const ANIM_TYPES: { value: AnimationType; labelKey: string }[] = [
  { value: "appear", labelKey: "animations.appear" },
  { value: "fade", labelKey: "animations.fade" },
  { value: "slide-up", labelKey: "animations.slideUp" },
  { value: "zoom", labelKey: "animations.zoom" },
];

interface SortableItemProps {
  anim: SlideAnimation;
  expanded: boolean;
  preview: string;
  /** Why this reveal does not resolve in the slide, or null. */
  issue: RevealUnresolvedReason | null;
  /** The paragraphs a "By paragraph" reveal steps through, in order. */
  paragraphs: string[];
  stepNumber: number;
  onChangeType: (id: string, type: AnimationType) => void;
  onChangeByParagraph: (id: string, byParagraph: boolean) => void;
  onRemove: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}

function SortableAnimationItem({
  anim,
  expanded,
  preview,
  issue,
  paragraphs,
  stepNumber,
  onChangeType,
  onChangeByParagraph,
  onRemove,
  onToggleExpanded,
}: SortableItemProps) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: anim.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
      }}
      className="border-b border-border bg-background"
    >
      <div className="flex min-h-14 items-center gap-2 px-3 py-3">
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={
            expanded ? t("animations.collapse") : t("animations.expand")
          }
          onClick={() => onToggleExpanded(anim.id)}
        >
          {expanded ? (
            <IconChevronDown className="size-5" />
          ) : (
            <IconChevronRight className="size-5" />
          )}
        </button>
        <span className="w-4 shrink-0 text-xs text-muted-foreground/60">
          {stepNumber}
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left text-sm text-foreground"
          title={
            preview ||
            t("animations.elementFallback", { index: anim.elementIndex + 1 })
          }
          onClick={() => onToggleExpanded(anim.id)}
        >
          <span className="block truncate">
            {t(
              ANIM_TYPES.find((type) => type.value === anim.type)?.labelKey ??
                "animations.appear",
            )}
            <span className="text-muted-foreground">
              {` (${t("animations.onClick")})`}
            </span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {preview ||
              t("animations.elementFallback", {
                index: anim.elementIndex + 1,
              })}
          </span>
          {issue && (
            <span className="block text-xs text-destructive">
              {t(REASON_LABEL_KEY[issue])}
            </span>
          )}
        </button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 touch-none cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
          aria-label={t("animations.reorder")}
        >
          <IconGripVertical className="size-5" />
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("animations.remove")}
          onClick={() => onRemove(anim.id)}
        >
          <IconTrash className="size-4" />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 pb-5 pt-4">
          <Select
            value={anim.type}
            onValueChange={(value) =>
              onChangeType(anim.id, value as AnimationType)
            }
          >
            <SelectTrigger
              className="h-12 w-full rounded-lg border-border bg-background px-3 text-base"
              aria-label={t("animations.effect")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANIM_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {t(type.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* The Trigger dropdown is hidden. It offered only "On click", and
              "After previous" and "With previous" are not implemented or
              measured against Google Slides yet, so the control had no effect. */}

          <label className="flex items-center gap-3 px-0.5 py-2 text-base text-foreground">
            <input
              type="checkbox"
              checked={Boolean(anim.byParagraph)}
              onChange={(event) =>
                onChangeByParagraph(anim.id, event.target.checked)
              }
              className="size-5 accent-primary"
            />
            {t("animations.byParagraph")}
          </label>

          {anim.byParagraph && paragraphs.length > 0 && (
            <ol className="space-y-1 pl-7 text-sm text-muted-foreground">
              {paragraphs.map((paragraph, index) => (
                <li key={index} className="truncate">
                  {index + 1}. {paragraph}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

interface AnimationsPanelProps {
  slide: Slide;
  selectedTarget?: SelectedAnimationTarget | null;
  onUpdateSlide: (updates: Partial<Omit<Slide, "id">>) => void;
  onClose: () => void;
}

export function AnimationsPanel({
  slide,
  selectedTarget = null,
  onUpdateSlide,
  onClose,
}: AnimationsPanelProps) {
  const t = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const animations = slide.animations ?? [];
  const [expandedAnimationId, setExpandedAnimationId] = useState<string | null>(
    null,
  );
  // Why the last change was refused. The change was not applied, so this is
  // not a fault in the stored reveals. Cleared when a change saves.
  const [refusedChange, setRefusedChange] =
    useState<RevealUnresolvedReason | null>(null);
  // Why Play did not start while the stored reveals resolve. Cleared when Play starts.
  const [playRefusal, setPlayRefusal] = useState<RevealUnresolvedReason | null>(
    null,
  );
  const previewCleanupRef = useRef<(() => void) | null>(null);

  // Reveals resolve against the stored HTML, the same HTML playback uses.
  const storedRoot = useMemo(
    () =>
      new DOMParser()
        .parseFromString(slide.content, "text/html")
        .querySelector(".fmd-slide"),
    [slide.content],
  );
  const outcomes = useMemo(
    () => resolveRevealSteps(storedRoot, animations),
    [animations, storedRoot],
  );
  const unresolvedReason =
    outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.reason]))[0] ??
    null;
  const shownPlayReason = unresolvedReason ?? playRefusal;

  const issueByAnimationId = useMemo(() => {
    const issues: Record<string, RevealUnresolvedReason> = {};
    outcomes.forEach((outcome, index) => {
      const animation = animations[index];
      if (!outcome.ok && animation) issues[animation.id] = outcome.reason;
    });
    return issues;
  }, [animations, outcomes]);

  // The paragraph list is the same steps playback runs.
  const paragraphsByAnimationId = useMemo(() => {
    const paragraphs: Record<string, string[]> = {};
    outcomes.forEach((outcome, index) => {
      const animation = animations[index];
      if (!outcome.ok || !animation) return;
      paragraphs[animation.id] = outcome.steps.map((step, stepIndex) =>
        getElementPreview(step.element, `Element ${stepIndex + 1}`),
      );
    });
    return paragraphs;
  }, [animations, outcomes]);

  const selectedTargetKey = selectedTarget
    ? animationElementKey(selectedTarget.elementPath)
    : null;
  const selectedAnimation = useMemo(
    () =>
      selectedTargetKey
        ? (animations.find(
            (animation) =>
              getSlideAnimationTargetKey(slide.content, animation) ===
              selectedTargetKey,
          ) ?? null)
        : null,
    [animations, selectedTargetKey, slide.content],
  );

  useEffect(() => {
    if (selectedAnimation) setExpandedAnimationId(selectedAnimation.id);
  }, [selectedAnimation]);

  // A list is refused only when it introduces a reveal that does not resolve. A
  // reveal the stored list already had unresolved may stay or leave, so a partial
  // repair saves. A refused change is not applied; the reason shows until a save
  // goes through.
  const commitAnimations = useCallback(
    (next: SlideAnimation[]): boolean => {
      const alreadyUnresolved = new Set(
        outcomes.flatMap((outcome, index) =>
          outcome.ok ? [] : [revealIdentity(animations[index]!)],
        ),
      );
      const [failed] = resolveRevealSteps(storedRoot, next).flatMap(
        (outcome, index) => {
          if (outcome.ok) return [];
          return alreadyUnresolved.has(revealIdentity(next[index]!))
            ? []
            : [outcome.reason];
        },
      );
      if (failed) {
        setRefusedChange(failed);
        return false;
      }
      setRefusedChange(null);
      setPlayRefusal(null);
      onUpdateSlide({ animations: next });
      return true;
    },
    [animations, onUpdateSlide, outcomes, storedRoot],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = animations.findIndex(
        (animation) => animation.id === active.id,
      );
      const newIndex = animations.findIndex(
        (animation) => animation.id === over.id,
      );
      if (oldIndex === -1 || newIndex === -1) return;
      commitAnimations(arrayMove(animations, oldIndex, newIndex));
    },
    [animations, commitAnimations],
  );

  const addAnimation = useCallback(() => {
    if (!selectedTarget || selectedAnimation) return;
    const animation: SlideAnimation = {
      id: nanoid(6),
      elementIndex: selectedTarget.elementIndex,
      elementPath: selectedTarget.elementPath,
      type: "appear",
    };
    if (commitAnimations([...animations, animation])) {
      setExpandedAnimationId(animation.id);
    }
  }, [animations, commitAnimations, selectedAnimation, selectedTarget]);

  const removeAnimation = useCallback(
    (id: string) => {
      commitAnimations(animations.filter((animation) => animation.id !== id));
      setExpandedAnimationId((current) => (current === id ? null : current));
    },
    [animations, commitAnimations],
  );

  const changeType = useCallback(
    (id: string, type: AnimationType) => {
      commitAnimations(
        animations.map((animation) =>
          animation.id === id ? { ...animation, type } : animation,
        ),
      );
    },
    [animations, commitAnimations],
  );

  const changeByParagraph = useCallback(
    (id: string, byParagraph: boolean) => {
      commitAnimations(
        animations.map((animation) =>
          animation.id === id ? { ...animation, byParagraph } : animation,
        ),
      );
    },
    [animations, commitAnimations],
  );

  const previewByAnimationId = useMemo(() => {
    const previews: Record<string, string> = {};
    for (const animation of animations) {
      previews[animation.id] = getSlideAnimationTargetPreview(
        slide.content,
        animation,
      );
    }
    return previews;
  }, [animations, slide.content]);

  const stopPreview = useCallback(() => {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
  }, []);

  // Play runs on a copy of the slide laid over the canvas. The canvas and the
  // stored content are never touched, so a save during Play stores no preview.
  // Each step is found in the copy by its source stamp, the link from the
  // stored HTML to the rendered DOM.
  const playAnimations = useCallback(() => {
    stopPreview();
    if (unresolvedReason) {
      // The alert already shows the stored reveal's reason, so a refused change
      // no longer describes the state the viewer is looking at.
      setRefusedChange(null);
      return;
    }
    // The list plays, so an earlier refusal no longer describes it.
    setRefusedChange(null);
    setPlayRefusal(null);
    const canvas = document.querySelector<HTMLElement>(
      "[data-main-slide-canvas] .fmd-slide",
    );
    const scope = canvas?.closest<HTMLElement>("[data-slide-content-scope]");
    const slideBox = scope?.parentElement;
    if (!canvas || !scope || !slideBox || !getRenderedSlideSource(scope)) {
      return;
    }
    const width = slideBox.offsetWidth;
    const height = slideBox.offsetHeight;
    if (!width || !height) return;

    const steps = revealStepsOf(outcomes);
    const copy = slideBox.cloneNode(true) as HTMLElement;
    const elements = steps.map((step) => {
      const ordinal = storedOrdinalAtPath(slide.content, step.path);
      return ordinal === null
        ? null
        : copy.querySelector(`[data-src-i$=":${ordinal}"]`);
    });
    if (elements.some((element) => element === null)) {
      setPlayRefusal("missing-element");
      return;
    }
    const targets = elements as Element[];
    const reveals = steps.map((step) => step.animation);

    const rect = slideBox.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-slide-play-preview", "");
    overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${width}px;height:${height}px;transform:scale(${rect.width / width});transform-origin:0 0;z-index:2147483000;`;
    overlay.appendChild(copy);
    document.body.appendChild(overlay);

    let shown = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function stop() {
      if (timer) clearTimeout(timer);
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
      if (previewCleanupRef.current === stop) previewCleanupRef.current = null;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") stop();
    }
    function revealNext() {
      if (shown < targets.length) {
        setBuildState(targets, reveals, shown + 1, shown);
        shown += 1;
      }
      timer = setTimeout(
        shown < targets.length ? revealNext : stop,
        PREVIEW_STEP_MS,
      );
    }

    setBuildState(targets, reveals, 0, null);
    overlay.addEventListener("click", stop);
    document.addEventListener("keydown", onKeyDown);
    previewCleanupRef.current = stop;
    revealNext();
  }, [outcomes, slide.content, stopPreview, unresolvedReason]);

  useEffect(() => stopPreview, [stopPreview]);

  const addButtonLabel = selectedTarget
    ? t("animations.addTransition")
    : t("animations.selectObject");

  return (
    <div className="flex h-full w-72 min-w-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t("animations.title")}
        </h2>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label={t("animations.close")}
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border p-4">
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-start gap-2"
            disabled={!selectedTarget || Boolean(selectedAnimation)}
            onClick={addAnimation}
          >
            <IconPlus className="size-4 text-primary" />
            {addButtonLabel}
          </Button>
        </div>

        {animations.length === 0 ? (
          <p className="px-4 py-8 text-sm leading-6 text-muted-foreground">
            {t("animations.emptyDescription")}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={animations.map((animation) => animation.id)}
              strategy={verticalListSortingStrategy}
            >
              {animations.map((animation, index) => (
                <SortableAnimationItem
                  key={animation.id}
                  anim={animation}
                  expanded={expandedAnimationId === animation.id}
                  preview={previewByAnimationId[animation.id] ?? ""}
                  issue={issueByAnimationId[animation.id] ?? null}
                  paragraphs={paragraphsByAnimationId[animation.id] ?? []}
                  stepNumber={index + 1}
                  onChangeType={changeType}
                  onChangeByParagraph={changeByParagraph}
                  onRemove={removeAnimation}
                  onToggleExpanded={(id) =>
                    setExpandedAnimationId((current) =>
                      current === id ? null : id,
                    )
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border p-4">
        {refusedChange ? (
          <p role="alert" className="text-sm text-destructive">
            {t(REASON_LABEL_KEY[refusedChange])}{" "}
            {t("animations.changeNotApplied")}
          </p>
        ) : (
          shownPlayReason && (
            <p role="alert" className="text-sm text-destructive">
              {t(REASON_LABEL_KEY[shownPlayReason])} {t("animations.blocked")}
            </p>
          )
        )}
        <Button
          type="button"
          className="h-10 w-full gap-2"
          disabled={animations.length === 0}
          onClick={playAnimations}
        >
          <IconPlayerPlay className="size-4" />
          {t("animations.play")}
        </Button>
      </div>
    </div>
  );
}
