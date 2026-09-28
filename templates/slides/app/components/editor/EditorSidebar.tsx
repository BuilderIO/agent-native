import { agentNativePath } from "@agent-native/core/client/api-path";
import type {
  AttributedRecentEdit,
  CollabUser,
} from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { LazyChunkErrorBoundary } from "@agent-native/core/client/lazy-chunk-error-boundary";
import { DEFAULT_AGENT_IDENTITY } from "@agent-native/toolkit/collab-ui";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { hashSlideContent, type DeckFitState } from "@shared/slide-fit";
import { IconEyeOff } from "@tabler/icons-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";
import { AiEditingMarker } from "@/components/editor/AiEditingMarker";
import { DeferredPopoverFallback } from "@/components/editor/DeferredPopoverFallback";
import GeneratingSlidePreview from "@/components/editor/GeneratingSlidePreview";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { defaultSlideContent, type Slide } from "@/context/DeckContext";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import { DeferredAddSlidePopover } from "@/lib/deferred-editor-surfaces";
import { TAB_ID } from "@/lib/tab-id";
import { shortcutLabel } from "@/lib/utils";

import type { DesignSystemData } from "../../../shared/api";
import { isSlideTextEditingTarget } from "./slide-text-targets";

interface EditorSidebarProps {
  slides: Slide[];
  activeSlideId: string;
  deckId: string;
  deckTitle: string;
  selectedSlideIds?: string[];
  onSelectSlide: (id: string, options?: SlideSelectionOptions) => void;
  readOnly?: boolean;
  slidePresence?: Map<string, CollabUser[]>;
  recentEdits?: AttributedRecentEdit[];
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  generatingSlide?: { index: number };
  generatingSlideSelected?: boolean;
  onSelectGeneratingSlide?: () => void;
  describeSlideId: string | null;
  onCloseDescribe: () => void;
  onAddSlideGeneratingChange?: (
    generating: boolean,
    targetSlideId: string | null,
  ) => void;
  aiGeneratingSlideId?: string | null;
  /** Resolves once a just-inserted blank slide has actually reached the
   *  server, so the agent's update-slide request can't race the add-slide
   *  persistence. */
  onAwaitAddSlidePersisted?: () => Promise<void>;
  onRemoveFailedSlide?: (slideId: string) => void;
  addSlideAgentSubmit: (message: string, context: string) => void;
  hasSlideClipboard?: boolean;
  onCutSlide?: (slideIds: string[]) => void;
  onCopySlide?: (slideIds: string[]) => void;
  onPasteSlide?: (slideId: string) => void;
  onDeleteSlide?: (slideIds: string[]) => void;
  onNewSlideAfter?: (slideId: string) => void;
  onDuplicateSlide?: (slideIds: string[]) => void;
  onReorderSlides?: (
    activeSlideId: string,
    overSlideId: string,
    selectedSlideIds?: string[],
  ) => void;
  altDragSlideId?: string | null;
  onToggleSkipSlide?: (slideIds: string[], skipped: boolean) => void;
}

export interface SlideSelectionOptions {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export function getSlideSelection({
  slideIds,
  selectedSlideIds,
  anchorSlideId,
  targetSlideId,
  shiftKey = false,
  metaKey = false,
  ctrlKey = false,
}: {
  slideIds: string[];
  selectedSlideIds: string[];
  anchorSlideId: string | null;
  targetSlideId: string;
} & SlideSelectionOptions): {
  selectedSlideIds: string[];
  anchorSlideId: string;
} {
  const targetIndex = slideIds.indexOf(targetSlideId);
  if (targetIndex === -1) {
    return { selectedSlideIds, anchorSlideId: targetSlideId };
  }

  const anchorIndex = slideIds.indexOf(anchorSlideId ?? "");
  let nextIds: string[];
  let nextAnchor = targetSlideId;
  if (shiftKey && anchorIndex !== -1) {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    nextIds = slideIds.slice(start, end + 1);
    nextAnchor = anchorSlideId!;
  } else if (metaKey || ctrlKey) {
    const selected = new Set(selectedSlideIds);
    if (selected.has(targetSlideId) && selected.size > 1) {
      selected.delete(targetSlideId);
    } else {
      selected.add(targetSlideId);
    }
    nextIds = slideIds.filter((id) => selected.has(id));
  } else {
    nextIds = [targetSlideId];
  }

  return { selectedSlideIds: nextIds, anchorSlideId: nextAnchor };
}

export function isContiguousSlideSelection(
  slideIds: string[],
  selectedSlideIds: string[],
): boolean {
  const selected = new Set(selectedSlideIds);
  const indexes = slideIds.reduce<number[]>((result, slideId, index) => {
    if (selected.has(slideId)) result.push(index);
    return result;
  }, []);
  return indexes.every(
    (index, offset) => offset === 0 || index === indexes[offset - 1]! + 1,
  );
}

const DECK_FIT_STATE_KEYS = [
  appStateKeyForBrowserTab("deck-fit-checks", TAB_ID),
  "deck-fit-checks",
];

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

function isAgentPresenceUser(user: CollabUser): boolean {
  return (
    user.email.trim().toLowerCase() ===
    DEFAULT_AGENT_IDENTITY.email.trim().toLowerCase()
  );
}

type SlideRailNavigationKey =
  | "ArrowUp"
  | "ArrowDown"
  | "PageUp"
  | "PageDown"
  | "Home"
  | "End";

function isSlideRailNavigationKey(key: string): key is SlideRailNavigationKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End"
  );
}

function getNextSlideId(
  slides: Slide[],
  activeSlideId: string,
  key: SlideRailNavigationKey,
): string | null {
  const currentIndex = slides.findIndex((s) => s.id === activeSlideId);
  if (currentIndex === -1) return null;

  const nextIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? slides.length - 1
        : key === "ArrowUp" || key === "PageUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(slides.length - 1, currentIndex + 1);

  return nextIndex === currentIndex ? null : (slides[nextIndex]?.id ?? null);
}

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

function SortableSlideThumb({
  slide,
  index,
  isActive,
  isSelected,
  selectedSlideIds = [],
  onSelect,
  onFilmstripNavigate,
  onMoveSlide,
  registerButtonRef,
  presenceUsers = [],
  aspectRatio,
  designSystem,
  onOverflowChange,
  readOnly = false,
  aiEditing = false,
  isFillingPlaceholder = false,
  canDelete = true,
  hasSlideClipboard = false,
  onCutSlide,
  onCopySlide,
  onPasteSlide,
  onDeleteSlide,
  onNewSlideAfter,
  onDuplicateSlide,
  onToggleSkipSlide,
  altDragSlideId,
}: {
  slide: Slide;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  selectedSlideIds?: string[];
  onSelect: (options?: SlideSelectionOptions) => void;
  onFilmstripNavigate: (
    key: SlideRailNavigationKey,
    extendSelection?: boolean,
  ) => void;
  onMoveSlide?: (key: "ArrowUp" | "ArrowDown", toBoundary: boolean) => void;
  readOnly?: boolean;
  registerButtonRef: (slideId: string, node: HTMLButtonElement | null) => void;
  presenceUsers?: CollabUser[];
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onOverflowChange: (info: SlideOverflowInfo) => void;
  aiEditing?: boolean;
  isFillingPlaceholder?: boolean;
  canDelete?: boolean;
  hasSlideClipboard?: boolean;
  onCutSlide?: (slideIds: string[]) => void;
  onCopySlide?: (slideIds: string[]) => void;
  onPasteSlide?: (slideId: string) => void;
  onDeleteSlide?: (slideIds: string[]) => void;
  onNewSlideAfter?: (slideId: string) => void;
  onDuplicateSlide?: (slideIds: string[]) => void;
  onToggleSkipSlide?: (slideIds: string[], skipped: boolean) => void;
  altDragSlideId?: string | null;
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
    transform:
      isDragging && altDragSlideId === slide.id
        ? undefined
        : CSS.Transform.toString(transform),
    transition,
    opacity:
      isDragging && altDragSlideId === slide.id ? 1 : isDragging ? 0.5 : 1,
  };

  const thumbDims = getAspectRatioDims(aspectRatio);
  const agentPresent = presenceUsers.some(isAgentPresenceUser);
  const humanPresenceUsers = presenceUsers.filter(
    (user) => !isAgentPresenceUser(user),
  );
  const showAiMarker = aiEditing || agentPresent || isFillingPlaceholder;
  const showGeneratingShimmer = agentPresent || isFillingPlaceholder;
  const actionSlideIds = selectedSlideIds.includes(slide.id)
    ? selectedSlideIds
    : [slide.id];

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={readOnly}>
          <button
            ref={(node) => registerButtonRef(slide.id, node)}
            type="button"
            {...(readOnly ? {} : attributes)}
            {...(readOnly ? {} : listeners)}
            onKeyDown={(event) => {
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                event.stopPropagation();
                if (!readOnly && canDelete) onDeleteSlide?.(actionSlideIds);
                return;
              }
              if (
                !readOnly &&
                onMoveSlide &&
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                event.preventDefault();
                event.stopPropagation();
                onMoveSlide(event.key, event.shiftKey);
                return;
              }
              listeners?.onKeyDown?.(event);
              if (event.defaultPrevented) return;
              if (!isSlideRailNavigationKey(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              onFilmstripNavigate(event.key, event.shiftKey);
            }}
            onClick={(event) => {
              event.currentTarget.focus();
              onSelect({
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
              });
            }}
            onContextMenu={() => {
              if (!selectedSlideIds.includes(slide.id)) onSelect({});
            }}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) onSelect({});
            }}
            aria-label={t("editorSidebar.selectSlide", { number: index + 1 })}
            aria-current={isActive ? "true" : undefined}
            data-slide-thumbnail-id={slide.id}
            className={`w-full text-left flex items-start gap-1.5 p-1.5 rounded-lg transition-[background-color,box-shadow] duration-150 ${
              isSelected ? "bg-accent" : isActive ? "bg-accent/60" : ""
            } ${
              readOnly ? "" : "cursor-grab active:cursor-grabbing"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
          >
            {/* Index and slide presence share the fixed rail so presence does not resize the row. */}
            <div className="relative flex-shrink-0 w-4 self-stretch">
              <span className="block text-center text-[10px] font-medium leading-5 text-muted-foreground/70">
                {index + 1}
              </span>
              {(showAiMarker || humanPresenceUsers.length > 0) && (
                <div className="absolute left-1/2 top-5 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
                  {showAiMarker && (
                    <AiEditingMarker className="size-4 text-[8px]" />
                  )}
                  {humanPresenceUsers.slice(0, 4).map((u, i) => (
                    <PresenceAvatarTip key={i} user={u} size={14} />
                  ))}
                  {humanPresenceUsers.length > 4 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[8px] font-medium leading-none text-muted-foreground ring-1 ring-black/40">
                      +{humanPresenceUsers.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Thumbnail */}
            <div className="flex-1 min-w-0">
              {/* Each thumbnail paints a full-resolution slide canvas scaled down by
               * transform, so a long rail keeps dozens of large layers live and the
               * browser drops frames or paints stale tiles. `content-visibility`
               * lets it skip everything below the fold; `aspect-ratio` keeps the row
               * the right height while its contents are skipped. */}
              <div
                className={`relative w-full overflow-hidden rounded border ${
                  slide.skipped ? "opacity-40" : ""
                }`}
                style={{
                  borderColor:
                    humanPresenceUsers.length > 0
                      ? humanPresenceUsers[0].color + "66"
                      : // guard:allow-raw-color — thumbnail border sits on an arbitrary-colored slide render, not app chrome
                        "rgba(255,255,255,0.06)",
                  aspectRatio: `${thumbDims.width} / ${thumbDims.height}`,
                  contentVisibility: "auto",
                }}
              >
                <SlideRenderer
                  slide={slide}
                  aspectRatio={aspectRatio}
                  designSystem={designSystem}
                  onOverflowChange={onOverflowChange}
                />
                {showGeneratingShimmer && (
                  <div
                    aria-hidden="true"
                    className="slide-thumbnail-ai-shimmer pointer-events-none absolute inset-0 z-10"
                  />
                )}
                {slide.skipped && (
                  // guard:allow-raw-color — dims an arbitrary-colored slide render, not app chrome; must stay black regardless of theme
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
                    {/* guard:allow-raw-color — icon sits on the black scrim above, not app chrome */}
                    <IconEyeOff className="size-6 text-white/80" />
                  </div>
                )}
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent
          style={{ animation: "none", transition: "none" }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <ContextMenuItem
            disabled={!canDelete}
            onSelect={() => onCutSlide?.(actionSlideIds)}
          >
            {t("editorSidebar.cut")}
            <ContextMenuShortcut className="tracking-normal">
              {shortcutLabel("cmd+x")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopySlide?.(actionSlideIds)}>
            {t("editorSidebar.copy")}
            <ContextMenuShortcut className="tracking-normal">
              {shortcutLabel("cmd+c")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasSlideClipboard}
            onSelect={() => onPasteSlide?.(slide.id)}
          >
            {t("editorSidebar.paste")}
            <ContextMenuShortcut className="tracking-normal">
              {shortcutLabel("cmd+v")}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onNewSlideAfter?.(slide.id)}>
            {t("editorSidebar.newSlide")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onDuplicateSlide?.(actionSlideIds)}>
            {t("editorSidebar.duplicateSlide")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => onToggleSkipSlide?.(actionSlideIds, !slide.skipped)}
          >
            {slide.skipped
              ? t("editorSidebar.unskipSlide")
              : t("editorSidebar.skipSlide")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canDelete}
            onSelect={() => onDeleteSlide?.(actionSlideIds)}
            className="text-destructive focus:text-destructive"
          >
            {t("editorSidebar.deleteSlide")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function GeneratingSlideSkeleton({
  index,
  aspectRatio,
  designSystem,
  selected,
  onSelect,
}: {
  index: number;
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={`relative block w-full rounded-lg text-left transition-colors ${
        selected ? "bg-accent" : ""
      }`}
      aria-label={t("editorSidebar.generatingSlide")}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <div className="flex w-full items-start gap-1.5 rounded-lg p-1.5">
        <span className="flex flex-shrink-0 flex-col items-center gap-1 text-center text-[10px] font-medium leading-5 text-muted-foreground/70">
          {index + 1}
          <AiEditingMarker className="size-4 text-[8px]" />
        </span>
        <div className="flex-1 min-w-0">
          <GeneratingSlidePreview
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
  selectedSlideIds = [],
  deckId,
  deckTitle,
  onSelectSlide,
  readOnly = false,
  slidePresence,
  recentEdits,
  aspectRatio,
  designSystem,
  generatingSlide,
  generatingSlideSelected = false,
  onSelectGeneratingSlide,
  describeSlideId,
  onCloseDescribe,
  onAddSlideGeneratingChange,
  aiGeneratingSlideId,
  onAwaitAddSlidePersisted,
  onRemoveFailedSlide,
  addSlideAgentSubmit,
  hasSlideClipboard,
  onCutSlide,
  onCopySlide,
  onPasteSlide,
  onDeleteSlide,
  onNewSlideAfter,
  onDuplicateSlide,
  onReorderSlides,
  onToggleSkipSlide,
  altDragSlideId,
}: EditorSidebarProps) {
  const t = useT();
  const [describeAnchorEl, setDescribeAnchorEl] =
    useState<HTMLButtonElement | null>(null);
  const closeDescribePopover = useCallback(() => {
    onCloseDescribe();
    setDescribeAnchorEl(null);
  }, [onCloseDescribe]);
  const [thumbnailListScrolled, setThumbnailListScrolled] = useState(false);
  const slideButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterDeleteRef = useRef<string | null>(null);
  const measurementsRef = useRef(
    new Map<
      string,
      {
        contentHash: string;
        layoutFitRevision?: string;
        info: SlideOverflowInfo;
        measuredAt: number;
      }
    >(),
  );
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aiEditedSlideIds = new Set(
    (recentEdits ?? [])
      .filter((edit) => edit.isAgent)
      .map(slideIdFromEdit)
      .filter((slideId): slideId is string => Boolean(slideId)),
  );

  const writeDeckFitState = useCallback(() => {
    const currentSlideIds = new Set(slides.map((slide) => slide.id));
    const measuredSlides = Object.fromEntries(
      Array.from(measurementsRef.current.entries())
        .filter(([slideId]) => currentSlideIds.has(slideId))
        .map(([slideId, measurement]) => [
          slideId,
          {
            contentHash: measurement.contentHash,
            ...(measurement.layoutFitRevision
              ? { layoutFitRevision: measurement.layoutFitRevision }
              : {}),
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
        ...(slide.layoutFitRevision
          ? { layoutFitRevision: slide.layoutFitRevision }
          : {}),
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
    setDescribeAnchorEl(null);
    setThumbnailListScrolled(false);
  }, [deckId]);

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

  const registerSlideButton = useCallback(
    (slideId: string, node: HTMLButtonElement | null) => {
      if (node) {
        slideButtonRefs.current.set(slideId, node);
      } else {
        slideButtonRefs.current.delete(slideId);
      }
      if (node && slideId === describeSlideId) {
        node.scrollIntoView({ block: "center" });
        setDescribeAnchorEl(node);
      }
    },
    [describeSlideId],
  );

  useEffect(() => {
    if (!activeSlideId) return;
    slideButtonRefs.current.get(activeSlideId)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSlideId]);

  useEffect(() => {
    const slideId = focusAfterDeleteRef.current;
    if (!slideId) return;

    const frame = requestAnimationFrame(() => {
      const button = slideButtonRefs.current.get(slideId);
      if (!button) return;
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
      if (focusAfterDeleteRef.current === slideId) {
        focusAfterDeleteRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [slides]);

  const handleDeleteSlide = useCallback(
    (slideIds: string[]) => {
      if (readOnly || !onDeleteSlide) return;
      const deletedIds = new Set(slideIds);
      const firstDeletedIndex = slides.findIndex((slide) =>
        deletedIds.has(slide.id),
      );
      if (firstDeletedIndex === -1) return;
      const nextSlide =
        slides.find(
          (slide, index) =>
            index > firstDeletedIndex && !deletedIds.has(slide.id),
        ) ??
        slides.find(
          (slide, index) =>
            index < firstDeletedIndex && !deletedIds.has(slide.id),
        );
      if (!nextSlide) return;
      focusAfterDeleteRef.current = nextSlide.id;
      onDeleteSlide(slideIds);
    },
    [onDeleteSlide, readOnly, slides],
  );

  const navigateToSlide = useCallback(
    (
      fromSlideId: string,
      key: SlideRailNavigationKey,
      extendSelection = false,
    ) => {
      const nextSlideId = getNextSlideId(slides, fromSlideId, key);
      if (!nextSlideId) return;

      if (extendSelection) {
        onSelectSlide(nextSlideId, { shiftKey: true });
      } else {
        onSelectSlide(nextSlideId);
      }
      requestAnimationFrame(() => {
        const nextButton = slideButtonRefs.current.get(nextSlideId);
        nextButton?.focus({ preventScroll: true });
        nextButton?.scrollIntoView({ block: "nearest" });
      });
    },
    [onSelectSlide, slides],
  );

  const moveSlideFromKeyboard = useCallback(
    (slideId: string, key: "ArrowUp" | "ArrowDown", toBoundary: boolean) => {
      if (readOnly || !onReorderSlides) return;
      const activeIndex = slides.findIndex((slide) => slide.id === slideId);
      if (activeIndex === -1) return;

      const requestedIds =
        selectedSlideIds.includes(slideId) &&
        isContiguousSlideSelection(
          slides.map((slide) => slide.id),
          selectedSlideIds,
        )
          ? selectedSlideIds
          : [slideId];
      const movingIds = new Set(requestedIds);
      const movingSlides = slides.filter((slide) => movingIds.has(slide.id));
      if (movingSlides.length === 0) return;

      const firstIndex = slides.findIndex((slide) => movingIds.has(slide.id));
      const lastIndex = slides.reduce(
        (last, slide, index) => (movingIds.has(slide.id) ? index : last),
        -1,
      );
      const targetIndex = toBoundary
        ? key === "ArrowUp"
          ? 0
          : slides.length - 1
        : key === "ArrowUp"
          ? firstIndex - 1
          : lastIndex + 1;
      const target = slides[targetIndex];
      if (!target || movingIds.has(target.id)) return;

      onReorderSlides(
        slideId,
        target.id,
        movingSlides.map((slide) => slide.id),
      );
    },
    [onReorderSlides, readOnly, selectedSlideIds, slides],
  );

  const describeSlideIndex = describeSlideId
    ? slides.findIndex((s) => s.id === describeSlideId)
    : -1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        isSlideTextEditingTarget(
          e.target,
          document.activeElement,
          document.querySelector(
            '[contenteditable="true"], [data-editing-block="true"]',
          ),
        ) ||
        document.querySelector('[data-slide-element-selected="true"]')
      )
        return;

      e.preventDefault();
      navigateToSlide(
        activeSlideId,
        e.key as "ArrowUp" | "ArrowDown",
        e.shiftKey,
      );
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeSlideId, navigateToSlide]);

  return (
    <div className="flex h-full min-h-0 w-48 flex-shrink-0 flex-col bg-background sm:w-52">
      <div
        className="relative min-h-0 flex-1"
        data-slides-thumbnail-scroll={
          thumbnailListScrolled ? "scrolled" : "top"
        }
      >
        <div
          className="h-full min-h-0 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2"
          onScroll={(event) => {
            setThumbnailListScrolled(event.currentTarget.scrollTop > 1);
          }}
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
                isSelected={selectedSlideIds.includes(slide.id)}
                selectedSlideIds={selectedSlideIds}
                onSelect={(options) => onSelectSlide(slide.id, options)}
                onFilmstripNavigate={(key, extendSelection) =>
                  navigateToSlide(slide.id, key, extendSelection)
                }
                onMoveSlide={
                  onReorderSlides
                    ? (key, toBoundary) =>
                        moveSlideFromKeyboard(slide.id, key, toBoundary)
                    : undefined
                }
                readOnly={readOnly}
                registerButtonRef={registerSlideButton}
                presenceUsers={slidePresence?.get(slide.id) ?? []}
                aspectRatio={aspectRatio}
                designSystem={designSystem}
                aiEditing={aiEditedSlideIds.has(slide.id)}
                isFillingPlaceholder={slide.id === aiGeneratingSlideId}
                canDelete={
                  slides.length >
                  (selectedSlideIds.includes(slide.id)
                    ? selectedSlideIds.length
                    : 1)
                }
                hasSlideClipboard={hasSlideClipboard}
                onCutSlide={onCutSlide}
                onCopySlide={onCopySlide}
                onPasteSlide={onPasteSlide}
                onDeleteSlide={handleDeleteSlide}
                onNewSlideAfter={onNewSlideAfter}
                onDuplicateSlide={onDuplicateSlide}
                altDragSlideId={altDragSlideId}
                onToggleSkipSlide={onToggleSkipSlide}
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
              selected={generatingSlideSelected}
              onSelect={onSelectGeneratingSlide}
            />
          )}
        </div>
      </div>
      {describeSlideId && describeSlideIndex !== -1 && describeAnchorEl && (
        <LazyChunkErrorBoundary
          fallback={
            <DeferredPopoverFallback
              surface="add-slide"
              anchorRef={{ current: describeAnchorEl }}
              failed
              onClose={closeDescribePopover}
            />
          }
        >
          <Suspense
            fallback={
              <DeferredPopoverFallback
                surface="add-slide"
                anchorRef={{ current: describeAnchorEl }}
                onClose={closeDescribePopover}
              />
            }
          >
            <DeferredAddSlidePopover
              open
              onOpenChange={(open) => {
                if (!open) closeDescribePopover();
              }}
              anchorRef={{ current: describeAnchorEl }}
              placement="right"
              deckId={deckId}
              deckTitle={deckTitle}
              activeSlideId={describeSlideId}
              activeSlideIndex={describeSlideIndex}
              slideCount={slides.length}
              targetSlideId={describeSlideId}
              agentSubmit={async (message, context) => {
                onAddSlideGeneratingChange?.(true, describeSlideId);
                try {
                  await onAwaitAddSlidePersisted?.();
                } catch (error) {
                  console.error("Failed to persist new slide:", error);
                  onAddSlideGeneratingChange?.(false, null);
                  const current = slides.find((s) => s.id === describeSlideId);
                  if (
                    current?.content === defaultSlideContent.blank &&
                    !current.notes
                  ) {
                    onRemoveFailedSlide?.(describeSlideId);
                  }
                  toast.error(t("editorSidebar.newSlideSaveFailed"));
                  return false;
                }
                addSlideAgentSubmit(message, context);
                return true;
              }}
            />
          </Suspense>
        </LazyChunkErrorBoundary>
      )}
    </div>
  );
}
