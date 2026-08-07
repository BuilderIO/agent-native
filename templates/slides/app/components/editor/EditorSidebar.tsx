import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import {
  type AttributedRecentEdit,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { RecentEditHighlights } from "@agent-native/toolkit/collab-ui";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { hashSlideContent, type DeckFitState } from "@shared/slide-fit";
import {
  IconGripVertical,
  IconCopy,
  IconTrash,
  IconLoader2,
} from "@tabler/icons-react";
import { useRef, useEffect } from "react";
import { useCallback } from "react";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";
import GeneratingSlidePreview from "@/components/editor/GeneratingSlidePreview";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import { TAB_ID } from "@/lib/tab-id";

import type { DesignSystemData } from "../../../shared/api";

interface EditorSidebarProps {
  slides: Slide[];
  activeSlideId: string;
  deckId: string;
  onSelectSlide: (id: string) => void;
  onDuplicateSlide: (id: string) => void;
  onDeleteSlide: (id: string) => void;
  /** Viewer-role decks get thumbnails only: no add, duplicate, or delete. */
  readOnly?: boolean;
  /** Presence map: slideId → list of users currently viewing that slide */
  slidePresence?: Map<string, CollabUser[]>;
  /** Lingering recent edits (e.g. agent edits) to highlight over thumbnails. */
  recentEdits?: AttributedRecentEdit[];
  /** Deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
  /** Active deck design system used by slide content tokens. */
  designSystem?: DesignSystemData;
  /** The next slide while the agent is preparing its HTML. */
  generatingSlide?: { index: number; content?: string | null };
  generatingSlideSelected?: boolean;
  onSelectGeneratingSlide?: () => void;
}

const DECK_FIT_STATE_KEYS = [
  appStateKeyForBrowserTab("deck-fit-checks", TAB_ID),
  "deck-fit-checks",
];

/** Extract the slide id from a `{kind:"paths",paths:["slides.<id>"]}` edit. */
function slideIdFromEdit(edit: AttributedRecentEdit): string | null {
  const d = edit.descriptor;
  if (d.kind === "paths" && Array.isArray(d.paths)) {
    for (const p of d.paths) {
      const m = /^slides\.(.+)$/.exec(p);
      if (m) return m[1];
    }
  }
  return null;
}

/** Small presence avatar circle with hover card showing name + email */
function PresenceAvatarTip({
  user,
  size = 16,
}: {
  user: CollabUser;
  size?: number;
}) {
  const avatarUrl = useAvatarUrl(user.email);
  const initial = user.name.slice(0, 2).toUpperCase();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="rounded-full overflow-hidden flex items-center justify-center font-bold text-white/90 flex-shrink-0 ring-1 ring-black/40 cursor-default"
          style={{
            width: size,
            height: size,
            backgroundColor: avatarUrl ? undefined : user.color,
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span style={{ fontSize: size * 0.45 }}>{initial}</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2 p-2">
        <div
          className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
          style={{ backgroundColor: avatarUrl ? undefined : user.color }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              className="w-full h-full object-cover"
            />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[12px] font-medium text-foreground leading-tight">
            {user.name}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {user.email}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Thumbnail overlays sit on top of rendered slide artwork, which is arbitrary
// user content rather than a themed app surface, so they use a fixed scrim.
const THUMB_OVERLAY_CLASS =
  // guard:allow-raw-color — matches the duplicate/delete overlays below.
  "absolute top-2 left-7 rounded bg-black/60 p-1 backdrop-blur-sm border border-white/10 cursor-grab active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100";
// guard:allow-raw-color — same fixed scrim as the class above.
const THUMB_OVERLAY_ICON_CLASS = "w-3 h-3 text-white/60";

function SortableSlideThumb({
  slide,
  index,
  isActive,
  onSelect,
  onDuplicate,
  onDelete,
  registerButtonRef,
  presenceUsers = [],
  aspectRatio,
  designSystem,
  onOverflowChange,
  readOnly = false,
}: {
  slide: Slide;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  registerButtonRef: (slideId: string, node: HTMLButtonElement | null) => void;
  presenceUsers?: CollabUser[];
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onOverflowChange: (info: SlideOverflowInfo) => void;
}) {
  const t = useT();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: slide.id,
    disabled: readOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <button
        ref={(node) => registerButtonRef(slide.id, node)}
        onClick={onSelect}
        onFocus={onSelect}
        aria-label={t("editorSidebar.selectSlide", { number: index + 1 })}
        aria-current={isActive ? "true" : undefined}
        data-slide-thumbnail-id={slide.id}
        className={`w-full text-left flex items-start gap-1.5 p-1.5 rounded-lg transition-[background-color,box-shadow] duration-150 ${
          isActive ? "bg-accent ring-1 ring-[#609FF8]/50" : "hover:bg-accent"
        } focus:outline-none`}
      >
        {/* Index and slide presence share the fixed rail so presence does not resize the row. */}
        <div className="relative flex-shrink-0 w-4 self-stretch">
          <span className="block text-center text-[10px] font-medium leading-5 text-muted-foreground/70">
            {index + 1}
          </span>
          {presenceUsers.length > 0 && (
            <div className="absolute left-1/2 top-5 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
              {presenceUsers.slice(0, 4).map((u, i) => (
                <PresenceAvatarTip key={i} user={u} size={14} />
              ))}
              {presenceUsers.length > 4 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[8px] font-medium leading-none text-muted-foreground ring-1 ring-black/40">
                  +{presenceUsers.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Thumbnail */}
        <div className="flex-1 min-w-0">
          <div
            className="w-full overflow-hidden rounded border"
            style={{
              borderColor:
                presenceUsers.length > 0
                  ? presenceUsers[0].color + "66"
                  : "rgba(255,255,255,0.06)",
            }}
          >
            <SlideRenderer
              slide={slide}
              aspectRatio={aspectRatio}
              designSystem={designSystem}
              onOverflowChange={onOverflowChange}
            />
          </div>
        </div>
      </button>

      {/* Drag handle — overlaid on the thumbnail instead of holding its own
       * column, so the rail stays narrow. Mirrors the action buttons opposite. */}
      {!readOnly && (
        <div {...attributes} {...listeners} className={THUMB_OVERLAY_CLASS}>
          <IconGripVertical className={THUMB_OVERLAY_ICON_CLASS} />
        </div>
      )}

      {/* Actions - always visible on touch devices */}
      {!readOnly && (
        <div className="absolute top-2 right-2 flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                }}
                className="p-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80"
                aria-label={t("editorSidebar.duplicateSlide")}
              >
                <IconCopy className="w-3 h-3 text-white/60" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editorSidebar.duplicate")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="p-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-red-900/80"
                aria-label={t("editorSidebar.deleteSlide")}
              >
                <IconTrash className="w-3 h-3 text-white/60" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editorSidebar.delete")}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function GeneratingSlideSkeleton({
  index,
  aspectRatio,
  designSystem,
  content,
  selected,
  onSelect,
}: {
  index: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  content?: string | null;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={`group relative block w-full rounded-lg text-left transition-colors ${
        selected ? "bg-accent ring-1 ring-ring" : "hover:bg-accent/50"
      }`}
      aria-label={t("editorSidebar.generatingSlide")}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <div className="w-full flex items-start gap-1.5 p-1.5 rounded-lg bg-accent/30">
        <span className="flex-shrink-0 w-4 text-center text-[10px] font-medium leading-5 text-muted-foreground/70">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <GeneratingSlidePreview
            content={content}
            aspectRatio={aspectRatio}
            designSystem={designSystem}
            thumbnail
          />
        </div>
      </div>
    </button>
  );
}

export default function EditorSidebar({
  slides,
  activeSlideId,
  deckId,
  onSelectSlide,
  onDuplicateSlide,
  onDeleteSlide,
  readOnly = false,
  slidePresence,
  recentEdits,
  aspectRatio,
  designSystem,
  generatingSlide,
  generatingSlideSelected = false,
  onSelectGeneratingSlide,
}: EditorSidebarProps) {
  const slideButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const thumbScrollRef = useRef<HTMLDivElement>(null);
  const measurementsRef = useRef(
    new Map<
      string,
      { contentHash: string; info: SlideOverflowInfo; measuredAt: number }
    >(),
  );
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeDeckFitState = useCallback(() => {
    const currentSlideIds = new Set(slides.map((slide) => slide.id));
    const measuredSlides = Object.fromEntries(
      Array.from(measurementsRef.current.entries())
        .filter(([slideId]) => currentSlideIds.has(slideId))
        .map(([slideId, measurement]) => [
          slideId,
          {
            contentHash: measurement.contentHash,
            contentHeight: measurement.info.contentHeight,
            contentWidth: measurement.info.contentWidth,
            viewportHeight: measurement.info.viewportHeight,
            viewportWidth: measurement.info.viewportWidth,
            verticalOverflow: measurement.info.verticalOverflow,
            horizontalOverflow: measurement.info.horizontalOverflow,
            measuredAt: measurement.measuredAt,
          },
        ]),
    );
    const payload: DeckFitState = {
      deckId,
      aspectRatio: aspectRatio ?? "16:9",
      slides: measuredSlides,
    };
    const body = JSON.stringify(payload);
    for (const key of DECK_FIT_STATE_KEYS) {
      fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
        method: "PUT",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Source": TAB_ID,
        },
        body,
      }).catch(() => {});
    }
  }, [aspectRatio, deckId, slides]);

  const handleSlideOverflowChange = useCallback(
    (slide: Slide, info: SlideOverflowInfo) => {
      const contentHash = hashSlideContent(slide.content);
      measurementsRef.current.set(slide.id, {
        contentHash,
        info,
        measuredAt: Date.now(),
      });
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = setTimeout(() => {
        writeTimerRef.current = null;
        writeDeckFitState();
      }, 0);
    },
    [writeDeckFitState],
  );

  useEffect(() => {
    measurementsRef.current.clear();
  }, [deckId, aspectRatio]);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      for (const key of DECK_FIT_STATE_KEYS) {
        fetch(agentNativePath(`/_agent-native/application-state/${key}`), {
          method: "DELETE",
          keepalive: true,
          headers: { "X-Request-Source": TAB_ID },
        }).catch(() => {});
      }
    };
  }, []);

  // Resolve a recent-edit descriptor (`slides.<id>`) to the on-screen rect of
  // that slide's thumbnail button, relative to the scroll container, so the
  // shared RecentEditHighlights overlay can draw a fading "AI edited" ring.
  const resolveThumbRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const slideId = slideIdFromEdit(edit);
      if (!slideId) return null;
      const node = slideButtonRefs.current.get(slideId);
      if (!node) return null;
      return node.getBoundingClientRect();
    },
    [],
  );
  const registerSlideButton = useCallback(
    (slideId: string, node: HTMLButtonElement | null) => {
      if (node) {
        slideButtonRefs.current.set(slideId, node);
      } else {
        slideButtonRefs.current.delete(slideId);
      }
    },
    [],
  );

  // Arrow key navigation for slides
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // Don't intercept if user is typing in an input/textarea or contenteditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;

      e.preventDefault();
      const currentIndex = slides.findIndex((s) => s.id === activeSlideId);
      if (currentIndex === -1) return;

      const nextIndex =
        e.key === "ArrowUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(slides.length - 1, currentIndex + 1);

      if (nextIndex !== currentIndex) {
        const nextSlideId = slides[nextIndex].id;
        onSelectSlide(nextSlideId);
        requestAnimationFrame(() => {
          slideButtonRefs.current.get(nextSlideId)?.focus({
            preventScroll: true,
          });
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [slides, activeSlideId, onSelectSlide]);

  return (
    <div className="flex h-full min-h-0 w-48 flex-shrink-0 flex-col border-r border-border/70 bg-background/95 sm:w-52">
      <div
        ref={thumbScrollRef}
        className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2"
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {slides.map((slide, index) => (
            <SortableSlideThumb
              key={slide.id}
              slide={slide}
              index={index}
              isActive={slide.id === activeSlideId}
              onSelect={() => onSelectSlide(slide.id)}
              onDuplicate={() => onDuplicateSlide(slide.id)}
              onDelete={() => onDeleteSlide(slide.id)}
              readOnly={readOnly}
              registerButtonRef={registerSlideButton}
              presenceUsers={slidePresence?.get(slide.id) ?? []}
              aspectRatio={aspectRatio}
              designSystem={designSystem}
              onOverflowChange={(info) =>
                handleSlideOverflowChange(slide, info)
              }
            />
          ))}
        </SortableContext>
        {generatingSlide && (
          <GeneratingSlideSkeleton
            index={generatingSlide.index}
            aspectRatio={aspectRatio}
            designSystem={designSystem}
            content={generatingSlide.content}
            selected={generatingSlideSelected}
            onSelect={onSelectGeneratingSlide}
          />
        )}
        {/* Fading "AI edited" highlights over the thumbnails of just-edited
            slides (the component handles the fade + name/color tag). */}
        {recentEdits && recentEdits.length > 0 && (
          <RecentEditHighlights
            edits={recentEdits}
            resolveRect={resolveThumbRect}
            containerRef={thumbScrollRef}
          />
        )}
      </div>
    </div>
  );
}
