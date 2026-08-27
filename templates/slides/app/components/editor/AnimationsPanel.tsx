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
  getSlideAnimationTargetKey,
  getSlideAnimationTargetPreview,
  resolveSlideAnimationTargets,
  type SelectedAnimationTarget,
} from "@/lib/slide-animation-elements";

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

          <Select value="on-click" onValueChange={() => {}}>
            <SelectTrigger
              className="h-12 w-full rounded-lg border-border bg-background px-3 text-base"
              aria-label={t("animations.trigger")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on-click">
                {t("animations.onClick")}
              </SelectItem>
            </SelectContent>
          </Select>

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
  const previewCleanupRef = useRef<(() => void) | null>(null);

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
      onUpdateSlide({ animations: arrayMove(animations, oldIndex, newIndex) });
    },
    [animations, onUpdateSlide],
  );

  const addAnimation = useCallback(() => {
    if (!selectedTarget || selectedAnimation) return;
    const animation: SlideAnimation = {
      id: nanoid(6),
      elementIndex: selectedTarget.elementIndex,
      elementPath: selectedTarget.elementPath,
      type: "appear",
    };
    onUpdateSlide({ animations: [...animations, animation] });
    setExpandedAnimationId(animation.id);
  }, [animations, onUpdateSlide, selectedAnimation, selectedTarget]);

  const removeAnimation = useCallback(
    (id: string) => {
      onUpdateSlide({
        animations: animations.filter((animation) => animation.id !== id),
      });
      setExpandedAnimationId((current) => (current === id ? null : current));
    },
    [animations, onUpdateSlide],
  );

  const changeType = useCallback(
    (id: string, type: AnimationType) => {
      onUpdateSlide({
        animations: animations.map((animation) =>
          animation.id === id ? { ...animation, type } : animation,
        ),
      });
    },
    [animations, onUpdateSlide],
  );

  const changeByParagraph = useCallback(
    (id: string, byParagraph: boolean) => {
      onUpdateSlide({
        animations: animations.map((animation) =>
          animation.id === id ? { ...animation, byParagraph } : animation,
        ),
      });
    },
    [animations, onUpdateSlide],
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

  const playAnimations = useCallback(() => {
    stopPreview();
    const root = document.querySelector<HTMLElement>(
      "[data-main-slide-canvas] .fmd-slide",
    );
    const resolved = root
      ? resolveSlideAnimationTargets(root, animations)
      : null;
    if (!resolved) return;

    const originals = resolved.flatMap(({ element }) => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        return [];
      }
      return [
        {
          element,
          opacity: element.style.opacity,
          pointerEvents: element.style.pointerEvents,
          transition: element.style.transition,
        },
      ];
    });
    if (originals.length !== resolved.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let index = 0;
    const restore = () => {
      if (timer) clearTimeout(timer);
      for (const original of originals) {
        original.element.style.opacity = original.opacity;
        original.element.style.pointerEvents = original.pointerEvents;
        original.element.style.transition = original.transition;
      }
    };
    const cleanup = () => {
      restore();
      if (previewCleanupRef.current === cleanup) {
        previewCleanupRef.current = null;
      }
    };
    previewCleanupRef.current = cleanup;

    for (const { element } of originals) {
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
    }

    const revealNext = () => {
      const target = originals[index];
      if (!target) {
        cleanup();
        return;
      }
      target.element.style.transition = "opacity 300ms ease";
      target.element.style.opacity = "1";
      target.element.style.pointerEvents = "auto";
      index += 1;
      timer = setTimeout(revealNext, 450);
    };
    revealNext();
  }, [animations, stopPreview]);

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

      <div className="shrink-0 border-t border-border p-4">
        <Button
          type="button"
          className="h-10 gap-2"
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
