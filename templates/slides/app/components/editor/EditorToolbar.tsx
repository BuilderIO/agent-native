import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  ArrowLeft,
  Play,
  Layout,
  Code,
  Eye,
  PanelLeft,
  ImageIcon,
  Share2,
  History,
  Undo2,
  Redo2,
  FolderOpen,
  Settings,
} from "lucide-react";
import type { Slide, SlideLayout } from "@/context/DeckContext";
import { FeedbackButton } from "@/components/FeedbackButton";

interface EditorToolbarProps {
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
  onShare: () => void;
  historyOpen: boolean;
  onShowHistory: () => void;
  historyButtonRef: React.RefObject<HTMLButtonElement | null>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  currentSlide?: Slide;
  onUpdateSlide?: (updates: Partial<Omit<Slide, "id">>) => void;
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
  const left = align === "right" ? rect.right - width : rect.left;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed rounded-lg border border-white/[0.08] bg-[hsl(240,5%,10%)] shadow-xl z-[200]"
      style={{ top: rect.bottom + 4, left, width }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function EditorToolbar({
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
  onShare,
  historyOpen,
  onShowHistory,
  historyButtonRef,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentSlide,
  onUpdateSlide,
}: EditorToolbarProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLButtonElement>(null);

  const closeAll = () => {
    setLayoutOpen(false);
  };

  return (
    <div className="h-12 border-b border-white/[0.06] bg-[hsl(240,5%,6%)] flex items-center px-2 sm:px-3 gap-1.5 sm:gap-2 overflow-x-auto">
      {/* Back button */}
      <Link
        to="/"
        className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0"
        title="Back to decks"
      >
        <ArrowLeft className="w-4 h-4 text-white/60" />
      </Link>

      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className={`p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0 ${
          sidebarOpen ? "text-white/60" : "text-white/30"
        }`}
        title="Toggle sidebar"
      >
        <PanelLeft className="w-4 h-4" />
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
      <span className="text-xs text-white/30 flex-shrink-0">
        {currentSlideIndex + 1}/{slideCount}
      </span>

      {/* Spacer */}
      <div className="flex-1 min-w-2" />

      {/* Slide settings cog menu */}
      {currentSlide && onUpdateSlide && (
        <>
          <button
            ref={layoutRef}
            onClick={() => {
              closeAll();
              setLayoutOpen(!layoutOpen);
            }}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors flex-shrink-0 ${
              layoutOpen
                ? "text-white/80 bg-white/[0.06]"
                : "text-white/50 hover:text-white/70 hover:bg-white/[0.06]"
            }`}
            title="Slide settings"
          >
            <Settings className="w-3.5 h-3.5" />
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
                  <Layout className="w-3 h-3" />
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
                <ImageIcon className="w-3 h-3" />
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
                <FolderOpen className="w-3 h-3" />
                Asset Library
              </button>
            </div>
          </ToolbarPopover>
        </>
      )}

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.08] flex-shrink-0 hidden sm:block" />

      {/* Undo/Redo */}
      <div className="flex items-center flex-shrink-0">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1.5 rounded-md hover:bg-white/[0.06] disabled:opacity-20 transition-colors"
          title="Undo (Cmd+Z)"
        >
          <Undo2 className="w-3.5 h-3.5 text-white/60" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1.5 rounded-md hover:bg-white/[0.06] disabled:opacity-20 transition-colors"
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5 text-white/60" />
        </button>
      </div>

      {/* History */}
      <button
        ref={historyButtonRef}
        onClick={onShowHistory}
        className={`p-1.5 rounded-md hover:bg-white/[0.06] transition-colors flex-shrink-0 ${
          historyOpen
            ? "text-white/80 bg-white/[0.06]"
            : "text-white/40 hover:text-white/70"
        }`}
        title="Edit history"
      >
        <History className="w-3.5 h-3.5" />
      </button>

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.08] flex-shrink-0 hidden sm:block" />

      {/* Edit mode tabs */}
      <div className="flex items-center rounded-md border border-white/[0.08] overflow-hidden flex-shrink-0">
        <button
          onClick={() => onTabChange("visual")}
          className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
            activeTab === "visual"
              ? "bg-white/[0.08] text-white/90"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          <Eye className="w-3 h-3" />
          <span className="hidden sm:inline">Preview</span>
        </button>
        <button
          onClick={() => onTabChange("code")}
          className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
            activeTab === "code"
              ? "bg-white/[0.08] text-white/90"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          <Code className="w-3 h-3" />
          <span className="hidden sm:inline">Code</span>
        </button>
      </div>

      {/* Share button */}
      <button
        onClick={onShare}
        className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors flex-shrink-0"
        title="Share presentation"
      >
        <Share2 className="w-3.5 h-3.5" />
      </button>

      <FeedbackButton />

      {/* Present button */}
      <Link
        to={`/deck/${deckId}/present`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#609FF8] hover:bg-[#7AB2FA] text-black text-xs font-medium transition-colors flex-shrink-0"
      >
        <Play className="w-3 h-3" />
        <span className="hidden sm:inline">Present</span>
      </Link>
    </div>
  );
}
