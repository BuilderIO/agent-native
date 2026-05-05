import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconPlus,
  IconGripVertical,
  IconCopy,
  IconTrash,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import type { Slide } from "@/context/DeckContext";
import type { AspectRatio } from "@/lib/aspect-ratios";
import SlideRenderer from "@/components/deck/SlideRenderer";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useCallback } from "react";
import {
  appBasePath,
  PromptComposer,
  type CollabUser,
  useAvatarUrl,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { GoogleDocImportHint } from "@/components/editor/GoogleDocImportHint";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorSidebarProps {
  slides: Slide[];
  activeSlideId: string;
  deckId: string;
  deckTitle: string;
  onSelectSlide: (id: string) => void;
  onDuplicateSlide: (id: string) => void;
  onDeleteSlide: (id: string) => void;
  /** Presence map: slideId → list of users currently viewing that slide */
  slidePresence?: Map<string, CollabUser[]>;
  /** Deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
}

const MAX_SOURCE_CONTEXT_CHARS = 60_000;

function truncateSourceForContext(prompt: string): {
  text: string;
  truncated: boolean;
} {
  if (prompt.length <= MAX_SOURCE_CONTEXT_CHARS) {
    return { text: prompt, truncated: false };
  }
  return {
    text: prompt.slice(0, MAX_SOURCE_CONTEXT_CHARS),
    truncated: true,
  };
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
  onDuplicate,
  onDelete,
  presenceUsers = [],
  aspectRatio,
}: {
  slide: Slide;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  presenceUsers?: CollabUser[];
  aspectRatio?: AspectRatio;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: slide.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <button
        onClick={onSelect}
        className={`w-full text-left flex items-start gap-2 p-2 rounded-lg transition-all duration-150 ${
          isActive ? "bg-accent ring-1 ring-[#609FF8]/50" : "hover:bg-accent"
        }`}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="flex-shrink-0 mt-2 cursor-grab active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
        >
          <IconGripVertical className="w-3.5 h-3.5 text-muted-foreground/70" />
        </div>

        {/* Index */}
        <span className="flex-shrink-0 w-5 mt-2 text-[10px] font-medium text-muted-foreground/70">
          {index + 1}
        </span>

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
            <SlideRenderer slide={slide} aspectRatio={aspectRatio} />
          </div>
          {/* Presence avatars — show who's on this slide */}
          {presenceUsers.length > 0 && (
            <div className="flex items-center gap-0.5 mt-1 px-0.5">
              {presenceUsers.slice(0, 4).map((u, i) => (
                <PresenceAvatarTip key={i} user={u} size={16} />
              ))}
              {presenceUsers.length > 4 && (
                <span className="text-[9px] text-muted-foreground/70 ml-0.5">
                  +{presenceUsers.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Actions - always visible on touch devices */}
      <div className="absolute top-2 right-2 flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="p-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80"
          title="Duplicate"
          aria-label="Duplicate slide"
        >
          <IconCopy className="w-3 h-3 text-white/60" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-red-900/80"
          title="Delete"
          aria-label="Delete slide"
        >
          <IconTrash className="w-3 h-3 text-white/60" />
        </button>
      </div>
    </div>
  );
}

function AddSlidePopover({
  open,
  onOpenChange,
  anchorRef,
  deckId,
  deckTitle,
  activeSlideId,
  slideCount,
  activeSlideIndex,
  agentSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  deckId: string;
  deckTitle: string;
  activeSlideId: string;
  slideCount: number;
  activeSlideIndex: number;
  generating: boolean;
  agentSubmit: (message: string, context: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange, anchorRef]);

  const handleSubmit = useCallback(
    async (text: string, files: File[]) => {
      let uploaded: UploadedFile[] = [];
      if (files.length > 0) {
        try {
          const formData = new FormData();
          files.forEach((f) => formData.append("files", f));
          const res = await fetch(`${appBasePath()}/api/uploads`, {
            method: "POST",
            body: formData,
          });
          if (res.ok) uploaded = (await res.json()) as UploadedFile[];
        } catch {
          /* silent */
        }
      }

      const trimmedText = text.trim();
      const description = [trimmedText || "a new slide", googleDocContext]
        .filter(Boolean)
        .join("\n\n");
      const sourceForContext = truncateSourceForContext(description);
      const fileContext =
        uploaded.length > 0
          ? `\n\nThe user uploaded ${uploaded.length} file(s) for context:\n${uploaded.map((f) => `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`).join("\n")}`
          : "";
      const context = [
        `Add a new slide to deck "${deckTitle}" (id: ${deckId}).`,
        `Insert after slide ${activeSlideIndex + 1} of ${slideCount} (active slide id: ${activeSlideId}).`,
        "The text below is the user's request and/or pasted source material for the new slide(s). Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
        `User request / source material:\n${sourceForContext.text}`,
        sourceForContext.truncated
          ? `The pasted source was longer than ${MAX_SOURCE_CONTEXT_CHARS} characters, so only the first ${MAX_SOURCE_CONTEXT_CHARS} characters were included to keep the agent request reliable.`
          : "",
        fileContext,
        "",
        "Create the slide content and insert it at the correct position using the app's slide data structure.",
      ].join("\n");

      agentSubmit(
        `Add slide: ${summarizePromptForChat(trimmedText || "a new slide")}`,
        context,
      );
      onOpenChange(false);
    },
    [
      activeSlideId,
      activeSlideIndex,
      agentSubmit,
      deckId,
      deckTitle,
      googleDocContext,
      onOpenChange,
      slideCount,
    ],
  );

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
    }
  }, [open]);

  if (!open || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const panelWidth = Math.min(420, window.innerWidth - 24);
  const left = Math.max(
    12,
    Math.min(rect.left, window.innerWidth - panelWidth - 12),
  );

  return createPortal(
    <div
      ref={panelRef}
      className="fixed w-[min(420px,calc(100vw-24px))] rounded-xl border border-border bg-popover shadow-2xl shadow-black/60 z-[200] p-3"
      style={{
        top: rect.bottom + 8,
        left,
      }}
    >
      <p className="px-1 pb-2 text-sm font-medium text-foreground/90">
        Add slides
      </p>
      <PromptComposer
        autoFocus
        placeholder="Describe the slides you want..."
        draftScope={`slides:add-slide:${deckId}`}
        onSubmit={handleSubmit}
        onTextChange={setPromptText}
      />
      <div className="-mx-1 mt-2">
        <GoogleDocImportHint
          promptText={promptText}
          onSourceContextChange={setGoogleDocContext}
        />
      </div>
    </div>,
    document.body,
  );
}

function summarizePromptForChat(prompt: string): string {
  const singleLine = prompt.trim().replace(/\s+/g, " ");
  if (!singleLine) return "a new slide";
  if (singleLine.length <= 180) return singleLine;
  return `${singleLine.slice(0, 177)}...`;
}

export default function EditorSidebar({
  slides,
  activeSlideId,
  deckId,
  deckTitle,
  onSelectSlide,
  onDuplicateSlide,
  onDeleteSlide,
  slidePresence,
  aspectRatio,
}: EditorSidebarProps) {
  const activeIndex = slides.findIndex((s) => s.id === activeSlideId);
  const [addOpen, setAddOpen] = useState(false);
  const [addSlideGenerating, setAddSlideGenerating] = useState(false);
  const headerAddRef = useRef<HTMLButtonElement>(null);
  const { generating, submit: agentSubmit } = useAgentGenerating();

  // Reset addSlideGenerating when global generating stops
  useEffect(() => {
    if (!generating) setAddSlideGenerating(false);
  }, [generating]);

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
        onSelectSlide(slides[nextIndex].id);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [slides, activeSlideId, onSelectSlide]);

  return (
    <div className="w-56 sm:w-64 flex-shrink-0 border-r border-border bg-background flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Slides
        </span>
        {addSlideGenerating ? (
          <IconLoader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        ) : (
          <button
            ref={headerAddRef}
            onClick={() => setAddOpen(!addOpen)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            title="Add slides"
            aria-label="Add slides"
          >
            <IconPlus className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
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
              presenceUsers={slidePresence?.get(slide.id) ?? []}
              aspectRatio={aspectRatio}
            />
          ))}
        </SortableContext>

        <div className="border-t border-border mt-2 pt-1">
          <ExtensionsSidebarSection />
        </div>
      </div>

      <AddSlidePopover
        open={addOpen}
        onOpenChange={setAddOpen}
        anchorRef={headerAddRef}
        deckId={deckId}
        deckTitle={deckTitle}
        activeSlideId={activeSlideId}
        slideCount={slides.length}
        activeSlideIndex={activeIndex >= 0 ? activeIndex : 0}
        generating={generating}
        agentSubmit={(msg, ctx) => {
          setAddSlideGenerating(true);
          agentSubmit(msg, ctx);
        }}
      />
    </div>
  );
}
