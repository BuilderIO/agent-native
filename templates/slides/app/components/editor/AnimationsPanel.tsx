import { useMemo, useCallback } from "react";
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
  IconWand,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import type {
  Slide,
  SlideAnimation,
  AnimationType,
} from "@/context/DeckContext";

// ─── HTML parsing helpers ─────────────────────────────────────────────────────

function findContentContainer(root: Element): Element | null {
  const children = Array.from(root.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].children.length >= 2) return children[i];
  }
  return null;
}

interface ParsedElement {
  index: number;
  preview: string;
}

function parseSlideElements(html: string): ParsedElement[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return [];
  const container = findContentContainer(root);
  if (!container) return [];
  return Array.from(container.children).map((child, i) => ({
    index: i,
    preview:
      child.textContent?.replace(/\s+/g, " ").trim().slice(0, 50) ||
      `Element ${i + 1}`,
  }));
}

// ─── Animation type options ───────────────────────────────────────────────────

const ANIM_TYPES: { value: AnimationType; label: string }[] = [
  { value: "appear", label: "Appear" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide Up" },
  { value: "zoom", label: "Zoom" },
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
      className="flex items-center gap-1.5 py-1.5 px-1 rounded-md hover:bg-white/[0.03] group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        tabIndex={-1}
      >
        <IconGripVertical className="w-3.5 h-3.5" />
      </button>

      {/* Step number badge */}
      <span className="text-[9px] font-mono text-white/30 w-3.5 text-center flex-shrink-0">
        {stepNumber}
      </span>

      {/* Element preview */}
      <span className="flex-1 text-[11px] text-white/60 truncate min-w-0">
        {preview || `Element ${anim.elementIndex + 1}`}
      </span>

      {/* Type selector */}
      <select
        value={anim.type}
        onChange={(e) => onChangeType(anim.id, e.target.value as AnimationType)}
        className="text-[10px] bg-white/[0.06] border border-white/[0.08] text-white/60 rounded px-1 py-0.5 outline-none focus:border-white/20 flex-shrink-0"
      >
        {ANIM_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Remove */}
      <button
        onClick={() => onRemove(anim.id)}
        className="text-white/20 hover:text-white/60 flex-shrink-0 opacity-0 group-hover:opacity-100"
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const animations = slide.animations ?? [];
  const availableElements = useMemo(
    () => parseSlideElements(slide.content),
    [slide.content],
  );

  // Map elementIndex → preview text for quick lookup
  const previewByIndex = useMemo(() => {
    const m: Record<number, string> = {};
    availableElements.forEach((el) => {
      m[el.index] = el.preview;
    });
    return m;
  }, [availableElements]);

  const usedIndices = new Set(animations.map((a) => a.elementIndex));

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
    (elementIndex: number) => {
      const newAnim: SlideAnimation = {
        id: nanoid(6),
        elementIndex,
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
      .filter((el) => !usedIndices.has(el.index))
      .map((el) => ({
        id: nanoid(6),
        elementIndex: el.index,
        type: "slide-up" as AnimationType,
      }));
    onUpdateSlide({ animations: [...animations, ...newAnims] });
  }, [availableElements, usedIndices, animations, onUpdateSlide]);

  const clearAll = useCallback(() => {
    onUpdateSlide({ animations: [] });
  }, [onUpdateSlide]);

  const unaddedElements = availableElements.filter(
    (el) => !usedIndices.has(el.index),
  );

  return (
    <div className="w-60 flex flex-col h-full border-l border-white/[0.06] bg-[hsl(240,5%,6%)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/70">Animations</span>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white/60"
          aria-label="Close animations panel"
        >
          <IconX className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Animation list */}
      <div className="flex-1 overflow-y-auto">
        {animations.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-white/25 leading-relaxed">
            No animations yet.
            <br />
            Add elements below to reveal them on click.
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
                    preview={previewByIndex[anim.elementIndex] ?? ""}
                    onRemove={removeAnimation}
                    onChangeType={changeType}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {animations.length > 0 && (
              <button
                onClick={clearAll}
                className="mt-1 w-full text-[10px] text-white/25 hover:text-white/50 py-1"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Available elements to add */}
        {availableElements.length > 0 && (
          <div className="border-t border-white/[0.06] px-2 py-2">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[9px] font-medium text-white/25 uppercase tracking-wider">
                Elements
              </span>
              {unaddedElements.length > 0 && (
                <button
                  onClick={autoFill}
                  className="flex items-center gap-0.5 text-[9px] text-[#609FF8]/70 hover:text-[#609FF8]"
                >
                  <IconWand className="w-2.5 h-2.5" />
                  Auto-fill
                </button>
              )}
            </div>
            {availableElements.map((el) => {
              const added = usedIndices.has(el.index);
              return (
                <button
                  key={el.index}
                  onClick={() => !added && addAnimation(el.index)}
                  disabled={added}
                  className={`flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-[11px] text-left ${
                    added
                      ? "text-white/20 cursor-default"
                      : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
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
          <div className="px-3 py-4 text-center text-[11px] text-white/20">
            No animatable elements detected on this slide.
          </div>
        )}
      </div>
    </div>
  );
}
