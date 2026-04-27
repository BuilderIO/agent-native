import { useState, useRef, useEffect, forwardRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconLayout,
  IconLayoutSidebar,
  IconPhoto,
  IconShare2,
  IconHistory,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFolderOpen,
  IconSettings,
  IconSchema,
  IconPencil,
  IconTransform,
  IconMessage,
  IconWand,
  IconAdjustments,
} from "@tabler/icons-react";
import type { Deck, Slide, SlideLayout } from "@/context/DeckContext";
import ShareDialog from "./ShareDialog";
import { ExportMenu } from "./ExportMenu";
import { ImportButton } from "./ImportButton";

import {
  AgentToggleButton,
  ShareButton,
  useAvatarUrl,
  uploadAvatar,
  emailToColor,
  emailToName,
  type CollabUser,
} from "@agent-native/core/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
interface EditorToolbarProps {
  deck: Deck;
  deckId: string;
  deckTitle: string;
  onTitleChange: (title: string) => void;
  activeTab: "visual" | "code";
  onTabChange: (tab: "visual" | "code") => void;
  slideCount: number;
  currentSlideIndex: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onGenerateImage: () => void;
  onOpenAssetLibrary: () => void;
  imageGenButtonRef: React.RefObject<HTMLButtonElement | null>;
  assetsButtonRef: React.RefObject<HTMLButtonElement | null>;
  historyOpen: boolean;
  onShowHistory: () => void;
  historyButtonRef: React.RefObject<HTMLButtonElement | null>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  currentSlide?: Slide;
  onUpdateSlide?: (updates: Partial<Omit<Slide, "id">>) => void;
  /** Active users on the current slide (from collab awareness) */
  activeUsers?: CollabUser[];
  /** True briefly when AI agent is making edits on the current slide */
  agentActive?: boolean;
  /** Whether the comments panel is open */
  commentsOpen?: boolean;
  /** Toggle the comments panel */
  onToggleComments?: () => void;
  /** Number of unresolved comments on the current slide */
  unresolvedCommentCount?: number;
  /** Current user email for avatar display */
  currentUserEmail?: string;
  /** Whether the animations panel is open */
  animationsOpen?: boolean;
  /** Toggle the animations panel */
  onToggleAnimations?: () => void;
  /** Whether the tweaks panel is open */
  tweaksOpen?: boolean;
  /** Toggle the tweaks panel */
  onToggleTweaks?: () => void;
  /** Duplicate the current deck */
  onDuplicateDeck?: () => void;
  /** Export the deck as PDF */
  onExportPdf?: () => void;
}

const slideLayoutOptions: { value: SlideLayout; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "section", label: "Section Divider" },
  { value: "content", label: "Content" },
  { value: "two-column", label: "Two Column" },
  { value: "image", label: "Image" },
  { value: "statement", label: "Statement" },
  { value: "full-image", label: "Full Image" },
  { value: "blank", label: "Blank" },
];

const backgroundOptions = [
  "bg-[#000000]",
  "bg-[#0a0a0a]",
  "bg-[#0f0f11]",
  "bg-[#111114]",
  "bg-[#141418]",
  "bg-gradient-to-br from-[#000000] to-[#0a0a14]",
  "bg-gradient-to-br from-[#0a0a0a] to-[#0f1a14]",
  "bg-[#ffffff]",
];

const AvatarFace = forwardRef<
  HTMLDivElement,
  { avatarUrl: string | null; name: string; color: string; className: string }
>(function AvatarFace({ avatarUrl, name, color, className }, ref) {
  return (
    <div ref={ref} className={className} style={{ backgroundColor: color }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
});

function PresenceAvatar({ user }: { user: CollabUser }) {
  const avatarUrl = useAvatarUrl(user.email);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AvatarFace
          avatarUrl={avatarUrl}
          name={user.name}
          color={user.color}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-[hsl(240,5%,6%)] overflow-hidden cursor-default"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2 p-2">
        <AvatarFace
          avatarUrl={avatarUrl}
          name={user.name}
          color={user.color}
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden"
        />
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-white leading-tight">
            {user.name}
          </span>
          <span className="text-[10px] text-white/50 leading-tight truncate">
            {user.email}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function CurrentUserAvatar({ email }: { email: string }) {
  const avatarUrl = useAvatarUrl(email);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadAvatar(file, email);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const initials = emailToName(email).charAt(0).toUpperCase();
  const color = emailToColor(email);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => inputRef.current?.click()}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-[hsl(240,5%,6%)] overflow-hidden hover:opacity-80"
          style={{ backgroundColor: color }}
          aria-label="Update your avatar"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="You"
              className="w-full h-full object-cover"
            />
          ) : (
            initials
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium">{email}</span>
          <span className="text-[10px] opacity-60">Click to update photo</span>
        </div>
      </TooltipContent>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </Tooltip>
  );
}

/** Popover anchored to a button ref */
function ToolbarPopover({
  open,
  anchorRef,
  onClose,
  children,
  width = 160,
  align = "right",
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose, anchorRef]);

  if (!open || !anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();
  const vw = window.innerWidth;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, vw - width - 8));

  return createPortal(
    <div
      ref={menuRef}
      className="fixed rounded-lg border border-white/[0.08] bg-[hsl(240,5%,10%)] shadow-xl z-[200] max-h-[80vh] overflow-y-auto"
      style={{ top: rect.bottom + 4, left, width: Math.min(width, vw - 16) }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function EditorToolbar({
  deck,
  deckId,
  deckTitle,
  onTitleChange,
  activeTab,
  onTabChange,
  slideCount,
  currentSlideIndex,
  sidebarOpen,
  onToggleSidebar,
  onGenerateImage,
  onOpenAssetLibrary,
  imageGenButtonRef,
  assetsButtonRef,
  historyOpen,
  onShowHistory,
  historyButtonRef,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentSlide,
  onUpdateSlide,
  activeUsers,
  agentActive,
  commentsOpen,
  onToggleComments,
  unresolvedCommentCount = 0,
  currentUserEmail,
  animationsOpen,
  onToggleAnimations,
  tweaksOpen,
  onToggleTweaks,
  onDuplicateDeck,
  onExportPdf,
}: EditorToolbarProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLButtonElement>(null);

  const closeAll = () => {
    setLayoutOpen(false);
  };

  return (
    <div className="h-12 border-b border-white/[0.06] bg-[hsl(240,5%,6%)] flex items-center px-1 sm:px-3 gap-1 sm:gap-2 overflow-x-auto">
      {/* Back button */}
      <Link
        to="/"
        className="p-2.5 sm:p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0"
        title="Back to decks"
        aria-label="Back to decks"
      >
        <IconArrowLeft className="w-4 h-4 text-white/60" />
      </Link>

      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className={`p-2.5 sm:p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0 ${
          sidebarOpen ? "text-white/60" : "text-white/30"
        }`}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <IconLayoutSidebar className="w-4 h-4" />
      </button>

      {/* Deck title */}
      <input
        type="text"
        value={deckTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        className="bg-transparent text-sm font-medium text-white/80 border-none outline-none focus:text-white min-w-0 w-24 sm:w-auto flex-shrink"
        spellCheck={false}
      />

      {/* Slide counter */}
      <span className="text-xs text-white/30 flex-shrink-0 hidden sm:inline">
        {currentSlideIndex + 1}/{slideCount}
      </span>

      {/* Spacer */}
      <div className="flex-1 min-w-2" />

      {currentUserEmail && <CurrentUserAvatar email={currentUserEmail} />}

      {/* Slide settings cog menu */}
      {currentSlide && onUpdateSlide && (
        <>
          <button
            ref={layoutRef}
            onClick={() => {
              closeAll();
              setLayoutOpen(!layoutOpen);
            }}
            className={`flex items-center gap-1 p-2.5 sm:px-2 sm:py-1.5 rounded-md text-xs transition-colors flex-shrink-0 ${
              layoutOpen
                ? "text-white/80 bg-white/[0.06]"
                : "text-white/50 hover:text-white/70 hover:bg-white/[0.06]"
            }`}
            title="Slide settings"
            aria-label="Slide settings"
          >
            <IconSettings className="w-3.5 h-3.5" />
          </button>
          <ToolbarPopover
            open={layoutOpen}
            anchorRef={layoutRef}
            onClose={() => setLayoutOpen(false)}
            width={220}
          >
            <div className="py-1.5">
              {/* Layout section */}
              <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                Layout
              </div>
              {slideLayoutOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onUpdateSlide({ layout: opt.value });
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                    currentSlide.layout === opt.value
                      ? "text-[#609FF8] bg-white/[0.04]"
                      : "text-white/60 hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  <IconLayout className="w-3 h-3" />
                  {opt.label}
                </button>
              ))}

              {/* Background section */}
              <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                Background
              </div>
              <div className="px-3 pb-2">
                <div className="grid grid-cols-4 gap-2">
                  {backgroundOptions.map((bg, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onUpdateSlide!({ background: bg });
                      }}
                      className={`w-10 h-7 rounded-md border transition-all ${bg} ${
                        currentSlide.background === bg
                          ? "border-[#609FF8] ring-1 ring-[#609FF8]/30"
                          : "border-white/[0.08] hover:border-white/[0.2]"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Image & Assets section */}
              <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                Media
              </div>
              <button
                ref={imageGenButtonRef}
                onClick={() => {
                  onGenerateImage();
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                <IconPhoto className="w-3 h-3" />
                Generate Image
              </button>
              <button
                ref={assetsButtonRef}
                onClick={() => {
                  onOpenAssetLibrary();
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                <IconFolderOpen className="w-3 h-3" />
                Asset Library
              </button>

              {/* Diagrams section */}
              <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                Diagrams
              </div>
              <button
                onClick={() => {
                  if (!onUpdateSlide || !currentSlide) return;
                  const mermaidTemplate = `<div class="fmd-slide" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:60px 80px;font-family:'Poppins',sans-serif;">
<div class="mermaid">
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action A]
    B -->|No| D[Action B]
    C --> E[End]
    D --> E
</div>
</div>`;
                  onUpdateSlide({
                    content: mermaidTemplate,
                    layout: "blank",
                  });
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                <IconSchema className="w-3 h-3" />
                Insert Mermaid Diagram
              </button>
              <button
                onClick={() => {
                  if (!onUpdateSlide) return;
                  onUpdateSlide({
                    excalidrawData: JSON.stringify({
                      elements: [],
                      appState: { viewBackgroundColor: "transparent" },
                      files: {},
                    }),
                  });
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                <IconPencil className="w-3 h-3" />
                Excalidraw Canvas
              </button>
              {typeof currentSlide?.content === "string" &&
                currentSlide.content.includes('class="mermaid"') && (
                  <button
                    onClick={async () => {
                      if (!onUpdateSlide || !currentSlide) return;
                      try {
                        const match = currentSlide.content.match(
                          /<div\s+class="mermaid"[^>]*>([\s\S]*?)<\/div>/i,
                        );
                        if (!match) return;
                        const { convertMermaidToExcalidraw } =
                          await import("./MermaidToExcalidrawPanel");
                        const data = await convertMermaidToExcalidraw(
                          match[1].trim(),
                        );
                        onUpdateSlide({ excalidrawData: data });
                        setLayoutOpen(false);
                      } catch (err: any) {
                        console.error("Mermaid to Excalidraw failed:", err);
                      }
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[#00E5FF]/80 hover:text-[#00E5FF] hover:bg-white/[0.04] transition-colors"
                  >
                    <IconTransform className="w-3 h-3" />
                    Convert Mermaid → Excalidraw
                  </button>
                )}
              {currentSlide?.excalidrawData && (
                <button
                  onClick={() => {
                    if (!onUpdateSlide) return;
                    onUpdateSlide({ excalidrawData: undefined });
                    setLayoutOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                >
                  <IconPencil className="w-3 h-3" />
                  Remove Excalidraw Canvas
                </button>
              )}

              {/* Transitions section */}
              <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                Transition
              </div>
              <div className="px-3 pb-2.5 grid grid-cols-4 gap-1">
                {(["instant", "fade", "slide", "zoom"] as const).map((t) => {
                  const active =
                    t === "instant"
                      ? !currentSlide.transition ||
                        currentSlide.transition === "instant" ||
                        currentSlide.transition === "none"
                      : currentSlide.transition === t;
                  return (
                    <button
                      key={t}
                      onClick={() => onUpdateSlide!({ transition: t })}
                      className={`px-1.5 py-1 rounded text-[10px] font-medium capitalize border ${
                        active
                          ? "bg-[#609FF8]/20 text-[#609FF8] border-[#609FF8]/30"
                          : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border-transparent"
                      }`}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
          </ToolbarPopover>
        </>
      )}

      {/* Animations button */}
      {currentSlide && onToggleAnimations && (
        <button
          onClick={onToggleAnimations}
          className={`p-2.5 sm:p-1.5 rounded-md cursor-pointer flex-shrink-0 ${
            animationsOpen
              ? "text-[#609FF8] bg-[#609FF8]/10"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
          }`}
          title="Element animations"
          aria-label="Element animations"
        >
          <IconWand className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Tweaks button */}
      {onToggleTweaks && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleTweaks}
              className={`p-1.5 rounded cursor-pointer ${tweaksOpen ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/[0.06]"}`}
            >
              <IconAdjustments className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Tweaks</TooltipContent>
        </Tooltip>
      )}

      {/* Import button */}
      <ImportButton deckId={deckId} />

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.08] flex-shrink-0 hidden sm:block" />

      {/* Undo/Redo */}
      <div className="flex items-center flex-shrink-0">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2.5 sm:p-1.5 rounded-md hover:bg-white/[0.06] disabled:opacity-20 transition-colors"
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <IconArrowBackUp className="w-3.5 h-3.5 text-white/60" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2.5 sm:p-1.5 rounded-md hover:bg-white/[0.06] disabled:opacity-20 transition-colors"
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <IconArrowForwardUp className="w-3.5 h-3.5 text-white/60" />
        </button>
      </div>

      {/* IconHistory - hidden on small screens */}
      <button
        ref={historyButtonRef}
        onClick={onShowHistory}
        className={`p-2.5 sm:p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0 hidden sm:block ${
          historyOpen
            ? "text-white/80 bg-white/[0.06]"
            : "text-white/40 hover:text-white/70"
        }`}
        title="Edit history"
        aria-label="Edit history"
      >
        <IconHistory className="w-3.5 h-3.5" />
      </button>

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.08] flex-shrink-0 hidden sm:block" />

      {/* Edit mode tabs */}
      <div className="flex items-center rounded-md border border-white/[0.08] overflow-hidden flex-shrink-0">
        <button
          onClick={() => onTabChange("visual")}
          className={`px-3 py-2 sm:py-1.5 text-xs font-medium transition-colors ${
            activeTab === "visual"
              ? "bg-white/[0.08] text-white/90"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => onTabChange("code")}
          className={`px-3 py-2 sm:py-1.5 text-xs font-medium transition-colors ${
            activeTab === "code"
              ? "bg-white/[0.08] text-white/90"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          Code
        </button>
      </div>

      {/* Presence avatars — show who's editing the current slide */}
      {((activeUsers && activeUsers.length > 0) || agentActive) && (
        <div className="flex items-center -space-x-1.5 flex-shrink-0 mr-0.5">
          {agentActive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-[hsl(240,5%,6%)] animate-pulse z-10 cursor-default"
                  style={{ backgroundColor: "#a78bfa" }}
                >
                  AI
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">AI is editing</TooltipContent>
            </Tooltip>
          )}
          {(activeUsers ?? []).slice(0, 5).map((u, i) => (
            <PresenceAvatar key={i} user={u} />
          ))}
          {(activeUsers?.length ?? 0) > 5 && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white/50 bg-white/10 ring-2 ring-[hsl(240,5%,6%)]">
              +{(activeUsers?.length ?? 0) - 5}
            </div>
          )}
        </div>
      )}

      {/* Comments toggle */}
      {onToggleComments && (
        <button
          onClick={onToggleComments}
          className={`relative p-2.5 sm:p-1.5 rounded-md transition-colors flex-shrink-0 ${
            commentsOpen
              ? "text-white/90 bg-white/[0.08]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
          }`}
          title="Comments"
          aria-label="Comments"
        >
          <IconMessage className="w-3.5 h-3.5" />
          {unresolvedCommentCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#609FF8] text-[8px] font-bold text-black flex items-center justify-center leading-none">
              {unresolvedCommentCount > 9 ? "9+" : unresolvedCommentCount}
            </span>
          )}
        </button>
      )}

      {/* Export / Share menu (export, duplicate, share) */}
      <ExportMenu
        deckId={deckId}
        deckTitle={deckTitle}
        onDuplicate={onDuplicateDeck ?? (() => {})}
        onExportPdf={onExportPdf ?? (() => {})}
      />

      {/* Framework share (ownership, per-user/org grants, visibility) */}
      <div className="flex-shrink-0">
        <ShareButton
          resourceType="deck"
          resourceId={deckId}
          resourceTitle={deckTitle}
          variant="compact"
        />
      </div>

      {/* Present button */}
      <Link
        to={`/deck/${deckId}/present`}
        className="flex items-center gap-1.5 px-2.5 py-2 sm:py-1.5 rounded-md bg-[#609FF8] hover:bg-[#7AB2FA] text-black text-xs font-medium transition-colors flex-shrink-0"
      >
        <IconPlayerPlay className="w-3 h-3" />
        <span className="hidden sm:inline">Present</span>
      </Link>
      <AgentToggleButton className="flex-shrink-0 text-white/40 hover:text-white/70 hover:bg-white/[0.06]" />
    </div>
  );
}
