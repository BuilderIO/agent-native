import { useT } from "@agent-native/core/client";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconTrash,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { useMemo, useCallback } from "react";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type {
  Slide,
  SlideAnimation,
  AnimationType,
} from "@/context/DeckContext";
import {
  animationElementKey,
  getSlideAnimationTargetKey,
  getSlideAnimationTargetPreview,
  parseSlideAnimationElements,
  type ParsedAnimationElement,
} from "@/lib/slide-animation-elements";

// ─── Animation type options ───────────────────────────────────────────────────

const ANIM_TYPES: { value: AnimationType; labelKey: string }[] = [
  { value: "appear", labelKey: "animations.appear" },
  { value: "fade", labelKey: "animations.fade" },
  { value: "slide-up", labelKey: "animations.slideUp" },
  { value: "zoom", labelKey: "animations.zoom" },
];

// ─── Sortable animation item ──────────────────────────────────────────────────

interface SortableItemProps {
  anim: SlideAnimation;
  stepNumber: number;
  preview: string;
  onRemove: (id: string) => void;
  onChangeType: (id: string, type: AnimationType) => void;
}

function SortableAnimationItem({
  anim,
  stepNumber,
  preview,
  onRemove,
  onChangeType,
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 py-1.5 px-1 rounded-md hover:bg-accent group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/70 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        tabIndex={-1}
      >
        <IconGripVertical className="w-3.5 h-3.5" />
      </button>

      {/* Step number badge */}
      <span className="text-[9px] font-mono text-muted-foreground w-3.5 text-center flex-shrink-0">
        {stepNumber}
      </span>

      {/* Element preview */}
      <span className="flex-1 text-[11px] text-muted-foreground truncate min-w-0">
        {preview ||
          t("animations.elementFallback", { index: anim.elementIndex + 1 })}
      </span>

      {/* Type selector */}
      <Select
        value={anim.type}
        onValueChange={(value) => onChangeType(anim.id, value as AnimationType)}
      >
        <SelectTrigger className="h-auto text-[10px] bg-accent border-border text-muted-foreground rounded px-1.5 py-0.5 flex-shrink-0 w-auto gap-1 min-w-[70px] focus:ring-0 focus:ring-offset-0">
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

      {/* Remove */}
      <button
        onClick={() => onRemove(anim.id)}
        className="text-muted-foreground/70 hover:text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100"
        tabIndex={-1}
      >
        <IconTrash className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface AnimationsPanelProps {
  slide: Slide;
  onUpdateSlide: (updates: Partial<Omit<Slide, "id">>) => void;
  onClose: () => void;
}

export function AnimationsPanel({
  slide,
  onUpdateSlide,
  onClose,
}: AnimationsPanelProps) {
  const t = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const animations = slide.animations ?? [];
  const availableElements = useMemo(
    () => parseSlideAnimationElements(slide.content),
    [slide.content],
  );

  const previewByAnimationId = useMemo(() => {
    const previews: Record<string, string> = {};
    animations.forEach((anim) => {
      previews[anim.id] = getSlideAnimationTargetPreview(slide.content, anim);
    });
    return previews;
  }, [animations, slide.content]);

  const usedTargetKeys = useMemo(() => {
    const keys = new Set<string>();
    animations.forEach((anim) => {
      const key = getSlideAnimationTargetKey(slide.content, anim);
      if (key) keys.add(key);
    });
    return keys;
  }, [animations, slide.content]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = animations.findIndex((a) => a.id === active.id);
      const newIdx = animations.findIndex((a) => a.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      onUpdateSlide({ animations: arrayMove(animations, oldIdx, newIdx) });
    },
    [animations, onUpdateSlide],
  );

  const addAnimation = useCallback(
    (element: ParsedAnimationElement) => {
      const newAnim: SlideAnimation = {
        id: nanoid(6),
        elementIndex: element.index,
        elementPath: element.path,
        type: "slide-up",
      };
      onUpdateSlide({ animations: [...animations, newAnim] });
    },
    [animations, onUpdateSlide],
  );

  const removeAnimation = useCallback(
    (id: string) => {
      onUpdateSlide({ animations: animations.filter((a) => a.id !== id) });
    },
    [animations, onUpdateSlide],
  );

  const changeType = useCallback(
    (id: string, type: AnimationType) => {
      onUpdateSlide({
        animations: animations.map((a) => (a.id === id ? { ...a, type } : a)),
      });
    },
    [animations, onUpdateSlide],
  );

  const autoFill = useCallback(() => {
    const newAnims: SlideAnimation[] = availableElements
      .filter((el) => !usedTargetKeys.has(animationElementKey(el.path)))
      .map((el) => ({
        id: nanoid(6),
        elementIndex: el.index,
        elementPath: el.path,
        type: "slide-up" as AnimationType,
      }));
    onUpdateSlide({ animations: [...animations, ...newAnims] });
  }, [availableElements, usedTargetKeys, animations, onUpdateSlide]);

  const clearAll = useCallback(() => {
    onUpdateSlide({ animations: [] });
  }, [onUpdateSlide]);

  const unaddedElements = availableElements.filter(
    (el) => !usedTargetKeys.has(animationElementKey(el.path)),
  );

  return (
    <div className="w-60 flex flex-col h-full border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-xs font-medium text-foreground/90">
          {t("animations.title")}
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground/70 hover:text-muted-foreground"
          aria-label={t("animations.close")}
        >
          <IconX className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Animation list */}
      <div className="flex-1 overflow-y-auto">
        {animations.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/70 leading-relaxed">
            {t("animations.emptyTitle")}
            <br />
            {t("animations.emptyDescription")}
          </div>
        ) : (
          <div className="px-2 py-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={animations.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {animations.map((anim, i) => (
                  <SortableAnimationItem
                    key={anim.id}
                    anim={anim}
                    stepNumber={i + 1}
                    preview={previewByAnimationId[anim.id] ?? ""}
                    onRemove={removeAnimation}
                    onChangeType={changeType}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {animations.length > 0 && (
              <button
                onClick={clearAll}
                className="mt-1 w-full text-[10px] text-muted-foreground/70 hover:text-muted-foreground py-1"
              >
                {t("animations.clearAll")}
              </button>
            )}
          </div>
        )}

        {/* Available elements to add */}
        {availableElements.length > 0 && (
          <div className="border-t border-border px-2 py-2">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("animations.elements")}
              </span>
              {unaddedElements.length > 0 && (
                <button
                  onClick={autoFill}
                  className="flex items-center gap-0.5 text-[9px] text-[#609FF8]/70 hover:text-[#609FF8]"
                >
                  {t("animations.autoFill")}
                </button>
              )}
            </div>
            {availableElements.map((el) => {
              const added = usedTargetKeys.has(animationElementKey(el.path));
              return (
                <button
                  key={el.index}
                  onClick={() => !added && addAnimation(el)}
                  disabled={added}
                  className={`flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-[11px] text-left ${
                    added
                      ? "text-muted-foreground/70 cursor-default"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <IconPlus
                    className={`w-3 h-3 flex-shrink-0 ${added ? "opacity-0" : ""}`}
                  />
                  <span className="truncate">{el.preview}</span>
                </button>
              );
            })}
          </div>
        )}

        {availableElements.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground/70">
            {t("animations.noAnimatableElements")}
          </div>
        )}
      </div>
    </div>
  );
}
