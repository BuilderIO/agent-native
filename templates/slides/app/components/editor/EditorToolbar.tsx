import {
  agentNativePath,
  appBasePath,
  appPath,
  useT,
} from "@agent-native/core/client";
import {
  AgentToggleButton,
  NotificationsBell,
  ShareButton,
  PresenceBar,
  type CollabUser,
} from "@agent-native/core/client";
import { RunsTray } from "@agent-native/core/client/progress";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconLayout,
  IconLayoutSidebar,
  IconPhoto,
  IconHistory,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFolderOpen,
  IconSettings,
  IconSchema,
  IconPencil,
  IconTransform,
  IconMessage,
  IconBolt,
  IconAdjustments,
  IconPencilPlus,
  IconPin,
  IconWand,
  IconUpload,
  IconSun,
  IconMoon,
  IconDots,
  IconPalette,
  IconLoader2,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Deck, Slide, SlideLayout } from "@/context/DeckContext";
import { defaultSlideContent } from "@/context/DeckContext";
import { toast } from "@/hooks/use-toast";
import {
  ASPECT_RATIO_VALUES,
  type AspectRatio,
  DEFAULT_ASPECT_RATIO,
} from "@/lib/aspect-ratios";
import { shortcutLabel } from "@/lib/utils";

import { ExportMenu } from "./ExportMenu";
interface EditorToolbarProps {
  deck: Deck;
  deckId: string;
  deckTitle: string;
  /** When false, the user is a viewer — render the editor shell with all
   *  edit affordances disabled, matching Google Slides' viewer experience.
   *  Defaults to true for backward compatibility. */
  canEdit?: boolean;
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
  /** Whether the agent has a durable presence entry on this slide */
  agentPresent?: boolean;
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
  /** Whether draw-on-slide mode is active */
  drawMode?: boolean;
  /** Toggle draw-on-slide mode */
  onToggleDrawMode?: () => void;
  /** Whether comment-pin drop mode is active */
  pinMode?: boolean;
  /** Toggle comment-pin drop mode */
  onTogglePinMode?: () => void;
  /** Duplicate the current deck */
  onDuplicateDeck?: () => void;
  /** Export the deck as PDF */
  onExportPdf?: () => void;
  /** Export the deck as PPTX */
  onExportPptx?: () => Promise<void> | void;
  /** Active deck aspect ratio (defaults to 16:9 when omitted) */
  aspectRatio?: AspectRatio;
  /** Change the deck's aspect ratio */
  onSetAspectRatio?: (ratio: AspectRatio) => void;
  /** Title of the design system linked to this deck, if any */
  designSystemTitle?: string | null;
}

const slideLayoutOptions: { value: SlideLayout; labelKey: string }[] = [
  { value: "title", labelKey: "editorToolbar.layoutTitle" },
  { value: "section", labelKey: "editorToolbar.layoutSection" },
  { value: "content", labelKey: "editorToolbar.layoutContent" },
  { value: "two-column", labelKey: "editorToolbar.layoutTwoColumn" },
  { value: "image", labelKey: "editorToolbar.layoutImage" },
  { value: "statement", labelKey: "editorToolbar.layoutStatement" },
  { value: "full-image", labelKey: "editorToolbar.layoutFullImage" },
  { value: "blank", labelKey: "editorToolbar.layoutBlank" },
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
  const vw = window.innerWidth;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, vw - width - 8));

  return createPortal(
    <div
      ref={menuRef}
      className="fixed rounded-lg border border-border bg-popover shadow-xl z-[200] max-h-[80vh] overflow-y-auto"
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
  onShowHistory,
  historyButtonRef,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentSlide,
  onUpdateSlide,
  activeUsers,
  agentPresent,
  agentActive,
  commentsOpen,
  onToggleComments,
  unresolvedCommentCount = 0,
  currentUserEmail,
  animationsOpen,
  onToggleAnimations,
  tweaksOpen,
  onToggleTweaks,
  drawMode,
  onToggleDrawMode,
  pinMode,
  onTogglePinMode,
  onDuplicateDeck,
  onExportPdf,
  onExportPptx,
  aspectRatio,
  onSetAspectRatio,
  designSystemTitle,
  canEdit = true,
}: EditorToolbarProps) {
  const t = useT();
  // Mirror Google Slides: the share dialog exposes both the editor URL
  // (primary) and the presentation URL (secondary). Access is enforced on
  // the deck, not the URL shape — anyone with at least viewer access can
  // open either link.
  const editorUrl =
    typeof window === "undefined"
      ? `/deck/${deckId}`
      : `${window.location.origin}${appPath(`/deck/${deckId}`)}`;
  const presentationUrl =
    typeof window === "undefined"
      ? `/p/${deckId}`
      : `${window.location.origin}${appPath(`/p/${deckId}`)}`;

  const activeAspectRatio: AspectRatio = aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLButtonElement>(null);

  const handleLayoutSelect = (layout: SlideLayout) => {
    if (!currentSlide || !onUpdateSlide) return;
    if (currentSlide.layout !== layout) {
      onUpdateSlide({ layout, content: defaultSlideContent[layout] });
    }
    setLayoutOpen(false);
  };
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);
  const isDark = themeMounted ? resolvedTheme === "dark" : false;
  // The four secondary tools share an "active when something is on" indicator
  // so the dot on the consolidated button reflects any of them.
  const anyToolActive = Boolean(
    animationsOpen || tweaksOpen || drawMode || pinMode,
  );

  const closeAll = () => {
    setLayoutOpen(false);
    setToolsOpen(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    toast({
      title: t("editorToolbar.importingFile"),
      description: t("editorToolbar.readingFile", { fileName: file.name }),
    });
    const formData = new FormData();
    formData.append("file", file);
    try {
      const uploadRes = await fetch(`${appBasePath()}/api/uploads`, {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadData?.error || t("editorToolbar.uploadFailed"));
      }
      const uploaded = Array.isArray(uploadData) ? uploadData[0] : uploadData;
      const filePath = uploaded?.path || uploaded?.url;
      if (!filePath) throw new Error(t("editorToolbar.uploadMissingPath"));

      const importRes = await fetch(
        agentNativePath("/_agent-native/actions/import-file"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath,
            deckId,
            format: "auto",
            importIntoDeck: true,
          }),
        },
      );
      const importData = await importRes.json();
      if (!importRes.ok || importData?.error) {
        throw new Error(importData?.error || t("editorToolbar.importFailed"));
      }
      toast({
        title: t("editorToolbar.importComplete"),
        description:
          typeof importData.slideCount === "number"
            ? t("editorToolbar.importCompleteSlides", {
                count: importData.slideCount,
                fileName: file.name,
              })
            : t("editorToolbar.importCompleteFile", {
                fileName: file.name,
              }),
      });
    } catch (err) {
      console.error("Import failed:", err);
      toast({
        title: t("editorToolbar.importFailed"),
        description:
          err instanceof Error
            ? err.message
            : t("editorToolbar.importFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b border-border bg-background px-1 sm:gap-1 sm:px-3">
      {/* Back button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/"
            className="p-2.5 sm:p-1.5 rounded-md hover:bg-accent transition-colors flex-shrink-0"
            aria-label={t("editorToolbar.backToDecks")}
          >
            <IconArrowLeft className="w-4 h-4 text-muted-foreground" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.backToDecks")}</TooltipContent>
      </Tooltip>

      {/* Slide-list toggle (mobile only — desktop uses the app sidebar rail) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleSidebar}
            className={`md:hidden p-2.5 sm:p-1.5 rounded-md hover:bg-accent transition-colors flex-shrink-0 ${
              sidebarOpen ? "text-muted-foreground" : "text-muted-foreground/70"
            }`}
            aria-label={t("editorToolbar.toggleSlideList")}
          >
            <IconLayoutSidebar className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.toggleSlideList")}</TooltipContent>
      </Tooltip>

      {/* Deck title */}
      <input
        type="text"
        value={deckTitle}
        onChange={(e) => onTitleChange(e.target.value)}
        className="bg-transparent text-sm font-medium text-foreground/90 border-none outline-none focus:text-foreground min-w-0 w-24 sm:w-auto flex-shrink"
        spellCheck={false}
      />

      {/* Slide counter */}
      <span className="text-xs text-muted-foreground/70 flex-shrink-0 hidden sm:inline">
        {currentSlideIndex + 1}/{slideCount}
      </span>

      {deck.designSystemId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="hidden max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-accent/35 px-2 py-1 text-xs text-muted-foreground sm:flex">
              <IconPalette className="h-3.5 w-3.5 shrink-0 text-[#609FF8]" />
              <span className="truncate">
                {designSystemTitle || t("editorToolbar.designSystem")}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {designSystemTitle
              ? t("editorToolbar.usingDesignSystem", {
                  title: designSystemTitle,
                })
              : t("editorToolbar.usingLinkedDesignSystem")}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-2" />

      {/* "View only" badge — mirrors Google Slides' viewer chrome */}
      {!canEdit && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {t("editorToolbar.viewOnly")}
        </span>
      )}

      {/* Slide settings cog menu */}
      {canEdit && currentSlide && onUpdateSlide && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={layoutRef}
                onClick={() => {
                  closeAll();
                  setLayoutOpen(!layoutOpen);
                }}
                className={`flex items-center gap-1 p-2.5 sm:px-2 sm:py-1.5 rounded-md text-xs transition-colors flex-shrink-0 ${
                  layoutOpen
                    ? "text-foreground/90 bg-accent"
                    : "text-muted-foreground hover:text-foreground/70 hover:bg-accent"
                }`}
                aria-label={t("editorToolbar.slideSettings")}
              >
                <IconSettings className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editorToolbar.slideSettings")}</TooltipContent>
          </Tooltip>
          <ToolbarPopover
            open={layoutOpen}
            anchorRef={layoutRef}
            onClose={() => setLayoutOpen(false)}
            width={220}
          >
            <div className="py-1.5">
              {/* Layout section */}
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("editorToolbar.layout")}
              </div>
              {slideLayoutOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleLayoutSelect(opt.value)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                    currentSlide.layout === opt.value
                      ? "text-[#609FF8] bg-accent/50"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <IconLayout className="w-3 h-3" />
                  {t(opt.labelKey)}
                </button>
              ))}

              {/* Background section */}
              <div className="mx-2 my-1.5 border-t border-border" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("editorToolbar.background")}
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
                          : "border-border hover:border-foreground/20"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Image & Assets section */}
              <div className="mx-2 my-1.5 border-t border-border" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("editorToolbar.media")}
              </div>
              <button
                ref={imageGenButtonRef}
                onClick={() => {
                  onGenerateImage();
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <IconPhoto className="w-3 h-3" />
                {t("editorToolbar.generateImage")}
              </button>
              <button
                ref={assetsButtonRef}
                onClick={() => {
                  onOpenAssetLibrary();
                  setLayoutOpen(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <IconFolderOpen className="w-3 h-3" />
                {t("editorToolbar.assetLibrary")}
              </button>

              {/* Diagrams section */}
              <div className="mx-2 my-1.5 border-t border-border" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("editorToolbar.diagrams")}
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
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <IconSchema className="w-3 h-3" />
                {t("editorToolbar.insertMermaidDiagram")}
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
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <IconPencil className="w-3 h-3" />
                {t("editorToolbar.excalidrawCanvas")}
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
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[#00E5FF]/80 hover:text-[#00E5FF] hover:bg-accent/50 transition-colors"
                  >
                    <IconTransform className="w-3 h-3" />
                    {t("editorToolbar.convertMermaidToExcalidraw")}
                  </button>
                )}
              {currentSlide?.excalidrawData && (
                <button
                  onClick={() => {
                    if (!onUpdateSlide) return;
                    onUpdateSlide({ excalidrawData: undefined });
                    setLayoutOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-muted-foreground hover:bg-accent/50 transition-colors"
                >
                  <IconPencil className="w-3 h-3" />
                  {t("editorToolbar.removeExcalidrawCanvas")}
                </button>
              )}

              {/* Transitions section */}
              <div className="mx-2 my-1.5 border-t border-border" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                {t("editorToolbar.transition")}
              </div>
              <div className="px-3 pb-2.5 grid grid-cols-4 gap-1">
                {(["instant", "fade", "slide", "zoom"] as const).map(
                  (transition) => {
                    const active =
                      transition === "instant"
                        ? !currentSlide.transition ||
                          currentSlide.transition === "instant" ||
                          currentSlide.transition === "none"
                        : currentSlide.transition === transition;
                    return (
                      <button
                        key={transition}
                        onClick={() => onUpdateSlide!({ transition })}
                        className={`px-1.5 py-1 rounded text-[10px] font-medium capitalize border ${
                          active
                            ? "bg-[#609FF8]/20 text-[#609FF8] border-[#609FF8]/30"
                            : "text-muted-foreground hover:text-foreground/70 hover:bg-accent/50 border-transparent"
                        }`}
                      >
                        {t(`editorToolbar.transition_${transition}`)}
                      </button>
                    );
                  },
                )}
              </div>

              {/* Aspect Ratio section (deck-level) */}
              {onSetAspectRatio && (
                <>
                  <div className="mx-2 my-1.5 border-t border-white/[0.06]" />
                  <div className="px-3 py-1.5 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                    {t("editorToolbar.aspectRatio")}
                  </div>
                  <div className="px-3 pb-2.5 grid grid-cols-4 gap-1">
                    {ASPECT_RATIO_VALUES.map((r) => {
                      const active = activeAspectRatio === r;
                      return (
                        <Tooltip key={r}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onSetAspectRatio(r)}
                              className={`px-1.5 py-1 rounded text-[10px] font-medium border ${
                                active
                                  ? "bg-[#609FF8]/20 text-[#609FF8] border-[#609FF8]/30"
                                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border-transparent"
                              }`}
                            >
                              {r}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("editorToolbar.setAspectRatio", { ratio: r })}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </ToolbarPopover>
        </>
      )}

      {/* Slide tools palette — animations, tweaks, draw, comment-pin all live
       * inside one popover so the toolbar doesn't drown in icons. Hidden in
       * view-only mode since none of these affordances apply. */}
      {canEdit &&
        (onToggleAnimations ||
          onToggleTweaks ||
          onToggleDrawMode ||
          onTogglePinMode) && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={toolsRef}
                  onClick={() => {
                    closeAll();
                    setToolsOpen(!toolsOpen);
                  }}
                  className={`relative p-1.5 rounded cursor-pointer flex-shrink-0 ${
                    anyToolActive || toolsOpen
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground/70 hover:bg-accent"
                  }`}
                  aria-label={t("editorToolbar.slideTools")}
                >
                  <IconWand className="w-4 h-4" />
                  {anyToolActive && !toolsOpen && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#609FF8]" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.slideTools")}</TooltipContent>
            </Tooltip>
            <ToolbarPopover
              open={toolsOpen}
              anchorRef={toolsRef}
              onClose={() => setToolsOpen(false)}
              width={200}
            >
              <div className="py-1.5">
                {currentSlide && onToggleAnimations && (
                  <button
                    onClick={() => {
                      onToggleAnimations();
                      setToolsOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                      animationsOpen
                        ? "text-[#609FF8] bg-accent/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <IconBolt className="w-3.5 h-3.5" />
                    {t("editorToolbar.elementAnimations")}
                  </button>
                )}
                {onToggleTweaks && (
                  <button
                    onClick={() => {
                      onToggleTweaks();
                      setToolsOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                      tweaksOpen
                        ? "text-foreground bg-accent/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <IconAdjustments className="w-3.5 h-3.5" />
                    {t("editorToolbar.tweaks")}
                  </button>
                )}
                {onToggleDrawMode && (
                  <button
                    onClick={() => {
                      onToggleDrawMode();
                      setToolsOpen(false);
                    }}
                    data-toolbar-draw-button
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                      drawMode
                        ? "text-foreground bg-accent/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <IconPencilPlus className="w-3.5 h-3.5" />
                    {t("editorToolbar.drawOnSlide")}
                  </button>
                )}
                {onTogglePinMode && (
                  <button
                    onClick={() => {
                      onTogglePinMode();
                      setToolsOpen(false);
                    }}
                    data-toolbar-pin-button
                    className={`flex items-start gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                      pinMode
                        ? "text-foreground bg-accent/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <IconPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="flex flex-col items-start min-w-0">
                      <span>{t("editorToolbar.pinComments")}</span>
                      <span className="text-[10px] text-muted-foreground/80 leading-tight mt-0.5">
                        {t("editorToolbar.pinCommentsDescription")}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </ToolbarPopover>
          </>
        )}

      {/* Edit-only cluster — undo/redo + edit-mode tabs */}
      {canEdit && (
        <>
          {/* Separator */}
          <div className="w-px h-5 bg-accent flex-shrink-0 hidden sm:block" />

          {/* Undo/Redo */}
          <div className="flex items-center flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="p-2.5 sm:p-1.5 rounded-md hover:bg-accent disabled:opacity-20 transition-colors"
                  aria-label={t("editorToolbar.undo")}
                >
                  <IconArrowBackUp className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("editorToolbar.undoWithShortcut", {
                  shortcut: shortcutLabel("cmd+z"),
                })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="p-2.5 sm:p-1.5 rounded-md hover:bg-accent disabled:opacity-20 transition-colors"
                  aria-label={t("editorToolbar.redo")}
                >
                  <IconArrowForwardUp className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("editorToolbar.redoWithShortcut", {
                  shortcut: shortcutLabel("cmd+shift+z"),
                })}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-accent flex-shrink-0 hidden sm:block" />

          {/* Edit mode tabs */}
          <div className="flex items-center rounded-md border border-border overflow-hidden flex-shrink-0">
            <button
              onClick={() => onTabChange("visual")}
              className={`px-3 py-2 sm:py-1.5 text-xs font-medium transition-colors ${
                activeTab === "visual"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {t("editorToolbar.preview")}
            </button>
            <button
              onClick={() => onTabChange("code")}
              className={`px-3 py-2 sm:py-1.5 text-xs font-medium transition-colors ${
                activeTab === "code"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {t("editorToolbar.code")}
            </button>
          </div>
        </>
      )}

      {/* Presence avatars — shared PresenceBar (agent + collaborators) */}
      <PresenceBar
        activeUsers={activeUsers ?? []}
        agentPresent={agentPresent}
        agentActive={agentActive}
        currentUserEmail={currentUserEmail}
        className="flex-shrink-0 mr-0.5"
      />

      {/* Comments toggle */}
      {onToggleComments && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleComments}
              className={`relative p-2.5 sm:p-1.5 rounded-md transition-colors flex-shrink-0 ${
                commentsOpen
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground/70 hover:bg-accent"
              }`}
              aria-label={t("editorToolbar.comments")}
            >
              <IconMessage className="w-3.5 h-3.5" />
              {unresolvedCommentCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#609FF8] text-[8px] font-bold text-black flex items-center justify-center leading-none">
                  {unresolvedCommentCount > 9 ? "9+" : unresolvedCommentCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.comments")}</TooltipContent>
        </Tooltip>
      )}

      {/* Export / Share menu (export, duplicate, share) */}
      <div className="flex-shrink-0">
        <ExportMenu
          deckId={deckId}
          deckTitle={deckTitle}
          onDuplicate={onDuplicateDeck ?? (() => {})}
          onExportPdf={onExportPdf ?? (() => {})}
          onExportPptx={onExportPptx ?? (() => {})}
        />
      </div>

      {/* Framework share (ownership, per-user/org grants, visibility) */}
      <div className="flex-shrink-0">
        <ShareButton
          resourceType="deck"
          resourceId={deckId}
          resourceTitle={deckTitle}
          shareUrl={editorUrl}
          shareUrlLabel={t("editorToolbar.editorLink")}
          shareUrlDescription={t("editorToolbar.editorLinkDescription")}
          secondaryShareUrl={presentationUrl}
          secondaryShareUrlLabel={t("editorToolbar.presentationLink")}
          secondaryShareUrlDescription={t(
            "editorToolbar.presentationLinkDescription",
          )}
        />
      </div>
      {/* Present button — matches Share trigger height (h-9) */}
      <Link
        to={`/deck/${deckId}/present`}
        className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <IconPlayerPlay className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t("editorToolbar.present")}</span>
      </Link>

      {/* Hidden file input for "Import" overflow menu item */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx,.docx,.pdf"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* Overflow — Import / History / Theme tucked away to clean the bar. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                ref={historyButtonRef}
                className="p-2.5 sm:p-1.5 rounded-md hover:bg-accent transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground/70 cursor-pointer"
                aria-label={t("editorToolbar.more")}
              >
                <IconDots className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.more")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={importing}
            onSelect={() => fileInputRef.current?.click()}
          >
            {importing ? (
              <IconLoader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <IconUpload className="w-4 h-4 mr-2" />
            )}
            {importing
              ? t("editorToolbar.importing")
              : t("editorToolbar.importFile")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onShowHistory}>
            <IconHistory className="w-4 h-4 mr-2" />
            {t("editorToolbar.savedVersions")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? (
              <IconSun className="w-4 h-4 mr-2" />
            ) : (
              <IconMoon className="w-4 h-4 mr-2" />
            )}
            {isDark
              ? t("editorToolbar.lightTheme")
              : t("editorToolbar.darkTheme")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NotificationsBell />
      <RunsTray pollMs={1500} />
      <AgentToggleButton />
    </div>
  );
}
