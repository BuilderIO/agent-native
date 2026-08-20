import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import type {
  AttributedRecentEdit,
  CollabUser,
} from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { SlideOverflowInfo } from "@/components/deck/SlideRenderer";
import { AddSlidePopover } from "@/components/editor/AddSlidePopover";
import { AiEditingMarker } from "@/components/editor/AiEditingMarker";
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
import { TAB_ID } from "@/lib/tab-id";
import { shortcutLabel } from "@/lib/utils";

import type { DesignSystemData } from "../../../shared/api";
import { isSlideTextEditingTarget } from "./slide-text-targets";

interface EditorSidebarProps {
  slides: Slide[];
  activeSlideId: string;
  deckId: string;
  deckTitle: string;
  onSelectSlide: (id: string) => void;
  /** Viewer-role decks get thumbnails only: no add, duplicate, or delete. */
  readOnly?: boolean;
  /** Presence map: slideId → list of users currently viewing that slide */
  slidePresence?: Map<string, CollabUser[]>;
  /** Lingering recent edits used to show the compact AI marker. */
  recentEdits?: AttributedRecentEdit[];
  /** Deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
  /** Active deck design system used by slide content tokens. */
  designSystem?: DesignSystemData;
  /** The next slide while the agent is preparing its HTML. Omitted when the
   *  agent is filling a placeholder that already has a row in this rail. */
  generatingSlide?: { index: number };
  generatingSlideSelected?: boolean;
  onSelectGeneratingSlide?: () => void;
  /** The slide just inserted via the toolbar's New Slide button — the rail
   *  anchors the "describe this slide" popover to that slide's thumbnail
   *  once it mounts. Owned by the parent since the button that sets it now
   *  lives in the toolbar, outside this component. */
  describeSlideId: string | null;
  /** Clears `describeSlideId` in the parent when the popover closes. */
  onCloseDescribe: () => void;
  /** Reports add-slide generation state up so the toolbar's New Slide button
   *  can disable itself while a request is in flight. `targetSlideId` is the
   *  placeholder the agent was asked to fill, so the parent can mark that row
   *  as the AI-active one instead of appending a second generating row. */
  onAddSlideGeneratingChange?: (
    generating: boolean,
    targetSlideId: string | null,
  ) => void;
  /** Slide the agent is filling in place, marked as AI-active in the rail. */
  aiGeneratingSlideId?: string | null;
  /** Resolves once a just-inserted blank slide has actually reached the
   *  server, so the agent's update-slide request can't race the add-slide
   *  persistence. */
  onAwaitAddSlidePersisted?: () => Promise<void>;
  /** Removes a blank placeholder slide whose persistence ultimately failed,
   *  so a flaky save doesn't leave a stray empty slide in the deck. */
  onRemoveFailedSlide?: (slideId: string) => void;
  /** Submits the add-slide agent request. Owned by the parent (rather than
   *  this component's own useAgentGenerating() call) so the run stays
   *  correctly scoped and trackable across a sidebar remount. */
  addSlideAgentSubmit: (message: string, context: string) => void;
  /** Whether a slide is currently on the cut/copy clipboard, so the rail's
   *  right-click menu can disable Paste when there's nothing to paste. */
  hasSlideClipboard?: boolean;
  onCutSlide?: (slideId: string) => void;
  onCopySlide?: (slideId: string) => void;
  /** Pastes the clipboard slide directly after this slide. */
  onPasteSlide?: (slideId: string) => void;
  onDeleteSlide?: (slideId: string) => void;
  /** Inserts a new blank slide directly after this slide. */
  onNewSlideAfter?: (slideId: string) => void;
  onDuplicateSlide?: (slideId: string) => void;
  /** Toggles whether this slide is excluded from Present/Presenter mode. */
  onToggleSkipSlide?: (slideId: string) => void;
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

function isAgentPresenceUser(user: CollabUser): boolean {
  return (
    user.email.trim().toLowerCase() ===
    DEFAULT_AGENT_IDENTITY.email.trim().toLowerCase()
  );
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

function SortableSlideThumb({
  slide,
  index,
  isActive,
  onSelect,
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
}: {
  slide: Slide;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  readOnly?: boolean;
  registerButtonRef: (slideId: string, node: HTMLButtonElement | null) => void;
  presenceUsers?: CollabUser[];
  aspectRatio?: AspectRatio;
  designSystem?: DesignSystemData;
  onOverflowChange: (info: SlideOverflowInfo) => void;
  /** A recent edit attributed to the agent — a lingering highlight, not a live signal. */
  aiEditing?: boolean;
  /** This exact slide is the placeholder the agent is filling right now — the
   *  one case where the shimmer belongs even without live presence. */
  isFillingPlaceholder?: boolean;
  /** False when this is the deck's last remaining slide — Cut/Delete stay enabled elsewhere but must not remove it. */
  canDelete?: boolean;
  hasSlideClipboard?: boolean;
  onCutSlide?: (slideId: string) => void;
  onCopySlide?: (slideId: string) => void;
  onPasteSlide?: (slideId: string) => void;
  onDeleteSlide?: (slideId: string) => void;
  onNewSlideAfter?: (slideId: string) => void;
  onDuplicateSlide?: (slideId: string) => void;
  onToggleSkipSlide?: (slideId: string) => void;
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

  const thumbDims = getAspectRatioDims(aspectRatio);
  const agentPresent = presenceUsers.some(isAgentPresenceUser);
  const humanPresenceUsers = presenceUsers.filter(
    (user) => !isAgentPresenceUser(user),
  );
  const showAiMarker = aiEditing || agentPresent || isFillingPlaceholder;
  // Narrower than the badge above: `aiEditing` also covers a slide's lingering
  // post-edit highlight, which is "recently done," not "in progress." The
  // shimmer should only run while the agent is actually live on this slide.
  const showGeneratingShimmer = agentPresent || isFillingPlaceholder;

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={readOnly}>
          <button
            ref={(node) => registerButtonRef(slide.id, node)}
            type="button"
            {...(readOnly ? {} : attributes)}
            {...(readOnly ? {} : listeners)}
            onClick={(event) => {
              // Safari does not focus a button on click, and the slide copy/paste
              // and delete shortcuts are scoped to a focused thumbnail.
              event.currentTarget.focus();
              onSelect();
            }}
            onFocus={onSelect}
            aria-label={t("editorSidebar.selectSlide", { number: index + 1 })}
            aria-current={isActive ? "true" : undefined}
            data-slide-thumbnail-id={slide.id}
            className={`w-full text-left flex items-start gap-1.5 p-1.5 rounded-lg transition-[background-color,box-shadow] duration-150 ${
              isActive ? "bg-accent" : ""
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
          onCloseAutoFocus={(event) => {
            // Radix restores focus to the trigger (this slide's thumbnail
            // button) when the menu closes. That button's onFocus reselects
            // its own slide, which clobbers New/Duplicate/Paste's deliberate
            // selection of the newly created slide. Our handlers already set
            // the right active slide explicitly, so skip the auto-focus.
            event.preventDefault();
          }}
        >
          <ContextMenuItem
            disabled={!canDelete}
            onSelect={() => onCutSlide?.(slide.id)}
          >
            {t("editorSidebar.cut")}
            <ContextMenuShortcut>{shortcutLabel("cmd+x")}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopySlide?.(slide.id)}>
            {t("editorSidebar.copy")}
            <ContextMenuShortcut>{shortcutLabel("cmd+c")}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!hasSlideClipboard}
            onSelect={() => onPasteSlide?.(slide.id)}
          >
            {t("editorSidebar.paste")}
            <ContextMenuShortcut>{shortcutLabel("cmd+v")}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onNewSlideAfter?.(slide.id)}>
            {t("editorSidebar.newSlide")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onDuplicateSlide?.(slide.id)}>
            {t("editorSidebar.duplicateSlide")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleSkipSlide?.(slide.id)}>
            {slide.skipped
              ? t("editorSidebar.unskipSlide")
              : t("editorSidebar.skipSlide")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canDelete}
            onSelect={() => onDeleteSlide?.(slide.id)}
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
  onToggleSkipSlide,
}: EditorSidebarProps) {
  const t = useT();
  const [describeAnchorEl, setDescribeAnchorEl] =
    useState<HTMLButtonElement | null>(null);
  const [thumbnailListScrolled, setThumbnailListScrolled] = useState(false);
  const slideButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const measurementsRef = useRef(
    new Map<
      string,
      { contentHash: string; info: SlideOverflowInfo; measuredAt: number }
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
      // The new-slide prompt anchors to the just-created slide's thumbnail,
      // which doesn't exist yet at click time — pick it up as soon as it mounts.
      // Center it in the scroll area first so the prompt has room on-screen
      // instead of opening off the bottom edge when the new slide lands there.
      if (node && slideId === describeSlideId) {
        node.scrollIntoView({ block: "center" });
        setDescribeAnchorEl(node);
      }
    },
    [describeSlideId],
  );

  const describeSlideIndex = describeSlideId
    ? slides.findIndex((s) => s.id === describeSlideId)
    : -1;

  // Arrow key navigation for slides
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      // Text editing and selected canvas objects own arrow keys. The marker
      // query also covers a transient focus loss after a native selection.
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
          const nextButton = slideButtonRefs.current.get(nextSlideId);
          nextButton?.focus({ preventScroll: true });
          nextButton?.scrollIntoView({ block: "nearest" });
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [slides, activeSlideId, onSelectSlide]);

  return (
    <div className="flex h-full min-h-0 w-48 flex-shrink-0 flex-col bg-background sm:w-52">
      <div
        className="relative min-h-0 flex-1"
        data-slides-thumbnail-scroll={
          thumbnailListScrolled ? "scrolled" : "top"
        }
      >
        <div
          className="h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain p-2"
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
                onSelect={() => onSelectSlide(slide.id)}
                readOnly={readOnly}
                registerButtonRef={registerSlideButton}
                presenceUsers={slidePresence?.get(slide.id) ?? []}
                aspectRatio={aspectRatio}
                designSystem={designSystem}
                aiEditing={aiEditedSlideIds.has(slide.id)}
                isFillingPlaceholder={slide.id === aiGeneratingSlideId}
                canDelete={slides.length > 1}
                hasSlideClipboard={hasSlideClipboard}
                onCutSlide={onCutSlide}
                onCopySlide={onCopySlide}
                onPasteSlide={onPasteSlide}
                onDeleteSlide={onDeleteSlide}
                onNewSlideAfter={onNewSlideAfter}
                onDuplicateSlide={onDuplicateSlide}
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
        <AddSlidePopover
          open
          onOpenChange={(open) => {
            if (!open) {
              onCloseDescribe();
              setDescribeAnchorEl(null);
            }
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
              // The popover already closed (AddSlidePopover doesn't wait on
              // this async callback), so the typed prompt is gone either
              // way. Only remove the placeholder if it's still untouched —
              // the save retries take long enough that the user could have
              // started editing it directly on the canvas in the meantime,
              // and deleting it would destroy that work.
              const current = slides.find((s) => s.id === describeSlideId);
              if (
                current?.content === defaultSlideContent.blank &&
                !current.notes
              ) {
                onRemoveFailedSlide?.(describeSlideId);
              }
              toast.error(t("editorSidebar.newSlideSaveFailed"));
              return;
            }
            addSlideAgentSubmit(message, context);
          }}
        />
      )}
    </div>
  );
}
