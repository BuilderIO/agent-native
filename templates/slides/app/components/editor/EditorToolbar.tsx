import { agentNativePath, appPath } from "@agent-native/core/client/api-path";
import { type CollabUser } from "@agent-native/core/client/collab";
import { useT } from "@agent-native/core/client/i18n";
import {
  openMcpAppHostLink,
  useIsMcpAppWidgetEmbed,
  useIsMcpDirectoryWidgetReadOnlyEmbed,
} from "@agent-native/core/client/mcp-app-host";
import { reloadForClientCompatibilityMismatch } from "@agent-native/core/client/route-chunk-recovery";
import {
  CreativeContextShareTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { RunsTray } from "@agent-native/toolkit/app/progress";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import {
  IconCircle,
  IconLayoutSidebar,
  IconPhoto,
  IconHistory,
  IconFolderOpen,
  IconMessage,
  IconDownload,
  IconSun,
  IconMoon,
  IconDotsVertical,
  IconExternalLink,
  IconLoader2,
  IconAdjustments,
  IconPencilPlus,
  IconBrandGoogle,
  IconCode,
  IconCopy,
  IconFileTypePdf,
  IconPlus,
  IconSquare,
  IconTextSize,
  IconBolt,
  IconStack2,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
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
import {
  getDeckSaveError,
  hasFailedDeckSave,
  hasUnsavedDeckChanges,
  useDeckContentConflicts,
  useDecks,
  useSaveState,
  type DeckContentConflictChoice,
  type Deck,
  type Slide,
} from "@/context/DeckContext";
import { useDeckVisibility } from "@/hooks/use-deck-visibility";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import { isDeckAccessLostStatus } from "@/lib/deck-access-lost";
import { DeckBackupError } from "@/lib/deck-backup";
import type { PresentRequest } from "@/lib/deck-present-url";
import {
  getDeckShareLinkOrder,
  type DeckShareLinkKind,
} from "@/lib/deck-share-links";
import type { GoogleSlidesExportResult } from "@/lib/export-google-slides-client";
import { isStorageSetupRequiredError } from "@/lib/image-drop-to-agent";
import {
  cleanupUploadedPromptFiles,
  formatPromptUploadFailure,
  isPromptUploadAuthRequiredError,
  isPromptUploadLimitError,
  isPromptUploadNetworkError,
  isPromptUploadStorageStatusError,
  uploadPromptFiles,
  type UploadedFile,
} from "@/lib/prompt-file-uploads";
import {
  parseUploadResponse,
  promptImportResponseError,
} from "@/lib/upload-response";

import {
  normalizeSlideTransition,
  SLIDE_TRANSITION_TYPES,
  type SlideTransitionType,
} from "../../../shared/slide-transitions";
import { AppMenu } from "./AppMenu";
import { DeckPrivacyBadge } from "./DeckPrivacyBadge";
import { DeckShareAgentTab } from "./DeckShareAgentTab";
import {
  registerEditorCommands,
  type EditorCommand,
} from "./editor-command-model";
import {
  EditorActionCluster,
  type SlideShapeType,
} from "./EditorActionCluster";
import {
  ExportDropdown,
  ExportMenu,
  ExportStatusDialog,
  ExportSubmenu,
  type ExportMenuHandle,
  type ExportStatus,
} from "./ExportMenu";
import { PresentMenu } from "./PresentMenu";
import type { SlideCanvasCommands } from "./SlideEditor";
import {
  SLIDE_TRANSITION_LABEL_KEYS,
  SlideTransitionControl,
  type SlideTransitionPatch,
} from "./SlideTransitionControl";

export type { PresentRequest };

interface EditorToolbarProps {
  deck: Deck;
  deckId: string;
  deckTitle: string;
  canEdit?: boolean;
  onTitleChange: (title: string) => void;
  currentSlideIndex: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onGenerateImage: () => void;
  onOpenAssetLibrary: () => void;
  onShowHistory: () => void;
  panelAnchorRef: React.RefObject<HTMLDivElement | null>;
  currentSlide?: Slide;
  onWideContextToolbarSlotChange?: (element: HTMLDivElement | null) => void;
  activeUsers?: CollabUser[];
  agentPresent?: boolean;
  agentActive?: boolean;
  commentsOpen?: boolean;
  onToggleComments?: () => void;
  unresolvedCommentCount?: number;
  currentUserEmail?: string;
  animationsOpen?: boolean;
  onToggleAnimations?: () => void;
  layersOpen?: boolean;
  onToggleLayers?: () => void;
  tweaksOpen?: boolean;
  onToggleTweaks?: () => void;
  drawMode?: boolean;
  onToggleDrawMode?: () => void;
  textBoxMode?: boolean;
  onToggleTextBoxMode?: () => void;
  shapeType?: SlideShapeType | null;
  onSelectShape?: (shape: SlideShapeType) => void;
  onChangeSlideTransition?: (patch: SlideTransitionPatch) => void;
  onApplySlideTransitionToAll?: (patch: SlideTransitionPatch) => void;
  onPlaySlideTransition?: () => void;
  onDuplicateDeck?: () => void;
  onExportPdf?: () => Promise<void> | void;
  onExportPptx?: () => Promise<void> | void;
  onExportGoogleSlides?: () => Promise<GoogleSlidesExportResult>;
  onPresent?: (request?: PresentRequest) => boolean | void;
  onDownloadBackup?: () => void;
  onImportDeckBackup?: (file: File) => Promise<{ slideCount: number }>;
  onAddEmptySlide?: () => void;
  addSlideGenerating?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canvasCommandsRef?: { current: SlideCanvasCommands | null };
  onDuplicateSlides?: () => void;
  onDeleteSlides?: () => void;
  onPreviousSlide?: () => void;
  onNextSlide?: () => void;
}

const TOOLBAR_ICON_BUTTON_CLASS =
  "inline-flex size-8 flex-shrink-0 items-center justify-center rounded-md transition-colors";

const SLIDE_TRANSITIONS: {
  value: SlideTransitionType;
  labelKey: string;
}[] = SLIDE_TRANSITION_TYPES.map((value) => ({
  value,
  labelKey: SLIDE_TRANSITION_LABEL_KEYS[value],
}));

export default function EditorToolbar({
  deck,
  deckId,
  deckTitle,
  onTitleChange,
  currentSlideIndex,
  sidebarOpen,
  onToggleSidebar,
  onGenerateImage,
  onOpenAssetLibrary,
  onShowHistory,
  panelAnchorRef,
  currentSlide,
  onWideContextToolbarSlotChange,
  activeUsers,
  agentPresent,
  agentActive,
  commentsOpen,
  onToggleComments,
  unresolvedCommentCount = 0,
  currentUserEmail,
  animationsOpen,
  onToggleAnimations,
  layersOpen,
  onToggleLayers,
  tweaksOpen,
  onToggleTweaks,
  drawMode,
  onToggleDrawMode,
  textBoxMode,
  onToggleTextBoxMode,
  shapeType,
  onSelectShape,
  onChangeSlideTransition,
  onApplySlideTransitionToAll,
  onPlaySlideTransition,
  onDuplicateDeck,
  onExportPdf,
  onExportPptx,
  onExportGoogleSlides,
  onPresent,
  onDownloadBackup,
  onImportDeckBackup,
  onAddEmptySlide,
  addSlideGenerating,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  canvasCommandsRef,
  onDuplicateSlides,
  onDeleteSlides,
  onPreviousSlide,
  onNextSlide,
  canEdit = true,
}: EditorToolbarProps) {
  const t = useT();
  // The top bar is the app's own in a widget. It drops only what the host owns
  // (the way back to the deck list, the agent panel) and what the widget's
  // write grant cannot run (comments, saved versions, export, import).
  const widgetEmbed = useIsMcpAppWidgetEmbed();
  // A read-only widget session refuses every save, so an offline or failed-save
  // pill would only restate that it is read-only.
  const readOnlyWidget = useIsMcpDirectoryWidgetReadOnlyEmbed();
  const { resolveDeckContentConflict, retryDeckSave } = useDecks();
  const hasSlides = deck.slides.length > 0;
  const creativeContextEnabled = useCreativeContextLab();
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
  const visibility = useDeckVisibility(deckId, deck.visibility);
  const shareLinkOrder = getDeckShareLinkOrder(visibility);
  // The presentation link has nothing to open until the deck has a slide.
  const visibleShareLink = (kind: DeckShareLinkKind) =>
    kind === "editor" || hasSlides ? shareLinks[kind] : undefined;
  const primaryShareLink = visibleShareLink(shareLinkOrder.primary);
  const secondaryShareLink = visibleShareLink(shareLinkOrder.secondary);

  const { saving } = useSaveState();
  const conflict = useDeckContentConflicts(deckId)[0];
  const deckHasUnsavedChanges = hasUnsavedDeckChanges(deckId);
  const saveFailed = hasFailedDeckSave(deckId);
  const saveError = getDeckSaveError(deckId);
  const queryClient = useQueryClient();
  const accessLost = saveFailed && isDeckAccessLostStatus(saveError?.status);
  const roleRefreshPendingRef = useRef(false);
  // The role query is not refetched on its own: once access comes back,
  // "View only" would otherwise outlive the failure that explained it. A retry
  // clears the failure while it is still in flight, so wait for it to settle.
  useEffect(() => {
    if (accessLost) {
      roleRefreshPendingRef.current = true;
    } else if (roleRefreshPendingRef.current && !saving) {
      roleRefreshPendingRef.current = false;
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-resource-shares"],
      });
    }
  }, [accessLost, saving, queryClient]);
  const resolveConflict = useCallback(
    async (choice: DeckContentConflictChoice) => {
      if (!conflict) return;
      const result = await resolveDeckContentConflict(
        deckId,
        conflict.slideId,
        choice,
      );
      if (result.status !== "resolved") throw new Error(result.reason);
    },
    [conflict, deckId, resolveDeckContentConflict],
  );
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

  const contextToolbarVisible = canEdit && Boolean(currentSlide);
  const showSlideTools =
    canEdit &&
    Boolean(
      (currentSlide && onToggleAnimations) ||
      onToggleTweaks ||
      onToggleDrawMode,
    );
  const showCommentsItem = !widgetEmbed && Boolean(onToggleComments);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<ExportMenuHandle>(null);
  const storageQuery = useSlideFileStorageStatus();
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const [showStorageSetup, setShowStorageSetup] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({
    state: "idle",
  });
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const [titleInputWidth, setTitleInputWidth] = useState(96);
  const [importing, setImporting] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);
  const isDark = themeMounted ? resolvedTheme === "dark" : false;
  const activeSlideTransition = normalizeSlideTransition(
    currentSlide?.transition,
  );
  const openFileImport = useCallback(() => {
    if (storageQuery.isLoading) {
      setShowStorageSetup(true);
      return;
    }
    if (fileStorageConfigured) {
      fileInputRef.current?.click();
    } else {
      setShowStorageSetup(true);
    }
  }, [fileStorageConfigured, storageQuery.isLoading]);

  useEffect(() => {
    if (showStorageSetup && fileStorageConfigured) {
      setShowStorageSetup(false);
    }
  }, [fileStorageConfigured, showStorageSetup]);

  useLayoutEffect(() => {
    const measuredWidth =
      titleMeasureRef.current?.getBoundingClientRect().width;
    if (typeof measuredWidth !== "number" || !Number.isFinite(measuredWidth)) {
      return;
    }
    setTitleInputWidth(
      Math.min(500, Math.max(96, Math.ceil(measuredWidth) + 16)),
    );
  }, [deckTitle]);
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") && !fileStorageConfigured) {
      setShowStorageSetup(true);
      e.target.value = "";
      return;
    }
    try {
      await importFileOnce(file);
    } finally {
      e.target.value = "";
    }
  };

  const importFileOnce = async (file: File) => {
    setImporting(true);
    let uploadedFiles: UploadedFile[] = [];
    toast(t("editorToolbar.importingFile"), {
      description: t("editorToolbar.readingFile", { fileName: file.name }),
    });
    try {
      if (file.name.toLowerCase().endsWith(".json")) {
        if (!onImportDeckBackup) throw new DeckBackupError();
        const { slideCount } = await onImportDeckBackup(file);
        toast.success(t("editorToolbar.importComplete"), {
          description: t("editorToolbar.importCompleteSlides", {
            count: slideCount,
            fileName: file.name,
          }),
        });
        return;
      }

      uploadedFiles = await uploadPromptFiles(
        [file],
        t("home.referenceFileStorageUnavailable"),
      );
      const uploaded = uploadedFiles[0];
      if (!uploaded) throw new Error(t("editorToolbar.uploadMissingPath"));

      const importRes = await fetch(
        agentNativePath("/_agent-native/actions/import-file"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: uploaded.path,
            deckId,
            format: "auto",
            importIntoDeck: true,
          }),
        },
      );
      const importData = await parseUploadResponse(
        importRes,
        t("editorToolbar.importFailed"),
      );
      if (!importRes.ok || importData?.error) {
        throw promptImportResponseError(
          importRes.status,
          importData,
          t("editorToolbar.importFailed"),
        );
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
      const storageSetupRequired = isStorageSetupRequiredError(err);
      if (storageSetupRequired) void storageQuery.refetch();
      // A timeout, a gateway page or a dropped connection says nothing about
      // the file, so the same import is offered again rather than a new pick.
      const retryable =
        !storageSetupRequired &&
        !(err instanceof DeckBackupError) &&
        isPromptUploadNetworkError(err);
      toast.error(t("editorToolbar.importFailed"), {
        ...(retryable
          ? {
              action: {
                label: t("home.retry"),
                onClick: () => void importFileOnce(file),
              },
            }
          : {}),
        description: formatPromptUploadFailure(
          err,
          storageSetupRequired
            ? t("home.fileStorageSetupRequired")
            : err instanceof DeckBackupError
              ? t("editorToolbar.invalidBackup")
              : isPromptUploadAuthRequiredError(err)
                ? t("home.importMenu.notStarted")
                : isPromptUploadNetworkError(err)
                  ? t("home.importMenu.networkFailed")
                  : isPromptUploadLimitError(err)
                    ? t("home.importMenu.uploadLimitExceeded")
                    : isPromptUploadStorageStatusError(err)
                      ? t("editorToolbar.importFailedDescription")
                      : err instanceof Error
                        ? err.message
                        : t("editorToolbar.importFailedDescription"),
        ),
      });
    } finally {
      await cleanupUploadedPromptFiles(uploadedFiles);
      setImporting(false);
    }
  };

  const editorCommands = useMemo<EditorCommand[]>(() => {
    const commands: EditorCommand[] = [];
    if (canEdit) {
      if (onAddEmptySlide) {
        commands.push({
          id: "new-slide",
          group: "slideTools",
          label: t("editorSidebar.newSlide"),
          keywords: ["slide", "add", "insert", "new"],
          icon: IconPlus,
          run: () => {
            if (!addSlideGenerating) onAddEmptySlide();
          },
        });
      }
      if (onToggleTextBoxMode) {
        commands.push({
          id: "add-text-box",
          group: "slideTools",
          label: t("editorToolbar.addTextBox"),
          keywords: ["text", "box", "insert"],
          icon: IconTextSize,
          active: textBoxMode,
          run: onToggleTextBoxMode,
        });
      }
      if (currentSlide && onSelectShape) {
        commands.push(
          {
            id: "shape-rectangle",
            group: "slideTools",
            label: t("editorToolbar.shapeRectangle"),
            keywords: ["shape", "rectangle", "square", "insert"],
            icon: IconSquare,
            active: shapeType === "rectangle",
            run: () => onSelectShape("rectangle"),
          },
          {
            id: "shape-circle",
            group: "slideTools",
            label: t("editorToolbar.shapeCircle"),
            keywords: ["shape", "circle", "ellipse", "insert"],
            icon: IconCircle,
            active: shapeType === "circle",
            run: () => onSelectShape("circle"),
          },
        );
      }
      commands.push(
        {
          id: "generate-image",
          group: "media",
          label: t("editorToolbar.generateImage"),
          keywords: ["image", "media", "ai"],
          icon: IconPhoto,
          run: onGenerateImage,
        },
        {
          id: "asset-library",
          group: "media",
          label: t("editorToolbar.assetLibrary"),
          keywords: ["image", "media", "assets"],
          icon: IconFolderOpen,
          run: onOpenAssetLibrary,
        },
      );
      if (currentSlide && onToggleAnimations) {
        commands.push({
          id: "element-animations",
          group: "slideTools",
          label: t("animations.title"),
          keywords: ["animation", "motion", "transition"],
          icon: IconBolt,
          active: animationsOpen,
          run: onToggleAnimations,
        });
      }
      if (currentSlide && onToggleLayers) {
        commands.push({
          id: "layers",
          group: "slideTools",
          label: t("editorToolbar.layers"),
          keywords: ["layers", "hierarchy", "stack"],
          icon: IconStack2,
          active: layersOpen,
          run: onToggleLayers,
        });
      }
      if (onToggleTweaks) {
        commands.push({
          id: "slide-tweaks",
          group: "slideTools",
          label: t("editorToolbar.tweaks"),
          keywords: ["style", "inspect", "adjust"],
          icon: IconAdjustments,
          active: tweaksOpen,
          run: onToggleTweaks,
        });
      }
      if (onToggleDrawMode) {
        commands.push({
          id: "draw-on-slide",
          group: "slideTools",
          label: t("editorToolbar.drawOnSlide"),
          keywords: ["annotate", "draw"],
          icon: IconPencilPlus,
          active: drawMode,
          run: onToggleDrawMode,
        });
      }
    }

    if (canEdit && currentSlide && onChangeSlideTransition) {
      commands.push(
        ...SLIDE_TRANSITIONS.map((transition) => ({
          id: `slide-transition-${transition.value}`,
          group: "slideTools" as const,
          label: t(transition.labelKey),
          keywords: ["slide", "transition", transition.value],
          icon: IconBolt,
          active: activeSlideTransition === transition.value,
          run: () => onChangeSlideTransition({ transition: transition.value }),
        })),
      );
    }
    if (onToggleComments) {
      commands.push({
        id: "comments",
        group: "comments",
        label: t("editorToolbar.comments"),
        keywords: ["comment", "review"],
        icon: IconMessage,
        active: commentsOpen,
        run: onToggleComments,
      });
    }

    if (hasSlides) {
      commands.push(
        {
          id: "download-html",
          group: "deck",
          label: t("editorExport.downloadHtml"),
          keywords: ["export", "html", "download"],
          icon: IconCode,
          run: () => void exportMenuRef.current?.exportHtml(),
        },
        {
          id: "export-pdf",
          group: "deck",
          label: t("editorExport.exportPdf"),
          keywords: ["export", "pdf", "download"],
          icon: IconFileTypePdf,
          run: () => void exportMenuRef.current?.exportPdf(),
        },
        {
          id: "export-pptx",
          group: "deck",
          label: t("editorExport.exportPptx"),
          keywords: ["export", "powerpoint", "pptx", "download"],
          icon: IconDownload,
          run: () => void exportMenuRef.current?.exportPptx(),
        },
      );
      if (onExportGoogleSlides) {
        commands.push({
          id: "export-to-google-slides",
          group: "deck",
          label: t("editorExport.openInGoogleSlides"),
          keywords: ["google", "slides", "export"],
          icon: IconBrandGoogle,
          run: () => void exportMenuRef.current?.exportGoogleSlides(),
        });
      }
    }
    if (onDuplicateDeck) {
      commands.push({
        id: "duplicate-deck",
        group: "deck",
        label: t("editorExport.duplicateDeck"),
        keywords: ["copy", "duplicate"],
        icon: IconCopy,
        run: onDuplicateDeck,
      });
    }
    commands.push(
      {
        id: "import-file",
        group: "other",
        label: importing
          ? t("editorToolbar.importing")
          : t("editorToolbar.importFile"),
        keywords: ["import", "pptx", "docx", "pdf"],
        icon: importing ? IconLoader2 : IconDownload,
        run: () => void openFileImport(),
      },
      {
        id: "saved-versions",
        group: "other",
        label: t("editorToolbar.savedVersions"),
        keywords: ["history", "versions", "restore"],
        icon: IconHistory,
        run: onShowHistory,
      },
      {
        id: "toggle-theme",
        group: "other",
        label: isDark
          ? t("editorToolbar.lightTheme")
          : t("editorToolbar.darkTheme"),
        keywords: ["theme", "dark", "light", "mode"],
        icon: isDark ? IconSun : IconMoon,
        run: () => setTheme(isDark ? "light" : "dark"),
      },
    );
    return commands;
  }, [
    activeSlideTransition,
    addSlideGenerating,
    animationsOpen,
    layersOpen,
    canEdit,
    commentsOpen,
    currentSlide,
    drawMode,
    hasSlides,
    importing,
    isDark,
    openFileImport,
    onAddEmptySlide,
    onDuplicateDeck,
    onExportGoogleSlides,
    onExportPdf,
    onGenerateImage,
    onOpenAssetLibrary,
    onShowHistory,
    onSelectShape,
    onChangeSlideTransition,
    onToggleAnimations,
    onToggleLayers,
    onToggleComments,
    onToggleDrawMode,
    onToggleTextBoxMode,
    onToggleTweaks,
    setTheme,
    shapeType,
    t,
    textBoxMode,
    tweaksOpen,
  ]);
  const editorCommandsRef = useRef<readonly EditorCommand[]>(editorCommands);
  editorCommandsRef.current = editorCommands;

  useEffect(() => registerEditorCommands(() => editorCommandsRef.current), []);

  // The host decides how a link leaves the widget frame; a host that cannot
  // open it, or has no bridge, falls back to a plain new tab.
  const openEditorInApp = () => {
    const openTab = () =>
      window.open(editorUrl, "_blank", "noopener,noreferrer");
    const request = openMcpAppHostLink(editorUrl);
    if (!request) {
      openTab();
      return;
    }
    void request.then((opened) => {
      if (!opened) openTab();
    }, openTab);
  };

  return (
    <div className="deck-editor-toolbar flex h-12 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap bg-background px-2 sm:px-3">
      <AppMenu
        widgetEmbed={widgetEmbed}
        canEdit={canEdit}
        exportMenu={
          <ExportSubmenu
            exportMenuRef={exportMenuRef}
            hasSlides={hasSlides}
            showGoogleSlides={Boolean(onExportGoogleSlides)}
          />
        }
        importing={importing}
        onImportFile={() => void openFileImport()}
        onDuplicateDeck={onDuplicateDeck}
        onDownloadBackup={onDownloadBackup}
        onShowHistory={onShowHistory}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        canvasCommandsRef={canvasCommandsRef}
        onDuplicateSlides={onDuplicateSlides}
        onDeleteSlides={onDeleteSlides}
        onPreviousSlide={onPreviousSlide}
        onNextSlide={onNextSlide}
      />

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

      {/* The contextual toolbar below carries the text-box tool whenever
       * there's a current slide (New Slide lives in the sidebar then). Render
       * this fallback only for an empty deck so the buttons never show twice. */}
      {canEdit && !contextToolbarVisible && (
        <EditorActionCluster
          textBoxMode={textBoxMode}
          onToggleTextBoxMode={onToggleTextBoxMode}
          onAddEmptySlide={onAddEmptySlide}
          addSlideGenerating={addSlideGenerating}
        />
      )}

      {/* Deck title */}
      <span
        ref={titleMeasureRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] whitespace-pre text-sm font-medium opacity-0"
      >
        {deckTitle || " "}
      </span>
      <input
        type="text"
        value={deckTitle}
        readOnly={!canEdit}
        onChange={(e) => onTitleChange(e.target.value)}
        style={{ width: `${titleInputWidth}px` }}
        className="min-w-0 max-w-[500px] shrink-0 bg-transparent text-sm font-medium text-foreground/90 outline-none focus:text-foreground"
        spellCheck={false}
      />
      <DeckPrivacyBadge visibility={visibility} />

      {/* Spacer */}
      <div className="w-2 shrink-0" />

      <div
        ref={onWideContextToolbarSlotChange}
        data-context-toolbar-host="wide"
        data-context-toolbar-visible={contextToolbarVisible ? "true" : "false"}
        className="deck-editor-context-toolbar-host deck-editor-context-toolbar-host--wide"
      />

      {/* "View only" badge — mirrors Google Slides' viewer chrome */}
      {!canEdit && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {t("editorToolbar.viewOnly")}
        </span>
      )}

      {/* Save status — subtle "Saving…" / "Saved" / offline pill. Renders
          nothing when idle. Only meaningful for editors. */}
      {!readOnlyWidget && (canEdit || saveFailed) && (
        <SaveStatusIndicator
          saving={saving}
          hasUnsavedChanges={deckHasUnsavedChanges}
          saveFailed={saveFailed}
          saveError={saveError}
          offline={offline}
          conflict={
            conflict
              ? {
                  slideNumber: Math.max(
                    1,
                    deck.slides.findIndex(
                      (slide) => slide.id === conflict.slideId,
                    ) + 1,
                  ),
                  canResolve: conflict.canResolve,
                }
              : undefined
          }
          onResolveConflict={resolveConflict}
          onRetrySave={() => retryDeckSave(deckId)}
          onReload={() => {
            if (saveError?.serverBuildId && saveError.requiredCompatibility) {
              reloadForClientCompatibilityMismatch(
                saveError.serverBuildId,
                saveError.requiredCompatibility,
                window,
                { force: true },
              );
            } else {
              window.location.reload();
            }
          }}
          onDownloadBackup={!widgetEmbed ? onDownloadBackup : undefined}
          onImportBackup={
            !widgetEmbed && canEdit && onImportDeckBackup
              ? () => backupInputRef.current?.click()
              : undefined
          }
          className="flex-shrink-0 mr-1"
        />
      )}

      {/* Top-right editor actions */}
      <div
        ref={panelAnchorRef}
        className="ml-auto flex shrink-0 items-center gap-1"
      >
        {/* Slide transition — the current slide's entry transition, speed,
            apply-to-all, and preview. */}
        {canEdit &&
          currentSlide &&
          onChangeSlideTransition &&
          onApplySlideTransitionToAll && (
            <SlideTransitionControl
              currentSlide={currentSlide}
              currentSlideIndex={currentSlideIndex}
              canEdit={canEdit}
              onChange={onChangeSlideTransition}
              onApplyToAll={onApplySlideTransitionToAll}
              onPlay={onPlaySlideTransition}
            />
          )}

        {/* Presence avatars — shared PresenceBar (agent + collaborators) */}
        <PresenceBar
          activeUsers={activeUsers ?? []}
          agentPresent={agentPresent}
          agentActive={agentActive}
          currentUserEmail={currentUserEmail}
          className="flex-shrink-0 pl-2"
        />

        {/* Consolidated editor menu */}
        {(showSlideTools || showCommentsItem) && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`${TOOLBAR_ICON_BUTTON_CLASS} cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground/70`}
                    aria-label={t("editorToolbar.more")}
                  >
                    <IconDotsVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("editorToolbar.more")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              forceMount
              align="end"
              className="max-h-[90vh] w-64 overflow-y-auto"
            >
              {showSlideTools && (
                <>
                  <DropdownMenuLabel>
                    {t("editorToolbar.slideTools")}
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {canEdit && currentSlide && onToggleAnimations && (
                      <DropdownMenuItem
                        onSelect={onToggleAnimations}
                        className={
                          animationsOpen
                            ? "bg-accent text-accent-foreground"
                            : undefined
                        }
                      >
                        <IconBolt className="size-4" />
                        {t("animations.title")}
                      </DropdownMenuItem>
                    )}
                    {canEdit && onToggleTweaks && (
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
                    {canEdit && onToggleDrawMode && (
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
                  </DropdownMenuGroup>
                </>
              )}

              {showCommentsItem && (
                <>
                  {showSlideTools && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={onToggleComments}
                    className={
                      commentsOpen
                        ? "bg-accent text-accent-foreground"
                        : undefined
                    }
                  >
                    <IconMessage className="size-4" />
                    {t("editorToolbar.comments")}
                    {unresolvedCommentCount > 0 && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {unresolvedCommentCount > 9
                          ? "9+"
                          : unresolvedCommentCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Always mounted so the command palette's export commands have a
            handle even while the app menu is closed. */}
        <ExportMenu
          ref={exportMenuRef}
          headless
          hideExportDialog
          onExportStatusChange={setExportStatus}
          hasSlides={hasSlides}
          deckId={deckId}
          deckTitle={deckTitle}
          onDuplicate={onDuplicateDeck ?? (() => {})}
          onExportPdf={onExportPdf ?? (() => {})}
          onExportPptx={onExportPptx ?? (() => {})}
          onExportGoogleSlides={onExportGoogleSlides}
        />
        <ExportStatusDialog
          status={exportStatus}
          onStatusChange={setExportStatus}
        />
      </div>

      {/* Framework share (ownership, per-user/org grants, visibility) */}
      <div className="flex-shrink-0">
        <ShareButton
          resourceType="deck"
          resourceId={deckId}
          resourceTitle={deckTitle}
          panelTitle={t("share.title")}
          roleCopy={{
            commenter: {
              label: t("editorToolbar.commenterRoleLabel"),
              description: t("editorToolbar.commenterRoleDescription"),
            },
          }}
          shareUrl={primaryShareLink?.url}
          shareUrlLabel={primaryShareLink?.label}
          shareUrlDescription={primaryShareLink?.description}
          secondaryShareUrl={secondaryShareLink?.url}
          secondaryShareUrlLabel={secondaryShareLink?.label}
          secondaryShareUrlDescription={secondaryShareLink?.description}
          showShareLinks={Boolean(primaryShareLink || secondaryShareLink)}
          shareUrlPlacement="bottom"
          peopleAccessLabel={t("share.whoHasAccess")}
          agentTabContent={
            widgetEmbed ? undefined : <DeckShareAgentTab deckId={deckId} />
          }
          basicSharingOnly={widgetEmbed}
          shareTabs={
            creativeContextEnabled && !widgetEmbed
              ? {
                  tabs: [
                    {
                      value: "context",
                      label: t("creativeContext.share.tabLabel"),
                      content: (
                        <CreativeContextShareTab
                          resource={{
                            appId: "slides",
                            resourceType: "deck",
                            resourceId: deckId,
                            title: deckTitle,
                            updatedAt: deck.updatedAt,
                            preview: {
                              kind: "document",
                              label: t("header.deck"),
                            },
                          }}
                        />
                      ),
                    },
                  ],
                }
              : undefined
          }
        />
      </div>
      {!widgetEmbed && (
        <ExportDropdown
          exportMenuRef={exportMenuRef}
          hasSlides={hasSlides}
          showGoogleSlides={Boolean(onExportGoogleSlides)}
        />
      )}
      {widgetEmbed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`${TOOLBAR_ICON_BUTTON_CLASS} cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground/70`}
              aria-label={t("editorToolbar.openInAgentNative")}
              onClick={openEditorInApp}
            >
              <IconExternalLink className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("editorToolbar.openInAgentNative")}
          </TooltipContent>
        </Tooltip>
      )}
      <PresentMenu
        deckId={deckId}
        currentSlideIndex={currentSlideIndex}
        hasSlides={hasSlides}
        onPresent={onPresent}
      />

      {/* Hidden file input for "Import" overflow menu item */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx,.docx,.pdf"
        onChange={handleImportFile}
        className="hidden"
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
      />
      <UploadStorageGate
        configured={fileStorageConfigured}
        unavailable={!storageQuery.isSuccess}
        open={showStorageSetup}
        onOpenChange={setShowStorageSetup}
        onRetry={() => void storageQuery.refetch()}
      />

      {!widgetEmbed && (
        <div className="flex items-center gap-1">
          <RunsTray pollMs={0} />
          <AgentToggleButton />
        </div>
      )}
    </div>
  );
}
