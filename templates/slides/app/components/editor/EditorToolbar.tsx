import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
  appPath,
} from "@agent-native/core/client/api-path";
import { type CollabUser } from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import { RunsTray } from "@agent-native/core/client/progress";
import { ShareButton } from "@agent-native/core/client/sharing";
import { CreativeContextShareTab } from "@agent-native/creative-context/client";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconLayoutSidebar,
  IconPhoto,
  IconHistory,
  IconFolderOpen,
  IconMessage,
  IconDownload,
  IconSun,
  IconMoon,
  IconDotsVertical,
  IconLoader2,
  IconBolt,
  IconAdjustments,
  IconPencilPlus,
  IconPin,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SaveStatusIndicator } from "@/components/visual-editor";
import type { Deck, Slide } from "@/context/DeckContext";
import { useSaveState } from "@/context/DeckContext";
import { getDeckShareLinkOrder } from "@/lib/deck-share-links";
import type { GoogleSlidesExportResult } from "@/lib/export-google-slides-client";
import { parseUploadResponse } from "@/lib/upload-response";

import { EditorActionCluster } from "./EditorActionCluster";
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
  slideCount: number;
  currentSlideIndex: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onGenerateImage: () => void;
  onOpenAssetLibrary: () => void;
  onShowHistory: () => void;
  historyButtonRef: React.RefObject<HTMLButtonElement | null>;
  currentSlide?: Slide;
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
  /** Whether the add-text-box tool is active */
  textBoxMode?: boolean;
  /** Toggle the add-text-box tool */
  onToggleTextBoxMode?: () => void;
  /** Duplicate the current deck */
  onDuplicateDeck?: () => void;
  /** Export the deck as PDF */
  onExportPdf?: () => void;
  /** Export the deck as PPTX */
  onExportPptx?: () => Promise<void> | void;
  /** Create the deck in the user's Google Drive as native Google Slides */
  onExportGoogleSlides?: () => Promise<GoogleSlidesExportResult>;
  /** Insert a blank slide after the current one */
  onAddEmptySlide?: () => void;
  /** Duplicate the current slide */
  onDuplicateCurrentSlide?: () => void;
  /** Id of the current slide, so an agent add-slide lands in the right place */
  currentSlideId?: string;
  /** True while an agent add-slide request is in flight */
  addSlideGenerating?: boolean;
  /** Called when an agent add-slide request is submitted */
  onAddSlideGeneratingChange?: (generating: boolean) => void;
}

const TOOLBAR_ICON_BUTTON_CLASS =
  "inline-flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors";

export default function EditorToolbar({
  deck,
  deckId,
  deckTitle,
  onTitleChange,
  slideCount,
  currentSlideIndex,
  sidebarOpen,
  onToggleSidebar,
  onGenerateImage,
  onOpenAssetLibrary,
  onShowHistory,
  historyButtonRef,
  currentSlide,
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
  textBoxMode,
  onToggleTextBoxMode,
  onDuplicateDeck,
  onExportPdf,
  onExportPptx,
  onExportGoogleSlides,
  onAddEmptySlide,
  onDuplicateCurrentSlide,
  currentSlideId,
  addSlideGenerating = false,
  onAddSlideGeneratingChange,
  canEdit = true,
}: EditorToolbarProps) {
  const t = useT();
  // Public decks default to the read-only presentation URL so recipients do
  // not get sent through the editor's auth gate. Restricted decks keep the
  // editor URL primary, where auth resolves viewer access.
  const editorUrl =
    typeof window === "undefined"
      ? `/deck/${deckId}`
      : `${window.location.origin}${appPath(`/deck/${deckId}`)}`;
  const presentationUrl =
    typeof window === "undefined"
      ? `/p/${deckId}`
      : `${window.location.origin}${appPath(`/p/${deckId}`)}`;
  const shareLinks = {
    editor: {
      url: editorUrl,
      label: t("editorToolbar.editorLink"),
      description: t("editorToolbar.editorLinkDescription"),
    },
    presentation: {
      url: presentationUrl,
      label: t("editorToolbar.presentationLink"),
      description: t("editorToolbar.presentationLinkDescription"),
    },
  };
  const shareLinkOrder = getDeckShareLinkOrder(deck.visibility);
  const primaryShareLink = shareLinks[shareLinkOrder.primary];
  const secondaryShareLink = shareLinks[shareLinkOrder.secondary];

  // Live save state for the toolbar indicator, so users always see whether
  // their work has committed (a lost-deck report motivated surfacing this).
  const { saving } = useSaveState();
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  useEffect(() => {
    const online = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // The contextual toolbar hosts the action cluster whenever it is on screen.
  // That row rides on SlideEditor, which only mounts for a real slide, so an
  // empty deck must keep this fallback or it has no way to add one.
  const contextToolbarVisible = canEdit && Boolean(currentSlide);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);
  const isDark = themeMounted ? resolvedTheme === "dark" : false;
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    toast(t("editorToolbar.importingFile"), {
      description: t("editorToolbar.readingFile", { fileName: file.name }),
    });
    const formData = new FormData();
    formData.append("file", file);
    try {
      const uploadRes = await fetch(`${appBasePath()}/api/uploads`, {
        method: "POST",
        body: formData,
      });
      // R83 — guard the parse: a failed upload can come back as a non-JSON
      // body (upstream proxy/platform error page, plaintext "Internal
      // Error", etc.). Parsing before the ok check used to throw a raw
      // "Unexpected token ... is not valid JSON" SyntaxError into this
      // toast instead of the clean message below.
      const uploadData = await parseUploadResponse(
        uploadRes,
        t("editorToolbar.uploadFailed"),
      );
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
      // R83 — same parse guard as the upload response above.
      const importData = await parseUploadResponse(
        importRes,
        t("editorToolbar.importFailed"),
      );
      if (!importRes.ok || importData?.error) {
        throw new Error(importData?.error || t("editorToolbar.importFailed"));
      }
      toast.success(t("editorToolbar.importComplete"), {
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
      toast.error(t("editorToolbar.importFailed"), {
        description:
          err instanceof Error
            ? err.message
            : t("editorToolbar.importFailedDescription"),
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 bg-background/95 px-2 shadow-[0_1px_0_hsl(var(--border)/0.35)] sm:px-3">
      {/* Back button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/"
            className={`${TOOLBAR_ICON_BUTTON_CLASS} hover:bg-accent`}
            aria-label={t("editorToolbar.backToDecks")}
          >
            <IconArrowLeft className="size-4 text-muted-foreground" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.backToDecks")}</TooltipContent>
      </Tooltip>

      {/* Slide-list toggle (mobile only — desktop uses the app sidebar rail) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleSidebar}
            className={`${TOOLBAR_ICON_BUTTON_CLASS} md:hidden hover:bg-accent ${
              sidebarOpen ? "text-muted-foreground" : "text-muted-foreground/70"
            }`}
            aria-label={t("editorToolbar.toggleSlideList")}
          >
            <IconLayoutSidebar className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("editorToolbar.toggleSlideList")}</TooltipContent>
      </Tooltip>

      {/* Add slide and the text-box tool live at the head of the contextual
       * toolbar below. That row is desktop-only and needs a slide to mount on,
       * so keep a fallback here for narrow screens and empty decks. */}
      {canEdit && (
        <EditorActionCluster
          className={contextToolbarVisible ? "lg:hidden" : undefined}
          deckId={deckId}
          deckTitle={deckTitle}
          currentSlideId={currentSlideId}
          slideCount={slideCount}
          currentSlideIndex={currentSlideIndex}
          addSlideGenerating={addSlideGenerating}
          onAddSlideGeneratingChange={onAddSlideGeneratingChange}
          onAddEmptySlide={onAddEmptySlide}
          onDuplicateCurrentSlide={onDuplicateCurrentSlide}
          textBoxMode={textBoxMode}
          onToggleTextBoxMode={onToggleTextBoxMode}
        />
      )}

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

      {/* Spacer */}
      <div className="flex-1 min-w-2" />

      {/* "View only" badge — mirrors Google Slides' viewer chrome */}
      {!canEdit && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {t("editorToolbar.viewOnly")}
        </span>
      )}

      {/* Save status — subtle "Saving…" / "Saved" / offline pill. Renders
          nothing when idle. Only meaningful for editors. */}
      {canEdit && (
        <SaveStatusIndicator
          saving={saving}
          offline={offline}
          className="flex-shrink-0 mr-1"
        />
      )}

      {/* Presence avatars — shared PresenceBar (agent + collaborators) */}
      <PresenceBar
        activeUsers={activeUsers ?? []}
        agentPresent={agentPresent}
        agentActive={agentActive}
        showAgentEditingDot={false}
        currentUserEmail={currentUserEmail}
        className="flex-shrink-0 mr-0.5"
      />

      {/* Framework share (ownership, per-user/org grants, visibility) */}
      <div className="flex-shrink-0">
        <ShareButton
          resourceType="deck"
          resourceId={deckId}
          resourceTitle={deckTitle}
          shareUrl={primaryShareLink.url}
          shareUrlLabel={primaryShareLink.label}
          shareUrlDescription={primaryShareLink.description}
          secondaryShareUrl={secondaryShareLink.url}
          secondaryShareUrlLabel={secondaryShareLink.label}
          secondaryShareUrlDescription={secondaryShareLink.description}
          shareTabs={{
            tabs: [
              {
                value: "context",
                label: "Context",
                content: (
                  <CreativeContextShareTab
                    resource={{
                      appId: "slides",
                      resourceType: "deck",
                      resourceId: deckId,
                      title: deckTitle,
                      updatedAt: deck.updatedAt,
                      preview: { kind: "document", label: "Deck" },
                    }}
                  />
                ),
              },
            ],
          }}
        />
      </div>
      {/* Present button — matches Share trigger height (h-9) */}
      <Link
        to={`/deck/${deckId}/present?slide=${currentSlideIndex + 1}`}
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

      {/* Consolidated editor menu */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                ref={historyButtonRef}
                className={`${TOOLBAR_ICON_BUTTON_CLASS} cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground/70`}
                aria-label={t("editorToolbar.more")}
              >
                <IconDotsVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("editorToolbar.more")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="max-h-[min(80vh,32rem)] w-64 overflow-y-auto"
        >
          {canEdit && (
            <>
              <DropdownMenuLabel>{t("editorToolbar.media")}</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={onGenerateImage}>
                  <IconPhoto className="size-4" />
                  {t("editorToolbar.generateImage")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenAssetLibrary}>
                  <IconFolderOpen className="size-4" />
                  {t("editorToolbar.assetLibrary")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}

          {canEdit &&
            (onToggleAnimations ||
              onToggleTweaks ||
              onToggleDrawMode ||
              onTogglePinMode) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t("editorToolbar.slideTools")}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {currentSlide && onToggleAnimations && (
                    <DropdownMenuItem
                      onSelect={onToggleAnimations}
                      className={
                        animationsOpen
                          ? "bg-accent text-accent-foreground"
                          : undefined
                      }
                    >
                      <IconBolt className="size-4" />
                      {t("editorToolbar.elementAnimations")}
                    </DropdownMenuItem>
                  )}
                  {onToggleTweaks && (
                    <DropdownMenuItem
                      onSelect={onToggleTweaks}
                      className={
                        tweaksOpen
                          ? "bg-accent text-accent-foreground"
                          : undefined
                      }
                    >
                      <IconAdjustments className="size-4" />
                      {t("editorToolbar.tweaks")}
                    </DropdownMenuItem>
                  )}
                  {onToggleDrawMode && (
                    <DropdownMenuItem
                      onSelect={onToggleDrawMode}
                      data-toolbar-draw-button
                      className={
                        drawMode
                          ? "bg-accent text-accent-foreground"
                          : undefined
                      }
                    >
                      <IconPencilPlus className="size-4" />
                      {t("editorToolbar.drawOnSlide")}
                    </DropdownMenuItem>
                  )}
                  {onTogglePinMode && (
                    <DropdownMenuItem
                      onSelect={onTogglePinMode}
                      data-toolbar-pin-button
                      className={
                        pinMode ? "bg-accent text-accent-foreground" : undefined
                      }
                    >
                      <IconPin className="size-4" />
                      {t("editorToolbar.pinComments")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </>
            )}

          {onToggleComments && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("editorToolbar.comments")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={onToggleComments}
                className={
                  commentsOpen ? "bg-accent text-accent-foreground" : undefined
                }
              >
                <IconMessage className="size-4" />
                {t("editorToolbar.comments")}
                {unresolvedCommentCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {unresolvedCommentCount > 9 ? "9+" : unresolvedCommentCount}
                  </span>
                )}
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <ExportMenu
            inline
            deckId={deckId}
            deckTitle={deckTitle}
            onDuplicate={onDuplicateDeck ?? (() => {})}
            onExportPdf={onExportPdf ?? (() => {})}
            onExportPptx={onExportPptx ?? (() => {})}
            onExportGoogleSlides={onExportGoogleSlides}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={importing}
            onSelect={() => fileInputRef.current?.click()}
          >
            {importing ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconDownload className="size-4" />
            )}
            {importing
              ? t("editorToolbar.importing")
              : t("editorToolbar.importFile")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onShowHistory}>
            <IconHistory className="size-4" />
            {t("editorToolbar.savedVersions")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? (
              <IconSun className="size-4" />
            ) : (
              <IconMoon className="size-4" />
            )}
            {isDark
              ? t("editorToolbar.lightTheme")
              : t("editorToolbar.darkTheme")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RunsTray pollMs={0} />
      <AgentToggleButton />
    </div>
  );
}
