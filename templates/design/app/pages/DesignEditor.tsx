import {
  generateTabId,
  AgentChatSurface,
  buildDynamicAgentSuggestions,
  type AgentDynamicSuggestionContext,
  isAssistantChatHistoryVersion,
  type AssistantChatHistoryConfig,
  type AssistantChatHistoryVersion,
  setAgentChatContextItem,
  removeAgentChatContextItem,
  useAgentChatContext,
  useExternalAgentHost,
} from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  usePresence,
  useFollowUser,
  useRecentEdits,
  type CollabUser,
  type AttributedRecentEdit,
  type OtherPresence,
} from "@agent-native/core/client/collab";
import { type PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import {
  useActionQuery,
  useActionMutation,
  actionErrorMessage,
  callAction,
  tryCallActionKeepalive,
  useSession,
  getBrowserTabId,
  readClientAppState,
  setClientAppState,
  useChangeVersion,
  useChangeVersions,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import {
  getBuilderParentOrigin,
  isEmbedAuthActive,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import {
  buildReviewThreads,
  useReviewComments,
  useSendReviewThreadToAgent,
  type ReviewThread,
} from "@agent-native/core/client/review";
import {
  ShareButton,
  withShareLinkAttribution,
} from "@agent-native/core/client/sharing";
import type { ReviewComment } from "@agent-native/core/review";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import {
  CreativeContextShareTab,
  parseCreativeContexts,
  useCreativeContextLabState,
  useCreativeContexts,
  useCreativeContextState,
  readCreativeContextState,
} from "@agent-native/creative-context/client";
import {
  LiveCursorOverlay,
  PresenceBar,
  RemoteSelectionRings,
  RecentEditHighlights,
} from "@agent-native/toolkit/collab-ui";
import type { ScrubRelativeExpression } from "@agent-native/toolkit/design-tweaks";
import {
  isBoardFile,
  normalizePoisonedBoardNestedCoords,
} from "@shared/board-file";
import {
  getBreakpointOverrideState,
  removeBreakpointMediaDeclaration,
} from "@shared/breakpoint-media";
import {
  builderPreviewOrigin,
  isBuilderPreviewUrl,
} from "@shared/builder-preview-url";
import {
  type CanvasFrameGeometry,
  type CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import {
  getElementWorldBoundsForZoomFit,
  getFrameGroupBounds,
  type FrameBounds,
  type FrameEntry,
} from "@shared/canvas-math";
import { resolveSourceCapabilities } from "@shared/capability-resolver";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerSource,
  type CodeLayerTreeNode,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import {
  componentNodeIdMatches,
  extractProps,
  isComponentInstance,
  isComponentInstanceForInstanceActions,
  propNameToDataAttribute,
} from "@shared/component-model";
import { getOverviewScreenFileIds } from "@shared/design-files";
import { DESIGN_REVIEW_PANEL } from "@shared/design-flags";
import type { A11yFinding } from "@shared/design-review";
import {
  DESIGN_CAPABILITY_NAMES,
  hasCapability,
} from "@shared/design-source-capabilities";
import { FULL_APP_BUILDING, readFusionApp } from "@shared/full-app";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import type { InteractionState } from "@shared/interaction-states";
import { DESIGN_TWEAKS } from "@shared/labs";
import type { LayoutGrid } from "@shared/layout-grid";
import { readLiteralJsxPropsAtAnchor } from "@shared/local-jsx-visual-edit";
import { countLockedLayersAcrossFiles } from "@shared/locked-layers";
import type { MotionAnimationClip, MotionEase } from "@shared/motion-timeline";
import {
  copyLayerAnimation,
  pasteLayerAnimation,
} from "@shared/motion-timeline";
import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  isNodeRewriteProposal,
  isPendingDesignReprompt,
  type NodeRewriteProposal,
} from "@shared/node-rewrite";
import {
  maxPenCornerRadius,
  parsePenNodes,
  setPenNodeCornerRadius,
  translatePenPath,
  type PenGeometry,
  type PenPath,
} from "@shared/pen-path";
import type { SourceNodeProvenance } from "@shared/preview-source-provenance";
import {
  breakpointUpperBoundPx,
  utilityStem,
} from "@shared/responsive-classes";
import {
  getResponsiveBreakpointHeightPx,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "@shared/responsive-frame-layout";
import { readDesignReviewSummary } from "@shared/review-summary";
import {
  annotateScreenHtmlForPersist,
  normalizeScreenHtml,
} from "@shared/screen-annotation";
import {
  isRunningAppSourceType,
  normalizeDesignSourceType,
  sourcePositionPrecision,
} from "@shared/source-mode";
import { sourceContentHash } from "@shared/source-workspace";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconArrowsDown,
  IconPencil,
  IconLayoutGrid,
  IconX,
  IconPin,
  IconCode,
  IconArchive,
  IconPhoto,
  IconChevronDown,
  IconCheck,
  IconDownload,
  IconClipboard,
  IconFileExport,
  IconFileStack,
  IconLayoutSidebar,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconRocket,
  IconExternalLink,
  IconTerminal2,
  IconLink,
  IconKeyboard,
  IconTemplate,
  IconHistory,
  IconAdjustmentsHorizontal,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import {
  useParams,
  useNavigate,
  Link,
  useLocation,
  useBlocker,
} from "react-router";
import { toast } from "sonner";
import * as Y from "yjs";

import { AddLocalhostScreenDialog } from "@/components/design/AddLocalhostScreenDialog";
import { AutoLayoutSuggestionDialog } from "@/components/design/AutoLayoutSuggestionDialog";
import {
  BreakpointDeviceControl,
  breakpointLabelForWidth,
} from "@/components/design/BreakpointBar";
import {
  CanvasContextMenu,
  type CanvasContextMenuHandle,
  type CanvasContextMenuPoint,
} from "@/components/design/CanvasContextMenu";
import { type CodeWorkbenchActiveFile } from "@/components/design/code-workbench/CodeWorkbench";
import { CodeWorkbenchLoader } from "@/components/design/code-workbench/CodeWorkbenchLoader";
import type { CreatePrimitiveSpec } from "@/components/design/design-canvas/creation";
import type {
  IframeContextMenuPayload,
  IframeHotkeyPayload,
  IframeFigmaClipboardPastePayload,
  IframeImagePastePayload,
} from "@/components/design/design-canvas/iframe-events";
import type { MotionTrackWire } from "@/components/design/design-canvas/motion-types";
import {
  failPendingTextCapture,
  registerPendingTextHostCommit,
} from "@/components/design/design-canvas/pending-text-capture";
import {
  recordDesignPerformance,
  trace,
} from "@/components/design/design-trace";
import {
  DesignCanvas,
  type EditorDragStateChange,
} from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import {
  AssetLibraryPanel,
  DesignExtensionsPanel,
  type DesignExtensionSlotContext,
} from "@/components/design/DesignExtensionsPanel";
import { DesignImportPanel } from "@/components/design/DesignImportPanel";
import { componentInstanceHasLocalOverrides } from "@/components/design/edit-panel/component-section";
import {
  rewriteSelectionFillStyles,
  selectionColorTargets,
} from "@/components/design/edit-panel/document-colors";
import { sizeNeedsMeasurement } from "@/components/design/edit-panel/element-classification";
import { inspectCodeDataForElement } from "@/components/design/edit-panel/inspect-code-source";
import type { ScaleToolControls } from "@/components/design/edit-panel/scale-properties";
import type { CapturedStyleTarget } from "@/components/design/edit-panel/style-change-types";
import {
  mergeRotationValue,
  parseRotationValue,
} from "@/components/design/edit-panel/transform-helpers";
import { nextTextDecorationLineValue } from "@/components/design/edit-panel/typography-helpers";
import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { DesignBottomToolbar } from "@/components/design/editor/DesignBottomToolbar";
import {
  DesignWorkspaceRail,
  INITIAL_GENERATION_DISABLED_LEFT_PANELS,
} from "@/components/design/editor/DesignWorkspaceRail";
import { HistoryPanel } from "@/components/design/editor/HistoryPanel";
import type { DesignMigrationResult } from "@/components/design/editor/MakeRealDialog";
import { MakeRealDialog } from "@/components/design/editor/MakeRealDialog";
import { PendingVisualStyleWarningDialog } from "@/components/design/editor/PendingVisualStyleWarningDialog";
import { ReadOnlyEditorPanel } from "@/components/design/editor/ReadOnlyEditorPanel";
import { SaveTemplateDialog } from "@/components/design/editor/SaveTemplateDialog";
import {
  EditPanel,
  isTextElement,
  type DocumentColorSourceFile,
  type InspectCodeData,
  type InspectorTab,
  type SelectionColorScope,
  type ScreenGeometrySelection,
  type ScreenSourceSelection,
  type StyleChangeMeta,
} from "@/components/design/EditPanel";
import { FigmaHydrationDialog } from "@/components/design/FigmaHydrationDialog";
import { FigmaPasteImagesNotice } from "@/components/design/FigmaPasteImagesNotice";
import { FirstRunStart } from "@/components/design/FirstRunStart";
import { FusionAppBanner } from "@/components/design/FusionAppBanner";
import { GenerationStatusCard } from "@/components/design/GenerationStatusCard";
import {
  beginEyedropperPick,
  hasEyeDropperSupport,
  type ExportSettingsValue,
} from "@/components/design/inspector";
import { waitForShaderWriteToSettle } from "@/components/design/inspector/GlslShaderPanel";
import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { KeyboardShortcutsPanel } from "@/components/design/KeyboardShortcutsPanel";
import {
  LayersPanel,
  type LayersPanelFile,
  type LayersPanelHandle,
  type LayersPanelMoveIntent,
  type LayersPanelNode,
} from "@/components/design/LayersPanel";
import {
  LocalhostWriteConsentDialog,
  type LocalhostWriteConsentPayload,
} from "@/components/design/LocalhostWriteConsentDialog";
import {
  MotionDock,
  type MotionDockTrack,
} from "@/components/design/MotionDock";
import {
  getBoardSurfaceContentBounds,
  shouldRenderOverviewReviewCanvas,
} from "@/components/design/multi-screen/board-surface-html";
import {
  deviceViewportFloorForWidth,
  getCanonicalScreenStack,
  getInitialFrameGeometry,
  getResponsiveScreenCullGeometry,
  reorderCanonicalScreenStack,
} from "@/components/design/multi-screen/frame-geometry";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import {
  sendLinkedScreenPreviewInteractionStateStyle,
  sendLinkedScreenPreviewStyleChange,
} from "@/components/design/multi-screen/linked-screen-preview";
import {
  designPreviewWindows,
  designPreviewWindowsForScreen,
  requestSelectionMeasurement,
} from "@/components/design/multi-screen/measure-selection";
import { getCurrentBoardSelectionWorldBounds } from "@/components/design/multi-screen/overview-layout";
import {
  resolveScreenHeightMode,
  type ScreenHeightMode,
} from "@/components/design/multi-screen/screen-height";
import {
  clampScreenDimension,
  readScreenSizeConstraints,
} from "@/components/design/multi-screen/screen-sizing";
import type {
  CanvasLayerMarqueeSelection,
  CanvasPrimitiveInsert,
  FrameGeometry,
  GradientEditOverlayTarget,
  MultiScreenCanvasTool,
  Point,
  ScreenContentRenderOptions,
  ScreenProjectionNodeIdentity,
  VectorEditOverlayState,
  VisibleCanvasRect,
} from "@/components/design/multi-screen/types";
import type {
  KScaleStyleChangesByFrameId,
  KScaleStyleChange,
} from "@/components/design/multi-screen/types";
import { isWheelCameraGestureActive } from "@/components/design/multi-screen/wheel-gesture-state";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { ReadOnlyDesignBanner } from "@/components/design/ReadOnlyDesignBanner";
import {
  ResponsiveInteractBar,
  ResponsiveInteractExitButton,
} from "@/components/design/ResponsiveInteractBar";
import { reviewThreadIdFromHash } from "@/components/design/review-link";
import {
  getUnreadReviewThreadIds,
  type ReviewCommentsPanelProps,
} from "@/components/design/ReviewCommentsPanel";
import type { ReviewPanelProps } from "@/components/design/ReviewPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import type {
  CanvasLayerHitCandidate,
  ElementInfo,
  GridGroupStructureMove,
  ElementSelectionIntent,
  DeviceFrameType,
  PortableStyleSnapshot,
  RuntimeStructureDeleteRequest,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
  RuntimeLayerRenameRequest,
  RuntimeStructureMoveRequest,
  TextEditingState,
} from "@/components/design/types";
import { DEVICE_FRAME_VIEWPORTS } from "@/components/design/types";
import {
  DesignAccessState,
  type DesignAccessStatus,
} from "@/components/DesignAccessState";
import { designSystemPickerOptions } from "@/components/editor/design-start-pickers";
import {
  FigmaLinkComposerBubble,
  useDetectedFigmaComposerLink,
} from "@/components/editor/FigmaLinkComposerBubble";
import PromptPopover, {
  preloadPromptComposer,
} from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ReviewCanvasPins,
  type RepromptDraftRequest,
} from "@/components/visual-editor";
import {
  DrawOverlay as SharedDrawOverlay,
  type DrawAnnotation,
} from "@/components/visual-editor/DrawOverlay";
import { NodeRewriteProposal as NodeRewriteProposalPanel } from "@/components/visual-editor/NodeRewriteProposal";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useEditorPreferences } from "@/hooks/use-editor-preferences";
import {
  designEditorCommandKey,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import {
  isDesignHotkeyEditableTarget,
  isNativeKeyboardActivationTarget,
  isShowKeyboardShortcutsHotkey,
  useDesignHotkeys,
  type DesignHotkeyAlignEdge,
  type DesignHotkeyDistributeAxis,
} from "@/hooks/useDesignHotkeys";
import {
  DESIGN_CHAT_STORAGE_KEY,
  sendToDesignAgentChat,
} from "@/lib/agent-chat";
import {
  builderSelectionChip,
  sendBuilderSelectionContext,
} from "@/lib/builder-host-chat";
import {
  isBuilderHostEmbed,
  rememberBuilderHostOrigin,
} from "@/lib/builder-host-origin";
import {
  acknowledgeClipboardContentMutation,
  publishClipboardContentMutation,
  type ClipboardContentLineage,
  type ClipboardContentMutationOrigin,
  type ClipboardContentMutationPublication,
} from "@/lib/clipboard-content-lineage";
import {
  readDesignClipboardPayloadFromSystem,
  readSystemClipboard,
} from "@/lib/design-clipboard";
import {
  type DesignClipboardPayload,
  type DesignClipboardScreenEntry,
  isAttemptedFigmaPaste,
} from "@/lib/design-import";
import { uploadDesignVideoFile } from "@/lib/design-media-upload";
import {
  acknowledgeDesignSaveOutboxEntry,
  createDesignSaveOutboxEntry,
  discardDesignSaveOutboxEntry,
  drainDesignSaveOutbox,
  journalDesignSaveOutboxEntry,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import { isDesignSystemUsableForGeneration } from "@/lib/design-system-data";
import {
  DESIGN_HISTORY_OPEN_EVENT,
  DESIGN_UI_TOGGLE_EVENT,
} from "@/lib/design-ui-events";
import { isEmbedChromeRequested } from "@/lib/embed-chrome";
import {
  dismissFigmaPasteImageNotice,
  figmaPasteImageNoticeDismissed,
} from "@/lib/figma-paste-image-notice";
import {
  exportDesignAsFigmaSvg,
  type LiveFigmaSvgSnapshot,
  type LiveFigmaSvgSource,
} from "@/lib/figma-svg-copy";
import type { UploadedFont } from "@/lib/font-upload";
import {
  clearPendingGeneration,
  hasPendingGenerationOutput,
  hasFreshPendingGeneration,
  isPendingGenerationStale,
  patchPendingGeneration,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
} from "@/lib/pending-generation";
import {
  canCopyPngToClipboard,
  copyPngPromiseToClipboard,
  PngClipboardError,
} from "@/lib/png-clipboard";
import { prettyScreenName } from "@/lib/screen-names";
import {
  SHELL_DESIGN_ID,
  buildShellDesign,
  shellContextChanged,
  type ShellDesignInput,
} from "@/lib/shell-design";
import { cn } from "@/lib/utils";
import {
  captureHistorySelectionSources,
  captureHistorySelectionFromOwners,
  resolveHistorySelection,
} from "@/pages/design-editor/history-identity";
import {
  externalPreviewUrlForContent,
  fullPreviewHtml,
} from "@/pages/design-editor/preview-html";

import {
  applyAutoLayoutSuggestion,
  isExistingFlowLayout,
  type AutoLayoutSuggestion,
} from "./design-editor/auto-layout-suggestion";
import {
  normalizedDesignFileType,
  uniqueLayerId,
} from "./design-editor/canvas-primitive-insert";
import { createPrimitiveInsertFromSpec } from "./design-editor/canvas-primitives";
import {
  boardRenderOffset,
  getElementOuterHtml,
  insertClonedHtmlLayers,
  penPathForVectorEdit,
  penPathScreenContentOffset,
  primitiveVectorEditSource,
  writeBackPrimitiveAsVector,
  writeBackVectorEditedPenPath,
  type ComponentCloneBatchContext,
} from "./design-editor/clone-and-pen-edit";
import {
  bridgeSourceIdForCodeLayerNode,
  canonicalizeElementInfoFromProjection,
  codeLayerPatchMessage,
  codeLayerSourceNodeIdAttrs,
  codeLayerNodeLooksLikeComponent,
  codeLayerSelectorAliases,
  codeLayerSelectorMatches,
  previewCodeLayerTreeMove,
  codeLayerTreeToPanelNodes,
  collectCodeLayerAncestors,
  collectEffectiveCodeLayerState,
  type EffectiveCodeLayerState,
  elementInfoForOwnedCodeLayerNode,
  elementInfoFromCodeLayerNode,
  findCodeLayerSiblingOrder,
  isCodeLayerNodeRuntimeOnly,
  preferredCodeLayerSelector,
  remapLegacyCodeLayerNodeId,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
  resolveSelectedCodeLayerNode,
  ensureUploadedFontFaceInHtml,
  type SelectedLayerTarget,
} from "./design-editor/code-layer-state";
import type {
  ResponsiveEditScope,
  RetryablePrompt,
  CanvasLayerClipboardEntry,
  CodingHandoffResult,
  DesignCanvasEmbeddedFrame,
  LiveScreenSnapshot,
  PatchProofState,
  PendingStructureVerificationSession,
  PendingStructureVerificationStatus,
  PostAuthDesignIntent,
  RuntimeLayerSnapshot,
  ShareExportFormat,
} from "./design-editor/command-types";
import { runAddAutoLayout } from "./design-editor/commands/add-auto-layout";
import { runAddScreen } from "./design-editor/commands/add-screen";
import {
  alignSelectionAvailability,
  runAlignSelection,
} from "./design-editor/commands/align-selection";
import { runApplyDesignEditorCommand } from "./design-editor/commands/apply-design-editor-command";
import { runApplyFileContentUpdate } from "./design-editor/commands/apply-file-content-update";
import { runApplyLayoutFlow } from "./design-editor/commands/apply-layout-flow";
import { runApplyLocalContentUpdate } from "./design-editor/commands/apply-local-content-update";
import { runApplyPendingVisualStylesWithAgent } from "./design-editor/commands/apply-pending-visual-styles-with-agent";
import { runApplyToSource } from "./design-editor/commands/apply-to-source";
import { runBooleanSubtractSelection } from "./design-editor/commands/boolean-subtract-selection";
import { runCanMoveLayer } from "./design-editor/commands/can-move-layer";
import { runChangeSelectedZIndex } from "./design-editor/commands/change-selected-z-index";
import { runCommitRelativeStyleDeltaToSelectedLayers } from "./design-editor/commands/commit-relative-style-delta-to-selected-layers";
import {
  runCommitStylesToSelectedLayers,
  type CapturedStyleTargetCommitOptions,
} from "./design-editor/commands/commit-styles-to-selected-layers";
import { runCommitVisualStyles } from "./design-editor/commands/commit-visual-styles";
import { runConfirmMakeReal } from "./design-editor/commands/confirm-make-real";
import { runCopyAsFigmaSvg } from "./design-editor/commands/copy-as-figma-svg";
import { runCopySelection } from "./design-editor/commands/copy-selection";
import {
  createComponentActionChange,
  runCreateComponent,
  type CreateComponentActionResult,
} from "./design-editor/commands/create-component";
import { runCreatePrimitive } from "./design-editor/commands/create-primitive";
import { runCreateScreenFrame } from "./design-editor/commands/create-screen-frame";
import {
  releaseCrossScreenDropAdmission,
  resolveCrossScreenMoveFailureRecovery,
  runCrossScreenElementDrop,
} from "./design-editor/commands/cross-screen-element-drop";
import {
  cancelCrossScreenRollbackTimeout,
  crossScreenSourceCancellationNeedsRetry,
  crossScreenRollbackAfterSourceCancellation,
  crossScreenRollbackIsComplete,
  crossScreenRollbackDisposition,
  crossScreenSourceDeleteCancellation,
  retryCrossScreenRollbackRequest,
  retryCrossScreenDeleteCancellation,
  scheduleCrossScreenDeleteTimeout,
  scheduleCrossScreenInsertTimeout,
  scheduleCrossScreenRollbackTimeout,
} from "./design-editor/commands/cross-screen-insert-timeout";
import { runDeleteFiles } from "./design-editor/commands/delete-files";
import { runDeleteSelection } from "./design-editor/commands/delete-selection";
import { runDetachInstanceMenuAction } from "./design-editor/commands/detach-instance-menu-action";
import { runDistributeSelection } from "./design-editor/commands/distribute-selection";
import { runDownloadAllScreensPdf } from "./design-editor/commands/download-all-screens-pdf";
import { runDownloadPdf } from "./design-editor/commands/download-pdf";
import { runDownloadSvg } from "./design-editor/commands/download-svg";
import {
  runDuplicateScreen,
  type DuplicateScreenRecoveryEntry,
} from "./design-editor/commands/duplicate-screen";
import { runDuplicateSelection } from "./design-editor/commands/duplicate-selection";
import { runEditorPaste } from "./design-editor/commands/editor-paste";
import { runEnterHotkey } from "./design-editor/commands/enter-hotkey";
import {
  runEnterSingleScreen,
  type EnterSingleScreenOptions,
} from "./design-editor/commands/enter-single-screen";
import { runEscapeHotkey } from "./design-editor/commands/escape-hotkey";
import { runFrameSelection } from "./design-editor/commands/frame-selection";
import { runGeometryCommit } from "./design-editor/commands/geometry-commit";
import { runGetSelectedLayerSnapshots } from "./design-editor/commands/get-selected-layer-snapshots";
import { runGroupSelection } from "./design-editor/commands/group-selection";
import { runIframeContextMenu } from "./design-editor/commands/iframe-context-menu";
import {
  runImportFigmaClipboardIntoDesign,
  type FigmaPasteLayerInsert,
} from "./design-editor/commands/import-figma-clipboard-into-design";
import { runInsertFigmaPasteLayers } from "./design-editor/commands/insert-figma-paste-layers";
import {
  coalesceMarqueeSelectionHistory,
  runMarqueeSelectionCancellation,
  runLayerMarqueeSelectionChange,
} from "./design-editor/commands/layer-marquee-selection-change";
import { runLayerMove } from "./design-editor/commands/layer-move";
import { runLayerMoveToScreen } from "./design-editor/commands/layer-move-to-screen";
import { runLayerRename } from "./design-editor/commands/layer-rename";
import { runLayerSelectionChange } from "./design-editor/commands/layer-selection-change";
import {
  createLinkedComponentMutationQueue,
  projectLinkedComponentPropertyEdit,
  type LinkedComponentActionResult,
  type LinkedComponentEdit,
  type LinkedComponentMutationQueueArgs,
} from "./design-editor/commands/linked-component-mutation";
import { resolveLinkedComponentSelection } from "./design-editor/commands/linked-component-structure";
import { runModeChange } from "./design-editor/commands/mode-change";
import { runNudgeSelection } from "./design-editor/commands/nudge-selection";
import {
  beginOptimisticBreakpointSetPatch,
  optimisticAddBreakpointData,
  optimisticRemoveBreakpointData,
} from "./design-editor/commands/optimistic-breakpoint-mutation";
import { runOverviewPrimitiveReparent } from "./design-editor/commands/overview-primitive-reparent";
import { runPasteCopiedScreens } from "./design-editor/commands/paste-copied-screens";
import { runPasteOverSelection } from "./design-editor/commands/paste-over-selection";
import { runPasteSelection } from "./design-editor/commands/paste-selection";
import { runPasteToReplace } from "./design-editor/commands/paste-to-replace";
import {
  getOverviewCanvasCenter,
  runPastedImageFiles,
  type PastedImageFilesClientAnchor,
  type PastedImageFilesTarget,
} from "./design-editor/commands/pasted-image-files";
import { parsePastedSvg } from "./design-editor/commands/pasted-svg";
import { runPendingTextHostCommit } from "./design-editor/commands/pending-text-host-commit";
import { runPersistFrameGeometrySave } from "./design-editor/commands/persist-frame-geometry-save";
import { runPrimitiveCreated } from "./design-editor/commands/primitive-created";
import { runPublishCanonicalContent } from "./design-editor/commands/publish-canonical-content";
import {
  runPublishVisualEditPending,
  shouldPublishVisualEditPending,
} from "./design-editor/commands/publish-visual-edit-pending";
import {
  createVisualEditSnapshotPublicationState,
  runClearVisualEditSnapshotPublications,
  runInvalidateVisualEditSnapshotPublication,
  runReserveVisualEditSnapshotInOrder,
  runScheduleVisualEditSnapshotPublication,
  type VisualEditSnapshotPublicationState,
} from "./design-editor/commands/publish-visual-edit-snapshot";
import { runRecordPendingLiveLayerStateEdit } from "./design-editor/commands/record-pending-live-layer-state-edit";
import {
  commitPendingLiveStructureEdits,
  preparePendingLiveStructureEdit,
  runRecordPendingLiveStructureEdit,
} from "./design-editor/commands/record-pending-live-structure-edit";
import { runRecordPendingLiveTextEdit } from "./design-editor/commands/record-pending-live-text-edit";
import { runRecordPendingVisualStyleEdit } from "./design-editor/commands/record-pending-visual-style-edit";
import { runRedo } from "./design-editor/commands/redo";
import { runRenderPngBlob } from "./design-editor/commands/render-png-blob";
import {
  runFileContentSaveKeepalive,
  runQueueFileContentSave,
  runSaveFileContent,
} from "./design-editor/commands/save-file-content";
import { runScaleSelection } from "./design-editor/commands/scale-selection";
import { runScreenElementSelect } from "./design-editor/commands/screen-element-select";
import { runScreenTextContentChange } from "./design-editor/commands/screen-text-content-change";
import { runScreenVisualDuplicateChange } from "./design-editor/commands/screen-visual-duplicate-change";
import { runScreenVisualStructureChange } from "./design-editor/commands/screen-visual-structure-change";
import { runScreenVisualStyleChange } from "./design-editor/commands/screen-visual-style-change";
import { runSelectAll } from "./design-editor/commands/select-all";
import {
  restoreSelectionColorPreview,
  runSelectionColorChange,
  type SelectionColorPreviewHistoryEntry,
  type SelectionColorPickerSessionEntry,
  setSelectionColorPickerSession,
} from "./design-editor/commands/selection-color-change";
import { runSendOverviewAnnotations } from "./design-editor/commands/send-overview-annotations";
import { runSendRuntimeLayerMoveSemanticHandoff } from "./design-editor/commands/send-runtime-layer-move-semantic-handoff";
import { runSendRuntimeLayerSemanticHandoff } from "./design-editor/commands/send-runtime-layer-semantic-handoff";
import { runSendRuntimeLayerStateSemanticHandoff } from "./design-editor/commands/send-runtime-layer-state-semantic-handoff";
import { runSetLayoutGrid } from "./design-editor/commands/set-layout-grid";
import { runStartRetryGeneration } from "./design-editor/commands/start-retry-generation";
import { runStartSidebarResize } from "./design-editor/commands/start-sidebar-resize";
import { runStyleChange } from "./design-editor/commands/style-change";
import { styleWriteTarget } from "./design-editor/commands/style-write-target";
import { runStylesChange } from "./design-editor/commands/styles-change";
import { runSuggestAutoLayout } from "./design-editor/commands/suggest-auto-layout";
import { runSwapFillStroke } from "./design-editor/commands/swap-fill-stroke";
import {
  runContextMenuPaste,
  runSystemPasteToReplace,
} from "./design-editor/commands/system-clipboard-paste";
import { runTextContentChange } from "./design-editor/commands/text-content-change";
import { runTidyUp } from "./design-editor/commands/tidy-up";
import { runToggleLayerHidden } from "./design-editor/commands/toggle-layer-hidden";
import { runToggleLayerLocked } from "./design-editor/commands/toggle-layer-locked";
import { runToggleMotionKeyframe } from "./design-editor/commands/toggle-motion-keyframe";
import { runTweakPromptSubmit } from "./design-editor/commands/tweak-prompt-submit";
import { runUndo } from "./design-editor/commands/undo";
import { runUngroupSelection } from "./design-editor/commands/ungroup-selection";
import { runVisualDuplicateChange } from "./design-editor/commands/visual-duplicate-change";
import {
  planVisualGridGroupStructureChange,
  resolveGridGroupLinkedComponentTarget,
  runVisualStructureChange,
} from "./design-editor/commands/visual-structure-change";
import { runWriteFrameGeometrySnapshot } from "./design-editor/commands/write-frame-geometry-snapshot";
import { getCreatedScreenNavigationPlan } from "./design-editor/created-screen-navigation";
import { designPrecedentDirectives } from "./design-editor/creative-context-precedent";
import {
  applyDesignDataOperations,
  buildFrameGeometryDataOperations,
  clearAcknowledgedDesignDataOperationsThroughRevision,
  compactDesignDataOperations,
  getDesignBreakpointWidths,
  getDesignCanvasBackground,
  invertDesignDataOperations,
  sanitizeCanvasBackground,
  pendingDesignDataOperations,
  rebaseDesignDataWithPendingOperations,
  stagePendingDesignDataOperations,
  type DesignDataOperation,
  type PendingDesignDataOperations,
} from "./design-editor/data-operations";
import { deriveDesignBreakpoints } from "./design-editor/derive/design-breakpoints";
import { buildNeededLayerModels } from "./design-editor/derive/layer-model-coverage";
import {
  deriveOverviewScreens,
  reuseUnchangedOverviewScreens,
  type OverviewScreen,
} from "./design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  frameHeightChangedIds,
  getCanvasFrameGeometry,
  getDesignDataRecord,
  getLayoutGrids,
  isDesignData,
  nextLocalhostScreenPosition,
  parseDesignDataJson,
} from "./design-editor/design-data-geometry-utils";
import { isRadixOverlayOpen } from "./design-editor/dom-guards";
import { useTweaks } from "./design-editor/domains/use-tweaks";
import {
  AUTO_RETRY_DELAY_MS,
  BOARD_SURFACE_SIZE,
  DESIGN_EDITOR_DEBUG_LOGS,
  EMPTY_TEXT_CLEANUP_MAX_ATTEMPTS,
  EMPTY_TEXT_CLEANUP_RETRY_MS,
  HOST_CHAT_SLOT_MESSAGE,
  LOCALHOST_COMPILED_SOURCE_EXTENSIONS,
  LOCALHOST_WRITE_EXTENSIONS,
  MAX_GENERATION_ATTEMPTS,
  MIN_FRAME_SIZE_PX,
  MOTION_DOCK_EXIT_FALLBACK_MS,
  MOTION_DOCK_EXIT_SETTLE_MS,
  NO_LOCALHOST_CONNECTION_MESSAGE,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
  OVERVIEW_ZOOM_THRESHOLD,
  STORED_RUN_LIVENESS_GRACE_MS,
} from "./design-editor/editor-constants";
import { shouldAcceptEditorDragStateEvent } from "./design-editor/editor-drag-state";
import {
  buildSignInHrefForComment,
  buildSignInHrefForDesignIntent,
  describeSelectionForHost,
  designSelectionStateKeys,
  isSupersededSelectionEcho,
  reloadRunningAppPreviewFrames,
  runtimeMultiplicityForElementProvenance,
  withMeasuredGeometry,
} from "./design-editor/editor-helpers";
import {
  createEditorSaveOperationSource,
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
} from "./design-editor/editor-session";
import {
  createPendingLocalFileContent,
  type FileContentSaveRequest,
  type PendingLocalFileContent,
  flushFileContentSavesOnBackground,
  flushPendingFileContentSavesOnCleanup,
  getDesignEditorShareUrl,
  getDesignEditorStateUrlSearch,
  getFreshActiveFileContent,
  getFreshScreenContent,
  getLocalhostRouteSourceFile,
  createPersistedContentHostSyncHandler,
  getPersistedContentHostSyncOptions,
  isStandaloneHttpUrl,
  previewContentReplaceNeedsRenderFallback,
  removeUndoRedoOrderKind,
  restorePendingFileContent,
  resolveLocalhostSourceWriteContent,
  resolveOptimisticTextDecorationLine,
  resolveServerFiles,
  shouldRetirePendingLocalFileContent,
  shouldClearLatestUnloadSaveForOutboxEntry,
  shouldSendKeepalive,
  type OptimisticTextDecorationLineEntry,
  type PreviewContentReplaceResult,
  type UndoRedoOrderKind,
} from "./design-editor/editor-state";
import { runAdoptDbFileContent } from "./design-editor/effects/adopt-db-file-content";
import { focusAgentComposer } from "./design-editor/effects/focus-agent-composer";
import { runMirrorSelectionToAgentChat } from "./design-editor/effects/mirror-selection-to-agent-chat";
import { runMotionAutosave } from "./design-editor/effects/motion-autosave";
import { runObserveCollabText } from "./design-editor/effects/observe-collab-text";
import { runPublishAgentSelectionContext } from "./design-editor/effects/publish-agent-selection-context";
import { runResumePendingGeneration } from "./design-editor/effects/resume-pending-generation";
import { runSeedCollabContent } from "./design-editor/effects/seed-collab-content";
import { syncLatestActiveContentFromRender } from "./design-editor/effects/sync-latest-active-content";
import { resolveFigmaPasteScene } from "./design-editor/figma-paste-scene";
import {
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designVariantGenerationDirectives,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
  loadDesignSystemGenerationContext,
  promptRequestsVariantExploration,
} from "./design-editor/generation-prompt-directives";
import {
  quantizeCanvasFrameGeometryForPersist,
  sanitizeCanvasFrameGeometryForPersist,
} from "./design-editor/geometry-persistence";
import {
  type ContentHistoryChange,
  type ContentHistoryEntry,
  type ContentHistorySelectionAfterMap,
  type FileCreationHistoryEntry,
  type FileDeletionHistoryEntry,
  type FileDeletionHistorySnapshot,
  finalizeTextCreationHistory,
  findLastContentHistoryChangeIndex,
  hasContentHistoryChange,
  contentHistoryScopeForViewMode,
  forwardYjsUndoStackItemMeta,
  getContentHistoryChanges,
  type GeometryHistoryEntry,
  type GeometryHistorySelection,
  type PendingTextCreationHistory,
  type SelectionHistoryEntry,
  MAX_DESIGN_UNDO_STACK,
  mergeLocalContentHistoryFallback,
  removeRecentUndoRedoOrderKinds,
  reserveLinkedComponentContentHistory,
} from "./design-editor/history";
import {
  getBodyInlineStyles,
  screenRootFrameRenderingOptions,
  setScreenRootDefaultHeightMode,
  setBodyInlineStyles,
  setScreenRootFrameRenderingStyles,
  isAbsoluteCodeLayerNode,
  warnIfPoisonedBoardCoordsNormalized,
} from "./design-editor/html-layer-positioning";
import { runInIdleSlices } from "./design-editor/idle-slices";
import {
  allIntakeTopicsCovered,
  loadIntakeContextFromAppState,
} from "./design-editor/intake-question-topics";
import { applyKScaleStyleChanges } from "./design-editor/k-scale";
import { createLatestWriteQueue } from "./design-editor/latest-write-queue";
import {
  layerStateIdsForScreen,
  scopedLayerStateId,
} from "./design-editor/layer-state-scope";
import {
  type AlignableRect,
  authoredPxLength,
  computeOverlapReflowGeometry,
  mergeAuthoredAndLiveRect,
  type ReflowCandidate,
} from "./design-editor/layout-operations";
import { reconcileLiveCollaborationOverride } from "./design-editor/live-collaboration-override";
import { measureFreeformGeometry } from "./design-editor/measure-child-rects";
import {
  hasMinimalInspectorSelection,
  rightInspectorPanelClassName,
} from "./design-editor/minimal-inspector";
import {
  applyMotionAutoKeyframesForStyles,
  hydrateMotionDockTracks,
  type MotionTimelineQueryResult,
  motionTimelineFingerprint,
} from "./design-editor/motion-state";
import {
  clampOverviewDisplayZoom,
  clampZoom,
  autoHeightScreenIds,
  computeIframeLocalCanvasPoint,
  getAllScreenFrameEntries,
  findScreenFrameAtCanvasPoint,
  getDefaultOverviewCanvasZoom,
  getNextZoomStepDown,
  getNextZoomStepUp,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewZoomScale,
  getScreenFrameOriginCanvas,
  pinnedHeightScreenIds,
  resolveOverviewZoomBasisScreenId,
  resolveZoomUpdate,
  readOverviewZoomPercentFromTransform,
  resolveScreenDropPoint,
  shouldPopToOverviewOnZoomChange,
  shouldResetExplicitOverviewZoomOnBasisChange,
  withMeasuredFrameHeights,
  getBoardSelectionFitBounds,
} from "./design-editor/overview-camera";
import { resolvePastePlacementForSelection } from "./design-editor/paste-placement";
import {
  clearPendingEditSessionMarker,
  readPendingEditSessionMarker,
  type PendingEditSessionMarkerResult,
  writePendingEditSessionMarker,
} from "./design-editor/pending-edit-session-marker";
import {
  applyInteractionStateStyleCommit,
  buildPendingVisualStyleRevertPatches,
  deriveStatePreviewTarget,
  formatPendingVisualStylePrompt,
  formatVisualEditClipboardPrompt,
  getPendingVisualEditCount,
  isVisualEditHandoffAcknowledged,
  appendPendingLiveNonStyleUndoEntry,
  mergePendingLiveNonStyleEdit,
  pendingLiveStructureEditsFromEdit,
  pendingLiveStructureEditsFromUndoEntry,
  pendingLiveLayerNameUndoRevertValue,
  nextPendingLiveEditTimestamp,
  pendingVisualStyleGestureIdForPhase,
  projectRelativeSourcePath,
  relativeOperationsForStyles,
  reactSourceAnchorForPendingEdit,
  type PendingLiveLayerNameEdit,
  type PendingLiveLayerStateEdit,
  type PendingLiveNonStyleEdit,
  type PendingLiveNonStyleUndoEntry,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
  type PendingLiveTextEdit,
  type PendingRelativeStyleOperation,
  type PendingVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  type PendingVisualStyleUndoEntry,
  resolveOverviewScreenSourceType,
  shouldPreferRuntimeLayerProjection,
  shouldUseRuntimeLayerProjection,
  shouldBlockPendingVisualStyleNavigation,
  shouldShowPendingVisualStyleApply,
} from "./design-editor/pending-edits";
import { usePendingLiveEditUnloadGuard } from "./design-editor/pending-live-edit-unload-guard";
import { usePerformanceBufferGuard } from "./design-editor/performance-buffer-guard";
import {
  blurActiveDesignEditableTarget,
  PngCaptureError,
  type PngCaptureScope,
} from "./design-editor/png-export-render";
import { openPreviewUrl } from "./design-editor/preview-navigation";
import {
  computeInteractZoomToFit,
  DEFAULT_INTERACT_DEVICE_PRESET,
  findInteractDevicePreset,
  INTERACT_CUSTOM_DEVICE_NAME,
} from "./design-editor/responsive-interact";
import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
} from "./design-editor/save-failure";
import {
  DEFAULT_STATES_PANEL_BREAKPOINTS,
  designEditorCommandFromSearchParams,
  designStatePreviewHtml,
  findDesignFileByScreenTarget,
  type DesignStatePreviewRow,
} from "./design-editor/screen-command-utils";
import {
  buildActiveFileNodeIdSet,
  computeOverviewScreenPickSelectionIds,
  getOverviewScreenContentKey,
  getOverviewScreenExportGeometryById,
  getOverviewScreenRuntimeReplacementKey,
  getSelectedScreenGeometryForInspector,
  getSelectedScreenIdsForEditorState,
  hasSelectableCodeLayerParent,
  isScreenRootElementInfo,
  isUserOriginatedSelectionIntent,
  overviewSelectionTargetsElement,
  resolveAvailableActiveFileId,
  resolveEffectiveSelectedLayerIds,
  resolveMarqueeAdditive,
  sameStringIds,
  selectionHistorySnapshotsEqual,
  shouldClearSelectionForReviewThreadTarget,
  shouldIgnoreOverviewLayerCreationEcho,
  shouldLimitEditorChromeUntilContentReady,
  shouldUseOverviewRuntimeReplacement,
} from "./design-editor/selection-state";
import {
  resolveSourceBaseForPublication,
  designFileCodeLayerSource,
  prepareCanonicalSourceContent,
  preparedSourceProjection,
} from "./design-editor/source-publication";
import {
  endedTextEditClosesActiveSession,
  endedTextEditMatchesPendingCreation,
  postShaderFillPreviewClearToPreviewIframes,
} from "./design-editor/text-edit-utils";
import {
  getDesignBottomToolbarMode,
  getSingleScreenCreationTool,
  resolveSpaceForwardTransition,
  resolveToolAfterSelection,
  shouldAskOnNewDesignArrival,
  shouldAutoEnableDrawOverlay,
} from "./design-editor/tool-state";
import {
  type DesignData,
  type DesignFile,
  type DesignLeftPanel,
  type DesignTool,
  type EditorMode,
  type ShapeTool,
  FOCUSED_SCREEN_ZOOM,
  SHOW_DESIGN_CODE_LEFT_PANEL,
  SHOW_DESIGN_SECONDARY_LEFT_PANELS,
} from "./design-editor/types";
import {
  VisualEditWebMcp,
  hasNativeWebMcpHost,
  type VisualEditPromptResult,
} from "./design-editor/VisualEditWebMcp";

type UpdateScreenSourceActionResult = {
  fileId: string;
  sourceType: "static" | "url";
  url: string | null;
  path: string | null;
  connectionId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

type RequestDesignAccessResult = {
  ok: boolean;
  alreadyHasAccess: boolean;
  alreadyRequested: boolean;
  notifiedOwner: boolean;
  requestId?: string;
  message: string;
};

/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */

// Mirrors `--design-chrome-rail-width` in app/global.css (8 baseline units ×
// 8px). The rail is always-on chrome (not measured via a ref) so the very
// first overview camera render — before any layout effect could measure the
// DOM — already accounts for it; see chromeInsetLeft below.
const DESIGN_CHROME_RAIL_WIDTH_PX = 64;

const NO_SELECTORS: string[] = [];
const NO_SELECTOR_GROUPS: string[][] = [];
const NO_MOTION_TRACKS: MotionTrackWire[] = [];

function previewUrlAtLiveRoute(
  previewUrl: string | undefined,
  routePath: string | undefined,
): string | undefined {
  if (!previewUrl || !routePath) return previewUrl;
  try {
    const base = new URL(previewUrl);
    const route = new URL(routePath, base.origin);
    if (route.origin !== base.origin) return previewUrl;
    base.pathname = route.pathname;
    base.search = route.search;
    base.hash = route.hash;
    return base.toString();
  } catch {
    return previewUrl;
  }
}

function pageHasWebMcpHost(): boolean {
  return hasNativeWebMcpHost();
}

type RequestLocalhostWrite = (opts: {
  files: string[];
  onGranted: LocalhostWriteConsentPayload["onGranted"];
  onCancel?: () => void;
}) => void;

function isLocalhostWriteConsentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "LocalWriteConsentRequiredError" ||
      error.name === "WriteConsentRequiredError" ||
      /write-consent grant|grant expired/i.test(error.message))
  );
}

function readRenderedLayerInfo(
  owner: {
    fileId: string;
    node: CodeLayerNode;
  },
  breakpointWidth?: number,
  boardFileId?: string,
): ElementInfo | null {
  const base = elementInfoFromCodeLayerNode(owner.node);
  for (const preview of designPreviewWindowsForScreen(
    owner.fileId,
    breakpointWidth,
    boardFileId,
  )) {
    try {
      const element = preview.document.querySelector(
        preferredCodeLayerSelector(owner.node),
      );
      if (!element) continue;
      const computed = preview.getComputedStyle(element);
      const parent = element.parentElement;
      const parentComputed = parent
        ? preview.getComputedStyle(parent)
        : undefined;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      return {
        ...base,
        sourceLayerIdentity: { screenId: owner.fileId, nodeId: owner.node.id },
        computedStyles: {
          ...base.computedStyles,
          position: computed.position,
          zIndex: computed.zIndex,
        },
        boundingRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        ...(parentComputed
          ? {
              parentDisplay: parentComputed.display,
              parentLayout: {
                ...base.parentLayout,
                display: parentComputed.display,
              },
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export default function DesignEditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <DesignEditor key={id ?? "missing-design"} />;
}

function DesignEditor() {
  const t = useT();
  const externalAgentHost = useExternalAgentHost();
  const applePlatform = useApplePlatform();
  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const { id } = useParams<{ id: string }>();
  const { session, isLoading: sessionLoading } = useSession();
  const isSignedIn = Boolean(session?.email);
  const sessionResolved = !sessionLoading;
  const designSaveActorScope = session?.userId ?? "anonymous";
  const requestLocalhostWriteRef = useRef<RequestLocalhostWrite | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  usePerformanceBufferGuard();
  const initialEditorUrlRef = useRef<{
    designId: string | undefined;
    searchParams: URLSearchParams;
  } | null>(null);
  const initialRouteScreenGuardRef = useRef<string | null>(null);
  if (
    !initialEditorUrlRef.current ||
    initialEditorUrlRef.current.designId !== id
  ) {
    const nextSearchParams = new URLSearchParams(location.search);
    initialEditorUrlRef.current = {
      designId: id,
      searchParams: nextSearchParams,
    };
    initialRouteScreenGuardRef.current =
      nextSearchParams.get("screen") ??
      nextSearchParams.get("fileId") ??
      nextSearchParams.get("filename");
  }
  const initialSearchParams = initialEditorUrlRef.current.searchParams;
  const initialRouteScreenTarget =
    initialSearchParams.get("screen") ??
    initialSearchParams.get("fileId") ??
    initialSearchParams.get("filename");
  const initialRouteSelectionId = initialSearchParams.get("selection") || null;
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const postAuthIntent = useMemo<PostAuthDesignIntent | null>(() => {
    const value = searchParams.get("intent");
    return value === "save" || value === "share" ? value : null;
  }, [searchParams]);
  const queryClient = useQueryClient();
  const browserTabId = getBrowserTabId();
  const shellMode = id === SHELL_DESIGN_ID;
  const embedded = shellMode || isEmbedAuthActive();
  const isVisualEditSurface = location.pathname.startsWith("/visual-edit/");
  const isLiveCanvasShareLink =
    isVisualEditSurface && searchParams.get("share") === "1";
  const embedChromeRequested = isEmbedChromeRequested();
  const hostOwnsChrome = embedded && !shellMode && !embedChromeRequested;
  const [builderHostConfirmed, setBuilderHostConfirmed] = useState(() =>
    isBuilderHostEmbed(),
  );
  const hostEmbeddedEditor =
    embedded && !hostOwnsChrome && builderHostConfirmed;
  const hostChatSlotRef = useRef<HTMLDivElement | null>(null);
  const hostChatGeneratingRef = useRef(false);
  const hostChatSlotObserverRef = useRef<ResizeObserver | null>(null);
  const postHostChatSlotRect = useCallback(() => {
    if (!hostEmbeddedEditor) return;
    const box = hostChatSlotRef.current?.getBoundingClientRect();
    const rect =
      box && box.width > 0 && box.height > 0
        ? {
            x: Math.round(box.left),
            y: Math.round(box.top),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null;
    window.parent.postMessage(
      { type: HOST_CHAT_SLOT_MESSAGE, data: { rect } },
      getBuilderParentOrigin() ?? "*",
    );
  }, [hostEmbeddedEditor]);
  const attachHostChatSlot = useCallback(
    (node: HTMLDivElement | null) => {
      hostChatSlotRef.current = node;
      hostChatSlotObserverRef.current?.disconnect();
      hostChatSlotObserverRef.current = null;
      if (node && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => postHostChatSlotRect());
        observer.observe(node);
        hostChatSlotObserverRef.current = observer;
      }
      postHostChatSlotRect();
    },
    [postHostChatSlotRect],
  );
  useEffect(() => {
    if (!hostEmbeddedEditor) return;
    window.addEventListener("resize", postHostChatSlotRect);
    return () => {
      window.removeEventListener("resize", postHostChatSlotRect);
      window.parent.postMessage(
        { type: HOST_CHAT_SLOT_MESSAGE, data: { rect: null } },
        getBuilderParentOrigin() ?? "*",
      );
    };
  }, [hostEmbeddedEditor, postHostChatSlotRect]);

  const designChatScope = useMemo(
    () => (id ? ({ type: "design" as const, id } as const) : null),
    [id],
  );
  const designChatHistory = useMemo<
    AssistantChatHistoryConfig | undefined
  >(() => {
    if (!designChatScope) return undefined;
    const designId = designChatScope.id;
    return {
      list: {
        action: "list-design-versions",
        args: (threadId) => ({
          designId,
          limit: 100,
          ...(threadId ? { threadId } : {}),
        }),
        getVersions: (result: unknown) => {
          const versions =
            result && typeof result === "object"
              ? (result as { versions?: unknown }).versions
              : undefined;
          return Array.isArray(versions)
            ? versions.filter(isAssistantChatHistoryVersion)
            : [];
        },
      },
      restore: {
        action: "restore-design-version",
        args: (version: AssistantChatHistoryVersion) => ({
          designId,
          versionId: version.id,
        }),
      },
    };
  }, [designChatScope]);
  const {
    link: detectedFigmaComposerLink,
    onComposerTextChange: handleComposerTextChange,
  } = useDetectedFigmaComposerLink();

  const isBuilderDesignEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get("design_host") ===
      "builder"
    );
  }, []);
  const [builderPreviewUrl, setBuilderPreviewUrl] = useState<string | null>(
    null,
  );
  const [shellInput, setShellInput] = useState<ShellDesignInput | null>(null);

  const [mode, setMode] = useState<EditorMode>("edit");
  const [overviewInteractScreenId, setOverviewInteractScreenId] = useState<
    string | null
  >(null);
  const overviewInteractScreenIdRef = useRef(overviewInteractScreenId);
  useEffect(() => {
    overviewInteractScreenIdRef.current = overviewInteractScreenId;
  }, [overviewInteractScreenId]);
  const [activeTool, setActiveTool] = useState<DesignTool>("move");
  const [shapeTool, setShapeTool] = useState<ShapeTool>("rect");
  const [frameToolDraws, setFrameToolDraws] = useState<"screen" | "frame">(
    "frame",
  );
  const locallyPinnedHeightIdsRef = useRef<Set<string>>(new Set());
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [screenZoom, setScreenZoom] = useState(FOCUSED_SCREEN_ZOOM);
  const [cameraCommand, setCameraCommand] = useState<{
    fitBounds: FrameBounds;
    nonce: number;
    paddingScreenPx?: number;
  } | null>(null);
  const cameraCommandNonceRef = useRef(0);
  const [suppressLineupRecenter, setSuppressLineupRecenter] = useState<{
    fromCount: number;
    addedCount: number;
    nonce: number;
  } | null>(null);
  const suppressLineupRecenterNonceRef = useRef(0);
  const [optimisticFrameGeometryById, setOptimisticFrameGeometryById] =
    useState<Record<string, FrameGeometry>>({});
  const measuredScreenHeightByIdRef = useRef<Record<string, number>>({});
  const handleOverviewPrimaryContentHeightChange = useCallback(
    (screenId: string, heightPx: number) => {
      measuredScreenHeightByIdRef.current = {
        ...measuredScreenHeightByIdRef.current,
        [screenId]: heightPx,
      };
    },
    [],
  );
  const boardSelectionWorldBoundsRef = useRef<{
    screenId: string;
    selector: string;
    memberSelectors?: readonly string[];
    memberSourceIds?: readonly string[];
    worldBounds: FrameBounds;
  } | null>(null);
  const screenZoomByIdRef = useRef<Map<string, number>>(new Map());
  const [explicitOverviewCanvasZoom, setExplicitOverviewCanvasZoom] = useState<
    number | null
  >(null);
  const [deviceFrame] = useState<DeviceFrameType>("none");
  const [interactDeviceName, setInteractDeviceName] = useState(
    DEFAULT_INTERACT_DEVICE_PRESET.name,
  );
  const [interactDeviceSize, setInteractDeviceSize] = useState({
    width: DEFAULT_INTERACT_DEVICE_PRESET.width,
    height: DEFAULT_INTERACT_DEVICE_PRESET.height,
  });
  const [interactZoom, setInteractZoom] = useState(100);
  const [viewMode, setViewMode] = useState<"single" | "overview">("overview");
  useEffect(() => {
    if (viewMode !== "single" || mode !== "interact") {
      setOverviewInteractScreenId(null);
    }
  }, [mode, viewMode]);
  const viewModeRef = useRef<"single" | "overview">("overview");
  const parentOriginRef = useRef<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const hostSelectionChipRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hostEmbeddedEditor) return;
    if (!selectedElement) {
      hostSelectionChipRef.current = null;
      return;
    }
    const chip = builderSelectionChip(
      describeSelectionForHost(selectedElement),
    );
    if (hostSelectionChipRef.current === chip) return;
    hostSelectionChipRef.current = chip;
    sendBuilderSelectionContext(describeSelectionForHost(selectedElement));
  }, [hostEmbeddedEditor, selectedElement]);
  const selectedElementRef = useRef(selectedElement);
  selectedElementRef.current = selectedElement;
  const [vectorEditingState, setVectorEditingState] = useState<{
    screenId: string;
    nodeId: string;
    layerId: string;
    path: PenPath;
    selectedAnchorIndex: number | null;
    sourceOffset: { x: number; y: number };
    primitiveSource: {
      geometry: PenGeometry;
      fill: string;
    } | null;
  } | null>(null);
  const [pendingVisualStyleEdits, setPendingVisualStyleEdits] = useState<
    PendingVisualStyleEdit[]
  >([]);
  const [pendingLiveNonStyleEdits, setPendingLiveNonStyleEdits] = useState<
    PendingLiveNonStyleEdit[]
  >([]);
  const [
    pendingVisualEditPublicationFailed,
    setPendingVisualEditPublicationFailed,
  ] = useState(false);
  const [
    pendingVisualEditRecoveryVisible,
    setPendingVisualEditRecoveryVisible,
  ] = useState(false);
  const [
    effectivePreviewTokensByScreenId,
    setEffectivePreviewTokensByScreenId,
  ] = useState<Record<string, string>>({});
  const [
    effectiveLiveEditCapabilitiesByScreenId,
    setEffectiveLiveEditCapabilitiesByScreenId,
  ] = useState<Record<string, string>>({});
  const [
    effectiveLiveEditRegistrationCapabilitiesByScreenId,
    setEffectiveLiveEditRegistrationCapabilitiesByScreenId,
  ] = useState<Record<string, string>>({});
  const [pendingEditSessionMarker, setPendingEditSessionMarker] =
    useState<PendingEditSessionMarkerResult>({ status: "absent" });
  const [
    pendingEditSessionRecoveryMarker,
    setPendingEditSessionRecoveryMarker,
  ] = useState<PendingEditSessionMarkerResult>({ status: "absent" });
  const pendingEditSessionDesignIdRef = useRef<string | null>(null);
  useEffect(() => {
    pendingEditSessionDesignIdRef.current = null;
    const marker = readPendingEditSessionMarker(id);
    setPendingEditSessionMarker(marker);
    setPendingEditSessionRecoveryMarker(marker);
  }, [id]);
  const clearPendingEditSessionRecovery = useCallback(() => {
    if (!id) return;
    pendingEditSessionDesignIdRef.current = null;
    const result = clearPendingEditSessionMarker(id);
    const nextState: PendingEditSessionMarkerResult =
      result.status === "cleared"
        ? { status: "absent" }
        : { status: "unavailable", reason: result.reason };
    setPendingEditSessionMarker(nextState);
    setPendingEditSessionRecoveryMarker(nextState);
  }, [id]);
  const clearPendingEditSessionRecoveryRef = useRef(
    clearPendingEditSessionRecovery,
  );
  useEffect(() => {
    clearPendingEditSessionRecoveryRef.current =
      clearPendingEditSessionRecovery;
  }, [clearPendingEditSessionRecovery]);
  const [pendingVisualStyleRevertRequest, setPendingVisualStyleRevertRequest] =
    useState<{
      requestId: number;
      patches: ReturnType<typeof buildPendingVisualStyleRevertPatches>;
    } | null>(null);
  const [pendingTextRevertRequest, setPendingTextRevertRequest] = useState<{
    requestId: number;
    patches: Array<{
      screenId: string;
      selector: string;
      sourceId?: string | null;
      value: string;
      html?: string;
      routePath?: string;
    }>;
  } | null>(null);
  const [pendingLayerStateReplayRequest, setPendingLayerStateReplayRequest] =
    useState<{
      requestId: number;
      patches: Array<{
        screenId: string;
        layerId: string;
        state: "hidden" | "locked";
        enabled: boolean;
        routePath?: string;
      }>;
    } | null>(null);
  const [pendingLayerNameReplayRequest, setPendingLayerNameReplayRequest] =
    useState<{
      requestId: number;
      patches: Array<{
        screenId: string;
        selector: string;
        sourceId?: string | null;
        name: string;
        routePath?: string;
      }>;
    } | null>(null);
  const [pendingStructureAckRequest, setPendingStructureAckRequest] = useState<{
    requestId: number;
    acks: Array<{
      screenId: string;
      requestId: string;
      applied: boolean;
      routePath?: string;
    }>;
  } | null>(null);
  const [runtimeStructureMoveRequest, setRuntimeStructureMoveRequest] =
    useState<(RuntimeStructureMoveRequest & { screenId: string }) | null>(null);
  const runtimeStructureMoveRevisionRef = useRef(0);
  const [runtimeStructureInsertRequest, setRuntimeStructureInsertRequestState] =
    useState<(RuntimeStructureInsertRequest & { screenId: string }) | null>(
      null,
    );
  const runtimeStructurePendingTransactionRef = useRef<string | null>(null);
  const setRuntimeStructureInsertRequest = useCallback<
    Dispatch<
      SetStateAction<
        (RuntimeStructureInsertRequest & { screenId: string }) | null
      >
    >
  >((next) => {
    if (typeof next !== "function" && next) {
      const pendingTransactionId =
        runtimeStructurePendingTransactionRef.current;
      if (pendingTransactionId && next.transactionId !== pendingTransactionId) {
        if (DESIGN_EDITOR_DEBUG_LOGS) {
          console.warn("[design] runtime structure insert admission refused", {
            pendingTransactionId,
            requestTransactionId: next.transactionId ?? null,
          });
        }
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return;
      }
    }
    setRuntimeStructureInsertRequestState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (resolved === current) return current;
      const pendingTransactionId =
        runtimeStructurePendingTransactionRef.current;
      if (
        resolved &&
        pendingTransactionId &&
        resolved.transactionId !== pendingTransactionId
      ) {
        if (DESIGN_EDITOR_DEBUG_LOGS) {
          console.warn("[design] runtime structure insert admission refused", {
            pendingTransactionId,
            requestTransactionId: resolved.transactionId ?? null,
          });
        }
        return current;
      }
      if (resolved?.transactionId) {
        runtimeStructurePendingTransactionRef.current = resolved.transactionId;
      }
      return resolved;
    });
  }, []);
  const [runtimeStructureDeleteRequest, setRuntimeStructureDeleteRequest] =
    useState<(RuntimeStructureDeleteRequest & { screenId: string }) | null>(
      null,
    );
  const [runtimeStructureRollbackRequest, setRuntimeStructureRollbackRequest] =
    useState<(RuntimeStructureRollbackRequest & { screenId: string }) | null>(
      null,
    );
  const runtimeStructureRollbackTimeoutCancelRef = useRef<(() => void) | null>(
    null,
  );
  const runtimeStructureRollbackRevisionRef = useRef(0);
  const [liveRoutePathsByScreenId, setLiveRoutePathsByScreenId] = useState<
    Record<string, string>
  >({});
  const liveRoutePathsByScreenIdRef = useRef<Record<string, string>>({});
  const handleLiveRoutePathChange = useCallback(
    (screenId: string | undefined, routePath: string) => {
      if (!screenId || !routePath) return;
      liveRoutePathsByScreenIdRef.current[screenId] = routePath;
      setLiveRoutePathsByScreenId((current) =>
        current[screenId] === routePath
          ? current
          : { ...current, [screenId]: routePath },
      );
    },
    [],
  );
  const [runtimeLayerRenameRequest, setRuntimeLayerRenameRequest] = useState<
    (RuntimeLayerRenameRequest & { screenId: string; layerId: string }) | null
  >(null);
  const runtimeLayerRenameRevisionRef = useRef(0);
  const [runtimeLayerSnapshotRequest, setRuntimeLayerSnapshotRequest] =
    useState<number | null>(null);
  const runtimeStructureInsertRevisionRef = useRef(0);
  const [
    runtimeStructureVerificationRequest,
    setRuntimeStructureVerificationRequest,
  ] = useState<{
    requestId: number;
    screenIds: string[];
  } | null>(null);
  const [
    pendingStructureVerificationStatus,
    setPendingStructureVerificationStatus,
  ] = useState<PendingStructureVerificationStatus>("idle");
  const [pendingAgentHandoffBusy, setPendingAgentHandoffBusy] = useState(false);
  const pendingAgentHandoffBusyRef = useRef(false);
  const pendingStructureVerificationRevisionRef = useRef(0);
  const pendingStructureVerificationSessionRef = useRef<
    PendingStructureVerificationSession | undefined
  >(undefined);
  const pendingStructureVerificationSnapshotsRef = useRef<
    Map<number, Record<string, RuntimeLayerSnapshot>>
  >(new Map());
  const [
    pendingVisualStyleBaselineResetRequest,
    setPendingVisualStyleBaselineResetRequest,
  ] = useState<number | null>(null);
  const pendingVisualStyleEditsRef = useRef<PendingVisualStyleEdit[]>([]);
  const pendingLiveNonStyleEditsRef = useRef<PendingLiveNonStyleEdit[]>([]);
  const pendingVisualEditPublicationRevisionRef = useRef(0);
  const pendingVisualEditPublisherIdRef = useRef(crypto.randomUUID());
  const pendingVisualEditPublicationQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const pendingVisualEditClearRequestedRef = useRef<string | null>(null);
  const pendingVisualEditHadPendingRef = useRef<string | null>(null);
  useEffect(() => {
    pendingVisualEditPublicationRevisionRef.current = 0;
    pendingVisualEditPublisherIdRef.current = crypto.randomUUID();
    pendingVisualEditClearRequestedRef.current = null;
    pendingVisualEditHadPendingRef.current = null;
    setPendingVisualEditPublicationFailed(false);
    setPendingVisualEditRecoveryVisible(false);
  }, [id]);
  const localhostConnectionRootPathByIdRef = useRef<Map<string, string>>(
    new Map(),
  );
  const pendingVisualStyleUndoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
  const pendingVisualStyleRedoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
  const pendingLiveStyleGestureStateRef = useRef({
    sequence: 0,
    activeId: null as string | null,
  });
  const pendingLiveNonStyleUndoStackRef = useRef<
    PendingLiveNonStyleUndoEntry[]
  >([]);
  const pendingLiveNonStyleRedoStackRef = useRef<
    PendingLiveNonStyleUndoEntry[]
  >([]);
  const pendingStructureRedoReplayRef = useRef<
    PendingLiveStructureUndoEntry | undefined
  >(undefined);
  const pendingStructureRedoReplayTimerRef = useRef<number | undefined>(
    undefined,
  );
  const pendingStructureRedoPreparedEditsRef = useRef<
    | {
        replay: PendingLiveStructureUndoEntry;
        edits: PendingLiveStructureEdit[];
      }
    | undefined
  >(undefined);
  const cancelPendingStructureVerification = useCallback(
    (nextStatus: PendingStructureVerificationStatus = "idle") => {
      const session = pendingStructureVerificationSessionRef.current;
      if (!session && nextStatus !== "idle") return;
      if (session) {
        session.cancelled = true;
        session.abortController.abort();
      }
      pendingStructureVerificationSessionRef.current = undefined;
      pendingStructureVerificationSnapshotsRef.current.clear();
      setRuntimeStructureVerificationRequest(null);
      setPendingStructureVerificationStatus(nextStatus);
    },
    [],
  );
  useEffect(() => {
    setPendingStructureVerificationStatus("idle");
    setRuntimeStructureVerificationRequest(null);
    return () => {
      const session = pendingStructureVerificationSessionRef.current;
      if (session) {
        session.cancelled = true;
        session.abortController.abort();
      }
      pendingStructureVerificationSessionRef.current = undefined;
      pendingStructureVerificationSnapshotsRef.current.clear();
    };
  }, [id]);
  useEffect(
    () => () => {
      if (pendingStructureRedoReplayTimerRef.current !== undefined) {
        window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      }
    },
    [],
  );
  const requestPendingVisualStyleRevert = useCallback(
    (edits: readonly PendingVisualStyleEdit[]) => {
      const patches = buildPendingVisualStyleRevertPatches(edits);
      if (patches.length === 0) return;
      const requestId = Date.now() + Math.random();
      const sendStyleForScreen = (window as any)
        .__designCanvasSendStyleForScreen;
      const fallbackPatches =
        typeof sendStyleForScreen === "function"
          ? patches.filter(
              (patch) =>
                !replayPendingVisualStyleRuntimePatch(
                  patch,
                  sendStyleForScreen,
                ),
            )
          : patches;
      if (fallbackPatches.length > 0) {
        setPendingVisualStyleRevertRequest({
          requestId,
          patches: fallbackPatches,
        });
      }
      setPendingVisualStyleBaselineResetRequest(requestId);
    },
    [],
  );
  const replayPendingVisualStyleRuntime = useCallback(
    (edits: readonly PendingVisualStyleEdit[]) => {
      const patches = edits
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          ...(edit.runtimeSelector
            ? { runtimeSelector: edit.runtimeSelector }
            : {}),
          ...(edit.runtimeSourceId
            ? { runtimeSourceId: edit.runtimeSourceId }
            : {}),
          routePath: edit.routePath,
          styles: edit.styles,
          ...(edit.interactionState
            ? { interactionState: edit.interactionState }
            : {}),
        }))
        .filter((patch) => Object.keys(patch.styles).length > 0);
      if (patches.length === 0) return undefined;
      const requestId = Date.now() + Math.random();
      const sendStyleForScreen = (window as any)
        .__designCanvasSendStyleForScreen;
      const fallbackPatches =
        typeof sendStyleForScreen === "function"
          ? patches.filter(
              (patch) =>
                !replayPendingVisualStyleRuntimePatch(
                  patch,
                  sendStyleForScreen,
                ),
            )
          : patches;
      if (fallbackPatches.length > 0) {
        setPendingVisualStyleRevertRequest({
          requestId,
          patches: fallbackPatches,
        });
      }
      return requestId;
    },
    [],
  );
  const requestPendingLiveNonStyleRevert = useCallback(
    (edits: readonly PendingLiveNonStyleEdit[]) => {
      const requestId = Date.now() + Math.random();
      const textPatches = edits
        .filter((edit): edit is PendingLiveTextEdit => edit.kind === "text")
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          value: edit.originalValue,
          html: edit.originalHtml,
          routePath: edit.routePath,
        }));
      const structureAcks = edits
        .filter(
          (edit): edit is PendingLiveStructureEdit => edit.kind === "structure",
        )
        .flatMap((edit) =>
          pendingLiveStructureEditsFromEdit(edit)
            .filter((member) => Boolean(member.requestId))
            .map((member) => ({
              screenId: member.screenId,
              requestId: member.requestId!,
              applied: false,
              routePath: member.routePath,
            })),
        );
      const layerStatePatches = edits
        .filter(
          (edit): edit is PendingLiveLayerStateEdit =>
            edit.kind === "layer-state",
        )
        .map((edit) => ({
          screenId: edit.screenId,
          layerId: edit.layerId,
          state: edit.state,
          enabled: edit.originalEnabled,
          routePath: edit.routePath,
        }));
      const layerNamePatches = edits
        .filter(
          (edit): edit is PendingLiveLayerNameEdit =>
            edit.kind === "layer-name",
        )
        .map((edit) => ({
          screenId: edit.screenId,
          selector: edit.selector,
          sourceId: edit.sourceId,
          name: edit.originalName,
          routePath: edit.routePath,
        }));
      if (textPatches.length > 0) {
        setPendingTextRevertRequest({ requestId, patches: textPatches });
      }
      if (structureAcks.length > 0) {
        setPendingStructureAckRequest({ requestId, acks: structureAcks });
      }
      if (layerStatePatches.length > 0) {
        setPendingLayerStateReplayRequest({
          requestId,
          patches: layerStatePatches,
        });
      }
      if (layerNamePatches.length > 0) {
        setPendingLayerNameReplayRequest({
          requestId,
          patches: layerNamePatches,
        });
      }
    },
    [],
  );
  const stagedSourceHandoffRef = useRef<"idle" | "awaiting-start" | "running">(
    "idle",
  );
  const stagedHandoffStartTimerRef = useRef<number | undefined>(undefined);
  const [applyingViaHost, setApplyingViaHost] = useState(false);
  const clearPendingLiveEditState = useCallback(() => {
    if (
      id &&
      (pendingVisualStyleEditsRef.current.length > 0 ||
        pendingLiveNonStyleEditsRef.current.length > 0)
    ) {
      pendingVisualEditClearRequestedRef.current = id;
    }
    stagedSourceHandoffRef.current = "idle";
    setApplyingViaHost(false);
    if (pendingEditSessionDesignIdRef.current === id) {
      clearPendingEditSessionRecovery();
    }
    if (stagedHandoffStartTimerRef.current !== undefined) {
      window.clearTimeout(stagedHandoffStartTimerRef.current);
      stagedHandoffStartTimerRef.current = undefined;
    }
    cancelPendingStructureVerification();
    pendingVisualStyleUndoStackRef.current = [];
    pendingVisualStyleRedoStackRef.current = [];
    pendingLiveNonStyleUndoStackRef.current = [];
    pendingLiveNonStyleRedoStackRef.current = [];
    historyOrderRef.current = historyOrderRef.current.filter(
      (kind) => kind !== "pending-style" && kind !== "pending-live",
    );
    redoOrderRef.current = redoOrderRef.current.filter(
      (kind) => kind !== "pending-style" && kind !== "pending-live",
    );
    pendingStructureRedoReplayRef.current = undefined;
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    pendingVisualStyleEditsRef.current = [];
    pendingLiveNonStyleEditsRef.current = [];
    setPendingVisualStyleEdits([]);
    setPendingLiveNonStyleEdits([]);
  }, [cancelPendingStructureVerification, clearPendingEditSessionRecovery, id]);
  const clearPendingLiveEditStateRef = useRef(clearPendingLiveEditState);
  useEffect(() => {
    clearPendingLiveEditStateRef.current = clearPendingLiveEditState;
  }, [clearPendingLiveEditState]);
  useEffect(() => {
    if (!pendingVisualStyleRevertRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingVisualStyleRevertRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingVisualStyleRevertRequest]);
  useEffect(() => {
    if (!pendingTextRevertRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingTextRevertRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingTextRevertRequest]);
  useEffect(() => {
    if (!pendingStructureAckRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingStructureAckRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingStructureAckRequest]);
  useEffect(() => {
    if (!pendingLayerStateReplayRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingLayerStateReplayRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingLayerStateReplayRequest]);
  const [textEditingState, setTextEditingState] = useState<TextEditingState>({
    active: false,
  });
  const activeTextEditingSessionRef = useRef<{
    screenId: string;
    sourceId?: string;
  } | null>(null);
  const handleTextEditingStateChangeForScreen = useCallback(
    (screenId: string, state: Omit<TextEditingState, "screenId">) => {
      const screenState = { ...state, screenId };
      if (state.active || state.hasRange) {
        activeTextEditingSessionRef.current = {
          screenId,
          sourceId: state.sourceId,
        };
        setTextEditingState(screenState);
        return;
      }
      if (
        !endedTextEditClosesActiveSession(activeTextEditingSessionRef.current, {
          screenId,
          sourceId: state.sourceId,
        })
      ) {
        return;
      }
      activeTextEditingSessionRef.current = null;
      setTextEditingState(screenState);
    },
    [],
  );
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [hoveredElementScreenId, setHoveredElementScreenId] = useState<
    string | null
  >(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const [contentRenderRevision, setContentRenderRevision] = useState(0);
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("design");
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{
    nonce: number;
    anchor: unknown;
    targetId?: string | null;
    threadId?: string;
  } | null>(null);
  const reviewFocusNonceRef = useRef(0);
  const openedReviewHashRef = useRef<string | null>(null);
  const [activeLeftPanel, setActiveLeftPanel] =
    useState<DesignLeftPanel | null>("file");
  const layersRevealedForFirstCreateRef = useRef(false);
  const [activeCodeFile, setActiveCodeFile] =
    useState<CodeWorkbenchActiveFile | null>(null);
  const initialSearchCommandAppliedForIdRef = useRef<string | null>(null);
  const initialUrlSelectionHydratedForIdRef = useRef<string | null>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(240);
  const [uiHidden, setUiHidden] = useState(false);
  const minimalUiByDefault =
    embedded && !hostOwnsChrome && !embedChromeRequested;
  const [minimalUi, setMinimalUi] = useState(minimalUiByDefault);
  useEffect(() => {
    setMinimalUi(minimalUiByDefault);
  }, [minimalUiByDefault, embedChromeRequested, hostOwnsChrome]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileViewport(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const keyboardShortcutsReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressProjectMenuReturnFocusRef = useRef(false);
  const leftSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const [layersSearchQuery, setLayersSearchQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [selectedLayerIdsState, setSelectedLayerIdsState] = useState<string[]>(
    [],
  );
  const canEditSelectedLiveLayerRef = useRef(false);
  const selectedLayerTargetsRef = useRef<SelectedLayerTarget[]>([]);
  const selectedScreenStyleChangeRef = useRef<
    | ((
        screenId: string,
        selector: string,
        styles: Record<string, string>,
        elementInfo?: ElementInfo,
        metadata?: StyleChangeMeta,
      ) => void)
    | null
  >(null);
  const routeSelectedScreenStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: StyleChangeMeta,
    ) =>
      selectedScreenStyleChangeRef.current?.(
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [],
  );
  const renderedElementInfoByLayerKeyRef = useRef<Map<string, ElementInfo>>(
    new Map(),
  );
  const renderedElementInfoRevisionRef = useRef(0);
  const layerSelectionHydrationRevisionRef = useRef(0);
  const rehydrateRenderedElementInfoRef = useRef<(() => void) | null>(null);
  const renderedInfoRehydratePendingRef = useRef(false);
  const invalidateRenderedElementInfo = useCallback(() => {
    renderedElementInfoByLayerKeyRef.current.clear();
    renderedElementInfoRevisionRef.current += 1;
    renderedInfoRehydratePendingRef.current = true;
  }, []);
  const rehydrateRenderedInfoAfterPreview = useCallback(() => {
    if (!renderedInfoRehydratePendingRef.current) return;
    renderedInfoRehydratePendingRef.current = false;
    queueMicrotask(() => rehydrateRenderedElementInfoRef.current?.());
  }, []);
  const commitStylesToSelectedLayersRef = useRef<
    (
      styles: Record<string, string>,
      targets?: SelectedLayerTarget[],
      capturedOptions?: CapturedStyleTargetCommitOptions,
    ) => boolean
  >(() => false);
  const commitCapturedStyleTargetsRef = useRef<
    (
      styles: Record<string, string>,
      targets: CapturedStyleTarget[],
      interactionState?: InteractionState,
    ) => void
  >(() => {});
  const effectiveCodeLayerStateRef = useRef<EffectiveCodeLayerState>({
    lockedIds: new Set(),
    hiddenIds: new Set(),
  });
  const codeLayerOwnerByNodeIdRef = useRef<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        sourceProjection: CodeLayerProjection;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >(new Map());
  const [overviewSelectedScreenIds, setOverviewSelectedScreenIds] = useState<
    string[]
  >([]);
  const [createdOverviewLayerSelection, setCreatedOverviewLayerSelection] =
    useState<{
      screenId: string;
      layerId: string;
    } | null>(null);
  const pendingOverviewScreenSelectionRef = useRef<string | null>(null);
  const pendingOverviewLayerSelectionRef = useRef<string | null>(null);
  const lastOverviewSelectedScreenIdsRef = useRef<string[]>([]);
  const lastMarqueeSelectionSignatureRef = useRef<string | null>(null);
  const hasActiveSelectionRef = useRef(false);
  useEffect(() => {
    hasActiveSelectionRef.current =
      selectedElement !== null || selectedLayerIdsState.length > 0;
    trace("select", "selection-changed", {
      layers: selectedLayerIdsState,
      element: selectedElement?.selector ?? null,
      hasSelection: hasActiveSelectionRef.current,
    });
  }, [selectedElement, selectedLayerIdsState]);
  const pendingTextEditNodeIdRef = useRef<string | null>(null);
  const pendingTextCreationHistoryRef =
    useRef<PendingTextCreationHistory | null>(null);
  const pendingEmptyTextEditRef = useRef<{
    screenId: string | null;
    nodeId: string;
    cancel: () => void;
    settled: boolean;
  } | null>(null);
  const pendingOverviewLayerSelectionClearTimerRef = useRef<number | null>(
    null,
  );

  useEffect(() => {
    const openAgentPanel = () => {
      setActiveLeftPanel("agent");
      focusAgentComposer();
    };
    const toggleAgentPanel = () =>
      setActiveLeftPanel((current) => {
        const next = current === "agent" ? "file" : "agent";
        if (next === "agent") focusAgentComposer();
        return next;
      });
    window.addEventListener("agent-panel:open", openAgentPanel);
    window.addEventListener("agent-panel:toggle", toggleAgentPanel);
    return () => {
      window.removeEventListener("agent-panel:open", openAgentPanel);
      window.removeEventListener("agent-panel:toggle", toggleAgentPanel);
    };
  }, []);

  const clearPendingOverviewLayerSelectionTimer = useCallback(() => {
    if (pendingOverviewLayerSelectionClearTimerRef.current === null) return;
    window.clearTimeout(pendingOverviewLayerSelectionClearTimerRef.current);
    pendingOverviewLayerSelectionClearTimerRef.current = null;
  }, []);
  const schedulePendingOverviewLayerSelectionClear = useCallback(
    (layerId: string) => {
      clearPendingOverviewLayerSelectionTimer();
      pendingOverviewLayerSelectionClearTimerRef.current = window.setTimeout(
        () => {
          if (pendingOverviewLayerSelectionRef.current === layerId) {
            pendingOverviewLayerSelectionRef.current = null;
          }
          setCreatedOverviewLayerSelection((current) =>
            current?.layerId === layerId ? null : current,
          );
          pendingOverviewLayerSelectionClearTimerRef.current = null;
        },
        1800,
      );
    },
    [clearPendingOverviewLayerSelectionTimer],
  );
  useEffect(
    () => clearPendingOverviewLayerSelectionTimer,
    [clearPendingOverviewLayerSelectionTimer],
  );
  const [lockedLayerIds, setLockedLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const layerStateOverridesRef = useRef<
    Map<string, { hidden?: boolean; locked?: boolean }>
  >(new Map());
  const applyLayerStatePreview = useCallback(
    (
      screenId: string,
      layerId: string,
      state: "hidden" | "locked",
      enabled: boolean,
    ) => {
      const scopedId = scopedLayerStateId(screenId, layerId);
      layerStateOverridesRef.current.set(scopedId, {
        ...layerStateOverridesRef.current.get(scopedId),
        [state]: enabled,
      });
      const update = (current: Set<string>) => {
        const next = new Set(current);
        if (enabled) next.add(scopedId);
        else next.delete(scopedId);
        return next;
      };
      if (state === "hidden") setHiddenLayerIds(update);
      else setLockedLayerIds(update);
    },
    [],
  );
  useEffect(() => {
    if (!pendingLayerStateReplayRequest) return;
    pendingLayerStateReplayRequest.patches.forEach((patch) => {
      if (
        patch.routePath &&
        patch.routePath !== liveRoutePathsByScreenIdRef.current[patch.screenId]
      ) {
        return;
      }
      applyLayerStatePreview(
        patch.screenId,
        patch.layerId,
        patch.state,
        patch.enabled,
      );
    });
  }, [applyLayerStatePreview, pendingLayerStateReplayRequest]);
  useEffect(() => {
    if (!pendingLayerNameReplayRequest) return;
    const timeout = window.setTimeout(() => {
      setPendingLayerNameReplayRequest(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingLayerNameReplayRequest]);
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [overviewClearSelectionRequest, setOverviewClearSelectionRequest] =
    useState(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const [hasSystemClipboardImages, setHasSystemClipboardImages] =
    useState(false);
  const menuClipboardFilesRef = useRef<File[]>([]);
  const menuClipboardReadIdRef = useRef(0);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  const copiedLayerAnimationRef = useRef<MotionAnimationClip | null>(null);
  const [hasAnimationClipboard, setHasAnimationClipboard] = useState(false);
  const copiedLayerEntriesRef = useRef<CanvasLayerClipboardEntry[]>([]);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  const copiedScreenEntriesRef = useRef<DesignClipboardPayload["screens"]>([]);
  const lastWrittenClipboardMarkerRef = useRef<string | null>(null);
  const lastWrittenClipboardPlainTextRef = useRef<string | null>(null);
  const latestClipboardMutationContentRef = useRef<
    Map<string, ClipboardContentLineage>
  >(new Map());
  const clipboardPasteUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const clipboardPasteRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const pasteCascadeRef = useRef(0);
  const lastDuplicateTransformRef = useRef<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const hasSelectedElement = Boolean(selectedElement);

  const [motionDockOpen, setMotionDockOpen] = useState(false);
  const [motionDockMounted, setMotionDockMounted] = useState(false);
  const motionDockUnmountTimerRef = useRef<number | null>(null);
  const motionDockOpenAnimationFrameRef = useRef<number | null>(null);
  const [motionTimelineId, setMotionTimelineId] = useState<string | null>(null);
  const [motionTracks, setMotionTracks] = useState<MotionDockTrack[]>([]);
  const [motionDurationMs, setMotionDurationMs] = useState(2000);
  const [motionDefaultEase, setMotionDefaultEase] = useState<string>("ease");
  const [motionPlayhead, setMotionPlayhead] = useState(0);
  const motionLivePlayheadRef = useRef<number | null>(null);
  const [motionAutoKeyframeEnabled, setMotionAutoKeyframeEnabled] =
    useState(false);
  const [motionTracksDirty, setMotionTracksDirty] = useState(false);
  const [motionAutosaveRevision, setMotionAutosaveRevision] = useState(0);
  const [motionHydrationFingerprint, setMotionHydrationFingerprint] = useState<
    string | null
  >(null);
  const motionAutosaveRevisionRef = useRef(0);
  const motionAutosaveFailedRevisionRef = useRef<number | null>(null);
  const motionAutosaveTimerRef = useRef<number | null>(null);
  const motionAutosaveFlushRef = useRef<(() => void) | null>(null);
  const lastScheduledMotionAutosaveRevisionRef = useRef(0);
  const previousMotionFileIdRef = useRef<string | null>(null);
  const clearMotionDockUnmountTimer = useCallback(() => {
    if (motionDockUnmountTimerRef.current === null) return;
    window.clearTimeout(motionDockUnmountTimerRef.current);
    motionDockUnmountTimerRef.current = null;
  }, []);
  const clearMotionDockOpenAnimationFrame = useCallback(() => {
    if (
      typeof window === "undefined" ||
      motionDockOpenAnimationFrameRef.current === null
    ) {
      return;
    }
    window.cancelAnimationFrame(motionDockOpenAnimationFrameRef.current);
    motionDockOpenAnimationFrameRef.current = null;
  }, []);
  const clearMotionAutosaveTimer = useCallback(() => {
    motionAutosaveFlushRef.current = null;
    if (motionAutosaveTimerRef.current === null) return;
    window.clearTimeout(motionAutosaveTimerRef.current);
    motionAutosaveTimerRef.current = null;
  }, []);
  const setMotionDockOpenAnimated = useCallback(
    (open: boolean) => {
      clearMotionDockUnmountTimer();
      clearMotionDockOpenAnimationFrame();
      if (open) {
        setMotionDockMounted(true);
        if (typeof window === "undefined") {
          setMotionDockOpen(true);
          return;
        }
        motionDockOpenAnimationFrameRef.current = window.requestAnimationFrame(
          () => {
            motionDockOpenAnimationFrameRef.current =
              window.requestAnimationFrame(() => {
                setMotionDockOpen(true);
                motionDockOpenAnimationFrameRef.current = null;
              });
          },
        );
        return;
      }

      setMotionDockOpen(false);
      if (typeof window === "undefined") {
        setMotionDockMounted(false);
        return;
      }
      motionDockUnmountTimerRef.current = window.setTimeout(() => {
        setMotionDockMounted(false);
        motionDockUnmountTimerRef.current = null;
      }, MOTION_DOCK_EXIT_FALLBACK_MS);
    },
    [clearMotionDockOpenAnimationFrame, clearMotionDockUnmountTimer],
  );
  const handleMotionDockExitComplete = useCallback(() => {
    if (motionDockOpen) return;
    clearMotionDockUnmountTimer();
    if (typeof window === "undefined") {
      setMotionDockMounted(false);
      return;
    }
    motionDockUnmountTimerRef.current = window.setTimeout(() => {
      setMotionDockMounted(false);
      motionDockUnmountTimerRef.current = null;
    }, MOTION_DOCK_EXIT_SETTLE_MS);
  }, [clearMotionDockUnmountTimer, motionDockOpen]);
  useEffect(
    () => () => {
      clearMotionDockUnmountTimer();
      clearMotionDockOpenAnimationFrame();
    },
    [clearMotionDockOpenAnimationFrame, clearMotionDockUnmountTimer],
  );
  useEffect(
    () => () => {
      const flushPendingMotionAutosave = motionAutosaveFlushRef.current;
      if (flushPendingMotionAutosave) {
        flushPendingMotionAutosave();
        return;
      }
      clearMotionAutosaveTimer();
    },
    [clearMotionAutosaveTimer],
  );
  const [shaderFillPreview, setShaderFillPreview] = useState<{
    selector?: string;
    nodeId?: string;
    css: string;
  } | null>(null);
  const clearShaderFillPreview = useCallback(() => {
    setShaderFillPreview(null);
    postShaderFillPreviewClearToPreviewIframes();
  }, []);

  const [activeBreakpointWidthState, setActiveBreakpointWidthState] = useState<
    number | undefined
  >(undefined);
  const [responsiveEditScope, setResponsiveEditScope] =
    useState<ResponsiveEditScope>("cascade-smaller");
  const responsiveEditScopeRef = useRef<ResponsiveEditScope>("cascade-smaller");
  const activeBreakpointWidthStateRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    activeBreakpointWidthStateRef.current = activeBreakpointWidthState;
    invalidateRenderedElementInfo();
  }, [activeBreakpointWidthState, invalidateRenderedElementInfo]);
  const lastAppliedActiveBreakpointIdRef = useRef<string | null>(null);

  const [activeInteractionStateState, setActiveInteractionStateState] =
    useState<InteractionState | null>(null);

  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [reviewFileId, setReviewFileId] = useState<string | null>(null);
  const [reviewFindings, setReviewFindings] = useState<A11yFinding[]>([]);
  const [reviewAuditLoading, setReviewAuditLoading] = useState(false);
  const [reviewAuditedAt, setReviewAuditedAt] = useState<string | null>(null);
  const [reviewAuditError, setReviewAuditError] = useState<string | null>(null);

  const builderHostProtocolActive = isBuilderDesignEmbed || hostEmbeddedEditor;
  useEffect(() => {
    if (!builderHostProtocolActive) return;
    window.parent.postMessage({ type: "agentNative.appReady" }, "*");

    function handleDesignHostMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const origin = event.origin ?? "";
      try {
        const hostname = new URL(origin).hostname.toLowerCase();
        const trusted =
          hostname === "builder.io" ||
          hostname.endsWith(".builder.io") ||
          hostname === "builder.my" ||
          hostname.endsWith(".builder.my") ||
          hostname === "localhost" ||
          hostname === "127.0.0.1";
        if (!trusted) return;
      } catch {
        return;
      }

      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "design:init") {
        if (!parentOriginRef.current) {
          parentOriginRef.current = origin;
        }
        rememberBuilderHostOrigin(origin);
        const { previewUrl, routes, context } = data.data ?? {};
        if (typeof previewUrl === "string" && isBuilderPreviewUrl(previewUrl)) {
          setBuilderPreviewUrl(previewUrl);
          const nextShellInput: ShellDesignInput = {
            previewOrigin: builderPreviewOrigin(previewUrl),
            routes: Array.isArray(routes)
              ? routes.flatMap((route: unknown) => {
                  const path = (route as { path?: unknown })?.path;
                  return typeof path === "string" && path ? [{ path }] : [];
                })
              : [],
            projectId: context?.projectId,
            branchName: context?.branchName,
            builderOrgId: context?.builderOrgId,
            contentId: context?.contentId ?? undefined,
          };
          setShellInput((current) => {
            if (
              current &&
              JSON.stringify(current) === JSON.stringify(nextShellInput)
            ) {
              return current;
            }
            if (current && shellContextChanged(current, nextShellInput)) {
              clearPendingLiveEditStateRef.current();
            }
            return nextShellInput;
          });
        }
      }

      if (data.type === "design:previewUrlChanged") {
        const nextPreviewUrl = data.data?.previewUrl;
        if (
          typeof nextPreviewUrl === "string" &&
          isBuilderPreviewUrl(nextPreviewUrl)
        ) {
          setBuilderPreviewUrl(nextPreviewUrl);
          const previewOrigin = builderPreviewOrigin(nextPreviewUrl);
          setShellInput((current) => {
            if (!current || current.previewOrigin === previewOrigin) {
              return current;
            }
            clearPendingLiveEditStateRef.current();
            return { ...current, previewOrigin };
          });
        }
      }

      if (data.type === "design:showChat") {
        setActiveLeftPanel("agent");
      }

      if (data.type === "design:chatState") {
        const next = data.data?.state;
        if (
          next === "generating" &&
          stagedSourceHandoffRef.current === "awaiting-start"
        ) {
          stagedSourceHandoffRef.current = "running";
          if (stagedHandoffStartTimerRef.current !== undefined) {
            window.clearTimeout(stagedHandoffStartTimerRef.current);
            stagedHandoffStartTimerRef.current = undefined;
          }
        }
        if (hostChatGeneratingRef.current && next !== "generating") {
          reloadRunningAppPreviewFrames();
          if (stagedSourceHandoffRef.current === "running") {
            stagedSourceHandoffRef.current = "idle";
            setApplyingViaHost(false);
            if (next === "idle") clearPendingLiveEditStateRef.current();
          }
        }
        hostChatGeneratingRef.current = next === "generating";
      }
    }

    window.addEventListener("message", handleDesignHostMessage);
    return () => window.removeEventListener("message", handleDesignHostMessage);
  }, [builderHostProtocolActive]);

  const focusDesignInspectorForSelection = useCallback(() => {
    setActiveInspectorTab("design");
  }, []);

  useEffect(() => {
    if (hasSelectedElement) focusDesignInspectorForSelection();
  }, [focusDesignInspectorForSelection, hasSelectedElement]);

  const startSidebarResize = useCallback(
    (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) =>
      runStartSidebarResize(
        {
          activeLeftPanel,
          leftSidebarContentRef,
          leftSidebarWidth,
          rightSidebarContentRef,
          rightSidebarWidth,
          setLeftSidebarWidth,
          setRightSidebarWidth,
        },
        side,
        event,
      ),
    [activeLeftPanel, leftSidebarWidth, rightSidebarWidth],
  );
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const linkedComponentMutationQueueRef = useRef<{
    designId: string;
    queue: ReturnType<typeof createLinkedComponentMutationQueue>;
  } | null>(null);
  const contentUndoStackRef = useRef<ContentHistoryEntry[]>([]);
  const contentRedoStackRef = useRef<ContentHistoryEntry[]>([]);
  const applyGeometryHistoryContentChangesRef = useRef<
    (
      changes: readonly ContentHistoryChange[],
      direction: "commit" | "undo" | "redo",
    ) => void
  >(() => {});
  const contentUndoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const contentRedoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const contentHistorySelectionAfterRef =
    useRef<ContentHistorySelectionAfterMap>(new WeakMap());
  const localContentUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const localContentRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const activeFileIdForUndoRef = useRef<string | null>(null);
  const suppressContentHistoryRef = useRef(false);
  const geometryUndoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const geometryRedoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const selectedLayerIdsStateRef = useRef<string[]>([]);
  const overviewSelectedScreenIdsRef = useRef<string[]>([]);
  const fileCreationUndoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const fileCreationRedoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const pendingDuplicateGeometriesRef = useRef<Map<string, FrameGeometry>>(
    new Map(),
  );
  const pendingDuplicateFilenamesRef = useRef<Set<string>>(new Set());
  const duplicateInFlightRef = useRef<Set<string>>(new Set());
  const duplicateRecoveryRef = useRef<
    Map<string, DuplicateScreenRecoveryEntry>
  >(new Map());
  const fileDeletionUndoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  const fileDeletionRedoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  // File deletion undo/redo recreates or removes SQL rows asynchronously.
  // Disable every history command while one of those mutations is in flight
  // so a rapid second Cmd+Z cannot race a create against the pending delete.
  const fileHistoryMutationPendingRef = useRef(false);
  const pendingHistoryDirectionsRef = useRef<Array<"undo" | "redo">>([]);
  const pendingHistoryDrainScheduledRef = useRef(false);
  const replayPendingHistoryRef = useRef<
    ((direction: "undo" | "redo") => void) | null
  >(null);
  const historyOrderRef = useRef<(UndoRedoOrderKind | "selection")[]>([]);
  const redoOrderRef = useRef<(UndoRedoOrderKind | "selection")[]>([]);
  const selectionUndoStackRef = useRef<SelectionHistoryEntry[]>([]);
  const selectionRedoStackRef = useRef<SelectionHistoryEntry[]>([]);
  const clearRedoStacks = useCallback(() => {
    contentRedoStackRef.current = [];
    contentRedoSelectionStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryRedoStackRef.current = [];
    fileCreationRedoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    pendingVisualStyleRedoStackRef.current = [];
    pendingLiveNonStyleRedoStackRef.current = [];
    clipboardPasteRedoStackRef.current = [];
    pendingStructureRedoReplayRef.current = undefined;
    selectionRedoStackRef.current = [];
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    redoOrderRef.current = [];
    undoManagerRef.current?.clear(false, true);
  }, []);
  const recordPendingHistoryEntry = useCallback(
    (kind: "pending-style" | "pending-live", replayedRedo = false) => {
      if (replayedRedo) {
        if (redoOrderRef.current[redoOrderRef.current.length - 1] === kind) {
          redoOrderRef.current = redoOrderRef.current.slice(0, -1);
        }
      } else {
        clearRedoStacks();
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        kind,
      ];
    },
    [clearRedoStacks],
  );
  const clearPendingHistoryDirections = useCallback(() => {
    pendingHistoryDirectionsRef.current = [];
    pendingHistoryDrainScheduledRef.current = false;
  }, []);
  const historySourceReaderRef = useRef<(screenId: string) => string>(() => {
    throw new Error("History source reader is not initialized");
  });
  const captureCurrentSelection = (): GeometryHistorySelection => {
    recordDesignPerformance("captureCurrentSelection");
    return captureHistorySelectionFromOwners(
      {
        overviewSelectedScreenIds: [...overviewSelectedScreenIdsRef.current],
        selectedLayerIds: [...selectedLayerIdsStateRef.current],
        activeFileId: activeFileIdForUndoRef.current,
      },
      codeLayerOwnerByNodeIdRef.current,
      (screenId) => historySourceReaderRef.current(screenId),
    );
  };
  const restoreSelectionSnapshot = useCallback(
    (selection: GeometryHistorySelection | undefined) => {
      if (!selection) return;
      if (viewModeRef.current !== "overview") {
        setSelectedLayerIdsState(selection.selectedLayerIds);
        if (selection.activeFileId) setActiveFileId(selection.activeFileId);
        return;
      }
      const restoredLayerId =
        selection.selectedLayerIds.length === 1
          ? selection.selectedLayerIds[0]
          : undefined;
      const restoredScreenSelectionId =
        selection.overviewSelectedScreenIds.length === 1 &&
        selection.selectedLayerIds.length === 1 &&
        selection.overviewSelectedScreenIds[0] === restoredLayerId
          ? restoredLayerId
          : null;
      pendingOverviewScreenSelectionRef.current = restoredScreenSelectionId;
      pendingOverviewLayerSelectionRef.current =
        restoredLayerId &&
        (codeLayerOwnerByNodeIdRef.current.has(restoredLayerId) ||
          restoredLayerId === restoredScreenSelectionId)
          ? restoredLayerId
          : null;
      if (pendingOverviewLayerSelectionRef.current) {
        schedulePendingOverviewLayerSelectionClear(
          pendingOverviewLayerSelectionRef.current,
        );
      } else {
        clearPendingOverviewLayerSelectionTimer();
      }
      setOverviewSelectedScreenIds(selection.overviewSelectedScreenIds);
      setSelectedLayerIdsState(selection.selectedLayerIds);
      if (selection.activeFileId) {
        setActiveFileId(selection.activeFileId);
      }
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      schedulePendingOverviewLayerSelectionClear,
    ],
  );
  const syncUndoRedoState = useCallback(() => {
    if (fileHistoryMutationPendingRef.current) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    if (
      pendingHistoryDirectionsRef.current.length > 0 &&
      !pendingHistoryDrainScheduledRef.current
    ) {
      pendingHistoryDrainScheduledRef.current = true;
      queueMicrotask(function drainPendingHistory() {
        if (fileHistoryMutationPendingRef.current) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        const direction = pendingHistoryDirectionsRef.current.shift();
        if (!direction) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        replayPendingHistoryRef.current?.(direction);
        if (fileHistoryMutationPendingRef.current) {
          pendingHistoryDrainScheduledRef.current = false;
          return;
        }
        if (pendingHistoryDirectionsRef.current.length > 0) {
          queueMicrotask(drainPendingHistory);
        } else {
          pendingHistoryDrainScheduledRef.current = false;
        }
      });
    }
    const undoManager = undoManagerRef.current;
    const canUseOverviewHistory = viewModeRef.current === "overview";
    const activeHistoryFileId = activeFileIdForUndoRef.current;
    const hasLocalUndo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentUndoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    const hasLocalRedo =
      !canUseOverviewHistory &&
      findLastContentHistoryChangeIndex(
        localContentRedoStackRef.current,
        activeHistoryFileId,
      ) !== -1;
    setCanUndo(
      Boolean(linkedComponentMutationQueueRef.current?.queue.hasPending()) ||
        contentUndoStackRef.current.some(
          (entry) => "linkedComponent" in entry && entry.linkedComponent,
        ) ||
        pendingVisualStyleEditsRef.current.length > 0 ||
        pendingLiveNonStyleUndoStackRef.current.length > 0 ||
        Boolean(undoManager?.canUndo()) ||
        hasLocalUndo ||
        clipboardPasteUndoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentUndoStackRef.current.length > 0 ||
            geometryUndoStackRef.current.length > 0 ||
            fileCreationUndoStackRef.current.length > 0 ||
            fileDeletionUndoStackRef.current.length > 0 ||
            selectionUndoStackRef.current.length > 0)),
    );
    setCanRedo(
      contentRedoStackRef.current.some(
        (entry) => "linkedComponent" in entry && entry.linkedComponent,
      ) ||
        pendingVisualStyleRedoStackRef.current.length > 0 ||
        pendingLiveNonStyleRedoStackRef.current.length > 0 ||
        Boolean(undoManager?.canRedo()) ||
        hasLocalRedo ||
        clipboardPasteRedoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentRedoStackRef.current.length > 0 ||
            geometryRedoStackRef.current.length > 0 ||
            fileCreationRedoStackRef.current.length > 0 ||
            fileDeletionRedoStackRef.current.length > 0 ||
            selectionRedoStackRef.current.length > 0)),
    );
  }, []);
  const pushSelectionHistoryEntry = useCallback(
    (before: GeometryHistorySelection, after: GeometryHistorySelection) => {
      if (selectionHistorySnapshotsEqual(before, after)) return;
      const record = (
        before: GeometryHistorySelection,
        after: GeometryHistorySelection,
      ) => {
        if (selectionHistorySnapshotsEqual(before, after)) return;
        selectionUndoStackRef.current = [
          ...selectionUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          { before, after },
        ];
        clearRedoStacks();
        historyOrderRef.current = [
          ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "selection",
        ];
        syncUndoRedoState();
      };
      if (
        linkedComponentMutationQueueRef.current?.queue.deferHistoryChange(
          () => {
            const previous = captureCurrentSelection();
            const fileIds = new Set([
              ...Object.keys(after.sourceContentByFileId ?? {}),
              ...after.overviewSelectedScreenIds,
              ...(after.activeFileId ? [after.activeFileId] : []),
            ]);
            const sources = Object.fromEntries(
              [...fileIds].map((fileId) => [
                fileId,
                historySourceReaderRef.current(fileId),
              ]),
            );
            const resolved = resolveHistorySelection(
              captureHistorySelectionSources(after, sources),
              sources,
            );
            flushSync(() => {
              restoreSelectionSnapshot(resolved.selection);
              setSelectedElement(resolved.element);
            });
            record(previous, resolved.selection!);
          },
        )
      )
        return;
      record(before, after);
    },
    [clearRedoStacks, restoreSelectionSnapshot, syncUndoRedoState],
  );
  const marqueeSelectionHistoryBeforeRef =
    useRef<GeometryHistorySelection | null>(null);
  const marqueeSelectedElementBeforeRef = useRef<ElementInfo | null>(null);
  const recordSelectionHistoryAroundChange = useCallback(
    (run: () => void) => {
      marqueeSelectionHistoryBeforeRef.current = null;
      marqueeSelectedElementBeforeRef.current = null;
      lastMarqueeSelectionSignatureRef.current = null;
      if (viewModeRef.current !== "overview") {
        run();
        return;
      }
      const before = captureCurrentSelection();
      flushSync(run);
      const after = captureCurrentSelection();
      pushSelectionHistoryEntry(before, after);
    },
    [pushSelectionHistoryEntry],
  );
  const recordMarqueeSelectionHistoryAroundChange = useCallback(
    (
      run: () => void,
      intent: {
        source?: string;
        final?: boolean;
        cancelled?: boolean;
        restoreHostSelection?: boolean;
        resetHistory?: boolean;
      },
    ) => {
      if (intent.source === "marquee" && intent.cancelled) {
        const before = marqueeSelectionHistoryBeforeRef.current;
        const selectedElementBefore = marqueeSelectedElementBeforeRef.current;
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
        runMarqueeSelectionCancellation({
          before,
          flushSync,
          restoreHostSelection: intent.restoreHostSelection === true,
          restoreSelectionSnapshot,
          run,
          selectedElementBefore,
          setSelectedElement,
        });
        return;
      }
      if (intent.source === "marquee" && intent.resetHistory) {
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
      }
      if (intent.source !== "marquee") {
        recordSelectionHistoryAroundChange(run);
        return;
      }
      if (viewModeRef.current !== "overview") {
        marqueeSelectionHistoryBeforeRef.current = null;
        marqueeSelectedElementBeforeRef.current = null;
        lastMarqueeSelectionSignatureRef.current = null;
        run();
        return;
      }
      recordDesignPerformance("marqueeSelectionChange");
      if (intent.final !== true) {
        if (marqueeSelectionHistoryBeforeRef.current === null) {
          lastMarqueeSelectionSignatureRef.current = null;
          marqueeSelectionHistoryBeforeRef.current = captureCurrentSelection();
          marqueeSelectedElementBeforeRef.current = selectedElementRef.current;
        }
        run();
        return;
      }
      const before =
        marqueeSelectionHistoryBeforeRef.current ?? captureCurrentSelection();
      flushSync(run);
      recordDesignPerformance("marqueeFinalSelectionChange");
      const after = captureCurrentSelection();
      const entry = coalesceMarqueeSelectionHistory(
        marqueeSelectionHistoryBeforeRef,
        intent.final === true,
        before,
        after,
      );
      if (entry) pushSelectionHistoryEntry(entry.before, entry.after);
      marqueeSelectedElementBeforeRef.current = null;
      lastMarqueeSelectionSignatureRef.current = null;
    },
    [
      pushSelectionHistoryEntry,
      recordSelectionHistoryAroundChange,
      restoreSelectionSnapshot,
    ],
  );
  useEffect(() => {
    pendingVisualStyleEditsRef.current = pendingVisualStyleEdits;
    syncUndoRedoState();
  }, [pendingVisualStyleEdits, syncUndoRedoState]);
  useEffect(() => {
    pendingLiveNonStyleEditsRef.current = pendingLiveNonStyleEdits;
    syncUndoRedoState();
  }, [pendingLiveNonStyleEdits, syncUndoRedoState]);
  const recordContentHistoryEntry = useCallback(
    (entry: ContentHistoryEntry, selectedLayerIdsOverride?: string[]) => {
      const changes = getContentHistoryChanges(entry).filter(
        hasContentHistoryChange,
      );
      if (changes.length === 0) return;
      const activeHistoryFileId = activeFileIdForUndoRef.current;
      if (
        activeHistoryFileId &&
        changes.some((change) => change.fileId === activeHistoryFileId)
      ) {
        undoManagerRef.current?.clear(true, false);
        localContentUndoStackRef.current =
          localContentUndoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        localContentRedoStackRef.current =
          localContentRedoStackRef.current.filter(
            (change) => change.fileId !== activeHistoryFileId,
          );
        historyOrderRef.current = removeUndoRedoOrderKind(
          historyOrderRef.current,
          "content",
        );
        redoOrderRef.current = removeUndoRedoOrderKind(
          redoOrderRef.current,
          "content",
        );
      }
      contentUndoStackRef.current = [
        ...contentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        changes.length === 1 ? changes[0] : { changes },
      ];
      const selection = captureCurrentSelection();
      contentUndoSelectionStackRef.current = [
        ...contentUndoSelectionStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        captureHistorySelectionSources(
          {
            ...selection,
            ...(selectedLayerIdsOverride
              ? { selectedLayerIds: selectedLayerIdsOverride }
              : {}),
          },
          {
            ...selection.sourceContentByFileId,
            ...Object.fromEntries(
              changes.map((change) => [change.fileId, change.before]),
            ),
          },
        ),
      ];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-content",
      ];
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const recordLocalContentHistoryEntry = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      localContentUndoStackRef.current = [
        ...localContentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        change,
      ];
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      clearRedoStacks();
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const recordLocalContentHistoryChangeFallback = useCallback(
    (change: ContentHistoryChange) => {
      if (
        historyOrderRef.current.lastIndexOf("file-content") >
        historyOrderRef.current.lastIndexOf("content")
      ) {
        localContentUndoStackRef.current = [
          ...localContentUndoStackRef.current.slice(
            -(MAX_DESIGN_UNDO_STACK - 1),
          ),
          change,
        ];
        return;
      }
      localContentUndoStackRef.current = mergeLocalContentHistoryFallback(
        localContentUndoStackRef.current,
        change,
      );
    },
    [],
  );
  const prepareTextCreationFinalization = useCallback(
    (
      fileId: string,
      nodeIds: readonly (string | null | undefined)[],
      finalContent: string,
    ) => {
      const pending = pendingTextCreationHistoryRef.current;
      if (
        !pending ||
        pending.fileId !== fileId ||
        !nodeIds.some((nodeId) => nodeId === pending.nodeId)
      ) {
        return {
          isCreationCommit: false,
          historyHandled: false,
          confirm: () => {},
        };
      }
      const consumePending = () => {
        if (pendingTextCreationHistoryRef.current !== pending) return false;
        pendingTextCreationHistoryRef.current = null;
        return true;
      };
      const result = finalizeTextCreationHistory(
        contentUndoStackRef.current,
        pending,
        finalContent,
      );
      if (result.status === "stale") {
        return {
          isCreationCommit: true,
          historyHandled: false,
          confirm: consumePending,
        };
      }
      return {
        isCreationCommit: true,
        historyHandled: true,
        confirm: () => {
          if (!consumePending()) return;
          contentUndoStackRef.current = result.stack;
          if (result.status === "rolled-back") {
            contentUndoSelectionStackRef.current =
              contentUndoSelectionStackRef.current.slice(0, -1);
            historyOrderRef.current = removeRecentUndoRedoOrderKinds(
              historyOrderRef.current,
              "file-content",
              1,
            );
          }
          syncUndoRedoState();
        },
      };
    },
    [syncUndoRedoState],
  );
  const recordExternalContentHistoryCheckpoint = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      const record = () => {
        if (contentHistoryScopeForViewMode(viewModeRef.current) === "global") {
          recordContentHistoryEntry(change);
          return;
        }
        undoManagerRef.current?.clear(true, false);
        recordLocalContentHistoryChangeFallback({
          ...change,
          isCheckpoint: true,
        });
        clearRedoStacks();
        syncUndoRedoState();
      };
      if (
        linkedComponentMutationQueueRef.current?.queue.interceptExternalCheckpoint(
          change,
          record,
        )
      )
        return;
      record();
    },
    [
      clearRedoStacks,
      recordContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      syncUndoRedoState,
    ],
  );
  const clearLocalUndoRedoStacks = useCallback(() => {
    contentUndoStackRef.current = [];
    contentRedoStackRef.current = [];
    contentUndoSelectionStackRef.current = [];
    contentRedoSelectionStackRef.current = [];
    localContentUndoStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryUndoStackRef.current = [];
    geometryRedoStackRef.current = [];
    fileCreationUndoStackRef.current = [];
    fileCreationRedoStackRef.current = [];
    pendingDuplicateGeometriesRef.current.clear();
    pendingDuplicateFilenamesRef.current.clear();
    duplicateInFlightRef.current.clear();
    duplicateRecoveryRef.current.clear();
    fileDeletionUndoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    fileHistoryMutationPendingRef.current = false;
    clearPendingHistoryDirections();
    selectionUndoStackRef.current = [];
    selectionRedoStackRef.current = [];
    clipboardPasteUndoStackRef.current = [];
    clipboardPasteRedoStackRef.current = [];
    latestClipboardMutationContentRef.current.clear();
    historyOrderRef.current = [];
    redoOrderRef.current = [];
  }, [clearPendingHistoryDirections]);
  const recordFileCreationHistoryEntry = useCallback(
    (entry: FileCreationHistoryEntry) => {
      const previous =
        fileCreationUndoStackRef.current[
          fileCreationUndoStackRef.current.length - 1
        ];
      const continuesBatch =
        !!entry.historyBatchId &&
        previous?.historyBatchId === entry.historyBatchId;
      fileCreationUndoStackRef.current = [
        ...fileCreationUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      if (!continuesBatch) {
        clearRedoStacks();
        historyOrderRef.current = [
          ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
          "file-created",
        ];
      }
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  const persistedSelectionStateRef = useRef<string | null>(null);
  const persistedSelectionContextRef = useRef<string | null>(null);
  const pendingPersistedSelectionWriteRef = useRef<{
    key: string;
    contextKey: string;
    value: Record<string, unknown>;
  } | null>(null);
  const persistedSelectionWriteTimerRef = useRef<number | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const designSaveOperationSourceRef = useRef(
    createEditorSaveOperationSource(),
  );
  const frameGeometrySaveTimerRef = useRef<number | null>(null);
  const pendingFrameGeometrySaveRef = useRef<{
    geometryById: CanvasFrameGeometryById;
    previousGeometry: CanvasFrameGeometryById;
  } | null>(null);
  const pendingFrameGeometryOperationsForUnloadRef =
    useRef<PendingDesignDataOperations>({});
  const frameGeometryOperationRevisionRef = useRef(0);
  const frameGeometryMutationChainRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const urlSyncTimerRef = useRef<number | null>(null);
  const urlSyncScreenIdRef = useRef<string | null>(null);
  const lastGeometryCommitAtRef = useRef(0);
  const lastGeometryCommitSourceRef = useRef<"pointer" | "keyboard" | null>(
    null,
  );
  const resetGeometryCommitCoalescing = useCallback(() => {
    lastGeometryCommitAtRef.current = 0;
    lastGeometryCommitSourceRef.current = null;
  }, []);
  const [localhostWriteConsentOpen, setLocalhostWriteConsentOpen] =
    useState(false);
  const [localhostWriteConsentPayload, setLocalhostWriteConsentPayload] =
    useState<LocalhostWriteConsentPayload | null>(null);
  const [localhostConsentConnectionId, setLocalhostConsentConnectionId] =
    useState<string>("");
  const [applyToSourcePending, setApplyToSourcePending] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const overviewCommentPinNonceRef = useRef(0);
  const [overviewCommentPinRequest, setOverviewCommentPinRequest] = useState<{
    nonce: number;
    canvasPoint: { x: number; y: number };
  } | null>(null);
  const [repromptDraftRequest, setRepromptDraftRequest] =
    useState<RepromptDraftRequest | null>(null);
  const [overviewAnnotationResetSignal, setOverviewAnnotationResetSignal] =
    useState(0);
  const [focusedAnnotationResetSignal, setFocusedAnnotationResetSignal] =
    useState(0);
  const [overviewAnnotationSending, setOverviewAnnotationSending] =
    useState(false);
  const overviewAnnotationSendingRef = useRef(false);
  const [focusedAnnotationSending, setFocusedAnnotationSending] =
    useState(false);
  const focusedAnnotationSendingCountRef = useRef(0);
  const handleFocusedAnnotationSendingChange = useCallback(
    (sending: boolean) => {
      focusedAnnotationSendingCountRef.current = Math.max(
        0,
        focusedAnnotationSendingCountRef.current + (sending ? 1 : -1),
      );
      setFocusedAnnotationSending(focusedAnnotationSendingCountRef.current > 0);
    },
    [],
  );
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const [pngExporting, setPngExporting] = useState(false);
  const [exportPreviewScreenId, setExportPreviewScreenId] = useState<
    string | null
  >(null);
  const [svgExporting, setSvgExporting] = useState(false);
  const [figmaSvgExporting, setFigmaSvgExporting] = useState(false);
  const pngExportingRef = useRef(false);
  const figmaSvgExportingRef = useRef(false);
  const figmaPasteImportingRef = useRef(false);
  const [figmaHydrationOpen, setFigmaHydrationOpen] = useState(false);
  const [figmaHydrationFileIds, setFigmaHydrationFileIds] = useState<string[]>(
    [],
  );
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "overview" || overviewSelectedScreenIds.length === 0) {
      return;
    }
    lastOverviewSelectedScreenIdsRef.current = [...overviewSelectedScreenIds];
  }, [overviewSelectedScreenIds, viewMode]);
  const [hasPendingGeneration, setHasPendingGeneration] = useState(false);
  const [generationChatTabId, setGenerationChatTabId] = useState<string | null>(
    null,
  );
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  const [promptDesignSystemId, setPromptDesignSystemId] = useState<
    string | null | undefined
  >(undefined);

  useEffect(() => {
    if (!isSignedIn) return;
    return () => {
      void (async () => {
        const keys = designSelectionStateKeys();
        if (persistedSelectionWriteTimerRef.current !== null) {
          window.clearTimeout(persistedSelectionWriteTimerRef.current);
          persistedSelectionWriteTimerRef.current = null;
        }
        pendingPersistedSelectionWriteRef.current = null;
        persistedSelectionStateRef.current = null;
        persistedSelectionContextRef.current = null;
        for (const key of keys) {
          // coercion-ok: absent client state means there is nothing to clear.
          const current = await readClientAppState(key).catch(() => null);
          const ownerId =
            current && typeof current === "object"
              ? (current as { ownerId?: unknown }).ownerId
              : undefined;
          if (ownerId !== designSelectionOwnerIdRef.current) continue;
          // coercion-ok: state cleanup is best effort during unmount.
          await setClientAppState(key, null, {
            keepalive: true,
          }).catch(() => {});
        }
      })();
    };
  }, [isSignedIn]);
  const [retryablePrompt, setRetryablePrompt] =
    useState<RetryablePrompt | null>(null);
  const generationOutputReadyRef = useRef(false);
  const pendingQuestionsVisibleRef = useRef(false);
  const generationRunConfirmedRef = useRef(false);
  const generationCompleteTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const storedRunLivenessTimerRef = useRef<number | null>(null);
  const clearGenerationCompleteTimer = useCallback(() => {
    if (generationCompleteTimerRef.current !== null) {
      window.clearTimeout(generationCompleteTimerRef.current);
      generationCompleteTimerRef.current = null;
    }
  }, []);
  const clearAutoRetryTimer = useCallback(() => {
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  }, []);
  const clearStoredRunLivenessTimer = useCallback(() => {
    if (storedRunLivenessTimerRef.current !== null) {
      window.clearTimeout(storedRunLivenessTimerRef.current);
      storedRunLivenessTimerRef.current = null;
    }
  }, []);
  const staleToastShownRef = useRef(false);
  const generationModelRef = useRef<{
    model?: string;
    engine?: string;
    effort?: PromptComposerSubmitOptions["effort"];
  } | null>(null);
  const rememberPendingGenerationForRetry = useCallback(() => {
    const pending = readPendingGeneration(id);
    if (pending?.prompt) {
      setRetryablePrompt({
        prompt: pending.prompt,
        files: Array.isArray(pending.files) ? pending.files : [],
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        contextItems: pending.contextItems,
        designSystemId: pending.designSystemId,
        attempt: pending.attempt ?? 1,
        source: pending.source,
        templateId: pending.templateId,
        templateBaselineFiles: pending.templateBaselineFiles,
      });
      return true;
    }
    return false;
  }, [id]);
  const markGenerationStale = useCallback(() => {
    clearGenerationCompleteTimer();
    rememberPendingGenerationForRetry();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(t("designEditor.generationMayHaveStopped"));
    if (!staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.info(t("designEditor.generationMayHaveStoppedToast"));
    }
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationComplete = useCallback(() => {
    clearGenerationCompleteTimer();
    generationCompleteTimerRef.current = window.setTimeout(() => {
      generationCompleteTimerRef.current = null;
      if (pendingQuestionsVisibleRef.current) {
        setHasPendingGeneration(false);
        staleToastShownRef.current = false;
        setGenerationIssue(null);
        return;
      }
      const hasOutput = generationOutputReadyRef.current;
      const preservedForRetry = hasOutput
        ? false
        : rememberPendingGenerationForRetry();
      clearPendingGeneration(id);
      setHasPendingGeneration(false);
      staleToastShownRef.current = false;
      setGenerationIssue(
        hasOutput
          ? null
          : preservedForRetry
            ? t("designEditor.generationStoppedRetry")
            : t("designEditor.generationStoppedCheckAgent"),
      );
    }, 4000);
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationStopped = useCallback(() => {
    clearGenerationCompleteTimer();
    clearAutoRetryTimer();
    clearStoredRunLivenessTimer();
    clearPendingGeneration(id);
    setGenerationChatTabId(null);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [
    clearAutoRetryTimer,
    clearGenerationCompleteTimer,
    clearStoredRunLivenessTimer,
    id,
  ]);
  const scheduleStoredRunLivenessCheck = useCallback(
    (runTabId: string) => {
      clearStoredRunLivenessTimer();
      generationRunConfirmedRef.current = false;
      storedRunLivenessTimerRef.current = window.setTimeout(() => {
        storedRunLivenessTimerRef.current = null;
        if (generationRunConfirmedRef.current) return;
        if (pendingQuestionsVisibleRef.current) {
          return;
        }
        const pending = readPendingGeneration(id);
        if (!pending || pending.runTabId !== runTabId) return;
        if (generationOutputReadyRef.current) {
          clearPendingGeneration(id);
          setHasPendingGeneration(false);
          setGenerationIssue(null);
          return;
        }
        rememberPendingGenerationForRetry();
        clearPendingGeneration(id);
        setHasPendingGeneration(false);
        setGenerationIssue(t("designEditor.generationStoppedRetry"));
      }, STORED_RUN_LIVENESS_GRACE_MS);
    },
    [clearStoredRunLivenessTimer, id, rememberPendingGenerationForRetry, t],
  );
  const {
    generating,
    submit: agentSubmit,
    reset: resetAgentGenerating,
    track: trackAgentGeneration,
  } = useAgentGenerating({
    onComplete: handleGenerationComplete,
    onStopped: handleGenerationStopped,
    onStale: markGenerationStale,
    shouldAdoptRunningTab: () =>
      Boolean(id) &&
      !generationOutputReadyRef.current &&
      hasFreshPendingGeneration(id),
    onAdoptRunningTab: (tabId) => {
      generationRunConfirmedRef.current = true;
      setGenerationChatTabId(tabId);
      setHasPendingGeneration(true);
    },
    onRunning: () => {
      generationRunConfirmedRef.current = true;
      clearStoredRunLivenessTimer();
    },
  });
  const { generating: reviewFeedbackApplying, submit: submitReviewFeedback } =
    useAgentGenerating();
  const handleQuestionFlowContinue = useCallback(
    (runTabId: string) => {
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      setRetryablePrompt(null);
      setGenerationChatTabId(runTabId);
      const pending = readPendingGeneration(id, { allowUntimestamped: true });
      patchPendingGeneration(id, {
        prompt: pending?.prompt ?? "Continue from answered design questions.",
        files: pending?.files ?? [],
        title: pending?.title,
        designSystemId: pending?.designSystemId,
        model: pending?.model,
        engine: pending?.engine,
        effort: pending?.effort,
        contextItems: pending?.contextItems,
        runTabId,
        attempt: pending?.attempt ?? 1,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      trackAgentGeneration(runTabId);
    },
    [clearGenerationCompleteTimer, id, trackAgentGeneration],
  );

  const getQuestionFlowModelSelection = useCallback(
    () =>
      generationModelRef.current ??
      readPendingGeneration(id, { allowUntimestamped: true }),
    [id],
  );
  const getQuestionFlowGenerationBrief = useCallback(() => {
    const pending = readPendingGeneration(id, { allowUntimestamped: true });
    if (!pending) return null;
    const files = pending.files ?? [];
    return {
      prompt: pending.prompt,
      designSystemId: pending.designSystemId,
      images: imageAttachmentsFromUploadedFiles(files),
      contextItems: pending.contextItems,
      uploadedFileContext: formatUploadedFileContext(files),
    };
  }, [id]);
  const {
    questions: pendingQuestions,
    title: pendingQuestionsTitle,
    description: pendingQuestionsDescription,
    skipLabel: pendingQuestionsSkipLabel,
    submitLabel: pendingQuestionsSubmitLabel,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id, {
    enabled: isSignedIn,
    continuationTabId: generationChatTabId,
    onContinue: handleQuestionFlowContinue,
    getModelSelection: getQuestionFlowModelSelection,
    getGenerationBrief: getQuestionFlowGenerationBrief,
  });
  const pendingQuestionsVisible = Boolean(
    pendingQuestions && pendingQuestions.length > 0,
  );

  useEffect(() => {
    return () => clearGenerationCompleteTimer();
  }, [clearGenerationCompleteTimer]);
  useEffect(() => {
    return () => clearAutoRetryTimer();
  }, [clearAutoRetryTimer]);
  useEffect(() => {
    return () => clearStoredRunLivenessTimer();
  }, [clearStoredRunLivenessTimer]);
  useEffect(() => {
    pendingQuestionsVisibleRef.current = pendingQuestionsVisible;
    if (!pendingQuestionsVisible || !hasPendingGeneration || generating) return;
    clearGenerationCompleteTimer();
    clearStoredRunLivenessTimer();
    setHasPendingGeneration(false);
    setGenerationIssue(null);
  }, [
    clearGenerationCompleteTimer,
    clearStoredRunLivenessTimer,
    generating,
    hasPendingGeneration,
    pendingQuestionsVisible,
  ]);

  const currentUserAvatarUrl = useAvatarUrl(session?.email);
  const currentUser: CollabUser | undefined = useMemo(
    () =>
      session?.email
        ? {
            name: session.name?.trim() || emailToName(session.email),
            email: session.email,
            color: emailToColor(session.email),
            ...(currentUserAvatarUrl
              ? { avatarUrl: currentUserAvatarUrl }
              : {}),
          }
        : undefined,
    [session?.email, session?.name, currentUserAvatarUrl],
  );
  const signInToSaveHref = buildSignInHrefForDesignIntent("save");
  const signInToShareHref = buildSignInHrefForDesignIntent("share");
  const signInToCommentHref = buildSignInHrefForComment();
  const handleSignInToSave = useCallback(() => {
    window.location.href = buildSignInHrefForDesignIntent("save");
  }, []);

  useEffect(() => {
    if (!id || !sessionResolved) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }
    setHasPendingGeneration(true);
    if (pending.runTabId) {
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
      scheduleStoredRunLivenessCheck(pending.runTabId);
    }
  }, [
    id,
    markGenerationStale,
    scheduleStoredRunLivenessCheck,
    sessionResolved,
    trackAgentGeneration,
  ]);

  const pendingGenerationActive =
    (hasPendingGeneration || Boolean(readPendingGeneration(id))) &&
    !pendingQuestionsVisible;

  const {
    data: designResult,
    error: designQueryError,
    isError: designQueryFailed,
    isLoading: designLoading,
    dataUpdatedAt: designDataUpdatedAt,
    refetch: refetchDesign,
  } = useActionQuery<DesignData | string>(
    "get-design",
    { id: id! },
    {
      enabled: !shellMode,
      refetchInterval: isVisualEditSurface
        ? pendingGenerationActive || generating
          ? 1000
          : 30_000
        : pendingGenerationActive || generating
          ? 1000
          : false,
    },
  );
  const {
    data: designAccessStatus,
    isLoading: designAccessStatusLoading,
    isError: designAccessStatusError,
    refetch: refetchDesignAccessStatus,
  } = useActionQuery<DesignAccessStatus>(
    "get-design-access-status",
    { designId: id! },
    {
      enabled: !shellMode && Boolean(id) && !isDesignData(designResult),
    },
  );
  const requestDesignAccessMutation = useActionMutation<
    RequestDesignAccessResult,
    { designId: string }
  >("request-design-access");
  const [designAccessRequestSent, setDesignAccessRequestSent] = useState(false);

  useEffect(() => {
    setDesignAccessRequestSent(false);
  }, [id]);

  const handleRequestDesignAccess = useCallback(async () => {
    if (!id || requestDesignAccessMutation.isPending) return;
    try {
      const result = await requestDesignAccessMutation.mutateAsync({
        designId: id,
      });
      if (result.alreadyHasAccess) {
        await Promise.all([refetchDesign(), refetchDesignAccessStatus()]);
      } else if (result.notifiedOwner) {
        setDesignAccessRequestSent(true);
      }
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("common.genericError"));
    }
  }, [
    id,
    refetchDesign,
    refetchDesignAccessStatus,
    requestDesignAccessMutation,
    t,
  ]);

  const shellDesign = useMemo(
    () => (shellInput ? buildShellDesign(shellInput).design : null),
    [shellInput],
  );

  const design = shellMode
    ? shellDesign
    : isDesignData(designResult)
      ? designResult
      : null;
  const overviewDataReady = shellMode || designResult !== undefined;
  const activeBreakpointStateVersion = useChangeVersion(
    id ? `app-state:design-active-breakpoint:${id}` : "",
  );
  const localhostConsentStateVersion = useChangeVersion(
    id ? `app-state:design-localhost-write-consent-request:${id}` : "",
  );
  const designEditorCommandKeys = useMemo(
    () =>
      browserTabId
        ? [designEditorCommandKey(browserTabId), designEditorCommandKey()]
        : [designEditorCommandKey()],
    [browserTabId],
  );
  const designEditorCommandVersion = useChangeVersions(
    designEditorCommandKeys.map((key) => `app-state:${key}`),
  );
  const pendingNodeRewriteStateKeys = useMemo(
    () =>
      id
        ? (design?.files.map((file) =>
            designRepromptPendingStateKey(id, file.id),
          ) ?? [])
        : [],
    [design?.files, id],
  );
  const pendingNodeRewriteStateVersion = useChangeVersions(
    pendingNodeRewriteStateKeys.map((key) => `app-state:${key}`),
  );
  const designAccessRole = design?.accessRole;
  const canShareDesign =
    designAccessRole === "owner" || designAccessRole === "admin";
  const designQueryErrorStatus =
    designQueryError && typeof designQueryError === "object"
      ? (designQueryError as { status?: unknown }).status
      : undefined;
  const designQueryAuthFailed =
    designQueryErrorStatus === 401 || designQueryErrorStatus === 403;
  const visualEditAccessLost =
    isVisualEditSurface &&
    designQueryFailed &&
    (designResult === undefined || designQueryAuthFailed);
  const canEditDesign = !visualEditAccessLost
    ? canShareDesign || designAccessRole === "editor"
    : false;
  const visualEditSnapshotPublicationStateRef =
    useRef<VisualEditSnapshotPublicationState | null>(null);
  if (!visualEditSnapshotPublicationStateRef.current) {
    visualEditSnapshotPublicationStateRef.current =
      createVisualEditSnapshotPublicationState();
  }
  const visualEditSnapshotPublicationState =
    visualEditSnapshotPublicationStateRef.current;
  const [liveCollaborationOverride, setLiveCollaborationOverride] = useState<{
    enabled: boolean;
    observedDataUpdatedAt: number;
  } | null>(null);
  const [liveCollaborationSaving, setLiveCollaborationSaving] = useState(false);
  const liveCollaborationEnabled =
    liveCollaborationOverride?.enabled ??
    design?.liveCollaborationEnabled === true;
  useEffect(() => setLiveCollaborationOverride(null), [id]);
  useEffect(() => {
    setLiveCollaborationOverride((override) =>
      reconcileLiveCollaborationOverride(
        override,
        design?.liveCollaborationEnabled,
        designDataUpdatedAt,
      ),
    );
  }, [design?.liveCollaborationEnabled, designDataUpdatedAt]);
  const handleLiveCollaborationChange = useCallback(
    async (enabled: boolean) => {
      if (!id || !isSignedIn || !canEditDesign || liveCollaborationSaving)
        return;
      setLiveCollaborationSaving(true);
      try {
        const result = await callAction<{
          designId: string;
          enabled: boolean;
        }>("update-visual-edit-collaboration", { designId: id, enabled });
        setLiveCollaborationOverride({
          enabled: result.enabled,
          observedDataUpdatedAt: designDataUpdatedAt,
        });
        if (result.enabled) {
          setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
        } else {
          runClearVisualEditSnapshotPublications(
            visualEditSnapshotPublicationState,
          );
        }
        try {
          const refreshed = await refetchDesign();
          if (
            refreshed.isSuccess &&
            isDesignData(refreshed.data) &&
            typeof refreshed.data.liveCollaborationEnabled === "boolean"
          ) {
            setLiveCollaborationOverride(null);
          }
        } catch {
          // coercion-ok: the mutation is committed; a later query reconciles this visible value.
          // Keep the successful mutation value visible until a later query confirms it.
        }
      } catch (error) {
        toast.error(
          actionErrorMessage(error) ??
            t("designEditor.liveCollaboration.enableError"),
        );
      } finally {
        setLiveCollaborationSaving(false);
      }
    },
    [
      canEditDesign,
      id,
      isSignedIn,
      liveCollaborationSaving,
      designDataUpdatedAt,
      refetchDesign,
      t,
      visualEditSnapshotPublicationState,
    ],
  );
  const canEditLiveScreens =
    isVisualEditSurface &&
    !visualEditAccessLost &&
    (canEditDesign ||
      design?.visibility === "public" ||
      designAccessRole === "viewer" ||
      designAccessRole === "commenter");
  const publicVisualEdit =
    isVisualEditSurface &&
    !visualEditAccessLost &&
    !canEditDesign &&
    design?.visibility === "public";
  const canApplyPendingVisualEditsWithAgent =
    canEditDesign && (isSignedIn || hostEmbeddedEditor || pageHasWebMcpHost());
  const canEditLiveScreenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const creativeContextLab = useCreativeContextLabState();
  const creativeContextEnabled = creativeContextLab.enabled;
  const tweaksEnabled = useLab(DESIGN_TWEAKS.key);
  const canCommentDesign =
    isSignedIn &&
    (designAccessRole === "owner" ||
      designAccessRole === "admin" ||
      designAccessRole === "editor" ||
      designAccessRole === "commenter");
  const canRenderAuthenticatedShare = isSignedIn || canEditDesign;
  const reviewResult = useReviewComments(
    {
      resourceType: "design",
      resourceId: id ?? "",
      includeResolved: true,
      newestFirst: true,
      limit: 500,
    },
    { enabled: Boolean(id) && !shellMode },
  );
  const reviewComments = reviewResult.data?.comments ?? [];
  const reviewUnreadCount = useMemo(
    () =>
      getUnreadReviewThreadIds(
        reviewComments,
        reviewResult.data?.discussion?.threadPreferences ?? {},
      ).size,
    [reviewComments, reviewResult.data?.discussion?.threadPreferences],
  );
  const reviewAgentQueueThreadIds = useMemo(
    () =>
      new Set(
        reviewComments
          .filter(
            (comment) =>
              comment.status === "open" &&
              comment.parentCommentId === null &&
              comment.resolutionTarget !== "human" &&
              !comment.consumedAt,
          )
          .map((comment) => comment.threadId),
      ),
    [reviewComments],
  );
  const persistedReviewSummary = readDesignReviewSummary(reviewResult.data);
  const reviewAgentQueueCount =
    persistedReviewSummary?.agentQueueCount ?? reviewAgentQueueThreadIds.size;
  const sendReviewThreadToAgent = useSendReviewThreadToAgent();
  const [reviewSendingThreadId, setReviewSendingThreadId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (
      reviewSendingThreadId &&
      reviewAgentQueueThreadIds.has(reviewSendingThreadId)
    ) {
      setReviewSendingThreadId(null);
    }
  }, [reviewAgentQueueThreadIds, reviewSendingThreadId]);
  const canEditDesignRef = useRef(canEditDesign);
  const rawServerFilesByIdRef = useRef(new Map<string, DesignFile>());
  const historyFilesRef = useRef<DesignFile[]>([]);
  const pendingLocalFileContentsRef = useRef<
    Map<string, PendingLocalFileContent>
  >(new Map());
  const [
    pendingLocalFileContentsRevision,
    setPendingLocalFileContentsRevision,
  ] = useState(0);

  const markPendingLocalFileContent = useCallback(
    (
      fileId: string,
      content: string,
      baseUpdatedAt?: string | null,
      identityMigrationSourceContent?: string,
    ) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (
        current?.content === content &&
        current.identityMigrationSourceContent ===
          identityMigrationSourceContent &&
        (baseUpdatedAt === undefined || current.baseUpdatedAt !== undefined)
      )
        return;
      pendingLocalFileContentsRef.current.set(
        fileId,
        createPendingLocalFileContent({
          current,
          file: rawServerFilesByIdRef.current.get(fileId),
          content,
          baseUpdatedAt,
          identityMigrationSourceContent,
        }),
      );
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  const clearPendingLocalFileContent = useCallback(
    (fileId: string, expectedContent?: string) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (!current) return;
      if (
        expectedContent !== undefined &&
        current.content !== expectedContent
      ) {
        return;
      }
      pendingLocalFileContentsRef.current.delete(fileId);
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    },
    [],
  );

  const rollbackPendingLocalFileContent = useCallback(
    (fileId: string, expectedContent: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      if (!pending || pending.content !== expectedContent) return;
      if (id) {
        queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
          old && typeof old === "object"
            ? restorePendingFileContent(old, fileId, pending, expectedContent)
            : old,
        );
      }
      clearPendingLocalFileContent(fileId, expectedContent);
      failPendingTextCapture(fileId);
    },
    [clearPendingLocalFileContent, id, queryClient],
  );

  useLayoutEffect(() => {
    canEditDesignRef.current = canEditDesign;
  }, [canEditDesign]);

  useEffect(() => {
    if (!id || !hasPendingGeneration) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    const timestamp = pending.startedAt ?? pending.createdAt ?? Date.now();
    const remaining = Math.max(
      0,
      PENDING_GENERATION_STALE_MS - (Date.now() - timestamp),
    );
    const timer = window.setTimeout(() => {
      const latest = readPendingGeneration(id);
      if (isPendingGenerationStale(latest)) {
        markGenerationStale();
      }
    }, remaining + 250);

    return () => window.clearTimeout(timer);
  }, [id, hasPendingGeneration, markGenerationStale]);

  const updateFileMutation = useActionMutation("update-file", {
    skipActionQueryInvalidation: true,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action"],
        predicate: (query) => query.queryKey[1] !== "get-design",
      });
    },
  });
  const renameScreenMutation = useActionMutation("rename-screen");
  const updateScreenSourceMutation = useActionMutation("update-screen-source");
  const createFileMutation = useActionMutation("create-file", {
    skipActionQueryInvalidation: true,
  });
  const createFileAsync = createFileMutation.mutateAsync;
  const deleteFileMutation = useActionMutation("delete-file");
  const updateDesignMutation = useActionMutation("update-design");
  const updateDesignAsync = updateDesignMutation.mutateAsync;
  const saveDesignDataAsync = useActionMutation("update-design", {
    skipActionQueryInvalidation: true,
  }).mutateAsync;
  const applyTweaksMutation = useActionMutation("apply-tweaks");
  const applyTweaksAsync = applyTweaksMutation.mutateAsync;
  const duplicateDesignMutation = useActionMutation("duplicate-design");
  const saveDesignAsTemplateMutation = useActionMutation(
    "save-design-as-template",
  );
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const exportHtmlMutation = useActionMutation("export-html");
  const exportZipMutation = useActionMutation("export-zip");
  const applyMotionEditMutation = useActionMutation("apply-motion-edit");
  const applyMotionEdit = applyMotionEditMutation.mutate;
  const removeMotionTimelineMutation = useActionMutation(
    "remove-motion-timeline",
  );
  const removeMotionTimeline = removeMotionTimelineMutation.mutate;
  const motionAutosavePending = applyMotionEditMutation.isPending;
  const addBreakpointMutation = useActionMutation("add-breakpoint");
  const removeBreakpointMutation = useActionMutation("remove-breakpoint");
  const updateBreakpointMutation = useActionMutation("update-breakpoint");
  const setActiveBreakpointMutation = useActionMutation(
    "set-active-breakpoint",
  );
  type ActiveBreakpointWrite = {
    designId: string;
    breakpointId: string;
    editScope: ResponsiveEditScope;
  };
  const setActiveBreakpointMutateAsyncRef = useRef(
    setActiveBreakpointMutation.mutateAsync,
  );
  setActiveBreakpointMutateAsyncRef.current =
    setActiveBreakpointMutation.mutateAsync;
  const activeBreakpointWriteQueueRef =
    useRef<ReturnType<typeof createLatestWriteQueue<ActiveBreakpointWrite>>>(
      null,
    );
  if (!activeBreakpointWriteQueueRef.current) {
    activeBreakpointWriteQueueRef.current = createLatestWriteQueue((input) =>
      setActiveBreakpointMutateAsyncRef.current(input),
    );
  }
  const persistActiveBreakpoint = useCallback(
    (breakpointId: string, editScope: ResponsiveEditScope) => {
      if (!id) return;
      activeBreakpointWriteQueueRef.current?.enqueue({
        designId: id,
        breakpointId,
        editScope,
      });
    },
    [id],
  );
  // §6.4 — "show all breakpoints" toggle: when true (default) the overview
  // renders one linked read-write frame per breakpoint width next to each
  // screen (same document at each viewport width); hiding keeps the chips
  // usable while decluttering the board.
  const [breakpointFramesHidden, setBreakpointFramesHidden] = useState(false);

  const openComponentSourceMutation = useActionMutation(
    "open-component-source",
  );
  const goToMainComponentMutation = useActionMutation("go-to-main-component");
  const detachComponentInstanceMutation = useActionMutation(
    "detach-component-instance",
  );
  const [componentSwapPickerRequest, setComponentSwapPickerRequest] =
    useState(0);

  const migrateBoardObjectsMutation = useActionMutation(
    "migrate-board-objects-to-file",
  );

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  const [makeRealDialogOpen, setMakeRealDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoLayoutSuggestionPreview, setAutoLayoutSuggestionPreview] =
    useState<{
      suggestion: AutoLayoutSuggestion;
      sourceType: "inline" | "localhost";
      contentHash: string;
      screenId: string;
    } | null>(null);
  const [publishWaitlistPopoverOpen, setPublishWaitlistPopoverOpen] =
    useState(false);
  const [publishWaitlistPopoverView, setPublishWaitlistPopoverView] = useState<
    "actions" | "waitlist"
  >("actions");
  const [publishWaitlistJoined, setPublishWaitlistJoined] = useState(false);
  const [joiningPublishWaitlist, setJoiningPublishWaitlist] = useState(false);
  const [publishWaitlistError, setPublishWaitlistError] = useState<
    string | null
  >(null);

  const [migrationResult, setMigrationResult] =
    useState<DesignMigrationResult | null>(null);

  const [shareExportFormat, setShareExportFormat] =
    useState<ShareExportFormat>("html");
  const [codingHandoffResult, setCodingHandoffResult] =
    useState<CodingHandoffResult | null>(null);
  const [codingHandoffError, setCodingHandoffError] = useState<string | null>(
    null,
  );
  const [codingHandoffLoading, setCodingHandoffLoading] = useState(false);
  const [, setPatchProof] = useState<PatchProofState | null>(null);
  const pendingFileSavesRef = useRef<Record<string, FileContentSaveRequest>>(
    {},
  );
  const fileSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  const fileSaveOperationRevisionRef = useRef<Record<string, number>>({});
  const latestFileSaveForUnloadRef = useRef<
    Record<string, FileContentSaveRequest>
  >({});
  const fileSaveOutboxJournalPromisesRef = useRef(
    new WeakMap<FileContentSaveRequest, Promise<boolean>>(),
  );
  const fileSaveTimersRef = useRef<Record<string, number>>({});
  const postAuthSaveRef = useRef<string | null>(null);

  const warnChangesWillRetry = useCallback(() => {
    toast.warning(t("visualEditor.changesSaveWhenReconnected"), {
      id: "design-save-outbox-warning",
    });
  }, [t]);

  const warnChangesDiscarded = useCallback(() => {
    toast.error(t("visualEditor.changesDiscarded"), {
      id: "design-save-outbox-discarded",
    });
  }, [t]);

  const journalOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await journalDesignSaveOutboxEntry(entry);
        return true;
        // coercion-ok: IndexedDB journaling is optional; the network save remains authoritative.
      } catch {
        return false;
      }
    },
    [],
  );

  const acknowledgeOutboxEntry = useCallback(
    async (entry: DesignSaveOutboxEntry) => {
      try {
        await acknowledgeDesignSaveOutboxEntry(entry);
      } catch {
        // The server save already succeeded. A local outbox cleanup failure
        // is neither data loss nor a connectivity warning; operation ids make
        // a later replay idempotent.
        // coercion-ok: the server mutation already succeeded; cleanup is best effort.
      }
    },
    [],
  );

  const retryDesignSaveOutbox = useCallback(async () => {
    if (!id) return;
    try {
      const result = await drainDesignSaveOutbox({
        designId: id,
        actorScope: designSaveActorScope,
      });
      if (result.rebased.length > 0) {
        toast.error(t("designEditor.toasts.saveConflict"), {
          id: "design-save-conflict:outbox",
        });
        for (const { entry } of result.rebased) {
          const content = entry.payload.content;
          if (typeof content === "string") {
            rollbackPendingLocalFileContent(entry.resourceId, content);
          }
        }
      }
      for (const entry of [
        ...result.saved,
        ...result.rebased.map(({ entry }) => entry),
        ...result.dropped.map(({ entry }) => entry),
      ]) {
        if (
          shouldClearLatestUnloadSaveForOutboxEntry(
            latestFileSaveForUnloadRef.current[entry.resourceId],
            entry,
          )
        ) {
          delete latestFileSaveForUnloadRef.current[entry.resourceId];
        }
      }
      if (result.saved.length > 0 || result.rebased.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      }
      if (result.failed.length > 0 && navigator.onLine === false) {
        warnChangesWillRetry();
      }
      if (result.dropped.length > 0) {
        warnChangesDiscarded();
      }
    } catch (error) {
      if (classifyDesignSaveFailure(error, navigator.onLine) === "offline") {
        warnChangesWillRetry();
      }
    }
  }, [
    designSaveActorScope,
    id,
    rollbackPendingLocalFileContent,
    queryClient,
    t,
    warnChangesWillRetry,
    warnChangesDiscarded,
  ]);

  useEffect(() => {
    const handleRetryOpportunity = () => void retryDesignSaveOutbox();
    void retryDesignSaveOutbox();
    window.addEventListener("online", handleRetryOpportunity);
    window.addEventListener("pageshow", handleRetryOpportunity);
    return () => {
      window.removeEventListener("online", handleRetryOpportunity);
      window.removeEventListener("pageshow", handleRetryOpportunity);
    };
  }, [retryDesignSaveOutbox, sessionResolved]);

  const createFileSaveOutboxEntry = useCallback(
    (pending: FileContentSaveRequest) => {
      if (!id || shellMode) return null;
      return createDesignSaveOutboxEntry({
        designId: id ?? "",
        actorScope: designSaveActorScope,
        actionName: "update-file",
        resourceId: pending.id,
        operationSource: pending.operationSource,
        operationRevision: pending.operationRevision,
        payload: {
          id: pending.id,
          content: pending.content,
          syncCollab: pending.syncCollab,
          operationSource: pending.operationSource,
          operationRevision: pending.operationRevision,
          expectedVersionHash:
            pending.unloadExpectedVersionHash ?? pending.expectedVersionHash,
          ...(pending.identityMigrationSourceContent !== undefined
            ? { identityOnly: true }
            : {}),
        },
      });
    },
    [designSaveActorScope, id, shellMode],
  );

  const cancelQueuedFileContentSave = useCallback(
    (fileId: string) => {
      const queued = pendingFileSavesRef.current[fileId];
      const timer = fileSaveTimersRef.current[fileId];
      if (timer) {
        window.clearTimeout(timer);
        delete fileSaveTimersRef.current[fileId];
      }
      const latest = latestFileSaveForUnloadRef.current[fileId];
      delete pendingFileSavesRef.current[fileId];
      delete latestFileSaveForUnloadRef.current[fileId];
      const pending = queued ?? latest;
      const entry = pending ? createFileSaveOutboxEntry(pending) : null;
      if (entry) {
        void discardDesignSaveOutboxEntry(entry).catch(() => {});
      }
    },
    [createFileSaveOutboxEntry, warnChangesWillRetry],
  );

  const saveFileContent = useCallback(
    (
      pending: FileContentSaveRequest,
      outboxJournalPromise?: Promise<boolean>,
    ) =>
      runSaveFileContent(
        {
          acknowledgeOutboxEntry,
          canEditDesignRef,
          createFileSaveOutboxEntry,
          designId: id,
          fileSaveChainsRef,
          fileSaveOutboxJournalPromisesRef,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          rollbackPendingLocalFileContent,
          markPendingLocalFileContent,
          queryClient,
          setPatchProof,
          t,
          updateFileMutation,
          warnChangesWillRetry,
        },
        pending,
        outboxJournalPromise,
      ),
    [
      acknowledgeOutboxEntry,
      createFileSaveOutboxEntry,
      journalOutboxEntry,
      rollbackPendingLocalFileContent,
      markPendingLocalFileContent,
      queryClient,
      t,
      updateFileMutation,
      warnChangesWillRetry,
    ],
  );

  const queueFileContentSave = useCallback(
    (
      fileId: string,
      content: string,
      options: {
        expectedVersionHash: string;
        syncCollab?: boolean;
        immediate?: boolean;
        identityMigrationSourceContent?: string;
      },
    ) => {
      return runQueueFileContentSave(
        {
          canEditDesignRef,
          createFileSaveOutboxEntry,
          fileSaveOperationRevisionRef,
          fileSaveOutboxJournalPromisesRef,
          fileSaveTimersRef,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          markPendingLocalFileContent,
          operationSource: designSaveOperationSourceRef.current,
          pendingFileSavesRef,
          saveFileContent,
          setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
          clearTimer: (timerId) => window.clearTimeout(timerId),
        },
        fileId,
        content,
        options,
      );
    },
    [
      createFileSaveOutboxEntry,
      journalOutboxEntry,
      markPendingLocalFileContent,
      saveFileContent,
    ],
  );

  const cancelIdentityMigration = useCallback(
    (fileId: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      if (pending?.identityMigrationSourceContent === undefined) return;
      const queued = pendingFileSavesRef.current[fileId];
      const latest = latestFileSaveForUnloadRef.current[fileId];
      if (queued?.identityMigrationSourceContent !== undefined) {
        const timer = fileSaveTimersRef.current[fileId];
        if (timer) window.clearTimeout(timer);
        delete fileSaveTimersRef.current[fileId];
        delete pendingFileSavesRef.current[fileId];
      }
      if (latest?.identityMigrationSourceContent !== undefined) {
        delete latestFileSaveForUnloadRef.current[fileId];
        const entry = createFileSaveOutboxEntry(latest);
        if (entry) void discardDesignSaveOutboxEntry(entry).catch(() => {});
      }
      clearPendingLocalFileContent(fileId, pending.content);
    },
    [clearPendingLocalFileContent, createFileSaveOutboxEntry],
  );

  const publishCanonicalContent = useCallback(
    (
      fileId: string,
      sourceContent: string,
      fileType: string = "html",
    ): string =>
      runPublishCanonicalContent(
        {
          canEditDesignRef,
          pendingLocalFileContentsRef,
          cancelIdentityMigration,
          queueFileContentSave,
        },
        fileId,
        sourceContent,
        fileType,
      ),
    [cancelIdentityMigration, queueFileContentSave],
  );

  const flushPendingFileContentSavesForBackground = useCallback(async () => {
    if (!canEditDesignRef.current) return;
    const flushed = flushFileContentSavesOnBackground(
      pendingFileSavesRef.current,
      latestFileSaveForUnloadRef.current,
      Object.values(fileSaveTimersRef.current),
      saveFileContent,
      window.clearTimeout,
    );
    fileSaveTimersRef.current = {};
    pendingFileSavesRef.current = {};
    await flushed;
    await Promise.all(Object.values(fileSaveChainsRef.current));
  }, [saveFileContent]);

  const sendFileContentSaveKeepalive = useCallback(
    (pending: FileContentSaveRequest) => {
      const collabLive = pending.syncCollab === false;
      if (!shouldSendKeepalive(true, collabLive)) return;
      runFileContentSaveKeepalive(
        {
          acknowledgeOutboxEntry,
          createFileSaveOutboxEntry,
          journalOutboxEntry,
          latestFileSaveForUnloadRef,
          outboxJournalPromise:
            fileSaveOutboxJournalPromisesRef.current.get(pending),
          sendKeepalive: (payload) =>
            tryCallActionKeepalive("update-file", payload as any),
        },
        pending,
      );
    },
    [acknowledgeOutboxEntry, createFileSaveOutboxEntry, journalOutboxEntry],
  );

  useEffect(() => {
    const sendPendingKeepaliveSaves = () => {
      if (!canEditDesignRef.current) return;
      for (const pending of Object.values(pendingFileSavesRef.current)) {
        latestFileSaveForUnloadRef.current[pending.id] = pending;
      }
      Object.values(latestFileSaveForUnloadRef.current).forEach(
        sendFileContentSaveKeepalive,
      );
    };
    const handlePageHide = () => {
      sendPendingKeepaliveSaves();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushPendingFileContentSavesOnCleanup(
        pendingFileSavesRef.current,
        Object.values(fileSaveTimersRef.current),
        saveFileContent,
        window.clearTimeout,
      );
      fileSaveTimersRef.current = {};
      pendingFileSavesRef.current = {};
    };
  }, [saveFileContent, sendFileContentSaveKeepalive]);

  const {
    cssVarValues,
    flushPendingTweakSave,
    handleTweakChange,
    setTweakSelections,
    tweakSelections,
    tweaks,
  } = useTweaks({
    acknowledgeOutboxEntry,
    applyTweaksAsync,
    canEditDesign,
    canEditDesignRef,
    design,
    designSaveActorScope,
    designSaveOperationSourceRef,
    id,
    queryClient,
    t,
    warnChangesWillRetry,
  });

  const shouldOpenShare = postAuthIntent === "share" && canShareDesign;
  const systemsEnabled = useDesignSystemWorkflows();
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems(isSignedIn && showPrompt && systemsEnabled);
  const designSystemOptions = useMemo(
    () => designSystemPickerOptions(designSystems),
    [designSystems],
  );
  const {
    preferences: editorPreferences,
    setPreferences: setEditorPreferences,
  } = useEditorPreferences();

  useEffect(() => {
    if (!id || !design || !isSignedIn || !postAuthIntent) return;

    const shouldDuplicate =
      postAuthIntent === "share" ? !canShareDesign : !canEditDesign;
    if (!shouldDuplicate) return;

    const key = `${postAuthIntent}:${id}`;
    if (postAuthSaveRef.current === key) return;
    postAuthSaveRef.current = key;

    duplicateDesignMutation
      .mutateAsync({ id, title: design.title } as any)
      .then((result: any) => {
        if (!result?.id) throw new Error("Missing copied design id");
        const nextSearch = postAuthIntent === "share" ? "?intent=share" : "";
        void navigate(`/design/${result.id}${nextSearch}`, { replace: true });
      })
      .catch(() => {
        postAuthSaveRef.current = null;
        toast.error(t("designEditor.toasts.saveCopyError"));
      });
  }, [
    canEditDesign,
    canShareDesign,
    design,
    duplicateDesignMutation,
    id,
    isSignedIn,
    navigate,
    postAuthIntent,
    t,
  ]);

  const creativeContextsQuery = useCreativeContexts(
    {},
    { enabled: creativeContextEnabled },
  );
  const creativeContextState = useCreativeContextState({
    enabled: creativeContextEnabled,
  });
  const creativeContextOptions = useMemo(
    () =>
      parseCreativeContexts(creativeContextsQuery.data)
        .filter((context) => context.memberCount > 0)
        .map((context) => ({ id: context.id, name: context.name })),
    [creativeContextsQuery.data],
  );
  const creativeContextPersistRef = useRef<Promise<unknown> | null>(null);
  const handleCreativeContextChange = useCallback(
    (contextId: string | null) => {
      creativeContextPersistRef.current = creativeContextState
        .setState({
          ...creativeContextState.state,
          contextMode: "auto",
          selectedContextId: contextId,
          pinnedPackId: null,
        })
        .catch((error) => {
          toast.error(t("creativeContext.stateSaveFailed"));
          throw error;
        });
    },
    [creativeContextState, t],
  );
  const resolvePromptDesignSystemId = useCallback(() => {
    if (design?.designSystemId) return design.designSystemId;
    if (!systemsEnabled) return null;
    if (
      defaultSystem &&
      isDesignSystemUsableForGeneration(defaultSystem.data)
    ) {
      return defaultSystem.id;
    }
    return (
      designSystems.find((system) =>
        isDesignSystemUsableForGeneration(system.data),
      )?.id ?? null
    );
  }, [defaultSystem, design?.designSystemId, designSystems, systemsEnabled]);

  const selectedPromptDesignSystemId = !systemsEnabled
    ? (design?.designSystemId ?? null)
    : promptDesignSystemId === undefined
      ? designSystemsLoading
        ? undefined
        : resolvePromptDesignSystemId()
      : promptDesignSystemId;

  const handlePromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      if (open) preloadPromptComposer();
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(design?.designSystemId ?? undefined);
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [canEditDesign, design?.designSystemId],
  );

  const handleTweakPromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && (!canEditDesign || !tweaksEnabled)) return;
      if (open) preloadPromptComposer();
      setShowTweakPrompt(open);
      if (!open) {
        tweakPromptAnchorRef.current = null;
      }
    },
    [canEditDesign, tweaksEnabled],
  );

  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      if (!canEditDesign || !tweaksEnabled) return;
      preloadPromptComposer();
      tweakPromptAnchorRef.current = anchor;
      setActiveInspectorTab("tweaks");
      setShowTweakPrompt(true);
    },
    [canEditDesign, tweaksEnabled],
  );

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null | undefined) => {
      if (
        designSystemId === undefined ||
        !id ||
        !canEditDesign ||
        design?.designSystemId === designSystemId
      ) {
        return;
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, designSystemId };
      });
      updateDesignMutation.mutate({ id, designSystemId } as any, {
        onError: () => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
      });
    },
    [
      canEditDesign,
      design?.designSystemId,
      id,
      queryClient,
      updateDesignMutation,
    ],
  );

  useEffect(() => {
    if (!design?.title) return;
    const nextTitle = `${normalizeDocumentTitle(design.title, "Untitled design")} — Design`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) {
        document.title = previousTitle;
      }
    };
  }, [design?.title]);

  const commitTitleEdit = useCallback(() => {
    setTitleEditing(false);
    if (!id || !canEditDesign) return;
    const next = titleDraft.trim();
    if (!next || next === design?.title) return;

    const designQueryKey = ["action", "get-design", { id }];
    const previousDesign = queryClient.getQueryData(designQueryKey);
    const previousListDesignsQueries = queryClient.getQueriesData({
      queryKey: ["action", "list-designs"],
    });
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: next };
    });
    queryClient.setQueriesData(
      { queryKey: ["action", "list-designs"] },
      (old: any) => {
        if (!old) return old;
        return {
          ...old,
          designs: (old.designs ?? []).map((d: any) =>
            d.id === id ? { ...d, title: next } : d,
          ),
        };
      },
    );

    updateDesignMutation.mutate({ id, title: next } as any, {
      onError: () => {
        queryClient.setQueryData(designQueryKey, previousDesign);
        for (const [queryKey, data] of previousListDesignsQueries) {
          queryClient.setQueryData(queryKey, data);
        }
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      },
    });
  }, [
    canEditDesign,
    design?.title,
    id,
    queryClient,
    titleDraft,
    updateDesignMutation,
  ]);

  const handleTitleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commitTitleEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setTitleEditing(false);
      }
    },
    [commitTitleEdit],
  );

  const serverFiles = resolveServerFiles(design);
  rawServerFilesByIdRef.current = new Map(
    serverFiles.map((file) => [file.id, file]),
  );
  useEffect(() => {
    if (pendingLocalFileContentsRef.current.size === 0) return;
    let changed = false;
    for (const file of serverFiles) {
      const pending = pendingLocalFileContentsRef.current.get(file.id);
      if (!shouldRetirePendingLocalFileContent(pending, file)) continue;
      pendingLocalFileContentsRef.current.delete(file.id);
      changed = true;
    }
    if (changed) {
      setPendingLocalFileContentsRevision((revision) => revision + 1);
    }
  }, [serverFiles]);
  const pendingLocalFileContentsSnapshot = useMemo(
    () => new Map(pendingLocalFileContentsRef.current),
    [pendingLocalFileContentsRevision],
  );
  const files = useMemo(
    () =>
      serverFiles.map((file) => {
        const sourceContent =
          pendingLocalFileContentsSnapshot.get(file.id)?.content ??
          file.content ??
          "";
        const prepared = prepareCanonicalSourceContent(sourceContent, {
          fileId: file.id,
          fileType: file.fileType,
          source: designFileCodeLayerSource(id, file.id, file.filename),
        });
        return prepared.content === file.content
          ? file
          : { ...file, content: prepared.content };
      }),
    [id, pendingLocalFileContentsSnapshot, serverFiles],
  );
  const getComponentExpectedFiles = useCallback(
    () =>
      files
        .filter((file) => file.fileType === "html")
        .map((file) => ({
          fileId: file.id,
          versionHash: sourceContentHash(file.content),
        })),
    [files],
  );
  historyFilesRef.current = files;

  const codeLayerSourceForScreen = useCallback(
    (
      screenId: string,
      kind: "design-file" | "inline-html" = "design-file",
    ): CodeLayerSource =>
      designFileCodeLayerSource(
        id,
        screenId,
        files.find((file) => file.id === screenId)?.filename,
        kind,
      ),
    [files, id],
  );
  const [pendingNodeRewriteProposals, setPendingNodeRewriteProposals] =
    useState<NodeRewriteProposal[]>([]);
  const proposalFileIdsKey = files.map((file) => file.id).join("\u0000");
  const proposalFileIds = useMemo(
    () => (proposalFileIdsKey ? proposalFileIdsKey.split("\u0000") : []),
    [proposalFileIdsKey],
  );
  useEffect(() => {
    if (!id || proposalFileIds.length === 0) {
      setPendingNodeRewriteProposals([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      proposalFileIds.map(async (fileId) => {
        // coercion-ok: missing pending state means there is no active reprompt.
        const pending = await readClientAppState(
          designRepromptPendingStateKey(id, fileId),
        ).catch(() => null); // coercion-ok: missing pending state means no active reprompt.
        if (!isPendingDesignReprompt(pending)) return null;
        // coercion-ok: missing proposal state means the reprompt has no result.
        const current = await readClientAppState(
          designRepromptProposalStateKey(id, fileId, pending.repromptId),
        ).catch(() => null); // coercion-ok: missing state means the reprompt has no result.
        if (isNodeRewriteProposal(current)) return current;
        if (!pending.priorProposalId || !pending.priorRepromptId) return null;
        // coercion-ok: missing prior state means there is no earlier proposal.
        const prior = await readClientAppState(
          designRepromptProposalStateKey(id, fileId, pending.priorRepromptId),
        ).catch(() => null); // coercion-ok: missing state means no earlier proposal.
        return isNodeRewriteProposal(prior) &&
          prior.proposalId === pending.priorProposalId
          ? prior
          : null;
      }),
    ).then((values) => {
      if (cancelled) return;
      setPendingNodeRewriteProposals(
        values
          .filter(isNodeRewriteProposal)
          .filter(
            (proposal) =>
              proposal.designId === id &&
              proposalFileIds.includes(proposal.fileId),
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pendingNodeRewriteStateVersion, id, proposalFileIds]);
  const pendingNodeRewriteByFile = useMemo(
    () =>
      new Map(
        pendingNodeRewriteProposals.map((proposal) => [
          proposal.fileId,
          proposal,
        ]),
      ),
    [pendingNodeRewriteProposals],
  );
  const pendingNodeRewriteScreenIds = useMemo(
    () => new Set(pendingNodeRewriteByFile.keys()),
    [pendingNodeRewriteByFile],
  );
  const documentColorFiles = useMemo<DocumentColorSourceFile[]>(
    () => files.map((file) => ({ id: file.id, content: file.content })),
    [files],
  );
  const [liveScreenSnapshotsById, setLiveScreenSnapshotsById] = useState<
    Record<string, LiveScreenSnapshot>
  >({});
  const scheduleVisualEditSnapshotRef = useRef(
    (_screenId: string, _html: string, _reservationToken?: string) => {},
  );
  const [runtimeLayerSnapshotsById, setRuntimeLayerSnapshotsById] = useState<
    Record<string, RuntimeLayerSnapshot>
  >({});
  const [screenRootComputedStylesById, setScreenRootComputedStylesById] =
    useState<Record<string, Record<string, string>>>({});
  const screenRootComputedStylesByIdRef = useRef(screenRootComputedStylesById);
  screenRootComputedStylesByIdRef.current = screenRootComputedStylesById;
  const screenRootStyleCallbacksRef = useRef<
    Map<string, (styles: Record<string, string>) => void>
  >(new Map());
  const runtimeLayerSnapshotsByIdRef = useRef<
    Record<string, RuntimeLayerSnapshot>
  >({});
  useEffect(() => {
    runtimeLayerSnapshotsByIdRef.current = runtimeLayerSnapshotsById;
  }, [runtimeLayerSnapshotsById]);
  useEffect(() => {
    const liveFileIds = new Set(serverFiles.map((file) => file.id));
    setLiveScreenSnapshotsById((current) => {
      let changed = false;
      const next: Record<string, LiveScreenSnapshot> = {};
      Object.entries(current).forEach(([fileId, snapshot]) => {
        if (!liveFileIds.has(fileId)) {
          changed = true;
          return;
        }
        next[fileId] = snapshot;
      });
      return changed ? next : current;
    });
    setRuntimeLayerSnapshotsById((current) => {
      let changed = false;
      const next: Record<string, RuntimeLayerSnapshot> = {};
      Object.entries(current).forEach(([fileId, snapshot]) => {
        if (!liveFileIds.has(fileId)) {
          changed = true;
          return;
        }
        next[fileId] = snapshot;
      });
      return changed ? next : current;
    });
    setScreenRootComputedStylesById((current) => {
      let changed = false;
      const next: Record<string, Record<string, string>> = {};
      Object.entries(current).forEach(([fileId, styles]) => {
        const breakpointMarker = fileId.lastIndexOf("::bp-");
        const screenId =
          breakpointMarker < 0 ? fileId : fileId.slice(0, breakpointMarker);
        if (!liveFileIds.has(screenId)) {
          changed = true;
          return;
        }
        next[fileId] = styles;
      });
      return changed ? next : current;
    });
    for (const key of screenRootStyleCallbacksRef.current.keys()) {
      const breakpointMarker = key.lastIndexOf("::bp-");
      const screenId =
        breakpointMarker < 0 ? key : key.slice(0, breakpointMarker);
      if (!liveFileIds.has(screenId)) {
        screenRootStyleCallbacksRef.current.delete(key);
      }
    }
  }, [serverFiles]);
  const designDataJson = useMemo(
    () => parseDesignDataJson(design?.data),
    [design?.data],
  );
  const designSourceType = useMemo(
    () =>
      normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
      normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
      "inline",
    [designDataJson.sourceMode, designDataJson.sourceType],
  );
  const designSourceTypeRef = useRef(designSourceType);
  designSourceTypeRef.current = designSourceType;

  const layoutGrids = useMemo(
    () => getLayoutGrids(designDataJson),
    [designDataJson],
  );
  const activeScreenLayoutGridStep =
    activeFileId && layoutGrids[activeFileId]
      ? layoutGrids[activeFileId].size
      : 1;
  const handleToggleLayoutGrids = useCallback(() => {
    const frameIds = Object.keys(layoutGrids);
    if (frameIds.length === 0) return;
    const anyVisible = frameIds.some(
      (frameId) => layoutGrids[frameId]!.visible,
    );
    for (const frameId of frameIds) {
      handleLayoutGridChangeRef.current?.(frameId, {
        ...layoutGrids[frameId]!,
        visible: !anyVisible,
      });
    }
  }, [layoutGrids]);
  const handleLayoutGridChange = useCallback(
    (frameId: string, next: Partial<LayoutGrid> | null) =>
      runSetLayoutGrid(
        {
          id,
          canEditDesign: canEditDesignRef.current,
          designDataJsonRef,
          queryClient,
          updateDesignMutation,
        },
        frameId,
        next,
      ),
    [id, queryClient, updateDesignMutation],
  );
  const handleLayoutGridChangeRef = useRef(handleLayoutGridChange);
  handleLayoutGridChangeRef.current = handleLayoutGridChange;

  const designDataJsonRef = useRef(designDataJson);
  const screenContentNaturalHeightByIdRef = useRef<Record<string, number>>({});
  const [screenContentNaturalHeights, setScreenContentNaturalHeights] =
    useState<Record<string, number>>({});
  const commitOverviewScreenStylesRef = useRef<
    (screenIds: string[], patch: Record<string, string>) => void
  >(() => {});
  useEffect(() => {
    designDataJsonRef.current = rebaseDesignDataWithPendingOperations(
      designDataJson,
      pendingFrameGeometryOperationsForUnloadRef.current,
    );
  }, [designDataJson]);
  const canvasFrameGeometryById = useMemo(
    () => getCanvasFrameGeometry(designDataJson),
    [designDataJson],
  );
  const displayedCanvasFrameGeometryById = useMemo(() => {
    if (Object.keys(optimisticFrameGeometryById).length === 0) {
      return canvasFrameGeometryById;
    }
    const next = { ...canvasFrameGeometryById };
    for (const [screenId, geometry] of Object.entries(
      optimisticFrameGeometryById,
    )) {
      const persisted = canvasFrameGeometryById[screenId];
      const persistedGeometryIsComplete =
        persisted &&
        typeof persisted.x === "number" &&
        typeof persisted.y === "number" &&
        typeof persisted.width === "number" &&
        typeof persisted.height === "number";
      if (!persistedGeometryIsComplete) next[screenId] = geometry;
    }
    return next;
  }, [canvasFrameGeometryById, optimisticFrameGeometryById]);
  useEffect(() => {
    setOptimisticFrameGeometryById((current) => {
      let changed = false;
      const next: Record<string, FrameGeometry> = {};
      for (const [screenId, geometry] of Object.entries(current)) {
        const persisted = canvasFrameGeometryById[screenId];
        const persistedGeometryIsComplete =
          persisted &&
          typeof persisted.x === "number" &&
          typeof persisted.y === "number" &&
          typeof persisted.width === "number" &&
          typeof persisted.height === "number";
        if (persistedGeometryIsComplete) {
          changed = true;
        } else {
          next[screenId] = geometry;
        }
      }
      return changed ? next : current;
    });
  }, [canvasFrameGeometryById]);
  const liveFrameGeometryRef = useRef(canvasFrameGeometryById);
  useEffect(() => {
    liveFrameGeometryRef.current = canvasFrameGeometryById;
  }, [canvasFrameGeometryById]);

  const boardFileId = useMemo(() => {
    const raw = (designDataJson as Record<string, unknown>).boardFileId;
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }, [designDataJson]);
  const boardFileIdRef = useRef(boardFileId);
  boardFileIdRef.current = boardFileId;

  const migrateBoardTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !canEditDesign || shellMode) return;
    if (boardFileId) return;
    if (migrateBoardTriggeredRef.current === id) return;
    migrateBoardTriggeredRef.current = id;
    migrateBoardObjectsMutation.mutate({ designId: id } as any, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design", { id }],
        });
      },
    });
  }, [
    boardFileId,
    canEditDesign,
    id,
    migrateBoardObjectsMutation,
    queryClient,
  ]);

  const openGenerateInAgent = useCallback(() => {
    setRetryablePrompt(null);
    window.dispatchEvent(new Event("agent-panel:open"));
  }, []);

  const arrivedFromNewDesign = initialSearchParams.get("new") === "1";
  const newDesignAskedRef = useRef(false);
  useEffect(() => {
    if (
      !shouldAskOnNewDesignArrival({
        arrivedFromNewDesign,
        alreadyAsked: newDesignAskedRef.current,
        canEditDesign,
        embedded,
        shellMode,
      })
    )
      return;
    newDesignAskedRef.current = true;
    openGenerateInAgent();
    const next = new URLSearchParams(location.search);
    next.delete("new");
    const query = next.toString();
    void navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
      replace: true,
    });
  }, [
    arrivedFromNewDesign,
    canEditDesign,
    embedded,
    location.pathname,
    location.search,
    navigate,
    openGenerateInAgent,
    shellMode,
  ]);

  const overviewScreensRef = useRef<
    (OverviewScreen & { codeLayerSource: CodeLayerSource })[]
  >([]);
  const overviewScreens = useMemo(() => {
    const next = reuseUnchangedOverviewScreens(
      overviewScreensRef.current,
      deriveOverviewScreens({
        designDataJson,
        files,
        activeBreakpointWidthState,
        breakpointFramesHidden,
        locallyPinnedHeightIds: locallyPinnedHeightIdsRef.current,
      }).map((screen) => ({
        ...screen,
        codeLayerSource: codeLayerSourceForScreen(screen.id),
      })),
    );
    overviewScreensRef.current = next;
    return next;
  }, [
    designDataJson,
    files,
    codeLayerSourceForScreen,
    activeBreakpointWidthState,
    boardFileId,
    breakpointFramesHidden,
  ]);
  const publicVisualEditConnectionIds = useMemo(() => {
    if (!isVisualEditSurface || isLiveCanvasShareLink) return [];
    return [
      ...new Set(
        overviewScreens.flatMap((screen) =>
          screen.connectionId ? [screen.connectionId] : [],
        ),
      ),
    ];
  }, [isLiveCanvasShareLink, isVisualEditSurface, overviewScreens]);
  const publicVisualEditConnectionId = publicVisualEditConnectionIds[0] ?? null;
  const publicVisualEditPreviewTokenQuery = useActionQuery<{
    previewToken?: string;
    liveEditCapability?: string;
    liveEditRegistrationCapability?: string;
    connections?: Record<
      string,
      {
        previewToken?: string;
        liveEditCapability?: string;
        liveEditRegistrationCapability?: string;
        bridgeUrl?: string;
      }
    >;
  }>(
    "refresh-localhost-preview-token",
    {
      designId: id!,
      publicVisualEdit,
    },
    {
      enabled:
        !shellMode && Boolean(id) && publicVisualEditConnectionIds.length > 0,
    },
  );
  const hasLocalhostScreens = overviewScreens.some(
    (screen) =>
      resolveOverviewScreenSourceType(screen, designSourceType) === "localhost",
  );
  const editorShareUrl = useMemo(() => {
    if (!id || typeof window === "undefined") return undefined;
    return withShareLinkAttribution(
      getDesignEditorShareUrl(
        id,
        window.location.origin,
        appBasePath(),
        hasLocalhostScreens ? "visual-edit" : "design",
      ),
      "design_share",
      session?.userId,
    );
  }, [hasLocalhostScreens, id, session?.userId]);
  const reserveVisualEditSnapshot = useCallback(
    (fileId?: string) => {
      if (!id || !fileId) {
        return Promise.reject(new Error("Missing visual edit snapshot target"));
      }
      return runReserveVisualEditSnapshotInOrder(
        visualEditSnapshotPublicationState,
        id,
        fileId,
        () =>
          callAction<{ reservationToken: string }>(
            "reserve-visual-edit-snapshot",
            { designId: id, fileId },
          ),
      );
    },
    [id, visualEditSnapshotPublicationState],
  );
  const scheduleVisualEditSnapshotPublication = useCallback(
    (screenId: string, html: string, reservationToken?: string) => {
      runScheduleVisualEditSnapshotPublication({
        canPublish: canEditDesign && liveCollaborationEnabled,
        designId: id,
        fileId: screenId,
        html,
        reservationToken,
        publish: (payload) =>
          callAction<{ published: boolean }>(
            "publish-visual-edit-snapshot",
            payload,
          ),
        setFailed: setPendingVisualEditPublicationFailed,
        showError: (fileId, error) => {
          console.error(
            "[design:visual-edit] fallback snapshot publication failed",
            error,
          );
          toast.error(t("designEditor.toasts.codingHandoffError"), {
            id: `design-visual-edit-snapshot:${fileId}`,
          });
        },
        state: visualEditSnapshotPublicationState,
      });
    },
    [
      canEditDesign,
      id,
      liveCollaborationEnabled,
      t,
      visualEditSnapshotPublicationState,
    ],
  );
  scheduleVisualEditSnapshotRef.current = scheduleVisualEditSnapshotPublication;
  useEffect(
    () => () =>
      runClearVisualEditSnapshotPublications(
        visualEditSnapshotPublicationState,
      ),
    [id],
  );
  const visualEditPendingQuery = useActionQuery<{
    designId: string;
    pendingEditCount: number;
    status: "ready" | "empty";
    prompt: string;
    revision: number | null;
    updatedAt: string | null;
  }>(
    "get-visual-edit-pending",
    { designId: id! },
    {
      enabled: canEditDesign && Boolean(id) && !shellMode,
      refetchInterval:
        canEditDesign && Boolean(id) && !shellMode ? 2_000 : false,
    },
  );
  const remoteVisualEditPending =
    canEditDesign &&
    visualEditPendingQuery.data?.status === "ready" &&
    visualEditPendingQuery.data.pendingEditCount > 0 &&
    Boolean(visualEditPendingQuery.data.prompt);
  const exportCanvasFrameGeometryById = useMemo(
    () =>
      getOverviewScreenExportGeometryById({
        overviewScreens,
        canvasFrameGeometryById,
        naturalHeightsById: screenContentNaturalHeights,
        screenRootComputedStylesById,
      }),
    [
      canvasFrameGeometryById,
      overviewScreens,
      screenContentNaturalHeights,
      screenRootComputedStylesById,
    ],
  );

  const boardFileContent = useMemo(() => {
    if (!boardFileId) return undefined;
    const boardFile = files.find((file) => file.id === boardFileId);
    return typeof boardFile?.content === "string" ? boardFile.content : "";
  }, [boardFileId, files]);

  const boardContentBounds = useMemo(
    () => getBoardSurfaceContentBounds(boardFileContent),
    [boardFileContent],
  );

  useEffect(() => {
    if (!boardFileId || !boardFileContent || !canEditDesign) return;
    const normalized = normalizePoisonedBoardNestedCoords(boardFileContent);
    if (!normalized.changed) return;
    warnIfPoisonedBoardCoordsNormalized(boardFileId, normalized);
    queueFileContentSave(boardFileId, normalized.html, {
      expectedVersionHash: sourceContentHash(boardFileContent),
    });
  }, [boardFileContent, boardFileId, canEditDesign, queueFileContentSave]);

  const boardFrameGeometry = useMemo((): FrameGeometry | undefined => {
    if (!boardFileId) return undefined;
    const origin = -BOARD_SURFACE_SIZE / 2;
    return {
      x: origin,
      y: origin,
      width: BOARD_SURFACE_SIZE,
      height: BOARD_SURFACE_SIZE,
    };
  }, [boardFileId]);

  const createFrameGeometryOutboxEntry = useCallback(
    (dataOperations: readonly DesignDataOperation[], revision: number) => {
      if (!id || shellMode) return null;
      const compacted = compactDesignDataOperations(dataOperations);
      if (compacted.length === 0) return null;
      return createDesignSaveOutboxEntry({
        designId: id,
        actorScope: designSaveActorScope,
        actionName: "update-design",
        resourceId: id,
        operationSource: designSaveOperationSourceRef.current,
        operationRevision: revision,
        payload: {
          id,
          dataOperations: compacted,
          operationSource: designSaveOperationSourceRef.current,
          operationRevision: revision,
        },
      });
    },
    [designSaveActorScope, id, shellMode],
  );

  const enqueueFrameGeometryDataSave = useCallback(
    (dataOperations: DesignDataOperation[]) => {
      if (!id || !canEditDesignRef.current || dataOperations.length === 0) {
        return false;
      }
      const revision = frameGeometryOperationRevisionRef.current + 1;
      frameGeometryOperationRevisionRef.current = revision;
      pendingFrameGeometryOperationsForUnloadRef.current =
        stagePendingDesignDataOperations(
          pendingFrameGeometryOperationsForUnloadRef.current,
          dataOperations,
          revision,
        );
      const outboxEntry = createFrameGeometryOutboxEntry(
        pendingDesignDataOperations(
          pendingFrameGeometryOperationsForUnloadRef.current,
        ),
        revision,
      );
      if (!outboxEntry) return false;
      const previous = frameGeometryMutationChainRef.current;
      const current = previous
        .catch(() => {})
        .then(async () => {
          try {
            await journalOutboxEntry(outboxEntry);
            await saveDesignDataAsync(outboxEntry.payload as any);
            pendingFrameGeometryOperationsForUnloadRef.current =
              clearAcknowledgedDesignDataOperationsThroughRevision(
                pendingFrameGeometryOperationsForUnloadRef.current,
                revision,
              );
            await acknowledgeOutboxEntry(outboxEntry);
          } catch {
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            warnChangesWillRetry();
          }
        });
      frameGeometryMutationChainRef.current = current;
      void current.finally(() => {
        if (frameGeometryMutationChainRef.current === current) {
          frameGeometryMutationChainRef.current = Promise.resolve();
        }
      });
      return true;
    },
    [
      acknowledgeOutboxEntry,
      createFrameGeometryOutboxEntry,
      id,
      journalOutboxEntry,
      queryClient,
      saveDesignDataAsync,
      warnChangesWillRetry,
    ],
  );

  const handleOverviewBreakpointContentHeightChange = useCallback(
    (screenId: string, widthPx: number, heightPx: number) => {
      if (
        !id ||
        !canEditDesignRef.current ||
        !Number.isSafeInteger(widthPx) ||
        widthPx <= 0 ||
        !Number.isFinite(heightPx) ||
        heightPx <= 0 ||
        heightPx > MAX_SANE_FRAME_DIMENSION_PX
      ) {
        return;
      }
      const screen = overviewScreens.find((item) => item.id === screenId);
      if (!screen) return;
      const metadataById = getDesignDataRecord(
        designDataJsonRef.current,
        "screenMetadata",
      );
      const metadata = getDesignDataRecord(metadataById, screenId);
      const existingHeight = getResponsiveBreakpointHeightPx(metadata, widthPx);
      const measuredHeight = Math.max(
        deviceViewportFloorForWidth(widthPx),
        Math.round(heightPx),
      );
      const projectedHeight =
        (widthPx * (screen.height ?? 2560)) / (screen.width ?? 1280);
      if (
        measuredHeight <=
        Math.max(projectedHeight, existingHeight ?? 0) + 1
      ) {
        return;
      }
      const operation: DesignDataOperation = {
        op: "set",
        path: [
          "screenMetadata",
          screenId,
          "breakpointHeights",
          String(widthPx),
        ],
        value: measuredHeight,
      };
      const nextData = applyDesignDataOperations(designDataJsonRef.current, [
        operation,
      ]);
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
        old && typeof old === "object"
          ? { ...old, data: JSON.stringify(nextData) }
          : old,
      );
      enqueueFrameGeometryDataSave([operation]);
    },
    [enqueueFrameGeometryDataSave, id, overviewScreens, queryClient],
  );

  const handleOverviewScreenContentNaturalHeightChange = useCallback(
    (screenId: string, heightPx: number | null) => {
      if (heightPx === null) {
        delete screenContentNaturalHeightByIdRef.current[screenId];
        setScreenContentNaturalHeights((previous) => {
          if (!(screenId in previous)) return previous;
          const next = { ...previous };
          delete next[screenId];
          return next;
        });
        return;
      }
      if (
        !Number.isFinite(heightPx) ||
        heightPx <= 0 ||
        heightPx > MAX_SANE_FRAME_DIMENSION_PX
      ) {
        return;
      }
      const naturalHeight = Math.round(heightPx);
      screenContentNaturalHeightByIdRef.current[screenId] = naturalHeight;
      setScreenContentNaturalHeights((previous) =>
        previous[screenId] === naturalHeight
          ? previous
          : { ...previous, [screenId]: naturalHeight },
      );
    },
    [],
  );

  const persistFrameGeometrySave = useCallback(
    (
      pending: {
        geometryById: CanvasFrameGeometryById;
        previousGeometry: CanvasFrameGeometryById;
      },
      keepalive = false,
    ): boolean =>
      runPersistFrameGeometrySave(
        {
          acknowledgeOutboxEntry,
          boardFileId,
          canEditDesignRef,
          createFrameGeometryOutboxEntry,
          designDataJsonRef,
          enqueueFrameGeometryDataSave,
          frameGeometryOperationRevisionRef,
          id,
          journalOutboxEntry,
          pendingFrameGeometryOperationsForUnloadRef,
          queryClient,
          warnChangesWillRetry,
        },
        pending,
        keepalive,
      ),
    [
      acknowledgeOutboxEntry,
      boardFileId,
      createFrameGeometryOutboxEntry,
      enqueueFrameGeometryDataSave,
      id,
      journalOutboxEntry,
      queryClient,
      warnChangesWillRetry,
    ],
  );

  const flushPendingFrameGeometrySave = useCallback(
    (keepalive = false) => {
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
        frameGeometrySaveTimerRef.current = null;
      }
      const pending = pendingFrameGeometrySaveRef.current;
      if (!pending) return;
      if (persistFrameGeometrySave(pending, keepalive)) {
        pendingFrameGeometrySaveRef.current = null;
      }
    },
    [persistFrameGeometrySave],
  );

  const queueFrameGeometrySave = useCallback(
    (geometryById: CanvasFrameGeometryById) => {
      if (!id || !canEditDesignRef.current) return;
      const previousGeometry = cloneCanvasFrameGeometry(
        getCanvasFrameGeometry(designDataJsonRef.current),
      );
      pendingFrameGeometrySaveRef.current = {
        geometryById: quantizeCanvasFrameGeometryForPersist(
          cloneCanvasFrameGeometry(geometryById),
          previousGeometry,
        ),
        previousGeometry,
      };
      const pending = pendingFrameGeometrySaveRef.current;
      const { geometryById: safeGeometryById } =
        sanitizeCanvasFrameGeometryForPersist(
          pending.geometryById,
          pending.previousGeometry,
          boardFileId ? [boardFileId] : [],
        );
      const dataOperations = buildFrameGeometryDataOperations({
        previousGeometry: pending.previousGeometry,
        nextGeometry: safeGeometryById,
        designData: designDataJsonRef.current,
      });
      const combinedOperations = compactDesignDataOperations([
        ...pendingDesignDataOperations(
          pendingFrameGeometryOperationsForUnloadRef.current,
        ),
        ...dataOperations,
      ]);
      if (combinedOperations.length > 0) {
        const revision = frameGeometryOperationRevisionRef.current + 1;
        frameGeometryOperationRevisionRef.current = revision;
        const entry = createFrameGeometryOutboxEntry(
          combinedOperations,
          revision,
        );
        if (entry) void journalOutboxEntry(entry);
      }
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
      }
      frameGeometrySaveTimerRef.current = window.setTimeout(
        flushPendingFrameGeometrySave,
        500,
      );
    },
    [
      boardFileId,
      createFrameGeometryOutboxEntry,
      flushPendingFrameGeometrySave,
      id,
      journalOutboxEntry,
    ],
  );

  const writeFrameGeometrySnapshot = useCallback(
    (
      geometryById: CanvasFrameGeometryById,
      options?: {
        replacePendingGeometrySave?: boolean;
        syncViewportFrameIds?: string[];
        pinHeightFrameIds?: string[];
      },
    ) =>
      runWriteFrameGeometrySnapshot(
        {
          boardFileId,
          canEditDesignRef,
          designDataJsonRef,
          enqueueFrameGeometryDataSave,
          frameGeometrySaveTimerRef,
          id,
          liveFrameGeometryRef,
          pendingFrameGeometrySaveRef,
          queryClient,
        },
        geometryById,
        options,
      ),
    [
      boardFileId,
      enqueueFrameGeometryDataSave,
      id,
      liveFrameGeometryRef,
      queryClient,
    ],
  );

  const handleGeometryCommit = useCallback(
    (
      before: CanvasFrameGeometryById,
      after: CanvasFrameGeometryById,
      options?: {
        source?: "pointer" | "keyboard";
        kScaleStyleChangesByFrameId?: KScaleStyleChangesByFrameId;
      },
    ) => {
      const heightChangedScreenIds = new Set(
        frameHeightChangedIds(before, after),
      );
      const committed = runGeometryCommit(
        {
          boardFileId,
          captureLinkedContentChanges: (
            linkedFrameIds,
            kScaleStyleChangesByFrameId,
          ) => {
            const changes: ContentHistoryChange[] = [];
            for (const screenId of linkedFrameIds) {
              const scaleChanges =
                kScaleStyleChangesByFrameId?.[screenId] ?? [];
              const heightChanged = heightChangedScreenIds.has(screenId);
              const screen = overviewScreens.find(
                (candidate) => candidate.id === screenId,
              );
              if (!screen) {
                if (scaleChanges.length > 0) return null;
                continue;
              }
              const beforeContent = screen.content;
              if (
                scaleChanges.length > 0 &&
                externalPreviewUrlForContent(beforeContent) !== null
              ) {
                return null;
              }
              let afterContent = beforeContent;
              if (scaleChanges.length > 0) {
                const patch = applyKScaleStyleChanges(
                  afterContent,
                  scaleChanges,
                  codeLayerSourceForScreen(screenId),
                );
                if (patch.status !== "applied") return null;
                afterContent = patch.content;
              }
              const metadata = getDesignDataRecord(
                getDesignDataRecord(
                  designDataJsonRef.current,
                  "screenMetadata",
                ),
                screenId,
              );
              if (
                resolveScreenHeightMode(
                  metadata.heightMode,
                  metadata.heightPinned === true,
                  metadata.sourceType,
                ) !== "hug"
              ) {
                if (beforeContent !== afterContent) {
                  changes.push({
                    fileId: screenId,
                    before: beforeContent,
                    after: afterContent,
                  });
                }
                continue;
              }
              if (!heightChanged) {
                if (beforeContent !== afterContent) {
                  changes.push({
                    fileId: screenId,
                    before: beforeContent,
                    after: afterContent,
                  });
                }
                continue;
              }
              if (externalPreviewUrlForContent(afterContent) !== null)
                return null;
              const rootStyles = screenRootComputedStylesById[screenId] ?? {};
              afterContent = setScreenRootFrameRenderingStyles(
                setScreenRootDefaultHeightMode(afterContent, "fixed"),
                screenRootFrameRenderingOptions(rootStyles, true),
              );
              if (beforeContent === afterContent) continue;
              const modePath: DesignDataOperation["path"] = [
                "screenMetadata",
                screenId,
                "heightMode",
              ];
              const pinnedPath: DesignDataOperation["path"] = [
                "screenMetadata",
                screenId,
                "heightPinned",
              ];
              const undo = [
                metadata.heightMode === undefined
                  ? { op: "delete" as const, path: modePath }
                  : {
                      op: "set" as const,
                      path: modePath,
                      value: metadata.heightMode,
                    },
                metadata.heightPinned === undefined
                  ? { op: "delete" as const, path: pinnedPath }
                  : {
                      op: "set" as const,
                      path: pinnedPath,
                      value: metadata.heightPinned,
                    },
              ];
              const redo: DesignDataOperation[] = [
                {
                  op: "set",
                  path: modePath,
                  value: "fixed",
                },
                {
                  op: "set",
                  path: pinnedPath,
                  value: true,
                },
              ];
              changes.push({
                fileId: screenId,
                before: beforeContent,
                after: afterContent,
                designDataChange: { undo, redo },
              });
            }
            return changes;
          },
          captureCurrentSelection,
          clearRedoStacks,
          designDataJsonRef,
          geometryUndoStackRef,
          historyOrderRef: historyOrderRef as React.RefObject<
            UndoRedoOrderKind[]
          >,
          id,
          applyLinkedContentChanges: (changes, direction) =>
            applyGeometryHistoryContentChangesRef.current(changes, direction),
          lastGeometryCommitAtRef,
          lastGeometryCommitSourceRef,
          liveFrameGeometryRef,
          locallyPinnedHeightIdsRef,
          queryClient,
          queueFrameGeometrySave,
          syncUndoRedoState,
          writeFrameGeometrySnapshot,
        },
        before,
        after,
        options,
      );
      if (!committed) {
        toast.error(t("designEditor.patchProof.selectorMissing"));
      }
      return committed;
    },
    [
      boardFileId,
      clearRedoStacks,
      codeLayerSourceForScreen,
      id,
      overviewScreens,
      queryClient,
      queueFrameGeometrySave,
      screenRootComputedStylesById,
      syncUndoRedoState,
      t,
      liveFrameGeometryRef,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleOpenMakeReal = useCallback(() => {
    setMigrationResult(null);
    setMakeRealDialogOpen(true);
  }, []);

  const handleConfirmMakeReal = useCallback(
    async () =>
      runConfirmMakeReal({
        designDataJsonRef,
        id,
        migrateMutation,
        queryClient,
        setMigrationResult,
        updateDesignMutation,
      }),
    [id, migrateMutation, updateDesignMutation, queryClient],
  );

  generationOutputReadyRef.current = hasPendingGenerationOutput(
    readPendingGeneration(id, { allowUntimestamped: true }),
    files,
  );

  useEffect(() => {
    if (!id) return;
    const pending = readPendingGeneration(id);
    if (!pending || pending.templateId) return;
    if (!hasPendingGenerationOutput(pending, files)) return;
    clearGenerationCompleteTimer();
    resetAgentGenerating();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [clearGenerationCompleteTimer, files, id, resetAgentGenerating]);

  useEffect(
    () =>
      runResumePendingGeneration({
        agentSubmit,
        clearGenerationCompleteTimer,
        creativeContextEnabled,
        creativeContextLabLoading: creativeContextLab.isLoading,
        creativeContextLabError: creativeContextLab.isError
          ? t("designEditor.generationStoppedRetry")
          : null,
        design,
        files,
        generationModelRef,
        id,
        markGenerationStale,
        setGenerationChatTabId,
        setGenerationIssue,
        setHasPendingGeneration,
        trackAgentGeneration,
      }),
    [
      id,
      design,
      files.length,
      creativeContextEnabled,
      creativeContextLab.isLoading,
      creativeContextLab.isError,
      agentSubmit,
      markGenerationStale,
      trackAgentGeneration,
      clearGenerationCompleteTimer,
      t,
    ],
  );

  useEffect(() => {
    const handlePageHide = () => {
      const pending = pendingFrameGeometrySaveRef.current;
      if (!pending) {
        if (!canEditDesignRef.current) return;
        const entry = createFrameGeometryOutboxEntry(
          pendingDesignDataOperations(
            pendingFrameGeometryOperationsForUnloadRef.current,
          ),
          frameGeometryOperationRevisionRef.current,
        );
        if (!entry) return;
        void journalOutboxEntry(entry);
        const attempt = tryCallActionKeepalive(
          "update-design",
          entry.payload as any,
        );
        if (!attempt.accepted) return;
        void attempt.completion
          .then(() => acknowledgeOutboxEntry(entry))
          .catch(warnChangesWillRetry);
        return;
      }
      persistFrameGeometrySave(pending, true);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushPendingFrameGeometrySave();
    };
  }, [
    acknowledgeOutboxEntry,
    createFrameGeometryOutboxEntry,
    flushPendingFrameGeometrySave,
    journalOutboxEntry,
    persistFrameGeometrySave,
    warnChangesWillRetry,
  ]);

  useEffect(() => {
    const handleBackground = () => {
      void flushPendingFileContentSavesForBackground().catch(
        warnChangesWillRetry,
      );
      flushPendingTweakSave();
      flushPendingFrameGeometrySave();
    };
    const handleForeground = () => {
      void retryDesignSaveOutbox();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleBackground();
      } else {
        handleForeground();
      }
    };
    const handleLifecycleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === "agent-native:app-background") {
        handleBackground();
      } else if (event.data?.type === "agent-native:app-foreground") {
        handleForeground();
      }
    };
    const handleChatHistoryFlush = (event: Event) => {
      const pendingFlushes = (event as CustomEvent<Promise<void>[]>).detail;
      pendingFlushes.push(flushPendingFileContentSavesForBackground());
    };

    window.addEventListener("agent-native:app-background", handleBackground);
    window.addEventListener("agent-native:app-foreground", handleForeground);
    window.addEventListener(
      "agent-native:design-flush-pending-saves",
      handleChatHistoryFlush,
    );
    window.addEventListener("message", handleLifecycleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(
        "agent-native:app-background",
        handleBackground,
      );
      window.removeEventListener(
        "agent-native:app-foreground",
        handleForeground,
      );
      window.removeEventListener(
        "agent-native:design-flush-pending-saves",
        handleChatHistoryFlush,
      );
      window.removeEventListener("message", handleLifecycleMessage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    flushPendingFileContentSavesForBackground,
    flushPendingFrameGeometrySave,
    flushPendingTweakSave,
    retryDesignSaveOutbox,
  ]);

  const defaultActiveFile =
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename) &&
        file.filename.toLowerCase() === "index.html",
    ) ??
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename),
    ) ??
    files[0];

  useEffect(() => {
    const nextActiveFileId = resolveAvailableActiveFileId({
      activeFileId,
      availableFileIds: files.map((file) => file.id),
      defaultFileId: defaultActiveFile?.id,
    });
    if (nextActiveFileId !== activeFileId) {
      setActiveFileId(nextActiveFileId);
    }
  }, [activeFileId, defaultActiveFile?.id, files]);

  const activeFile =
    files.find((f) => f.id === activeFileId) ?? defaultActiveFile;
  const activePendingSource = activeFile
    ? pendingLocalFileContentsRef.current.get(activeFile.id)
    : undefined;
  const activeReconcileFile =
    activePendingSource &&
    activePendingSource.identityMigrationSourceContent === undefined
      ? activeFile
      : (rawServerFilesByIdRef.current.get(activeFile?.id ?? "") ?? activeFile);
  const activeNodeRewriteProposal = activeFile
    ? (pendingNodeRewriteByFile.get(activeFile.id) ?? null)
    : null;
  const designBottomToolbarMode = getDesignBottomToolbarMode({
    isSignedIn,
    canEditDesign,
    canCommentDesign,
    hasActiveFile: Boolean(activeFile),
  });
  activeFileIdForUndoRef.current = activeFile?.id ?? null;
  selectedLayerIdsStateRef.current = selectedLayerIdsState;
  overviewSelectedScreenIdsRef.current = overviewSelectedScreenIds;

  const designBreakpoints = useMemo(
    () => deriveDesignBreakpoints(designDataJson),
    [designDataJson],
  );

  const handleBreakpointBarSelect = useCallback(
    (widthPx: number | undefined, selectedBreakpointId?: string) => {
      // Selection and bridge events from a breakpoint iframe can be followed
      // by a style commit in the same browser task. Mirror synchronously so
      // that commit cannot observe the previous frame's scope while React is
      // still scheduling the state update.
      activeBreakpointWidthStateRef.current = widthPx;
      invalidateRenderedElementInfo();
      setActiveBreakpointWidthState(widthPx);
      if (!id) return;
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      const breakpointId =
        selectedBreakpointId ?? (widthPx !== undefined && bp ? bp.id : "auto");
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [
      id,
      designBreakpoints,
      invalidateRenderedElementInfo,
      persistActiveBreakpoint,
    ],
  );
  const handleResponsiveEditScopeChange = useCallback(
    (scope: ResponsiveEditScope) => {
      responsiveEditScopeRef.current = scope;
      setResponsiveEditScope(scope);
      if (!id) return;
      const activeWidth = activeBreakpointWidthStateRef.current;
      const breakpointId =
        activeWidth === undefined
          ? "auto"
          : (designBreakpoints.find((bp) => bp.widthPx === activeWidth)?.id ??
            "auto");
      persistActiveBreakpoint(breakpointId, scope);
    },
    [designBreakpoints, id, persistActiveBreakpoint],
  );

  // Item 9 — agent→UI breakpoint sync. `set-active-breakpoint` (the action
  // the agent calls) persists `design-active-breakpoint:<designId>` to
  // application state so the agent and UI agree on the active edit scope;
  // this effect is the UI half that was previously missing — the BreakpointBar
  // chip/viewport-width only ever changed from the UI's own chip clicks.
  // React to the targeted active-breakpoint app-state counter, read the key,
  // and apply it -
  // except this key is a durable "current scope" value (not a one-shot
  // command), so unlike that effect this one does NOT null the key out after
  // reading; it just dedupes against the last-applied breakpointId so the
  // UI's own echoed write doesn't re-run every local setter on every chip
  // click (see lastAppliedActiveBreakpointIdRef's doc comment above, and
  // handleBreakpointBarSelect/handleBreakpointBarRemove/
  // handleOverviewActiveBreakpointChange below, which seed the ref
  // immediately on a local write so the resulting poll tick is a no-op
  // instead of a redundant re-apply).
  useEffect(() => {
    if (!id || !isSignedIn) return;
    let cancelled = false;
    void (async () => {
      if (activeBreakpointWriteQueueRef.current?.hasPending()) return;
      const value = await readClientAppState<{
        designId?: string;
        activeBreakpointId?: string;
        responsiveEditScope?: ResponsiveEditScope;
        // coercion-ok: missing persisted breakpoint state means use defaults.
      }>(`design-active-breakpoint:${id}`).catch(() => null);
      if (
        cancelled ||
        activeBreakpointWriteQueueRef.current?.hasPending() ||
        !value ||
        value.designId !== id
      ) {
        return;
      }
      const nextBreakpointId = value.activeBreakpointId ?? "auto";
      if (nextBreakpointId === lastAppliedActiveBreakpointIdRef.current) {
        return;
      }
      lastAppliedActiveBreakpointIdRef.current = nextBreakpointId;
      const nextScope =
        value.responsiveEditScope === "only" ? "only" : "cascade-smaller";
      responsiveEditScopeRef.current = nextScope;
      setResponsiveEditScope(nextScope);
      const nextWidthPx =
        nextBreakpointId !== "auto"
          ? designBreakpoints.find((bp) => bp.id === nextBreakpointId)?.widthPx
          : undefined;
      setActiveBreakpointWidthState(nextWidthPx);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBreakpointStateVersion, designBreakpoints, id, isSignedIn]);

  // Agent→UI: open the write-consent dialog when the agent requests local file
  // write access via request-localhost-write-consent (granting stays human-only).
  // One-shot: consume the app-state key, open the dialog, then clear it so
  // echoed app-state bumps don't re-open it.
  //
  // Keyed on edit access, not ambient session state: the visual-edit handoff can
  // grant a local capability without a normal Design sign-in. Gating this on
  // `isSignedIn` would leave that user unable to grant write consent.
  useEffect(() => {
    if (!id || !canEditDesign) return;
    let cancelled = false;
    const key = `design-localhost-write-consent-request:${id}`;
    void (async () => {
      const request = await readClientAppState<{
        designId?: string;
        connectionId?: string;
        rootPath?: string;
        files?: string[];
        // coercion-ok: missing consent state means no pending request.
      }>(key).catch(() => null);
      if (
        cancelled ||
        !request ||
        request.designId !== id ||
        !request.connectionId
      ) {
        return;
      }
      setLocalhostConsentConnectionId(request.connectionId);
      setLocalhostWriteConsentPayload({
        rootPath: request.rootPath ?? request.connectionId,
        files: request.files ?? [],
        onGranted: () => {
          toast.success("File writes allowed for 8 hours." /* i18n-ignore */);
        },
        onCancel: () => {},
      });
      setLocalhostWriteConsentOpen(true);
      await setClientAppState(key, null).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [localhostConsentStateVersion, canEditDesign, id]);

  const activeScreenBaseWidthPx = useMemo<number | null>(() => {
    if (!activeFile?.id) return null;
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
    const metadata = getDesignDataRecord(metadataByFileId, activeFile.id);
    return typeof metadata.width === "number" && Number.isFinite(metadata.width)
      ? (metadata.width as number)
      : null;
  }, [activeFile?.id, designDataJson]);

  const activeBreakpointUpperBoundPx = useMemo<number | null>(() => {
    if (activeBreakpointWidthState == null) return null;
    return breakpointUpperBoundPx(
      designBreakpoints.map((bp) => bp.widthPx),
      activeBreakpointWidthState,
      activeScreenBaseWidthPx,
    );
  }, [activeBreakpointWidthState, designBreakpoints, activeScreenBaseWidthPx]);
  const motionTimelineQueryParams =
    id && activeFile?.id
      ? { designId: id, sourceRef: activeFile.id }
      : { designId: "", sourceRef: "" };
  const { data: motionTimelineResult } =
    useActionQuery<MotionTimelineQueryResult>(
      "get-motion-timeline",
      motionTimelineQueryParams,
      {
        enabled: Boolean(isSignedIn && id && activeFile?.id),
        refetchOnMount: "always",
      },
    );
  useEffect(() => {
    if (activeFile && !embedded) return;
    clearMotionDockUnmountTimer();
    setMotionDockOpen(false);
    setMotionDockMounted(false);
  }, [activeFile, clearMotionDockUnmountTimer, embedded]);
  useEffect(() => {
    if (!reviewFileId || reviewFileId === activeFile?.id) return;
    setReviewFileId(null);
    setReviewFindings([]);
    setReviewAuditedAt(null);
    setReviewAuditError(null);
    setReviewAuditLoading(false);
  }, [activeFile?.id, reviewFileId]);

  const selectedScreenIds = useMemo(
    () =>
      getSelectedScreenIdsForEditorState({
        activeFileId: activeFile?.id ?? activeFileId,
        overviewSelectedScreenIds,
        viewMode,
      }),
    [activeFile?.id, activeFileId, overviewSelectedScreenIds, viewMode],
  );
  const activeOverviewScreenId =
    activeFile?.id ?? activeFileId ?? overviewScreens[0]?.id ?? null;
  const activeOverviewScreen = useMemo(
    () =>
      activeOverviewScreenId
        ? overviewScreens.find((screen) => screen.id === activeOverviewScreenId)
        : undefined,
    [activeOverviewScreenId, overviewScreens],
  );
  const handleEffectivePreviewTokenChange = useCallback(
    (screenId: string | undefined, previewToken: string) => {
      if (!screenId || !previewToken) return;
      setEffectivePreviewTokensByScreenId((current) =>
        current[screenId] === previewToken
          ? current
          : { ...current, [screenId]: previewToken },
      );
    },
    [],
  );
  const handleLiveEditCapabilityChange = useCallback(
    (screenId: string | undefined, capability: string) => {
      if (!screenId || !capability) return;
      setEffectiveLiveEditCapabilitiesByScreenId((current) =>
        current[screenId] === capability
          ? current
          : { ...current, [screenId]: capability },
      );
    },
    [],
  );
  const handleLiveEditRegistrationCapabilityChange = useCallback(
    (screenId: string | undefined, capability: string) => {
      if (!screenId || !capability) return;
      setEffectiveLiveEditRegistrationCapabilitiesByScreenId((current) =>
        current[screenId] === capability
          ? current
          : { ...current, [screenId]: capability },
      );
    },
    [],
  );
  const activeScreenSnapshotOnly = Boolean(
    isLiveCanvasShareLink &&
    designAccessRole &&
    designAccessRole !== "owner" &&
    resolveOverviewScreenSourceType(activeOverviewScreen, designSourceType) ===
      "localhost",
  );
  const activeScreenBridgeUrl = activeScreenSnapshotOnly
    ? undefined
    : activeOverviewScreen?.bridgeUrl;
  const activeScreenPreviewToken = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectivePreviewTokensByScreenId[activeOverviewScreen.id]
        : undefined) ??
      ("previewToken" in (activeOverviewScreen ?? {}) &&
      typeof activeOverviewScreen?.previewToken === "string"
        ? activeOverviewScreen.previewToken
        : (publicVisualEditPreviewTokenQuery.data?.connections?.[
            activeOverviewScreen?.connectionId ?? ""
          ]?.previewToken ??
          (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
            ? publicVisualEditPreviewTokenQuery.data?.previewToken
            : undefined))));
  const activeScreenLiveEditCapability = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectiveLiveEditCapabilitiesByScreenId[activeOverviewScreen.id]
        : undefined) ??
      (activeOverviewScreen?.connectionId
        ? publicVisualEditPreviewTokenQuery.data?.connections?.[
            activeOverviewScreen.connectionId
          ]?.liveEditCapability
        : undefined) ??
      (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
        ? publicVisualEditPreviewTokenQuery.data?.liveEditCapability
        : undefined));
  const activeScreenLiveEditRegistrationCapability = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectiveLiveEditRegistrationCapabilitiesByScreenId[
            activeOverviewScreen.id
          ]
        : undefined) ??
      (activeOverviewScreen?.connectionId
        ? publicVisualEditPreviewTokenQuery.data?.connections?.[
            activeOverviewScreen.connectionId
          ]?.liveEditRegistrationCapability
        : undefined) ??
      (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
        ? publicVisualEditPreviewTokenQuery.data?.liveEditRegistrationCapability
        : undefined));
  const activeScreenExternalSnapshotHtml = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]?.html
    : undefined;
  const overviewScreenIdList = useMemo(
    () => overviewScreens.map((screen) => screen.id),
    [overviewScreens],
  );
  const overviewZoomBasisScreenId = resolveOverviewZoomBasisScreenId({
    candidateFileId: activeFile?.id ?? activeFileId ?? null,
    boardFileId: boardFileId ?? null,
    overviewScreenIds: overviewScreenIdList,
  });
  const overviewZoomBasisScreen = useMemo(
    () =>
      overviewZoomBasisScreenId
        ? overviewScreens.find(
            (screen) => screen.id === overviewZoomBasisScreenId,
          )
        : undefined,
    [overviewZoomBasisScreenId, overviewScreens],
  );
  const activeOverviewSourceWidth =
    deviceFrame === "none"
      ? overviewZoomBasisScreen?.width
      : DEVICE_FRAME_VIEWPORTS[deviceFrame].width;
  const activeOverviewFrameWidth = overviewZoomBasisScreenId
    ? displayedCanvasFrameGeometryById[overviewZoomBasisScreenId]?.width
    : undefined;
  const overviewZoomScale = getOverviewZoomScale({
    frameWidth: activeOverviewFrameWidth,
    sourceWidth: activeOverviewSourceWidth,
  });
  const overviewZoomScaleRef = useRef(overviewZoomScale);

  useEffect(() => {
    overviewZoomScaleRef.current = overviewZoomScale;
  }, [overviewZoomScale]);

  const overviewZoomBasisIdRef = useRef<string | null>(
    overviewZoomBasisScreenId,
  );
  useEffect(() => {
    const previousBasisScreenId = overviewZoomBasisIdRef.current;
    overviewZoomBasisIdRef.current = overviewZoomBasisScreenId;
    if (
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId,
        nextBasisScreenId: overviewZoomBasisScreenId,
        explicitOverviewCanvasZoom,
        nextOverviewZoomScale: overviewZoomScale,
      })
    ) {
      setExplicitOverviewCanvasZoom(null);
    }
  }, [
    explicitOverviewCanvasZoom,
    overviewZoomBasisScreenId,
    overviewZoomScale,
  ]);

  const overviewCanvasZoom =
    explicitOverviewCanvasZoom ??
    getDefaultOverviewCanvasZoom(overviewZoomScale);
  const overviewZoom = clampOverviewDisplayZoom(
    getOverviewDisplayZoom(overviewCanvasZoom, overviewZoomScale),
  );
  const zoom = viewMode === "overview" ? overviewZoom : screenZoom;
  const initialOverviewZoomValue = initialSearchParams.get("zoom");
  const hasExplicitOverviewZoomCommand =
    viewMode === "overview" &&
    initialSearchParams.get("view") === "overview" &&
    initialOverviewZoomValue !== null &&
    Number.isFinite(Number(initialOverviewZoomValue));
  const setZoomForView = useCallback(
    (targetView: "single" | "overview", update: SetStateAction<number>) => {
      if (targetView === "overview") {
        setExplicitOverviewCanvasZoom((currentCanvasZoom) => {
          const scale = overviewZoomScaleRef.current;
          const resolvedCanvasZoom =
            currentCanvasZoom ?? getDefaultOverviewCanvasZoom(scale);
          const currentDisplayZoom = getOverviewDisplayZoom(
            resolvedCanvasZoom,
            scale,
          );
          const nextDisplayZoom = resolveZoomUpdate(update, currentDisplayZoom);
          return Number.isFinite(nextDisplayZoom)
            ? getOverviewCanvasZoom(nextDisplayZoom, scale)
            : currentCanvasZoom;
        });
        return;
      }
      setScreenZoom((currentZoom) => {
        const nextZoom = resolveZoomUpdate(update, currentZoom);
        return Number.isFinite(nextZoom) ? nextZoom : currentZoom;
      });
    },
    [],
  );
  const setZoom = useCallback(
    (update: SetStateAction<number>) => {
      setZoomForView(viewMode, update);
    },
    [setZoomForView, viewMode],
  );

  useEffect(() => {
    if (viewMode !== "single" || !activeFileId) return;
    screenZoomByIdRef.current.set(activeFileId, screenZoom);
  }, [activeFileId, screenZoom, viewMode]);

  const applyDesignEditorCommand = useCallback(
    (command: DesignEditorCommand | Record<string, unknown>) =>
      runApplyDesignEditorCommand(
        {
          canEditDesign,
          canvasFrameGeometryById,
          files,
          id,
          overviewScreens,
          setActiveFileId,
          setActiveInspectorTab,
          setActiveLeftPanel,
          setActiveTool,
          setDrawMode,
          setInteractDeviceName,
          setInteractDeviceSize,
          setMode,
          setOverviewSelectedScreenIds,
          setPinMode,
          setScreenZoom,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          setZoomForView,
          pendingOverviewScreenSelectionRef,
          overviewDataReady,
          viewModeRef,
          requestCameraFit: (camera) => {
            cameraCommandNonceRef.current += 1;
            setCameraCommand({
              ...camera,
              nonce: cameraCommandNonceRef.current,
            });
          },
        },
        command,
      ),
    [
      canEditDesign,
      canvasFrameGeometryById,
      files,
      id,
      overviewScreens,
      overviewDataReady,
      setZoomForView,
    ],
  );

  useEffect(() => {
    if (!id) return;
    if (initialSearchCommandAppliedForIdRef.current === id) return;
    const command = designEditorCommandFromSearchParams(
      id,
      initialSearchParams,
    );
    if (!command) {
      initialSearchCommandAppliedForIdRef.current = id;
      return;
    }
    const applied = applyDesignEditorCommand(command);
    if (applied) {
      initialSearchCommandAppliedForIdRef.current = id;
    }
  }, [applyDesignEditorCommand, id, initialSearchParams]);

  useEffect(() => {
    if (!id || !canEditDesign) return;
    let cancelled = false;
    const keys = browserTabId
      ? [designEditorCommandKey(browserTabId), designEditorCommandKey()]
      : [designEditorCommandKey()];

    void (async () => {
      for (const key of keys) {
        // coercion-ok: an absent command is equivalent to no queued command.
        const command = await readClientAppState<DesignEditorCommand>(
          key,
          // coercion-ok: an absent command is equivalent to no queued command.
        ).catch(() => null);
        if (cancelled || !command || command.designId !== id) continue;
        const applied = applyDesignEditorCommand(command);
        if (!applied) return;
        // coercion-ok: command cleanup is best effort after applying it.
        await setClientAppState(key, null).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    designEditorCommandVersion,
    applyDesignEditorCommand,
    browserTabId,
    canEditDesign,
    id,
  ]);

  const optimisticallyInsertCreatedFile = useCallback(
    (args: {
      fileId: string;
      filename: string;
      fileType: DesignFile["fileType"];
      content: string;
      result?: Record<string, unknown> | null;
    }) => {
      if (!id) return;
      const now = new Date().toISOString();
      const optimisticFile: DesignFile = {
        id: args.fileId,
        filename: args.filename,
        fileType: args.fileType,
        content: annotateScreenHtmlForPersist(args.content, args.fileType),
        createdAt:
          typeof args.result?.createdAt === "string"
            ? args.result.createdAt
            : now,
        updatedAt:
          typeof args.result?.updatedAt === "string"
            ? args.result.updatedAt
            : now,
      };
      historyFilesRef.current = historyFilesRef.current.some(
        (file) => file.id === args.fileId,
      )
        ? historyFilesRef.current.map((file) =>
            file.id === args.fileId ? optimisticFile : file,
          )
        : [...historyFilesRef.current, optimisticFile];
      void queryClient.cancelQueries({
        queryKey: ["action", "get-design", { id }],
        exact: true,
      });
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        return {
          ...old,
          files: old.files.some((file: DesignFile) => file.id === args.fileId)
            ? old.files.map((file: DesignFile) =>
                file.id === args.fileId ? optimisticFile : file,
              )
            : [...old.files, optimisticFile],
        };
      });
    },
    [id, queryClient],
  );

  const focusCreatedScreen = useCallback(
    (
      screenId: string,
      geometry: FrameGeometry,
      options?: {
        preserveCamera?: boolean;
        suppressLineupRecenter?: boolean;
      },
    ) => {
      const plan = getCreatedScreenNavigationPlan({ screenId, geometry });
      setOptimisticFrameGeometryById((current) => ({
        ...current,
        [screenId]: geometry,
      }));
      pendingOverviewScreenSelectionRef.current = screenId;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setActiveFileId(plan.activeFileId);
      setSelectedElement(null);
      setSelectedLayerIdsState(plan.selectedLayerIds);
      setOverviewSelectedScreenIds(plan.selectedScreenIds);
      setActiveTool("move");
      setMode("edit");
      viewModeRef.current = plan.viewMode;
      setViewMode(plan.viewMode);
      if (options?.suppressLineupRecenter) {
        const nonce = ++suppressLineupRecenterNonceRef.current;
        setSuppressLineupRecenter((current) => {
          const sameBatch = current?.fromCount === overviewScreens.length;
          return {
            fromCount: sameBatch ? current.fromCount : overviewScreens.length,
            addedCount: sameBatch ? current.addedCount + 1 : 1,
            nonce,
          };
        });
      }
      if (!options?.preserveCamera) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          ...plan.camera,
          nonce: cameraCommandNonceRef.current,
        });
      }
    },
    [clearPendingOverviewLayerSelectionTimer, overviewScreens.length],
  );

  const handleDuplicateScreen = useCallback(
    (
      screenId: string,
      request?: {
        canvasPosition?: { x: number; y: number };
        preserveCamera?: boolean;
        historyBatchId?: string;
        duplicateStackIndex?: number;
      },
    ) =>
      runDuplicateScreen(
        {
          canEditDesign,
          createFileAsync,
          deleteFileAsync: deleteFileMutation.mutateAsync,
          designDataJsonRef,
          duplicateRecoveryRef,
          files,
          focusCreatedScreen,
          id,
          liveFrameGeometryRef,
          optimisticallyInsertCreatedFile,
          overviewScreens,
          pendingDuplicateGeometriesRef,
          pendingDuplicateFilenamesRef,
          duplicateInFlightRef,
          queryClient,
          recordFileCreationHistoryEntry,
          t,
          updateDesignAsync,
          writeFrameGeometrySnapshot,
        },
        screenId,
        request,
      ),
    [
      canEditDesign,
      createFileAsync,
      deleteFileMutation,
      files,
      focusCreatedScreen,
      recordFileCreationHistoryEntry,
      id,
      optimisticallyInsertCreatedFile,
      overviewScreens,
      queryClient,
      t,
      updateDesignAsync,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleAddScreen = useCallback(
    () =>
      runAddScreen({
        boardContentBounds,
        boardFileId,
        canEditDesign,
        createFileMutation,
        designDataJsonRef,
        files,
        focusCreatedScreen,
        id,
        optimisticallyInsertCreatedFile,
        overviewScreens,
        queryClient,
        recordFileCreationHistoryEntry,
        t,
        writeFrameGeometrySnapshot,
      }),
    [
      canEditDesign,
      boardContentBounds,
      boardFileId,
      createFileMutation,
      files,
      focusCreatedScreen,
      id,
      optimisticallyInsertCreatedFile,
      overviewScreens,
      queryClient,
      recordFileCreationHistoryEntry,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleCreateScreenFrame = useCallback(
    (geometry: { x: number; y: number; width: number; height: number }) =>
      runCreateScreenFrame(
        {
          canEditDesign,
          createFileMutation,
          designDataJsonRef,
          files,
          focusCreatedScreen,
          id,
          locallyPinnedHeightIdsRef,
          optimisticallyInsertCreatedFile,
          queryClient,
          recordFileCreationHistoryEntry,
          t,
          writeFrameGeometrySnapshot,
        },
        geometry,
      ),
    [
      canEditDesign,
      createFileMutation,
      files,
      focusCreatedScreen,
      id,
      optimisticallyInsertCreatedFile,
      queryClient,
      recordFileCreationHistoryEntry,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleCreateScreenFromPreset = useCallback(
    (preset: { name: string; width: number; height: number }) => {
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
        includeResponsivePreviews: true,
      });
      const bounds = getFrameGroupBounds(frames);
      const gap = 56;
      const geometry = bounds
        ? {
            x: bounds.right + gap,
            y: bounds.top,
            width: preset.width,
            height: preset.height,
          }
        : { x: 0, y: 0, width: preset.width, height: preset.height };
      handleCreateScreenFrame(geometry);
    },
    [
      boardFileId,
      boardContentBounds,
      exportCanvasFrameGeometryById,
      handleCreateScreenFrame,
      overviewScreens,
    ],
  );

  const { ydoc, awareness, isSynced, activeUsers, agentPresent, agentActive } =
    useCollaborativeDoc({
      docId:
        isSignedIn && canEditDesign && viewMode === "single"
          ? activeFileId
          : null,
      requestSource: TAB_ID,
      user: currentUser,
    });

  const overviewPresenceFileId =
    viewMode === "overview"
      ? (activeFileId ?? overviewScreens[0]?.id ?? null)
      : null;
  const {
    awareness: overviewAwareness,
    ydoc: overviewYdoc,
    isSynced: overviewIsSynced,
  } = useCollaborativeDoc({
    docId:
      isSignedIn && canEditDesign && overviewPresenceFileId
        ? overviewPresenceFileId
        : null,
    requestSource: TAB_ID,
    user: currentUser,
  });

  const [collabContent, setCollabContent] = useState<string | null>(null);
  const [collabContentFileId, setCollabContentFileId] = useState<string | null>(
    null,
  );
  const previousDesignIdForHistoryRef = useRef<string | null>(null);
  const prevActiveFileIdRef = useRef<string | null>(null);
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  const lastAppliedFileContentRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    for (const file of serverFiles) {
      if (
        viewMode === "single" &&
        isSynced &&
        ydoc &&
        file.id === activeFileId &&
        prevActiveFileIdRef.current === activeFileId &&
        lastAppliedFileUpdatedAtRef.current
      )
        continue;
      const pending = pendingLocalFileContentsRef.current.get(file.id);
      if (pending && pending.identityMigrationSourceContent === undefined)
        continue;
      if (
        pending?.identityMigrationSourceContent !== undefined &&
        file.content !== pending.content &&
        file.content !== pending.identityMigrationSourceContent &&
        pending.identityMigrationStoredContent === (file.content ?? "") &&
        pending.identityMigrationStoredUpdatedAt === (file.updatedAt ?? null)
      )
        continue;
      publishCanonicalContent(file.id, file.content ?? "", file.fileType);
    }
  }, [
    serverFiles,
    publishCanonicalContent,
    canEditDesign,
    activeFileId,
    viewMode,
    isSynced,
    ydoc,
  ]);

  const lastLocalContentRef = useRef<string | null>(null);
  const latestActiveContentRef = useRef<string | null>(null);
  const livePreviewContentRef = useRef<{
    fileId: string;
    content: string;
  } | null>(null);
  const documentFileUpdatedAtRef = useRef<string | null>(null);
  const documentFileContentRef = useRef<string | null>(null);
  const collabContentRef = useRef<string | null>(null);
  const collabContentFileIdRef = useRef<string | null>(null);
  const staleAgentCollabRecoveryTimerRef = useRef<number | null>(null);
  const clearStaleAgentCollabRecovery = useCallback(() => {
    if (staleAgentCollabRecoveryTimerRef.current !== null) {
      window.clearTimeout(staleAgentCollabRecoveryTimerRef.current);
      staleAgentCollabRecoveryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (previousDesignIdForHistoryRef.current === id) return;
    previousDesignIdForHistoryRef.current = id ?? null;
    clearLocalUndoRedoStacks();
    syncUndoRedoState();
  }, [clearLocalUndoRedoStacks, id, syncUndoRedoState]);

  useEffect(() => {
    if (viewMode === "overview") {
      prevActiveFileIdRef.current = activeFileId;
      livePreviewContentRef.current = null;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastAppliedFileContentRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
      return;
    }
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      livePreviewContentRef.current = null;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastAppliedFileContentRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery, viewMode]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);

  useEffect(
    () =>
      runSeedCollabContent({
        publishCanonicalContent,
        activeFile: activeReconcileFile,
        activeFileId,
        collabContentFileIdRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        pendingLocalFileContentsRef,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        ydoc,
      }),
    [
      canEditDesign,
      publishCanonicalContent,
      ydoc,
      isSynced,
      activeFileId,
      activeReconcileFile?.content,
      activeReconcileFile?.fileType,
      activeReconcileFile?.updatedAt,
      pendingLocalFileContentsRevision,
    ],
  );

  useEffect(() => {
    documentFileUpdatedAtRef.current = activeReconcileFile?.updatedAt ?? null;
    documentFileContentRef.current = activeReconcileFile?.content ?? null;
  }, [activeReconcileFile?.content, activeReconcileFile?.updatedAt]);

  useEffect(() => {
    collabContentRef.current = collabContent;
    collabContentFileIdRef.current = collabContentFileId;
  }, [collabContent, collabContentFileId]);

  useEffect(
    () =>
      runObserveCollabText({
        publishCanonicalContent,
        activeFileId,
        fileType: activeFile?.fileType,
        agentActive,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        pendingLocalFileContentsRef,
        recordExternalContentHistoryCheckpoint,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        setHoveredElement,
        setSelectedElement,
        undoManagerRef,
        ydoc,
      }),
    [
      publishCanonicalContent,
      activeFileId,
      activeFile?.fileType,
      agentActive,
      isSynced,
      recordExternalContentHistoryCheckpoint,
      ydoc,
    ],
  );

  useEffect(() => {
    if (!ydoc || !isSynced) {
      undoManagerRef.current?.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => syncUndoRedoState();
    const handleStackItemAdded = (event: {
      origin?: unknown;
      type?: "undo" | "redo";
    }) => {
      if (event.origin !== LOCAL_EDIT_ORIGIN || event.type !== "undo") {
        syncUndoRedoState();
        return;
      }
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "content",
      ];
      clearRedoStacks();
      syncUndoRedoState();
    };
    const handleStackItemPopped = (event: {
      stackItem: { meta: Map<unknown, unknown> };
      type?: "undo" | "redo";
    }) => {
      const oppositeStack = event.type === "undo" ? um.redoStack : um.undoStack;
      forwardYjsUndoStackItemMeta(
        event.stackItem,
        oppositeStack[oppositeStack.length - 1],
      );
      syncUndoRedoState();
    };
    um.on("stack-item-added", handleStackItemAdded);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", handleStackItemPopped);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.off("stack-item-added", handleStackItemAdded);
      um.off("stack-item-updated", syncState);
      um.off("stack-item-popped", handleStackItemPopped);
      um.off("stack-cleared", syncState);
      um.destroy();
      undoManagerRef.current = null;
      historyOrderRef.current = removeUndoRedoOrderKind(
        historyOrderRef.current,
        "content",
      );
      redoOrderRef.current = removeUndoRedoOrderKind(
        redoOrderRef.current,
        "content",
      );
      syncUndoRedoState();
    };
  }, [clearRedoStacks, ydoc, isSynced, syncUndoRedoState]);

  useEffect(
    () =>
      runAdoptDbFileContent({
        publishCanonicalContent,
        activeFile: activeReconcileFile,
        agentActive,
        clearStaleAgentCollabRecovery,
        collabContent,
        collabContentFileId,
        collabContentFileIdRef,
        collabContentRef,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastAppliedFileContentRef,
        lastLocalContentRef,
        latestActiveContentRef,
        recordExternalContentHistoryCheckpoint,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        staleAgentCollabRecoveryTimerRef,
      }),
    [
      canEditDesign,
      publishCanonicalContent,
      activeReconcileFile,
      agentActive,
      clearStaleAgentCollabRecovery,
      collabContent,
      collabContentFileId,
      isSynced,
      recordExternalContentHistoryCheckpoint,
    ],
  );

  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

  const { others, setPresence } = usePresence(
    awareness,
    ydoc?.clientID ?? null,
  );

  const canvasContextMenuRef = useRef<CanvasContextMenuHandle | null>(null);
  const [canvasLayerHitCandidates, setCanvasLayerHitCandidates] = useState<
    CanvasLayerHitCandidate[]
  >([]);
  const layersPanelRef = useRef<LayersPanelHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const visibleCanvasRectRef = useRef<(() => VisibleCanvasRect | null) | null>(
    null,
  );
  const canvasBackgroundRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const activeEditorDragRef = useRef(false);
  const activeEditorDragScreenIdRef = useRef<string | null>(null);
  const activeEditorDragIdRef = useRef<string | null>(null);
  const retiredEditorDragIdsRef = useRef(new Set<string>());
  const retiredEditorDragScreenIdsRef = useRef(new Set<string>());
  const latestEditorDragEventAtRef = useRef(new Map<string, number>());
  type LayerStructurePreview = {
    sourceId: string;
    anchorId: string;
    placement: "before" | "after" | "inside";
    insert: boolean;
  };
  const [layerStructurePreviewByFileId, setLayerStructurePreviewByFileId] =
    useState<Record<string, LayerStructurePreview>>({});

  const canvasIframeRef = useMemo<React.RefObject<HTMLIFrameElement | null>>(
    () => ({
      get current() {
        const iframes = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          ),
        );
        if (!activeFile?.id) return iframes[0] ?? null;
        return (
          iframes.find(
            (iframe) => iframe.dataset.screenIframeId === activeFile.id,
          ) ??
          iframes[0] ??
          null
        );
      },
    }),
    [activeFile?.id],
  );

  const handleEditorDragStateChange = useCallback(
    (state: EditorDragStateChange) => {
      const dragId = state.dragId;
      const activeDragId = activeEditorDragIdRef.current;
      const previousScreenId = activeEditorDragScreenIdRef.current;
      if (
        !shouldAcceptEditorDragStateEvent(state, {
          dragId: activeDragId,
          retiredDragIds: retiredEditorDragIdsRef.current,
          retiredScreenIds: retiredEditorDragScreenIdsRef.current,
          latestEventAt: dragId
            ? latestEditorDragEventAtRef.current.get(dragId)
            : undefined,
        })
      )
        return;
      if (dragId && typeof state.eventAt === "number") {
        latestEditorDragEventAtRef.current.set(dragId, state.eventAt);
        if (latestEditorDragEventAtRef.current.size > 32) {
          const oldest = latestEditorDragEventAtRef.current.keys().next().value;
          if (oldest) latestEditorDragEventAtRef.current.delete(oldest);
        }
      }
      const screenId = state.screenId;
      const retiredScreenClear =
        state.active &&
        dragId === activeDragId &&
        screenId &&
        retiredEditorDragScreenIdsRef.current.has(screenId) &&
        state.preview?.phase === "clear";
      if (state.active && dragId && activeDragId && dragId !== activeDragId) {
        retiredEditorDragIdsRef.current.add(activeDragId);
        retiredEditorDragScreenIdsRef.current.clear();
        if (retiredEditorDragIdsRef.current.size > 32) {
          const oldest = retiredEditorDragIdsRef.current.values().next().value;
          if (oldest) retiredEditorDragIdsRef.current.delete(oldest);
        }
      }
      if (
        state.active &&
        dragId &&
        dragId === activeDragId &&
        previousScreenId &&
        screenId &&
        previousScreenId !== screenId
      ) {
        retiredEditorDragScreenIdsRef.current.add(previousScreenId);
      }
      if (state.active && dragId) activeEditorDragIdRef.current = dragId;
      if (!state.active) activeEditorDragIdRef.current = null;
      if (!state.active) retiredEditorDragScreenIdsRef.current.clear();
      if (retiredScreenClear && screenId) {
        setLayerStructurePreviewByFileId((current) => {
          if (!current[screenId]) return current;
          const next = { ...current };
          delete next[screenId];
          return next;
        });
        return;
      }
      activeEditorDragRef.current = state.active;
      activeEditorDragScreenIdRef.current = state.active
        ? (screenId ?? null)
        : null;
      const screenChanged =
        previousScreenId && previousScreenId !== (screenId ?? null);
      if (!screenId) {
        if (!previousScreenId) return;
        setLayerStructurePreviewByFileId((current) => {
          if (!current[previousScreenId]) return current;
          const next = { ...current };
          delete next[previousScreenId];
          return next;
        });
        return;
      }
      setLayerStructurePreviewByFileId((current) => {
        const preview = state.preview;
        const next = screenChanged ? { ...current } : current;
        if (screenChanged) delete next[previousScreenId];
        if (
          !state.active ||
          preview?.phase === "clear" ||
          !preview?.sourceId ||
          !preview.anchorId ||
          !preview.placement
        ) {
          if (!next[screenId]) return next;
          const cleared = { ...next };
          delete cleared[screenId];
          return cleared;
        }
        return {
          ...next,
          [screenId]: {
            sourceId: preview.sourceId,
            anchorId: preview.anchorId,
            placement: preview.placement,
            insert: preview.insert !== false,
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    const dragScreenId = activeEditorDragScreenIdRef.current;
    if (!dragScreenId || dragScreenId === activeFile?.id) return;
    activeEditorDragScreenIdRef.current = null;
    activeEditorDragRef.current = false;
    setLayerStructurePreviewByFileId((current) => {
      if (!current[dragScreenId]) return current;
      const next = { ...current };
      delete next[dragScreenId];
      return next;
    });
  }, [activeFile?.id]);

  const cancelActiveEditorDrag = useCallback(() => {
    if (!activeEditorDragRef.current) return false;
    activeEditorDragRef.current = false;
    if (typeof document === "undefined") return true;
    const pressedAt = Date.now();
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt },
          "*",
        );
      });
    return true;
  }, []);

  const handleRunDesignAudit = useCallback(async () => {
    if (!id || !activeFile?.id) return;
    const auditFileId = activeFile.id;
    setReviewFileId(auditFileId);
    setReviewAuditLoading(true);
    setReviewAuditError(null);
    try {
      const result = await callAction<{
        findings: A11yFinding[];
        auditedAt: string;
      }>("run-design-audit", {
        designId: id,
        fileId: auditFileId,
      } as any);
      setReviewFileId(auditFileId);
      setReviewFindings(Array.isArray(result.findings) ? result.findings : []);
      setReviewAuditedAt(result.auditedAt ?? new Date().toISOString());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.auditRunFailed");
      setReviewAuditError(message);
      toast.error(message);
    } finally {
      setReviewAuditLoading(false);
    }
  }, [activeFile?.id, id, t]);

  const handleReviewFindingClick = useCallback(
    (finding: A11yFinding) => {
      const selector =
        finding.selector ??
        (finding.nodeId
          ? `[data-agent-native-node-id="${finding.nodeId.replace(/"/g, '\\"')}"]`
          : null);
      if (!selector) return;
      canvasIframeRef.current?.contentWindow?.postMessage(
        {
          type: "select-element",
          selector,
          nodeId: finding.nodeId ?? undefined,
        },
        "*",
      );
      if (finding.nodeId) setSelectedLayerIdsState([finding.nodeId]);
    },
    [canvasIframeRef],
  );

  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
      }
    };
  }, []);

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pendingCursorRef.current = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null;
        const cursor = pendingCursorRef.current;
        if (cursor) setPresence({ cursor });
      });
    },
    [setPresence],
  );

  const handleCanvasBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (viewModeRef.current === "overview") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".design-canvas-iframe-wrapper")) return;
      if (
        target?.closest(
          "button, a, input, textarea, select, [role='menu'], [role='menuitem'], [role='dialog'], [data-radix-popper-content-wrapper]",
        )
      ) {
        return;
      }
      setSelectedElement(null);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState([]);
      setOverviewClearSelectionRequest((request) => request + 1);
    },
    [],
  );

  const [inspectorPopoverOpen, setInspectorPopoverOpen] = useState(false);
  useEffect(() => {
    const ATTR = "data-radix-popper-content-wrapper";
    const update = () => {
      const wrappers = document.body.querySelectorAll(`[${ATTR}]`);
      setInspectorPopoverOpen(
        Array.from(wrappers).some((wrapper) => isRadixOverlayOpen(wrapper)),
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPresence({ selection: selectedElement?.selector ?? null });
  }, [selectedElement?.selector, setPresence]);

  const viewportRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (viewportRafRef.current !== null) {
      cancelAnimationFrame(viewportRafRef.current);
    }
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = null;
      setPresence({
        viewport: { fileId: activeFileId ?? undefined, zoom },
      });
    });
    return () => {
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
    };
  }, [activeFileId, zoom, setPresence]);

  const mapIframeRectToViewport = useCallback(
    (iframe: HTMLIFrameElement, rect: DOMRect): DOMRect | null => {
      const frameRect = iframe.getBoundingClientRect();
      if (frameRect.width === 0 || frameRect.height === 0) return null;
      const layoutWidth = iframe.clientWidth || frameRect.width;
      const layoutHeight = iframe.clientHeight || frameRect.height;
      const scaleX = layoutWidth ? frameRect.width / layoutWidth : 1;
      const scaleY = layoutHeight ? frameRect.height / layoutHeight : 1;
      return new DOMRect(
        frameRect.left + rect.left * scaleX,
        frameRect.top + rect.top * scaleY,
        rect.width * scaleX,
        rect.height * scaleY,
      );
    },
    [],
  );

  const resolveSelectorRectInIframe = useCallback(
    (iframe: HTMLIFrameElement | null, selector: string): DOMRect | null => {
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        // coercion-ok: cross-origin iframe access is an expected absent-geometry result.
      } catch {
        return null;
      }
      if (!doc) return null;
      let el: Element | null = null;
      try {
        el = doc.querySelector(selector);
        // coercion-ok: an invalid selector has no inspectable geometry.
      } catch {
        return null;
      }
      if (!el) return null;
      return mapIframeRectToViewport(iframe, el.getBoundingClientRect());
    },
    [mapIframeRectToViewport],
  );

  const resolveTextQuoteRectInIframe = useCallback(
    (iframe: HTMLIFrameElement | null, quote: string): DOMRect | null => {
      const needle = quote.trim();
      if (!needle) return null;
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        // coercion-ok: cross-origin iframe access is an expected absent-geometry result.
      } catch {
        return null;
      }
      if (!doc?.body) return null;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const text = node.nodeValue ?? "";
        const idx = text.indexOf(needle);
        if (idx !== -1 && node.parentElement) {
          try {
            const range = doc.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + needle.length);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              return mapIframeRectToViewport(iframe, rect);
            }
            // coercion-ok: a range can become invalid during DOM mutation; use the parent rect.
          } catch {
            // fall back to the parent element rect below
          }
          return mapIframeRectToViewport(
            iframe,
            node.parentElement.getBoundingClientRect(),
          );
        }
        node = walker.nextNode();
      }
      return null;
    },
    [mapIframeRectToViewport],
  );

  const resolveSelectorRect = useCallback(
    (selector: string): DOMRect | null =>
      resolveSelectorRectInIframe(canvasIframeRef.current, selector),
    [canvasIframeRef, resolveSelectorRectInIframe],
  );

  const resolveTextQuoteRect = useCallback(
    (quote: string): DOMRect | null =>
      resolveTextQuoteRectInIframe(canvasIframeRef.current, quote),
    [canvasIframeRef, resolveTextQuoteRectInIframe],
  );

  const resolveSelectionRect = useCallback(
    (descriptor: string): DOMRect | null => resolveSelectorRect(descriptor),
    [resolveSelectorRect],
  );

  const resolveRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const d = edit.descriptor;
      if (d.kind === "selector" && typeof d.selector === "string") {
        return resolveSelectorRect(d.selector);
      }
      if (d.kind === "text" && typeof d.quote === "string") {
        return resolveTextQuoteRect(d.quote);
      }
      return null;
    },
    [resolveSelectorRect, resolveTextQuoteRect],
  );

  const recentEdits = useRecentEdits(others);

  const othersForOverlays = useMemo<OtherPresence[]>(
    () => others.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [others, zoom],
  );
  const recentEditsForOverlays = useMemo<AttributedRecentEdit[]>(
    () => recentEdits.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentEdits, zoom],
  );

  const othersWithAgentCursor = useMemo<OtherPresence[]>(() => {
    const container = canvasContainerRef.current;
    if (!container) return othersForOverlays;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) {
      return othersForOverlays;
    }
    return othersForOverlays.map((other) => {
      if (!other.isAgent || other.presence.cursor) return other;
      let rect: DOMRect | null = null;
      const selection = other.presence.selection as
        | string
        | { selector?: string }
        | null
        | undefined;
      const selector =
        typeof selection === "string" ? selection : selection?.selector;
      if (selector) rect = resolveSelectorRect(selector);
      if (!rect) {
        const ring = other.presence.recentEdits;
        if (Array.isArray(ring)) {
          for (let i = ring.length - 1; i >= 0 && !rect; i--) {
            const entry = ring[i] as AttributedRecentEdit;
            if (entry?.descriptor) {
              rect = resolveRecentEditRect({
                ...entry,
                clientId: other.clientId,
                user: other.user,
                isAgent: true,
              });
            }
          }
        }
      }
      if (!rect) return other;
      const cx = rect.left + rect.width / 2 - containerRect.left;
      const cy = rect.top + rect.height / 2 - containerRect.top;
      return {
        ...other,
        presence: {
          ...other.presence,
          cursor: {
            x: Math.max(0, Math.min(1, cx / containerRect.width)),
            y: Math.max(0, Math.min(1, cy / containerRect.height)),
          },
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    othersForOverlays,
    resolveSelectorRect,
    resolveRecentEditRect,
    canvasContainerRef,
    zoom,
  ]);

  const { others: overviewOthers } = usePresence(
    overviewAwareness,
    overviewYdoc?.clientID ?? null,
  );

  const getOverviewFrameIframe = useCallback(
    (fileId: string | null): HTMLIFrameElement | null => {
      if (!fileId) return null;
      const container = canvasContainerRef.current;
      if (!container) return null;
      const escaped =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(fileId) : fileId;
      return (
        findCanvasIframeForScreen(container, fileId, boardFileId) ??
        container.querySelector<HTMLIFrameElement>(
          `iframe[data-screen-iframe-id^="${escaped}::bp-"]`,
        ) ??
        null
      );
    },
    [boardFileId, canvasContainerRef],
  );

  const resolveOverviewSelectionRect = useCallback(
    (descriptor: string): DOMRect | null =>
      resolveSelectorRectInIframe(
        getOverviewFrameIframe(overviewPresenceFileId),
        descriptor,
      ),
    [
      getOverviewFrameIframe,
      overviewPresenceFileId,
      resolveSelectorRectInIframe,
    ],
  );
  const resolveOverviewRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const iframe = getOverviewFrameIframe(overviewPresenceFileId);
      if (!iframe) return null;
      const d = edit.descriptor;
      if (d.kind === "selector" && typeof d.selector === "string") {
        return resolveSelectorRectInIframe(iframe, d.selector);
      }
      if (d.kind === "text" && typeof d.quote === "string") {
        return resolveTextQuoteRectInIframe(iframe, d.quote);
      }
      return null;
    },
    [
      getOverviewFrameIframe,
      overviewPresenceFileId,
      resolveSelectorRectInIframe,
      resolveTextQuoteRectInIframe,
    ],
  );

  const overviewAgentOthers = useMemo<OtherPresence[]>(
    () => overviewOthers.filter((o) => o.isAgent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overviewOthers, overviewCanvasZoom],
  );
  const overviewRecentEdits = useRecentEdits(overviewAgentOthers);
  const overviewRecentEditsForOverlays = useMemo<AttributedRecentEdit[]>(
    () => overviewRecentEdits.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overviewRecentEdits, overviewCanvasZoom],
  );

  const [followingEmail, setFollowingEmail] = useState<string | null>(null);
  const followingId = useMemo(() => {
    if (!followingEmail) return null;
    const lc = followingEmail.trim().toLowerCase();
    const match = others.find((o) => o.user.email.trim().toLowerCase() === lc);
    return match?.clientId ?? null;
  }, [followingEmail, others]);

  const { stopFollowing } = useFollowUser({
    others,
    followingId,
    viewportKey: "viewport",
    onViewport: (vp) => {
      if (vp.fileId && vp.fileId !== activeFileId) {
        setActiveFileId(vp.fileId);
      }
      if (typeof vp.zoom === "number") {
        setZoom(vp.zoom);
      }
    },
  });

  const handleAvatarClick = useCallback(
    (user: CollabUser | null) => {
      const email = user?.email ?? "agent@system";
      const lc = email.trim().toLowerCase();
      if (followingEmail?.trim().toLowerCase() === lc) {
        setFollowingEmail(null);
        stopFollowing();
      } else {
        setFollowingEmail(email);
      }
    },
    [followingEmail, stopFollowing],
  );

  const activeCollabFileReady =
    viewMode === "single" && activeFileId === prevActiveFileIdRef.current;
  const pendingActiveFileContent = activeFile?.id
    ? pendingLocalFileContentsSnapshot.get(activeFile.id)?.content
    : undefined;
  const activeContentSource =
    pendingActiveFileContent ??
    (activeCollabFileReady &&
    collabContentFileId === activeFile?.id &&
    collabContent !== null
      ? collabContent
      : (activeFile?.content ?? ""));
  const rawActiveContent =
    typeof activeContentSource === "string" ? activeContentSource : "";
  const canonicalFileId = activeFile?.id;
  const canonicalFileType = activeFile?.fileType;
  const activeContent = useMemo(
    () =>
      canonicalFileId
        ? prepareCanonicalSourceContent(rawActiveContent, {
            fileId: canonicalFileId,
            fileType: canonicalFileType,
          }).content
        : rawActiveContent,
    [canonicalFileId, canonicalFileType, rawActiveContent],
  );
  useLayoutEffect(() => {
    if (activeFile?.id && rawActiveContent !== activeContent)
      publishCanonicalContent(
        activeFile.id,
        rawActiveContent,
        activeFile.fileType,
      );
  }, [
    activeFile?.id,
    activeFile?.fileType,
    rawActiveContent,
    activeContent,
    publishCanonicalContent,
    canEditDesign,
  ]);
  const initialGenerationChromeLimited =
    shouldLimitEditorChromeUntilContentReady({
      fileCount: files.length,
      generating,
      hasActiveCanvasContent: Boolean(activeFile && activeContent.trim()),
      pendingGenerationActive,
    });
  useLayoutEffect(() => {
    syncLatestActiveContentFromRender({
      activeContent,
      activeFile,
      latestActiveContentRef,
      pendingLocalFileContents: pendingLocalFileContentsRef.current,
    });
  }, [activeContent, activeFile?.id, activeFile?.fileType]);
  useEffect(() => {
    if (!initialGenerationChromeLimited) return;
    setActiveLeftPanel("agent");
  }, [initialGenerationChromeLimited]);
  const fileContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.id, typeof file.content === "string" ? file.content : "");
    }
    return map;
  }, [files]);
  const getUnprojectedScreenContent = useCallback(
    (screenId: string) =>
      prepareCanonicalSourceContent(
        getFreshScreenContent({
          screenId,
          activeFileId: activeFile?.id,
          freshActiveContentFileId: activeFile?.id,
          freshActiveContent: getFreshActiveFileContent({
            activeContent,
            pendingContent: activeFile?.id
              ? (latestFileSaveForUnloadRef.current[activeFile.id]?.content ??
                pendingLocalFileContentsRef.current.get(activeFile.id)?.content)
              : null,
            latestContent: latestActiveContentRef.current,
            lastLocalContent: lastLocalContentRef.current,
          }),
          fileContentById,
          pendingContent:
            latestFileSaveForUnloadRef.current[screenId]?.content ??
            pendingLocalFileContentsRef.current.get(screenId)?.content ??
            null,
        }),
        {
          fileId: screenId,
          fileType: rawServerFilesByIdRef.current.get(screenId)?.fileType,
        },
      ).content,
    [activeContent, activeFile?.id, fileContentById],
  );
  const getScreenContent = useCallback(
    (screenId: string) => {
      const current = getUnprojectedScreenContent(screenId);
      const linkedQueue = linkedComponentMutationQueueRef.current;
      const projected =
        linkedQueue && linkedQueue.designId === id
          ? linkedQueue.queue.getProjectedContent(screenId)
          : undefined;
      if (projected === undefined) return current;
      const pendingSave = latestFileSaveForUnloadRef.current[screenId];
      return pendingSave?.expectedVersionHash === sourceContentHash(projected)
        ? current
        : projected;
    },
    [getUnprojectedScreenContent, id],
  );
  const lastDurableLockedLayerCountRef = useRef(0);
  const durableLockedLayerCount = useMemo(
    () =>
      saveTemplateOpen
        ? countLockedLayersAcrossFiles(
            files.map((file) => ({ content: getScreenContent(file.id) })),
          )
        : lastDurableLockedLayerCountRef.current,
    [files, getScreenContent, saveTemplateOpen],
  );
  lastDurableLockedLayerCountRef.current = durableLockedLayerCount;

  const canApplyContentEdit = useCallback(
    (fileId: string) => {
      const linkedQueue = linkedComponentMutationQueueRef.current;
      if (
        !linkedQueue ||
        linkedQueue.designId !== id ||
        !linkedQueue.queue.blocksLocalContentEdits()
      ) {
        return true;
      }
      toast.info(t("visualEditor.saving"), {
        id: `design-source-linked-edit-pending:${fileId}`,
      });
      return false;
    },
    [id, t],
  );
  const getProjectionContentForScreen = useCallback(
    (screenId: string) =>
      liveScreenSnapshotsById[screenId]?.html ?? getScreenContent(screenId),
    [getScreenContent, liveScreenSnapshotsById],
  );

  historySourceReaderRef.current = getProjectionContentForScreen;

  const embeddedFrameCacheRef = useRef<
    Map<string, { key: string; value: DesignCanvasEmbeddedFrame }>
  >(new Map());
  const getEmbeddedFrame = useCallback(
    (screenId: string, width: number, height: number) => {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const key = `${w}x${h}`;
      const cache = embeddedFrameCacheRef.current;
      const cached = cache.get(screenId);
      if (cached && cached.key === key) return cached.value;
      const value: DesignCanvasEmbeddedFrame = {
        viewportWidth: w,
        viewportHeight: h,
        displayWidth: w,
        displayHeight: h,
        fluid: true,
      };
      cache.set(screenId, { key, value });
      return value;
    },
    [],
  );
  const handleScreenExternalContentSnapshot = useCallback(
    (screenId: string, snapshot: LiveScreenSnapshot) => {
      setLiveScreenSnapshotsById((current) => {
        const existing = current[screenId];
        if (
          existing?.url === snapshot.url &&
          existing.html === snapshot.html &&
          existing.status === snapshot.status &&
          existing.contentType === snapshot.contentType
        ) {
          return current;
        }
        return { ...current, [screenId]: snapshot };
      });
    },
    [],
  );
  const handleScreenRuntimeLayerSnapshot = useCallback(
    (screenId: string, snapshot: RuntimeLayerSnapshot) => {
      const screen = overviewScreensRef.current.find(
        (candidate) => candidate.id === screenId,
      );
      if (
        screen &&
        resolveOverviewScreenSourceType(screen, designSourceTypeRef.current) ===
          "localhost" &&
        snapshot.reservationToken
      ) {
        scheduleVisualEditSnapshotRef.current(
          screenId,
          snapshot.html,
          snapshot.reservationToken,
        );
      }
      runtimeLayerSnapshotsByIdRef.current = {
        ...runtimeLayerSnapshotsByIdRef.current,
        [screenId]: snapshot,
      };
      setRuntimeLayerSnapshotsById((current) => {
        const existing = current[screenId];
        if (
          existing?.html === snapshot.html &&
          existing.nodeCount === snapshot.nodeCount &&
          existing.documentId === snapshot.documentId
        ) {
          return current;
        }
        return { ...current, [screenId]: snapshot };
      });
    },
    [],
  );
  const getScreenRootComputedStylesCallback = useCallback(
    (screenId: string) => {
      const callbacks = screenRootStyleCallbacksRef.current;
      const existingCallback = callbacks.get(screenId);
      if (existingCallback) return existingCallback;
      const callback = (styles: Record<string, string>) => {
        setScreenRootComputedStylesById((current) => {
          const existing = current[screenId];
          const sameStyles =
            existing &&
            Object.keys(existing).length === Object.keys(styles).length &&
            Object.entries(styles).every(
              ([property, value]) => existing[property] === value,
            );
          if (sameStyles) return current;
          return { ...current, [screenId]: styles };
        });
      };
      callbacks.set(screenId, callback);
      return callback;
    },
    [],
  );
  const handleScreenRuntimeVerificationSnapshot = useCallback(
    (
      screenId: string,
      snapshot: RuntimeLayerSnapshot & { requestId: number },
    ) => {
      const session = pendingStructureVerificationSessionRef.current;
      if (
        !session ||
        session.cancelled ||
        session.requestId !== snapshot.requestId
      ) {
        return;
      }
      const byRequest = pendingStructureVerificationSnapshotsRef.current;
      const current = byRequest.get(snapshot.requestId) ?? {};
      byRequest.set(snapshot.requestId, {
        ...current,
        [screenId]: snapshot,
      });
    },
    [],
  );
  const runtimeLayerSnapshotCallbacksRef = useRef<
    Map<string, (snapshot: RuntimeLayerSnapshot) => void>
  >(new Map());
  const getRuntimeLayerSnapshotCallback = useCallback(
    (screenId: string) => {
      const cache = runtimeLayerSnapshotCallbacksRef.current;
      const cached = cache.get(screenId);
      if (cached) return cached;
      const callback = (snapshot: RuntimeLayerSnapshot) =>
        handleScreenRuntimeLayerSnapshot(screenId, snapshot);
      cache.set(screenId, callback);
      return callback;
    },
    [handleScreenRuntimeLayerSnapshot],
  );
  const runtimeVerificationSnapshotCallbacksRef = useRef<
    Map<
      string,
      (snapshot: RuntimeLayerSnapshot & { requestId: number }) => void
    >
  >(new Map());
  const getRuntimeVerificationSnapshotCallback = useCallback(
    (screenId: string) => {
      const cache = runtimeVerificationSnapshotCallbacksRef.current;
      const cached = cache.get(screenId);
      if (cached) return cached;
      const callback = (
        snapshot: RuntimeLayerSnapshot & { requestId: number },
      ) => handleScreenRuntimeVerificationSnapshot(screenId, snapshot);
      cache.set(screenId, callback);
      return callback;
    },
    [handleScreenRuntimeVerificationSnapshot],
  );
  const updateLiveScreenSnapshotContent = useCallback(
    (
      screenId: string,
      html: string,
      options: { recordHistory?: boolean } = {},
    ) => {
      const existing = liveScreenSnapshotsById[screenId];
      if (!existing) return false;
      if (existing.html === html) return true;
      try {
        assertDesignHtmlEditIntegrity({
          previousContent: existing.html,
          nextContent: html,
          fileType: "html",
        });
      } catch (error) {
        toast.error(designSaveErrorMessage(error) ?? t("common.genericError"), {
          id: `design-source-integrity:${screenId}`,
        });
        return false;
      }
      if (options.recordHistory !== false) {
        const change = { fileId: screenId, before: existing.html, after: html };
        if (viewModeRef.current === "overview") {
          recordContentHistoryEntry(change);
        } else {
          recordLocalContentHistoryEntry(change);
        }
      }
      setLiveScreenSnapshotsById((current) => ({
        ...current,
        [screenId]: { ...existing, html },
      }));
      scheduleVisualEditSnapshotPublication(screenId, html);
      return true;
    },
    [
      liveScreenSnapshotsById,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      scheduleVisualEditSnapshotPublication,
      t,
    ],
  );
  const recordPendingVisualStyleEdit = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        originalStyles?: Record<string, string>;
        interactionState?: InteractionState;
        pendingUndoGestureId?: string;
        preserveSelection?: boolean;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runRecordPendingVisualStyleEdit(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthState,
          activeFile,
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          clipboardPasteRedoStackRef,
          files,
          getProjectionContentForScreen,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleRedoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingVisualStyleEditsRef,
          pendingVisualStyleRedoStackRef,
          pendingVisualStyleUndoStackRef,
          recordPendingHistoryEntry,
          responsiveEditScopeRef,
          runtimeLayerSnapshotsById,
          selectedElement,
          onNoRenderedBox: () =>
            toast.error(t("designEditor.patchProof.noRenderedBox"), {
              id: "design-no-rendered-box",
              duration: 4000,
            }),
          setPatchProof,
          setPendingVisualStyleEdits,
          setSelectedElement,
          setSelectedLayerIdsState,
        },
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [
      activeBreakpointUpperBoundPx,
      activeBreakpointWidthState,
      activeFile?.id,
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      getProjectionContentForScreen,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
      selectedElement?.computedStyles,
      selectedElement?.inlineStyles,
      selectedElement?.sourceId,
    ],
  );

  const recordPendingLiveTextEdit = useCallback(
    (
      screenId: string,
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: {
        html?: string;
        originalValue?: string;
        originalHtml?: string;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runRecordPendingLiveTextEdit(
        {
          activeFile,
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          canCoalescePendingLiveEdit: () =>
            historyOrderRef.current[historyOrderRef.current.length - 1] ===
            "pending-live",
          runtimeLayerSnapshotsById,
          selectedElement,
          setPendingLiveNonStyleEdits,
        },
        screenId,
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
      selectedElement?.htmlContent,
      selectedElement?.sourceId,
      selectedElement?.textContent,
    ],
  );

  const recordPendingLiveLayerStateEdit = useCallback(
    (
      layerId: string,
      state: "hidden" | "locked",
      enabled: boolean,
      originalEnabled: boolean,
    ) =>
      runRecordPendingLiveLayerStateEdit(
        {
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          clipboardPasteRedoStackRef,
          codeLayerOwnerByNodeIdRef,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        layerId,
        state,
        enabled,
        originalEnabled,
        liveRoutePathsByScreenIdRef.current[
          codeLayerOwnerByNodeIdRef.current.get(layerId)?.fileId ?? ""
        ],
      ),
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );

  const recordPendingLiveStructureEdit = useCallback(
    (
      screenId: string,
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        routePath?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        remintCollidingNodeIds?: boolean;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
        removed?: true;
      },
    ) => {
      runRecordPendingLiveStructureEdit(
        {
          canEditDesign,
          canEditLiveScreens: canEditLiveScreenIdsRef.current,
          cancelPendingStructureVerification,
          files,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          pendingLiveNonStyleEditsRef,
          pendingLiveNonStyleRedoStackRef,
          pendingLiveNonStyleUndoStackRef,
          pendingStructureRedoReplayRef,
          pendingStructureRedoReplayTimerRef,
          pendingStructureRedoPreparedEditsRef,
          pendingVisualStyleRedoStackRef,
          recordPendingHistoryEntry,
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        screenId,
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      );
    },
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );
  const recordPendingLiveLayerNameEdit = useCallback(
    (
      layerId: string,
      name: string,
      originalName?: string,
      routePath?: string,
    ) => {
      const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (!owner || !canEditLiveScreenIdsRef.current.has(owner.fileId)) {
        return false;
      }
      const screen = overviewScreens.find(
        (candidate) => candidate.id === owner.fileId,
      );
      if (resolveOverviewScreenSourceType(screen) !== "localhost") {
        return false;
      }
      const info = elementInfoFromCodeLayerNode(owner.node);
      const sourceId = bridgeSourceIdForCodeLayerNode(owner.node);
      const selector = preferredCodeLayerSelector(owner.node);
      const fallbackName =
        files.find((file) => file.id === owner.fileId)?.filename ??
        owner.fileId;
      const nextEdit: PendingLiveLayerNameEdit = {
        kind: "layer-name",
        screenId: owner.fileId,
        filename: fallbackName,
        screenName: prettyScreenName(fallbackName),
        layerId,
        selector,
        sourceId,
        ...(routePath || liveRoutePathsByScreenIdRef.current[owner.fileId]
          ? {
              routePath:
                routePath ?? liveRoutePathsByScreenIdRef.current[owner.fileId],
            }
          : {}),
        sourceAnchor: reactSourceAnchorForPendingEdit({
          info,
          id: sourceId,
          rootPath: screen?.connectionId
            ? localhostConnectionRootPathByIdRef.current.get(
                screen.connectionId,
              )
            : undefined,
          runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
            runtimeLayerSnapshotsById,
            info,
          ),
          reason: `Pending live layer rename for ${layerId} in screen ${owner.fileId}.`,
        }),
        tagName: info.tagName ?? null,
        classes: info.classes ?? [],
        name,
        originalName:
          originalName ??
          owner.node.dataAttributes["data-agent-native-layer-name"] ??
          "",
        updatedAt: nextPendingLiveEditTimestamp(),
      };
      const revertName = pendingLiveLayerNameUndoRevertValue(
        pendingLiveNonStyleEditsRef.current,
        nextEdit,
      );
      cancelPendingStructureVerification("conflict");
      pendingLiveNonStyleRedoStackRef.current = [];
      pendingVisualStyleRedoStackRef.current = [];
      clipboardPasteRedoStackRef.current = [];
      const previousUndoLength = pendingLiveNonStyleUndoStackRef.current.length;
      appendPendingLiveNonStyleUndoEntry(
        pendingLiveNonStyleUndoStackRef.current,
        { kind: "layer-name", edit: nextEdit, revertName },
        historyOrderRef.current[historyOrderRef.current.length - 1] ===
          "pending-live",
      );
      if (pendingLiveNonStyleUndoStackRef.current.length > previousUndoLength) {
        recordPendingHistoryEntry("pending-live");
      }
      const nextPending = mergePendingLiveNonStyleEdit(
        pendingLiveNonStyleEditsRef.current,
        nextEdit,
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      setPendingLiveNonStyleEdits(nextPending);
      return true;
    },
    [
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      recordPendingHistoryEntry,
      runtimeLayerSnapshotsById,
    ],
  );
  const activeProjectionContent =
    activeFile?.id !== undefined
      ? getProjectionContentForScreen(activeFile.id)
      : activeContent;
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );
  const activeCodeLayerProjection = useMemo(
    () =>
      buildCodeLayerProjection(activeProjectionContent, {
        source: activeFile?.id
          ? codeLayerSourceForScreen(activeFile.id)
          : undefined,
      }),
    [activeFile?.id, activeProjectionContent, codeLayerSourceForScreen],
  );
  const activeRuntimeCodeLayerProjection = useMemo(() => {
    const fileId = activeFile?.id;
    if (!fileId) return null;
    const snapshot = runtimeLayerSnapshotsById[fileId];
    if (!snapshot) return null;
    const eligible = shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === fileId),
      fallbackSourceType:
        normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
        normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
        "inline",
      content: files.find((file) => file.id === fileId)?.content ?? "",
    });
    if (!eligible) return null;
    const projection = buildCodeLayerProjection(snapshot.html, {
      source: codeLayerSourceForScreen(fileId, "inline-html"),
    });
    return projection.nodes.length > 0 ? projection : null;
  }, [
    activeFile?.id,
    codeLayerSourceForScreen,
    designDataJson,
    files,
    overviewScreens,
    runtimeLayerSnapshotsById,
  ]);
  const activeRuntimeSourceLocationUnavailable = useMemo(() => {
    const fileId = activeFile?.id;
    const snapshot = fileId ? runtimeLayerSnapshotsById[fileId] : undefined;
    if (!fileId || !snapshot) return false;
    const eligible = shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === fileId),
      fallbackSourceType:
        normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
        normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
        "inline",
      content: files.find((file) => file.id === fileId)?.content ?? "",
    });
    if (!eligible) return false;
    const projection = buildCodeLayerProjection(snapshot.html, {
      source: codeLayerSourceForScreen(fileId, "inline-html"),
    });
    return !projection.nodes.some((node) =>
      node.dataAttributes["data-source-file"]?.trim(),
    );
  }, [
    activeFile?.id,
    codeLayerSourceForScreen,
    designDataJson,
    files,
    overviewScreens,
    runtimeLayerSnapshotsById,
  ]);
  const activeMotionTimeline = motionTimelineResult?.timelines?.[0] ?? null;
  const activeMotionHydrationFingerprint = activeFile?.id
    ? motionTimelineFingerprint(activeFile.id, activeMotionTimeline)
    : null;

  useEffect(() => {
    const fileId = activeFile?.id ?? null;
    if (previousMotionFileIdRef.current === fileId) return;
    previousMotionFileIdRef.current = fileId;
    const flushPendingMotionAutosave = motionAutosaveFlushRef.current;
    motionAutosaveFlushRef.current = null;
    if (flushPendingMotionAutosave) flushPendingMotionAutosave();
    clearMotionAutosaveTimer();
    motionAutosaveRevisionRef.current = 0;
    motionAutosaveFailedRevisionRef.current = null;
    lastScheduledMotionAutosaveRevisionRef.current = 0;
    setMotionTimelineId(null);
    setMotionTracks([]);
    setMotionDurationMs(2000);
    setMotionDefaultEase("ease");
    setMotionPlayhead(0);
    setMotionAutoKeyframeEnabled(false);
    setMotionTracksDirty(false);
    setMotionAutosaveRevision(0);
    setMotionHydrationFingerprint(null);
  }, [activeFile?.id, clearMotionAutosaveTimer]);

  useEffect(() => {
    if (!activeFile?.id || !activeMotionHydrationFingerprint) return;
    if (motionTracksDirty) return;
    if (motionHydrationFingerprint === activeMotionHydrationFingerprint) return;

    const hydratedTracks = activeMotionTimeline
      ? hydrateMotionDockTracks(
          activeMotionTimeline.tracks,
          activeCodeLayerProjection,
        )
      : [];

    setMotionTimelineId(activeMotionTimeline?.id ?? null);
    setMotionTracks(hydratedTracks);
    setMotionDurationMs(activeMotionTimeline?.durationMs ?? 2000);
    setMotionDefaultEase(activeMotionTimeline?.defaultEase ?? "ease");
    setMotionHydrationFingerprint(activeMotionHydrationFingerprint);
  }, [
    activeCodeLayerProjection,
    activeFile?.id,
    activeMotionHydrationFingerprint,
    activeMotionTimeline,
    motionHydrationFingerprint,
    motionTracksDirty,
  ]);

  const selectedCodeLayerNode = useMemo(
    () =>
      resolveSelectedCodeLayerNode({
        selectedElement,
        sourceProjection: activeCodeLayerProjection,
        runtimeProjection: activeRuntimeCodeLayerProjection,
      }),
    [
      activeCodeLayerProjection,
      activeRuntimeCodeLayerProjection,
      selectedElement,
    ],
  );
  const selectedElementLayerId = selectedCodeLayerNode?.id ?? null;
  const selectedMotionTargetNodeId =
    selectedCodeLayerNode?.dataAttributes[
      "data-agent-native-node-id"
    ]?.trim() ??
    selectedElement?.sourceId ??
    null;
  const selectedElementHasMotionTrack = useMemo(() => {
    if (!selectedMotionTargetNodeId) return false;
    return motionTracks.some(
      (track) => track.targetNodeId === selectedMotionTargetNodeId,
    );
  }, [motionTracks, selectedMotionTargetNodeId]);
  const motionKeyframeState = useMemo(() => {
    if (motionTracks.length === 0) return undefined;
    const keyframedProperties = selectedMotionTargetNodeId
      ? motionTracks
          .filter((track) => track.targetNodeId === selectedMotionTargetNodeId)
          .map((track) => track.property)
      : [];
    return { hasTimeline: true, keyframedProperties };
  }, [motionTracks, selectedMotionTargetNodeId]);
  const selectedCanvasSelectorCandidates = useMemo(() => {
    const runtimeSelector = selectedElement?.runtimeSelector?.trim();
    const runtimeCandidates = runtimeSelector ? [runtimeSelector] : [];
    if (selectedCodeLayerNode) {
      return Array.from(
        new Set([
          ...runtimeCandidates,
          ...codeLayerSelectorAliases(selectedCodeLayerNode),
        ]),
      );
    }
    return runtimeCandidates.concat(
      selectedElement?.selector && selectedElement.selector !== runtimeSelector
        ? [selectedElement.selector]
        : [],
    );
  }, [
    selectedCodeLayerNode,
    selectedElement?.runtimeSelector,
    selectedElement?.selector,
  ]);
  const selectedCanvasSelector = selectedCanvasSelectorCandidates[0] ?? null;

  const handleDesignStateSelect = useCallback(
    (stateId: string | null, row?: DesignStatePreviewRow) => {
      if (isStandaloneHttpUrl(activeContent)) {
        toast.error(t("designEditor.toasts.designStateLiveScreen"), {
          duration: 5000,
        });
        return;
      }
      setSelectedStateId(stateId);
      const win = canvasIframeRef.current?.contentWindow;
      if (!win) return;

      if (stateId === null) {
        win.postMessage(
          {
            type: "replace-document-content",
            content: activeContent,
            forceFullDocument: true,
          },
          "*",
        );
        return;
      }

      const html = designStatePreviewHtml(row);
      if (!html) return;
      win.postMessage(
        {
          type: "replace-document-content",
          content: html,
          forceFullDocument: true,
        },
        "*",
      );
    },
    [activeContent, canvasIframeRef],
  );

  // ── Inspector header quick actions (Create component / Inspect code) ───────
  // Resolve the design-level source type + capability map so the inspector can
  // gate the real-app affordances (jump-to-source, prop write-back).
  const activeCanvasSourceType = resolveOverviewScreenSourceType(
    activeOverviewScreen,
    designSourceType,
  );
  const liveScreenIds = useMemo(
    () =>
      new Set(
        overviewScreens
          .filter(
            (screen) =>
              resolveOverviewScreenSourceType(screen, designSourceType) ===
              "localhost",
          )
          .map((screen) => screen.id),
      ),
    [designSourceType, overviewScreens],
  );
  canEditLiveScreenIdsRef.current = canEditLiveScreens
    ? new Set([
        ...liveScreenIds,
        ...(publicVisualEdit && boardFileId ? [boardFileId] : []),
      ])
    : new Set();
  const canEditLiveScreen = useCallback(
    (screenId: string | null | undefined) =>
      canEditLiveScreens && Boolean(screenId && liveScreenIds.has(screenId)),
    [canEditLiveScreens, liveScreenIds],
  );
  const editableLiveScreenIds = useMemo(
    () =>
      canEditDesign || canEditLiveScreens ? liveScreenIds : new Set<string>(),
    [canEditDesign, canEditLiveScreens, liveScreenIds],
  );
  const canEditActiveVisualScreen =
    canEditDesign || canEditLiveScreen(activeFile?.id ?? activeFileId);
  const activeSingleScreenCreationTool = getSingleScreenCreationTool({
    activeTool,
    viewMode,
    hasActiveFile: Boolean(activeFile),
  });
  const sourceCapabilities = useMemo(() => {
    const caps = resolveSourceCapabilities(designSourceType);
    return DESIGN_CAPABILITY_NAMES.filter((name) => hasCapability(caps, name));
  }, [designSourceType]);

  const fusionApp = useMemo(
    () => readFusionApp(designDataJson),
    [designDataJson],
  );
  useEffect(() => {
    if (fusionApp?.source !== "builder-host") return;
    setBuilderHostConfirmed(true);
  }, [fusionApp?.source]);

  const fullAppBuildingEnabled = useFeatureFlag(FULL_APP_BUILDING.key);
  const designReviewPanelEnabled = useFeatureFlag(DESIGN_REVIEW_PANEL.key);

  useEffect(() => {
    if (!tweaksEnabled && activeInspectorTab === "tweaks") {
      setActiveInspectorTab("design");
    }
    if (!tweaksEnabled) setShowTweakPrompt(false);
  }, [activeInspectorTab, tweaksEnabled]);

  const designFusionUrl = useMemo(() => {
    const raw = (designDataJson as { fusionUrl?: unknown }).fusionUrl;
    if (typeof raw === "string" && raw) return raw;
    return fusionApp?.previewUrl;
  }, [designDataJson, fusionApp]);

  const handleComponentSourceJump = useCallback(
    ({ nodeId }: { nodeId: string; componentName: string }) => {
      if (!id || !nodeId) return;
      openComponentSourceMutation.mutate(
        { designId: id, nodeId, fileId: activeFileId ?? undefined } as any,
        {
          onError: () => {
            toast.error(
              "Could not open component source" /* i18n-ignore edge-case jump failure */,
            );
          },
        },
      );
    },
    [id, activeFileId, openComponentSourceMutation],
  );

  const handleActiveRuntimeLayerSnapshot = useCallback(
    (snapshot: RuntimeLayerSnapshot) => {
      if (!activeFile?.id) return;
      handleScreenRuntimeLayerSnapshot(activeFile.id, snapshot);
    },
    [activeFile?.id, handleScreenRuntimeLayerSnapshot],
  );
  const handleActiveRuntimeVerificationSnapshot = useCallback(
    (snapshot: RuntimeLayerSnapshot & { requestId: number }) => {
      if (!activeFile?.id) return;
      handleScreenRuntimeVerificationSnapshot(activeFile.id, snapshot);
    },
    [activeFile?.id, handleScreenRuntimeVerificationSnapshot],
  );

  const selectedComponentNodeId = useMemo(() => {
    if (selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode)) {
      return bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode);
    }
    const runtimeComponent = selectedElement?.runtimeComponent;
    if (
      activeCanvasSourceType === "localhost" &&
      (selectedElement?.componentAnnotation?.trim() ||
        selectedElement?.componentName?.trim()) &&
      runtimeComponent?.componentId?.trim() &&
      runtimeComponent.instanceId?.trim() &&
      runtimeComponent.name?.trim() &&
      selectedElement?.provenance?.component?.trim()
    ) {
      return runtimeComponent.instanceId;
    }
    return undefined;
  }, [activeCanvasSourceType, selectedCodeLayerNode, selectedElement]);
  const selectedInstanceActionNodeId = useMemo(() => {
    if (!selectedCodeLayerNode) return undefined;
    return isComponentInstanceForInstanceActions(selectedCodeLayerNode)
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : undefined;
  }, [selectedCodeLayerNode]);
  const acceptedActiveFile = activeFile?.id
    ? rawServerFilesByIdRef.current.get(activeFile.id)
    : undefined;
  const pendingActiveFileEntry = activeFile?.id
    ? pendingLocalFileContentsSnapshot.get(activeFile.id)
    : undefined;
  const acceptedActiveContent = pendingActiveFileEntry
    ? pendingActiveFileEntry.baseContent
    : acceptedActiveFile?.content;
  const hasSelectedComponent = Boolean(
    selectedComponentNodeId &&
    ((selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode)) ||
      (selectedElement?.runtimeComponent?.componentId?.trim() &&
        selectedElement.runtimeComponent.instanceId?.trim() &&
        selectedElement.runtimeComponent.name?.trim() &&
        selectedElement.provenance?.component?.trim())),
  );
  const acceptedComponentProjection = useMemo(() => {
    if (
      !hasSelectedComponent ||
      !acceptedActiveFile ||
      typeof acceptedActiveContent !== "string"
    ) {
      return undefined;
    }
    return buildCodeLayerProjection(acceptedActiveContent, {
      source: {
        kind: "design-file",
        ...(id ? { designId: id } : {}),
        fileId: acceptedActiveFile.id,
        ...(acceptedActiveFile.filename
          ? { filename: acceptedActiveFile.filename }
          : {}),
      },
    });
  }, [
    acceptedActiveContent,
    acceptedActiveFile?.filename,
    acceptedActiveFile?.id,
    hasSelectedComponent,
    id,
  ]);
  const componentDetailsReady = useMemo(() => {
    const matchesSelectedComponent = (node: CodeLayerNode) =>
      selectedComponentNodeId !== undefined &&
      isComponentInstance(node) &&
      componentNodeIdMatches(node, selectedComponentNodeId);
    const selectedNodeIsOptimistic = Boolean(
      selectedComponentNodeId &&
      activeCodeLayerProjection.nodes.some(matchesSelectedComponent),
    );
    if (!hasSelectedComponent || !selectedNodeIsOptimistic) return true;
    if (pendingActiveFileEntry && !acceptedComponentProjection) return false;
    if (!acceptedComponentProjection) return true;
    return acceptedComponentProjection.nodes.some(matchesSelectedComponent);
  }, [
    acceptedComponentProjection,
    activeCodeLayerProjection,
    hasSelectedComponent,
    pendingActiveFileEntry,
    selectedComponentNodeId,
  ]);
  const selectedComponentHasLocalOverrides = useMemo(
    () =>
      activeCanvasSourceType === "inline" &&
      componentInstanceHasLocalOverrides(
        activeCodeLayerProjection,
        selectedCodeLayerNode,
      ),
    [activeCanvasSourceType, activeCodeLayerProjection, selectedCodeLayerNode],
  );
  const selectedElementAlreadyComponent = useMemo(() => {
    if (!selectedElement) return false;
    if (
      selectedElement.runtimeComponent &&
      !(selectedCodeLayerNode && isComponentInstance(selectedCodeLayerNode))
    ) {
      return false;
    }
    if (selectedElement.componentAnnotation?.trim()) return true;
    if (selectedElement.componentName?.trim()) return true;
    return codeLayerNodeLooksLikeComponent(selectedCodeLayerNode);
  }, [selectedCodeLayerNode, selectedElement]);
  const selectedElementInsideComponent = useMemo(() => {
    if (!selectedCodeLayerNode) return false;
    const root = linkedComponentRootForNode(
      selectedCodeLayerNode,
      activeCodeLayerProjection,
    );
    return Boolean(root && root.id !== selectedCodeLayerNode.id);
  }, [activeCodeLayerProjection, selectedCodeLayerNode]);

  useEffect(() => {
    clearShaderFillPreview();
  }, [
    activeFile?.id,
    clearShaderFillPreview,
    selectedElement?.selector,
    selectedElement?.sourceId,
  ]);
  useEffect(() => {
    clearShaderFillPreview();
  }, [
    activeInspectorTab,
    clearShaderFillPreview,
    location.pathname,
    location.search,
  ]);
  useEffect(() => {
    window.addEventListener("pagehide", clearShaderFillPreview);
    window.addEventListener("beforeunload", clearShaderFillPreview);
    return () => {
      window.removeEventListener("pagehide", clearShaderFillPreview);
      window.removeEventListener("beforeunload", clearShaderFillPreview);
    };
  }, [clearShaderFillPreview]);

  const defaultComponentName = useMemo(() => {
    if (selectedCodeLayerNode?.layerName)
      return selectedCodeLayerNode.layerName;
    if (selectedElement?.tagName) {
      const tag = selectedElement.tagName;
      return tag.charAt(0).toUpperCase() + tag.slice(1);
    }
    return "Component";
  }, [selectedCodeLayerNode?.layerName, selectedElement?.tagName]);

  const selectedComponentLocalSourceAnchor = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      selectedElement?.runtimeComponent?.writeCapability !==
        "authored-jsx-literal"
    ) {
      return undefined;
    }
    const connectionId =
      (activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "";
    const runtimeComponent = selectedElement.runtimeComponent;
    const sourcePath = projectRelativeSourcePath({
      sourceFile: runtimeComponent.sourceFile,
      rootPath: connectionId
        ? localhostConnectionRootPathByIdRef.current.get(connectionId)
        : undefined,
    });
    if (
      !connectionId ||
      !sourcePath ||
      !runtimeComponent.line ||
      !runtimeComponent.column
    )
      return undefined;
    const runtimeMultiplicity = runtimeMultiplicityForElementProvenance(
      runtimeLayerSnapshotsById,
      selectedElement,
    );
    return {
      connectionId,
      path: sourcePath,
      line: runtimeComponent.line,
      column: runtimeComponent.column,
      positionPrecision: sourcePositionPrecision(runtimeComponent.method),
      runtimeMultiplicity,
      scope:
        runtimeMultiplicity === 1
          ? ("single-instance" as const)
          : ("repeated-render" as const),
    };
  }, [
    activeCanvasSourceType,
    activeOverviewScreen,
    runtimeLayerSnapshotsById,
    selectedElement,
  ]);

  const { data: selectedComponentSource } = useActionQuery<{
    versionHash?: string;
    content?: string;
  }>(
    "read-local-file",
    {
      designId: id ?? "",
      connectionId: selectedComponentLocalSourceAnchor?.connectionId ?? "",
      path: selectedComponentLocalSourceAnchor?.path ?? "",
    },
    {
      enabled: Boolean(
        id && selectedComponentLocalSourceAnchor && canEditDesign,
      ),
      refetchOnMount: "always",
    },
  );

  const selectedComponentLiteralProps = useMemo(() => {
    if (
      !selectedComponentLocalSourceAnchor ||
      typeof selectedComponentSource?.content !== "string"
    ) {
      return undefined;
    }
    const literalProps = readLiteralJsxPropsAtAnchor({
      content: selectedComponentSource.content,
      anchor: selectedComponentLocalSourceAnchor,
    });
    return literalProps?.filter(
      ({ name }) =>
        !name.startsWith("data-agent-native-") &&
        name !== "style" &&
        name !== "className",
    );
  }, [selectedComponentLocalSourceAnchor, selectedComponentSource?.content]);

  const selectedComponentLocalSource = useMemo(() => {
    if (!selectedComponentLocalSourceAnchor) return undefined;
    const expectedVersionHash = selectedComponentSource?.versionHash;
    if (!expectedVersionHash) return undefined;
    const propStamps = (selectedComponentLiteralProps ?? []).map(
      ({ name, value }) => ({
        name: propNameToDataAttribute(name),
        value,
      }),
    );
    return {
      ...selectedComponentLocalSourceAnchor,
      expectedVersionHash,
      ...(propStamps.length > 0 ? { propStamps } : {}),
    };
  }, [
    selectedComponentLocalSourceAnchor,
    selectedComponentSource?.versionHash,
    selectedComponentLiteralProps,
  ]);

  const selectedElementOuterHtml = useMemo(() => {
    if (!selectedElement?.selector) return null;
    return getElementOuterHtml(activeContent, selectedElement.selector);
  }, [activeContent, selectedElement?.selector]);

  const motionSelectedTarget = useMemo<{
    nodeId: string;
    label: string;
  } | null>(() => {
    if (!selectedCodeLayerNode) return null;
    const nodeId =
      selectedCodeLayerNode.dataAttributes["data-agent-native-node-id"]?.trim();
    if (!nodeId) return null;
    const label =
      selectedCodeLayerNode.layerName ||
      selectedElement?.tagName ||
      "Selected element";
    return { nodeId, label };
  }, [selectedCodeLayerNode, selectedElement?.tagName]);

  const markMotionTracksDirty = useCallback(() => {
    setMotionTracksDirty(true);
    setMotionAutosaveRevision((revision) => {
      const next = revision + 1;
      motionAutosaveRevisionRef.current = next;
      motionAutosaveFailedRevisionRef.current = null;
      return next;
    });
  }, []);

  const pruneMotionTracksByNodeId = useCallback(
    (nodeIdsToRemove: Set<string>) => {
      setMotionTracks((current) => {
        const next = current.filter(
          (track) => !nodeIdsToRemove.has(track.targetNodeId),
        );
        if (next.length === current.length) return current;
        markMotionTracksDirty();
        return next;
      });
    },
    [markMotionTracksDirty],
  );

  const handleMotionTracksChange = useCallback(
    (tracks: MotionDockTrack[]) => {
      setMotionTracks(tracks);
      markMotionTracksDirty();
    },
    [markMotionTracksDirty],
  );

  const handleMotionDurationChange = useCallback(
    (durationMs: number) => {
      setMotionDurationMs(durationMs);
      markMotionTracksDirty();
    },
    [markMotionTracksDirty],
  );

  const motionTracksWire = useMemo<MotionTrackWire[]>(() => {
    if (!motionDockOpen || motionTracks.length === 0) return [];
    return motionTracks.map(({ label: _label, ...track }) => track);
  }, [motionDockOpen, motionTracks]);

  const upsertMotionKeyframesFromStyles = useCallback(
    (
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      selector?: string,
    ) => {
      if (!motionDockOpen || !motionAutoKeyframeEnabled) return;
      const info = elementInfo ?? selectedElement ?? undefined;
      const targetNode = info
        ? resolveCodeLayerNodeFromElementInfo(activeCodeLayerProjection, info)
        : selector
          ? resolveCodeLayerNodeFromBridge(activeCodeLayerProjection, selector)
          : selectedCodeLayerNode;
      const targetNodeId =
        targetNode?.dataAttributes["data-agent-native-node-id"]?.trim() ??
        info?.sourceId ??
        selectedCodeLayerNode?.dataAttributes[
          "data-agent-native-node-id"
        ]?.trim();
      if (!targetNodeId) return;

      const activePlayhead = motionLivePlayheadRef.current ?? motionPlayhead;
      let changed = false;
      setMotionTracks((current) => {
        const next = applyMotionAutoKeyframesForStyles(current, {
          targetNodeId,
          styles,
          playheadT: activePlayhead,
          timelineDurationMs: motionDurationMs,
          defaultEase: motionDefaultEase as MotionEase,
        });
        changed = next !== current;
        return next;
      });
      if (changed) markMotionTracksDirty();
    },
    [
      activeCodeLayerProjection,
      markMotionTracksDirty,
      motionAutoKeyframeEnabled,
      motionDefaultEase,
      motionDockOpen,
      motionDurationMs,
      motionPlayhead,
      selectedCodeLayerNode,
      selectedElement,
    ],
  );

  const handleToggleMotionKeyframe = useCallback(
    (cssProperty: string) =>
      runToggleMotionKeyframe(
        {
          canEditDesign,
          markMotionTracksDirty,
          motionDefaultEase,
          motionLivePlayheadRef,
          motionPlayhead,
          selectedCodeLayerNode,
          selectedElement,
          selectedMotionTargetNodeId,
          setMotionTracks,
        },
        cssProperty,
      ),
    [
      canEditDesign,
      markMotionTracksDirty,
      motionDefaultEase,
      motionPlayhead,
      selectedCodeLayerNode,
      selectedElement?.computedStyles,
      selectedElement?.tagName,
      selectedMotionTargetNodeId,
    ],
  );

  const inspectCodeData = useMemo<InspectCodeData | undefined>(() => {
    if (!selectedElement) return undefined;
    return inspectCodeDataForElement(selectedElement, selectedElementOuterHtml);
  }, [selectedElement, selectedElementOuterHtml]);

  const handleCreateComponent = useCallback(
    (name: string) => {
      if (
        !canEditDesign ||
        !id ||
        !activeFileId ||
        !selectedElement ||
        selectedElementInsideComponent
      )
        return;
      if (
        activeCanvasSourceType === "localhost" &&
        selectedElement.runtimeComponent?.writeCapability ===
          "authored-jsx-literal" &&
        !selectedComponentLocalSource
      ) {
        toast.error(t("designEditor.toasts.componentCreateFailed"));
        return;
      }
      const current = linkedComponentMutationQueueRef.current;
      if (current?.designId !== id) return;
      const nodeId = selectedElementLayerId ?? undefined;
      const selector = selectedCanvasSelector ?? selectedElement.selector;
      const run = (retriedAfterConsent = false) =>
        runCreateComponent(
          {
            canEditDesign,
            designId: id,
            fileId: activeFileId,
            selectionBefore: captureCurrentSelection(),
            createComponent: (request) =>
              callAction<CreateComponentActionResult>(
                "create-component",
                request,
              ),
            mutationTransaction: {
              enqueue: (request) =>
                current.queue.enqueueSourceMutation({
                  ...request,
                  validate: createComponentActionChange,
                }),
            },
          },
          {
            nodeId,
            selector,
            name,
            ...(selectedComponentLocalSource
              ? { source: { local: selectedComponentLocalSource } }
              : {}),
          },
        )
          .then((outcome) => {
            if (!outcome) return;
            const source = outcome.result.source;
            if (source) {
              queryClient.setQueryData(
                [
                  "action",
                  "read-local-file",
                  {
                    designId: id,
                    connectionId: source.connectionId,
                    path: source.path,
                  },
                ],
                (previous: { versionHash?: string } | undefined) => ({
                  ...previous,
                  versionHash: source.versionHash,
                }),
              );
            }
            if (!outcome.historyRecorded) {
              toast.error(t("designEditor.toasts.componentCreateFailed"));
              return;
            }
            if (outcome.hostSync === "accepted") {
              toast.success(t("designEditor.toasts.componentCreated"));
            }
          })
          .catch((error: unknown) => {
            if (
              !retriedAfterConsent &&
              selectedComponentLocalSource &&
              isLocalhostWriteConsentError(error)
            ) {
              requestLocalhostWriteRef.current?.({
                files: [selectedComponentLocalSource.path],
                onGranted: () => run(true),
              });
              return;
            }
            toast.error(t("designEditor.toasts.componentCreateFailed"));
          });
      void run();
    },
    [
      canEditDesign,
      activeCanvasSourceType,
      captureCurrentSelection,
      id,
      selectedElement,
      selectedElementLayerId,
      selectedCanvasSelector,
      activeFileId,
      selectedElementInsideComponent,
      selectedComponentLocalSource,
      queryClient,
      t,
    ],
  );

  const handleCreateComponentHotkey = useCallback(() => {
    if (
      !canEditDesign ||
      !id ||
      !selectedElement ||
      selectedElementAlreadyComponent ||
      selectedElementInsideComponent
    ) {
      return;
    }
    handleCreateComponent(defaultComponentName);
  }, [
    canEditDesign,
    id,
    selectedElement,
    selectedElementAlreadyComponent,
    selectedElementInsideComponent,
    handleCreateComponent,
    defaultComponentName,
  ]);

  const hoveredCodeLayerNode = useMemo(() => {
    if (!hoveredElement) return null;
    if (isScreenRootElementInfo(hoveredElement)) return null;
    return resolveCodeLayerNodeFromElementInfo(
      activeCodeLayerProjection,
      hoveredElement,
    );
  }, [activeCodeLayerProjection, hoveredElement]);
  const hoveredCanvasSelectorCandidates = useMemo(() => {
    const runtimeSelector = hoveredElement?.runtimeSelector?.trim();
    const runtimeCandidates = runtimeSelector ? [runtimeSelector] : [];
    if (isScreenRootElementInfo(hoveredElement)) return [];
    if (hoveredCodeLayerNode) {
      return Array.from(
        new Set([
          ...runtimeCandidates,
          ...codeLayerSelectorAliases(hoveredCodeLayerNode),
        ]),
      );
    }
    return runtimeCandidates.concat(
      hoveredElement?.selector && hoveredElement.selector !== runtimeSelector
        ? [hoveredElement.selector]
        : [],
    );
  }, [hoveredCodeLayerNode, hoveredElement]);
  const hoveredCanvasSelector = hoveredCanvasSelectorCandidates[0] ?? null;
  const hoveredElementIsScreenRoot = isScreenRootElementInfo(hoveredElement);
  const hoveredScreenRootId = hoveredElementIsScreenRoot
    ? hoveredElementScreenId
    : null;
  const hoveredChildScreenId = hoveredElementIsScreenRoot
    ? null
    : hoveredElementScreenId;
  const nonActiveProjectionCacheRef = useRef<
    Map<string, { contentRef: string; projection: CodeLayerProjection }>
  >(new Map());
  const runtimeProjectionCacheRef = useRef<
    Map<string, { contentRef: string; projection: CodeLayerProjection }>
  >(new Map());
  const getCodeLayerProjectionForScreen = useCallback(
    (screenId: string) => {
      if (!fileContentById.has(screenId)) return null;
      const content = getProjectionContentForScreen(screenId);
      const cache = nonActiveProjectionCacheRef.current;
      if (screenId === activeFile?.id) {
        cache.set(screenId, {
          contentRef: content,
          projection: activeCodeLayerProjection,
        });
        return activeCodeLayerProjection;
      }
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const source = codeLayerSourceForScreen(screenId);
      let projection = preparedSourceProjection(screenId, content, source);
      if (!projection) {
        recordDesignPerformance("buildCodeLayerProjection");
        projection = buildCodeLayerProjection(content, { source });
      }
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      codeLayerSourceForScreen,
      fileContentById,
      getProjectionContentForScreen,
    ],
  );
  const getRuntimeCodeLayerProjection = useCallback(
    (screenId: string, content: string): CodeLayerProjection => {
      const cache = runtimeProjectionCacheRef.current;
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId, "inline-html"),
      });
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [codeLayerSourceForScreen],
  );

  const replacePreviewContent = useCallback(
    (
      nextContent: string,
      selector?: string | null,
      options: { forceFullDocument?: boolean } = {},
    ): PreviewContentReplaceResult => {
      if (isStandaloneHttpUrl(nextContent)) {
        return "skipped-live-route";
      }
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return "unavailable";
      const replaced = replaceContent(
        nextContent,
        selector ?? selectedCanvasSelector,
        selectedCanvasSelectorCandidates,
        {
          forceFullDocument: options.forceFullDocument === true,
        },
      );
      if (replaced && activeFile?.id) {
        livePreviewContentRef.current = {
          fileId: activeFile.id,
          content: nextContent,
        };
      }
      return replaced ? "applied" : "unavailable";
    },
    [
      activeFile?.id,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedElement,
    ],
  );

  const syncLiveScreenSnapshotPreview = useCallback(
    (screenId: string, html: string) => {
      if (screenId !== activeFile?.id) return;
      if (
        previewContentReplaceNeedsRenderFallback(
          replacePreviewContent(html, null, { forceFullDocument: true }),
        )
      ) {
        setContentRenderRevision((revision) => revision + 1);
      }
    },
    [activeFile?.id, replacePreviewContent],
  );

  const deleteRuntimeElement = useCallback(
    (
      selector?: string | null,
      candidates?: readonly string[],
      requestId?: string,
    ) => {
      const deleteElement = (window as any).__designCanvasDeleteElement;
      if (typeof deleteElement !== "function") return false;
      return Boolean(
        deleteElement(
          selector ?? selectedCanvasSelector,
          candidates ?? selectedCanvasSelectorCandidates,
          requestId,
        ),
      );
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates],
  );

  const publishAuthoritativeClipboardMutation = useCallback(
    (args: {
      fileId: string;
      baseContent: string;
      nextContent: string;
      origin: ClipboardContentMutationOrigin;
      baseSource?: "lineage" | "document";
    }): ClipboardContentMutationPublication | null => {
      const current = latestClipboardMutationContentRef.current.get(
        args.fileId,
      );
      const nextLineage = publishClipboardContentMutation({
        current,
        fileId: args.fileId,
        fileType: rawServerFilesByIdRef.current.get(args.fileId)?.fileType,
        baseContentHash: sourceContentHash(args.baseContent),
        nextContent: args.nextContent,
        origin: args.origin,
        baseSource: args.baseSource,
      });
      if (!nextLineage) return null;
      latestClipboardMutationContentRef.current.set(args.fileId, nextLineage);
      return {
        mutationId: nextLineage.mutationId,
        contentHash: nextLineage.contentHash,
        origin: nextLineage.origin,
      };
    },
    [],
  );

  const acknowledgeAuthoritativeClipboardMutation = useCallback(
    (args: {
      fileId: string;
      nextContent: string;
      publication?: ClipboardContentMutationPublication;
    }) => {
      const nextLineage = acknowledgeClipboardContentMutation({
        current: latestClipboardMutationContentRef.current.get(args.fileId),
        nextContent: args.nextContent,
        nextContentHash: sourceContentHash(args.nextContent),
        publication: args.publication,
      });
      if (nextLineage) {
        latestClipboardMutationContentRef.current.set(args.fileId, nextLineage);
      }
    },
    [],
  );

  const sourceBaseForPublication = useCallback(
    (fileId: string, beforeContent: string) => {
      const pending = pendingLocalFileContentsRef.current.get(fileId);
      return resolveSourceBaseForPublication({
        fileId,
        fileType: rawServerFilesByIdRef.current.get(fileId)?.fileType,
        pending,
        collabContent:
          collabContentFileIdRef.current === fileId
            ? collabContentRef.current
            : null,
        persistedContent: rawServerFilesByIdRef.current.get(fileId)?.content,
        beforeContent,
      });
    },
    [],
  );

  const applyLocalContentUpdate = useCallback(
    (
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        immediateSave?: boolean;
        awaitSave?: boolean;
        persist?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        sourceBaseContent?: string;
        identityMigrationSourceContent?: string;
        shaderWriteCompletion?: true;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
      } = {},
    ) => {
      if (
        options.persist !== false &&
        !canApplyContentEdit(activeFile?.id ?? "active")
      ) {
        return { status: "refused" as const };
      }
      const result = runApplyLocalContentUpdate(
        {
          acknowledgeAuthoritativeClipboardMutation,
          activeFile,
          canEditDesignRef,
          cancelQueuedFileContentSave,
          clearPendingLocalFileContent,
          collabContentFileIdRef,
          collabContentRef,
          id,
          isSynced,
          lastLocalContentRef,
          latestActiveContentRef,
          markPendingLocalFileContent,
          queryClient,
          queueFileContentSave,
          recordContentHistoryEntry,
          recordLocalContentHistoryChangeFallback,
          recordLocalContentHistoryEntry,
          replacePreviewContent,
          setCollabContent,
          setCollabContentFileId,
          setContentRenderRevision,
          suppressContentHistoryRef,
          t,
          undoManagerRef,
          viewModeRef,
          ydoc,
        },
        nextContent,
        {
          ...options,
          sourceBaseContent:
            options.sourceBaseContent ??
            sourceBaseForPublication(
              activeFile?.id ?? "",
              options.historyBeforeContent ??
                getScreenContent(activeFile?.id ?? ""),
            ),
        },
      );
      if (result.status === "accepted") invalidateRenderedElementInfo();
      return result;
    },
    [
      sourceBaseForPublication,
      canApplyContentEdit,
      getScreenContent,
      activeFile,
      acknowledgeAuthoritativeClipboardMutation,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      id,
      isSynced,
      markPendingLocalFileContent,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      syncUndoRedoState,
      t,
      ydoc,
      invalidateRenderedElementInfo,
    ],
  );

  const applyFileContentUpdate = useCallback(
    (
      fileId: string,
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        immediateSave?: boolean;
        awaitSave?: boolean;
        persist?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        sourceBaseContent?: string;
        identityMigrationSourceContent?: string;
        shaderWriteCompletion?: true;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
      } = {},
    ) => {
      if (options.persist !== false && !canApplyContentEdit(fileId)) {
        return { status: "refused" as const };
      }
      const result = runApplyFileContentUpdate(
        {
          acknowledgeAuthoritativeClipboardMutation,
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          canEditDesignRef,
          cancelQueuedFileContentSave,
          clearPendingLocalFileContent,
          files,
          getScreenContent,
          id,
          markPendingLocalFileContent,
          overviewIsSynced,
          overviewPresenceFileId,
          overviewYdoc,
          queryClient,
          queueFileContentSave,
          recordContentHistoryEntry,
          suppressContentHistoryRef,
          t,
        },
        fileId,
        nextContent,
        {
          ...options,
          sourceBaseContent:
            options.sourceBaseContent ??
            sourceBaseForPublication(
              fileId,
              options.historyBeforeContent ?? getScreenContent(fileId),
            ),
        },
      );
      if (result.status === "accepted") invalidateRenderedElementInfo();
      return result;
    },
    [
      sourceBaseForPublication,
      canApplyContentEdit,
      getScreenContent,
      activeFile?.id,
      acknowledgeAuthoritativeClipboardMutation,
      applyLocalContentUpdate,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      files,
      id,
      markPendingLocalFileContent,
      overviewIsSynced,
      overviewPresenceFileId,
      overviewYdoc,
      queryClient,
      queueFileContentSave,
      recordContentHistoryEntry,
      t,
      invalidateRenderedElementInfo,
    ],
  );

  const applyFileContentUpdateRef = useRef(applyFileContentUpdate);
  applyFileContentUpdateRef.current = applyFileContentUpdate;

  type LinkedComponentQueueRuntime = Omit<
    LinkedComponentMutationQueueArgs,
    "fileSaveChainsRef" | "pendingFileSavesRef"
  >;
  const linkedComponentQueueRuntimeRef =
    useRef<LinkedComponentQueueRuntime | null>(null);
  linkedComponentQueueRuntimeRef.current = id
    ? {
        designId: id,
        fileIds: () =>
          files
            .filter((file) => file.fileType === "html")
            .map((file) => file.id),
        getContent: getUnprojectedScreenContent,
        getSourceBaseContent: (fileId) =>
          sourceBaseForPublication(fileId, getUnprojectedScreenContent(fileId)),
        projectEdit: (fileId, nodeId, edit, contentByFileId) =>
          projectLinkedComponentPropertyEdit({
            documents: files
              .filter((file) => file.fileType === "html")
              .map((file) => ({
                source: {
                  kind: "design-file" as const,
                  designId: id,
                  fileId: file.id,
                  filename: file.filename,
                },
                content: contentByFileId.get(file.id) ?? "",
              })),
            fileId,
            nodeId,
            edit,
          }),
        canonicalizeSourceContent: (fileId, content) =>
          prepareCanonicalSourceContent(content, {
            fileId,
            fileType: rawServerFilesByIdRef.current.get(fileId)?.fileType,
          }).content,
        flushPendingSaves: flushPendingFileContentSavesForBackground,
        hasPendingSave: (fileId) =>
          Boolean(
            pendingFileSavesRef.current[fileId] ||
            fileSaveTimersRef.current[fileId],
          ),
        getPendingSave: (fileId) => latestFileSaveForUnloadRef.current[fileId],
        invokeAction: (payload) =>
          callAction<LinkedComponentActionResult>(
            "apply-component-prop-edit",
            payload as any,
          ),
        applyFileContentUpdate: (fileId, content, options) =>
          applyFileContentUpdate(fileId, content, options),
        applySelection: (selection) => {
          const cached = queryClient.getQueryData<{ files: DesignFile[] }>([
            "action",
            "get-design",
            { id },
          ]);
          const file = cached?.files.find(
            (file) => file.id === selection.fileId,
          );
          if (typeof file?.content !== "string") {
            throw new Error(
              "The saved component file is unavailable for selection.",
            );
          }
          const { snapshot, nodes } = resolveLinkedComponentSelection({
            ...selection,
            content: file.content,
            previous: captureCurrentSelection(),
          });
          flushSync(() => {
            restoreSelectionSnapshot(snapshot);
            setSelectedElement(
              nodes.length === 1
                ? elementInfoFromCodeLayerNode(nodes[0]!)
                : null,
            );
            pendingOverviewLayerSelectionRef.current =
              nodes.length === 1 ? nodes[0]!.id : null;
          });
          return snapshot;
        },
        getCurrentSelection: captureCurrentSelection,
        reserveContentHistory: (selectionBefore) => {
          undoManagerRef.current?.stopCapturing();
          const reservation = reserveLinkedComponentContentHistory({
            stack: contentUndoStackRef,
            selections: contentUndoSelectionStackRef,
            order: historyOrderRef,
            selection: selectionBefore ?? captureCurrentSelection(),
            after: contentHistorySelectionAfterRef,
            clearRedoStacks,
          });
          syncUndoRedoState();
          return reservation;
        },
        waitForHostWrites: async (fileIds) => {
          await Promise.all(fileIds.map(waitForShaderWriteToSettle));
        },
        syncUndoRedoState,
        refreshAfterConflict: () =>
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design", { id }],
          }),
        reportFailure: (message) =>
          toast.error(message, {
            id: `linked-component:${id}`,
            duration: 4000,
          }),
      }
    : null;
  if (id && linkedComponentMutationQueueRef.current?.designId !== id) {
    const currentRuntime = (): LinkedComponentQueueRuntime => {
      const runtime = linkedComponentQueueRuntimeRef.current;
      if (!runtime || runtime.designId !== id) {
        throw new Error(
          "The design changed while this component edit was running.",
        );
      }
      return runtime;
    };
    const currentRuntimeIfActive = (): LinkedComponentQueueRuntime | null => {
      const runtime = linkedComponentQueueRuntimeRef.current;
      return runtime?.designId === id ? runtime : null;
    };
    linkedComponentMutationQueueRef.current = {
      designId: id,
      queue: createLinkedComponentMutationQueue({
        designId: id,
        fileIds: () => currentRuntime().fileIds(),
        getContent: (fileId) => currentRuntime().getContent(fileId),
        getSourceBaseContent: (fileId) =>
          currentRuntime().getSourceBaseContent(fileId),
        projectEdit: (fileId, nodeId, edit, contentByFileId) =>
          currentRuntime().projectEdit?.(
            fileId,
            nodeId,
            edit,
            contentByFileId,
          ) ?? null,
        canonicalizeSourceContent: (fileId, content) =>
          currentRuntime().canonicalizeSourceContent(fileId, content),
        flushPendingSaves: () => currentRuntime().flushPendingSaves(),
        hasPendingSave: (fileId) => currentRuntime().hasPendingSave(fileId),
        getPendingSave: (fileId) => currentRuntime().getPendingSave(fileId),
        fileSaveChainsRef,
        pendingFileSavesRef,
        invokeAction: (payload) => currentRuntime().invokeAction(payload),
        applyFileContentUpdate: (fileId, content, options) =>
          currentRuntime().applyFileContentUpdate(fileId, content, options),
        applySelection: (selection) =>
          currentRuntime().applySelection?.(selection),
        getCurrentSelection: () => currentRuntime().getCurrentSelection(),
        reserveContentHistory: (selectionBefore) =>
          currentRuntime().reserveContentHistory(selectionBefore),
        waitForHostWrites: (fileIds) =>
          currentRuntime().waitForHostWrites(fileIds),
        syncUndoRedoState: () => currentRuntimeIfActive()?.syncUndoRedoState(),
        refreshAfterConflict: () =>
          currentRuntimeIfActive()?.refreshAfterConflict(),
        reportFailure: (message) =>
          currentRuntimeIfActive()?.reportFailure(message),
      }),
    };
  }
  const applyLinkedComponentEdit = useCallback(
    (
      fileId: string,
      nodeId: string,
      edit: LinkedComponentEdit,
      selectionBefore?: GeometryHistorySelection,
      onApplied?: () => void,
    ) => {
      const current = linkedComponentMutationQueueRef.current;
      if (!id || current?.designId !== id) {
        toast.error(t("designEditor.patchProof.selectorMissing"), {
          duration: 4000,
        });
        return;
      }
      void current.queue
        .enqueue(fileId, nodeId, edit, selectionBefore, onApplied)
        .catch(() => {});
    },
    [id, t],
  );

  useEffect(
    () =>
      runMotionAutosave({
        activeContent,
        activeFile,
        applyFileContentUpdate,
        applyMotionEdit,
        clearMotionAutosaveTimer,
        getScreenContent,
        id,
        lastLocalContentRef,
        lastScheduledMotionAutosaveRevisionRef,
        latestActiveContentRef,
        motionAutosaveFailedRevisionRef,
        motionAutosaveFlushRef,
        motionAutosavePending,
        motionAutosaveRevision,
        motionAutosaveRevisionRef,
        motionAutosaveTimerRef,
        motionDefaultEase,
        motionDurationMs,
        motionTimelineId,
        motionTracks,
        motionTracksDirty,
        previousMotionFileIdRef,
        queryClient,
        removeMotionTimeline,
        removeMotionTimelineMutation,
        setMotionHydrationFingerprint,
        setMotionTimelineId,
        setMotionTracksDirty,
      }),
    [
      activeFile?.id,
      activeFile?.updatedAt,
      activeContent,
      applyFileContentUpdate,
      applyMotionEdit,
      clearMotionAutosaveTimer,
      getScreenContent,
      id,
      motionAutosaveRevision,
      motionAutosavePending,
      motionDefaultEase,
      motionDurationMs,
      motionTimelineId,
      motionTracks,
      motionTracksDirty,
      queryClient,
      removeMotionTimeline,
      removeMotionTimelineMutation.isPending,
    ],
  );

  const handleComponentPropApplied = useMemo(
    () =>
      createPersistedContentHostSyncHandler({
        activeFileIdRef,
        applyFileContentUpdateRef,
      }),
    [],
  );
  const handleShaderSourceApplied = useMemo(
    () =>
      createPersistedContentHostSyncHandler({
        activeFileIdRef,
        applyFileContentUpdateRef,
        shaderWriteCompletion: true,
      }),
    [],
  );

  const handleGoToMainComponentMenuAction = useCallback(() => {
    if (!id || !selectedInstanceActionNodeId) return;
    goToMainComponentMutation.mutate(
      {
        designId: id,
        nodeId: selectedInstanceActionNodeId,
        fileId: activeFileId ?? undefined,
      },
      {
        onSuccess: (result: {
          isMain?: boolean;
          ctaRequired?: boolean;
          ctaMessage?: string;
          note?: string;
        }) => {
          if (result.ctaRequired) {
            toast.error(
              result.ctaMessage ??
                t("designEditor.componentInstances.goToMainUnavailable"),
            );
            return;
          }
          if (result.isMain) {
            toast(
              result.note ??
                t("designEditor.componentInstances.onlyKnownInstance"),
            );
          }
        },
        onError: () =>
          toast.error(t("designEditor.componentInstances.resolveMainFailed")),
      },
    );
  }, [
    activeFileId,
    goToMainComponentMutation,
    id,
    selectedInstanceActionNodeId,
    t,
  ]);

  const handleDetachInstanceMenuAction = useCallback(
    () =>
      runDetachInstanceMenuAction({
        activeContent,
        activeFile,
        activeFileId,
        detachComponentInstanceMutation,
        handleComponentPropApplied,
        id,
        selectedComponentNodeId: selectedInstanceActionNodeId,
        t,
      }),
    [
      activeFileId,
      activeContent,
      activeFile?.updatedAt,
      detachComponentInstanceMutation,
      handleComponentPropApplied,
      id,
      selectedInstanceActionNodeId,
      t,
    ],
  );

  const handleSwapInstanceMenuAction = useCallback(() => {
    if (!id || !selectedInstanceActionNodeId) return;
    setUiHidden(false);
    setMode("edit");
    setActiveInspectorTab("design");
    setComponentSwapPickerRequest((request) => request + 1);
  }, [id, selectedInstanceActionNodeId]);

  const handleReviewFixApplied = useCallback(
    (
      _finding: A11yFinding,
      result?: { fileId?: string; patchedContent?: string },
    ) => {
      setReviewFindings((prev) =>
        prev.filter((finding) => finding.id !== _finding.id),
      );
      if (
        typeof result?.fileId === "string" &&
        typeof result.patchedContent === "string"
      ) {
        applyFileContentUpdate(
          result.fileId,
          result.patchedContent,
          getPersistedContentHostSyncOptions({
            fileId: result.fileId,
            activeFileId: activeFile?.id ?? null,
          }),
        );
      }
      void handleRunDesignAudit();
    },
    [activeFile?.id, applyFileContentUpdate, handleRunDesignAudit],
  );

  const resolvedReviewPanelProps = useMemo<
    Omit<ReviewPanelProps, "className"> | undefined
  >(() => {
    if (!designReviewPanelEnabled || !id || !activeFile || shellMode) {
      return undefined;
    }
    const reviewMatchesActiveFile = reviewFileId === activeFile.id;
    return {
      findings: reviewMatchesActiveFile ? reviewFindings : [],
      auditLoading: reviewMatchesActiveFile ? reviewAuditLoading : false,
      auditedAt: reviewMatchesActiveFile ? reviewAuditedAt : null,
      auditError: reviewMatchesActiveFile ? reviewAuditError : null,
      onRunAudit: handleRunDesignAudit,
      onFindingClick: handleReviewFindingClick,
      fixSource: {
        designId: id,
        fileId: activeFile.id,
        filename: activeFile.filename,
      },
      onFixApplied: handleReviewFixApplied,
    };
  }, [
    activeFile,
    designReviewPanelEnabled,
    handleReviewFindingClick,
    handleReviewFixApplied,
    handleRunDesignAudit,
    id,
    reviewAuditError,
    reviewAuditLoading,
    reviewAuditedAt,
    reviewFileId,
    reviewFindings,
    shellMode,
  ]);

  const dispatchReviewFeedbackToAgent = useCallback(
    (root: ReviewComment, replies: ReviewComment[] = []) => {
      if (!id) return;
      const replyText = replies
        .map((reply) => `${reply.authorName ?? "Reviewer"}: ${reply.body}`)
        .join("\n");
      sendToDesignAgentChat({
        message: "Apply this selected design review thread only.", // i18n-ignore agent dispatch prompt
        context: [
          `Design id: ${id}`,
          `Review thread id: ${root.threadId}`,
          `Screen id: ${root.targetId ?? "unknown"}`,
          `Feedback: ${root.body}`,
          replyText ? `Replies:\n${replyText}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        submit: true,
        openSidebar: true,
        newTab: true,
      });
    },
    [id],
  );

  const handleDispatchCommentToAgent = useCallback(
    (comment: ReviewComment) => {
      if (!canEditDesign) return;
      dispatchReviewFeedbackToAgent(comment);
    },
    [canEditDesign, dispatchReviewFeedbackToAgent],
  );

  const handleSendReviewThreadToAgent = useCallback(
    (thread: ReviewThread) => {
      if (
        !id ||
        !canEditDesign ||
        thread.root.status !== "open" ||
        reviewSendingThreadId
      ) {
        return;
      }
      setReviewSendingThreadId(thread.root.threadId);
      sendReviewThreadToAgent.mutate(
        {
          resourceType: "design",
          resourceId: id,
          threadId: thread.root.threadId,
        },
        {
          onSuccess: () => {
            dispatchReviewFeedbackToAgent(thread.root, thread.replies);
          },
          onError: () => {
            setReviewSendingThreadId(null);
            toast.error(t("review.sendToAgentFailed"));
          },
        },
      );
    },
    [
      canEditDesign,
      dispatchReviewFeedbackToAgent,
      id,
      reviewSendingThreadId,
      sendReviewThreadToAgent,
      t,
    ],
  );

  const handleReviewThreadSelect = useCallback(
    (thread: ReviewThread) => {
      const targetId = thread.root.targetId;
      if (
        shouldClearSelectionForReviewThreadTarget({
          activeFileId: activeFile?.id,
          targetId,
          boardFileId,
        })
      ) {
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        setHoveredElement(null);
        setHoveredElementScreenId(null);
        setOverviewClearSelectionRequest((request) => request + 1);
      }
      const boardTarget = targetId === null;
      if (targetId || boardTarget) {
        viewModeRef.current = "overview";
        setViewMode("overview");
        setActiveFileId(boardTarget ? (boardFileId ?? null) : targetId);
        setOverviewSelectedScreenIds(boardTarget ? [] : [targetId]);
        setSelectedLayerIdsState(boardTarget ? [] : [targetId]);
        setMode("edit");
      }
      setActiveInspectorTab("comments");
      reviewFocusNonceRef.current += 1;
      setReviewFocusRequest({
        nonce: reviewFocusNonceRef.current,
        anchor: thread.root.anchor,
        targetId,
        threadId: thread.root.threadId,
      });
    },
    [activeFile?.id, boardFileId],
  );

  useEffect(() => {
    if (!id || reviewResult.isLoading) return;
    const threadId = reviewThreadIdFromHash(location.hash);
    if (!threadId) return;
    const hashKey = `${id}:${threadId}`;
    if (openedReviewHashRef.current === hashKey) return;
    const thread = buildReviewThreads(reviewComments).find(
      (candidate) => candidate.root.threadId === threadId,
    );
    if (!thread) return;
    openedReviewHashRef.current = hashKey;
    handleReviewThreadSelect(thread);
  }, [
    handleReviewThreadSelect,
    id,
    location.hash,
    reviewComments,
    reviewResult.isLoading,
  ]);

  const reviewCommentsPanelProps = useMemo<
    ReviewCommentsPanelProps | undefined
  >(
    () =>
      id
        ? {
            designId: id,
            canComment: canCommentDesign,
            currentUserEmail: session?.email,
            currentTargetId:
              activeFile?.id === boardFileId ? null : activeFile?.id,
            canResolve: canEditDesign,
            canDeleteComment: (comment) =>
              canEditDesign ||
              ("canDelete" in comment && comment.canDelete === true) ||
              comment.authorEmail === session?.email,
            signInHref: signInToCommentHref,
            canDispatchToAgent: canEditDesign,
            sendingThreadId: reviewSendingThreadId,
            onSendThreadToAgent: canEditDesign
              ? handleSendReviewThreadToAgent
              : undefined,
            onSelectThread: handleReviewThreadSelect,
          }
        : undefined,
    [
      canCommentDesign,
      canEditDesign,
      activeFile?.id,
      handleReviewThreadSelect,
      handleSendReviewThreadToAgent,
      id,
      reviewSendingThreadId,
      session?.email,
      signInToCommentHref,
    ],
  );

  const handleCreatePrimitive = useCallback(
    (
      screenId: string,
      primitive: CanvasPrimitiveInsert,
      options?: {
        reparentTargetIdentity?: ScreenProjectionNodeIdentity;
      },
    ) =>
      runCreatePrimitive(
        {
          activeBreakpointWidthState,
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canvasBackground: canvasBackgroundRef.current,
          canEditDesign,
          files,
          getScreenContent,
          pendingTextCreationHistoryRef,
          pendingTextEditNodeIdRef,
          overviewScreens,
          runtimeStructureInsertRevisionRef,
          setRuntimeStructureInsertRequest,
          t,
          viewModeRef,
        },
        screenId,
        primitive,
        options,
      ),
    [
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getScreenContent,
      overviewScreens,
      t,
    ],
  );

  const removeEmptyTextNodeIfUntouched = useCallback(
    (
      screenId: string | null,
      nodeId: string,
    ):
      | "removed"
      | "kept-has-content"
      | "node-absent"
      | "content-unavailable"
      | "no-screen"
      | "remove-failed" => {
      if (!screenId) return "no-screen";
      const content = getScreenContent(screenId);
      if (!content) return "content-unavailable";
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId),
      });
      const node = projection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === nodeId ||
          n.id === nodeId,
      );
      if (!node) return "node-absent";
      const hasContent = (node.textSnippet ?? "").trim().length > 0;
      if (hasContent) return "kept-has-content";
      const nextContent = removeCodeLayerNodeFromHtml(content, node);
      if (!nextContent || nextContent === content) return "remove-failed";
      const finalizedCreation = prepareTextCreationFinalization(
        screenId,
        [nodeId, node.id, node.dataAttributes["data-agent-native-node-id"]],
        nextContent,
      );
      const publication = applyFileContentUpdate(screenId, nextContent, {
        refreshPreview: false,
        recordHistory: !finalizedCreation.historyHandled,
      });
      if (publication.status !== "accepted") return "remove-failed";
      finalizedCreation.confirm();
      setSelectedLayerIdsState((current) =>
        current.filter((id) => id !== node.id),
      );
      setSelectedElement((current) =>
        current?.sourceId === nodeId || current?.id === nodeId ? null : current,
      );
      return "removed";
    },
    [
      applyFileContentUpdate,
      codeLayerSourceForScreen,
      prepareTextCreationFinalization,
      getScreenContent,
    ],
  );

  const removeEmptyTextNodeWithRetry = useCallback(
    (screenId: string | null, nodeId: string) => {
      const attempt = (remaining: number) => {
        const outcome = removeEmptyTextNodeIfUntouched(screenId, nodeId);
        if (outcome !== "node-absent" && outcome !== "content-unavailable") {
          return;
        }
        if (remaining <= 0) {
          console.warn(
            `[design] could not resolve empty text node ${screenId}/${nodeId} to clean up (${outcome})`,
          );
          return;
        }
        window.setTimeout(
          () => attempt(remaining - 1),
          EMPTY_TEXT_CLEANUP_RETRY_MS,
        );
      };
      attempt(EMPTY_TEXT_CLEANUP_MAX_ATTEMPTS - 1);
    },
    [removeEmptyTextNodeIfUntouched],
  );

  const handlePrimitiveCreated = useCallback(
    (
      screenId: string,
      nodeId: string,
      options?: {
        nextTool?: "move" | "pen";
        preserveActiveTool?: boolean;
      },
    ) =>
      runPrimitiveCreated(
        {
          activeLeftPanel,
          boardFileId,
          clearPendingOverviewLayerSelectionTimer,
          pendingEmptyTextEditRef,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          pendingTextEditNodeIdRef,
          layersRevealedForFirstCreateRef,
          removeEmptyTextNodeWithRetry,
          setActiveFileId,
          setActiveLeftPanel,
          setActiveTool,
          setCreatedOverviewLayerSelection,
          setHoveredElement,
          setMode,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
        },
        screenId,
        nodeId,
        options,
      ),
    [
      activeLeftPanel,
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      removeEmptyTextNodeWithRetry,
    ],
  );

  useEffect(() => {
    const pending = pendingEmptyTextEditRef.current;
    if (!endedTextEditMatchesPendingCreation(pending, textEditingState)) return;
    pending?.cancel();
  }, [
    textEditingState.active,
    textEditingState.screenId,
    textEditingState.sourceId,
  ]);

  const handleBoardDrawPrimitive = useCallback(
    (
      primitive: CanvasPrimitiveInsert,
      options?: {
        nextTool?: "move" | "pen";
        reparentTargetIdentity?: ScreenProjectionNodeIdentity;
      },
    ) => {
      if (!boardFileId || !canEditDesign) return false;
      const result = handleCreatePrimitive(
        boardFileId,
        primitive,
        options?.reparentTargetIdentity
          ? { reparentTargetIdentity: options.reparentTargetIdentity }
          : undefined,
      );
      if (!result) return false;
      const nodeId =
        typeof result === "string"
          ? result
          : typeof result === "object"
            ? result.nodeId
            : primitive.nodeId;
      if (nodeId) {
        handlePrimitiveCreated(boardFileId, nodeId, options);
      }

      return typeof result === "object"
        ? result
        : typeof result === "string"
          ? result
          : true;
    },
    [boardFileId, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  const handleSingleScreenCreatePrimitive = useCallback(
    (spec: CreatePrimitiveSpec) => {
      if (!activeFile || !canEditDesign) return false;
      const nodeId = uniqueLayerId(spec.tool === "pen" ? "path" : spec.tool);
      const primitive = createPrimitiveInsertFromSpec(spec, nodeId);
      if (!primitive) return false;
      const result = handleCreatePrimitive(activeFile.id, primitive);
      if (!result) return false;
      const resultNodeId = typeof result === "string" ? result : nodeId;
      handlePrimitiveCreated(activeFile.id, resultNodeId, {
        nextTool:
          spec.nextTool ??
          (spec.tool === "pen" && spec.preserveActiveTool !== false
            ? "pen"
            : undefined),
        preserveActiveTool: spec.preserveActiveTool,
      });
      return resultNodeId;
    },
    [activeFile, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  const handleUpdatePenPath = useCallback(
    (screenId: string, nodeId: string, path: PenPath) => {
      if (!canEditDesign) return false;
      const baseContent = getScreenContent(screenId);
      if (!baseContent) return false;
      const nextContent = writeBackVectorEditedPenPath(
        baseContent,
        nodeId,
        path,
      );
      if (nextContent === null) return false;
      if (nextContent === baseContent) return true;
      return (
        applyFileContentUpdate(screenId, nextContent, {
          skipPreview: screenId !== activeFile?.id,
          historyBeforeContent: baseContent,
        }).status === "accepted"
      );
    },
    [activeFile?.id, applyFileContentUpdate, canEditDesign, getScreenContent],
  );

  const handleVectorEditChange = useCallback(
    (nextPath: PenPath, phase: "preview" | "commit") => {
      const current = vectorEditingState;
      if (!current) return false;
      let primitiveSource = current.primitiveSource;
      if (phase === "commit") {
        const baseContent = getScreenContent(current.screenId);
        if (!baseContent) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return false;
        }

        const sourcePath = translatePenPath(
          nextPath,
          -current.sourceOffset.x,
          -current.sourceOffset.y,
        );
        const nextContent = current.primitiveSource
          ? writeBackPrimitiveAsVector(
              baseContent,
              current.nodeId,
              sourcePath,
              current.primitiveSource.geometry,
              current.primitiveSource.fill,
            )
          : writeBackVectorEditedPenPath(
              baseContent,
              current.nodeId,
              sourcePath,
            );
        if (nextContent === null) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return false;
        }
        if (nextContent !== baseContent) {
          const result = applyFileContentUpdate(current.screenId, nextContent, {
            skipPreview: current.screenId !== activeFile?.id,
            historyBeforeContent: baseContent,
          });
          if (result.status !== "accepted") return false;
          if (current.primitiveSource) primitiveSource = null;
        }
      }
      setVectorEditingState((latest) =>
        latest?.layerId === current.layerId
          ? { ...latest, path: nextPath, primitiveSource }
          : latest,
      );
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      getScreenContent,
      t,
      vectorEditingState,
    ],
  );

  const handleVectorEditExit = useCallback(() => {
    setVectorEditingState(null);
  }, []);

  const handleVectorAnchorSelection = useCallback(
    (selectedAnchorIndex: number | null) => {
      setVectorEditingState((current) =>
        current ? { ...current, selectedAnchorIndex } : current,
      );
    },
    [],
  );

  const handleVectorCornerRadiusChange = useCallback(
    (radius: number, phase: "preview" | "commit") => {
      setVectorEditingState((current) => {
        if (!current || current.selectedAnchorIndex === null) return current;
        const nextPath = setPenNodeCornerRadius(
          current.path,
          current.selectedAnchorIndex,
          radius,
        );
        if (!nextPath) return current;
        if (
          (current.path.nodes[current.selectedAnchorIndex]?.cornerRadius ??
            0) ===
          (nextPath.nodes[current.selectedAnchorIndex]?.cornerRadius ?? 0)
        ) {
          return current;
        }
        if (phase === "commit") {
          const baseContent = getScreenContent(current.screenId);
          if (!baseContent) {
            toast.error(t("designEditor.toasts.vectorEditUnsupported"));
            return current;
          }
          const sourcePath = translatePenPath(
            nextPath,
            -current.sourceOffset.x,
            -current.sourceOffset.y,
          );
          const nextContent = writeBackVectorEditedPenPath(
            baseContent,
            current.nodeId,
            sourcePath,
          );
          if (nextContent === null) {
            toast.error(t("designEditor.toasts.vectorEditUnsupported"));
            return current;
          }
          if (nextContent !== baseContent) {
            applyFileContentUpdate(current.screenId, nextContent, {
              skipPreview: current.screenId !== activeFile?.id,
              historyBeforeContent: baseContent,
            });
          }
        }
        return { ...current, path: nextPath };
      });
    },
    [activeFile?.id, applyFileContentUpdate, getScreenContent, t],
  );

  useEffect(() => {
    if (
      vectorEditingState &&
      !selectedLayerIdsState.includes(vectorEditingState.layerId)
    ) {
      setVectorEditingState(null);
    }
  }, [selectedLayerIdsState, vectorEditingState]);

  const vectorEditOverlayState = useMemo<VectorEditOverlayState | null>(() => {
    if (!vectorEditingState) return null;
    const originCanvas = getScreenFrameOriginCanvas({
      screenId: vectorEditingState.screenId,
      overviewScreens,
      canvasFrameGeometryById,
      boardFileId,
    });
    if (!originCanvas) return null;
    return {
      path: vectorEditingState.path,
      selectedAnchorIndex: vectorEditingState.selectedAnchorIndex,
      onSelectedAnchorChange: handleVectorAnchorSelection,
      originCanvas,
      onChange: handleVectorEditChange,
      onExit: handleVectorEditExit,
    };
  }, [
    boardFileId,
    canvasFrameGeometryById,
    handleVectorEditChange,
    handleVectorEditExit,
    handleVectorAnchorSelection,
    overviewScreens,
    vectorEditingState,
  ]);

  const handleOverviewScreenSelectionChange = useCallback(
    (ids: string[]) => {
      const pendingId = pendingOverviewScreenSelectionRef.current;
      const fileIds = new Set(getOverviewScreenFileIds(files));
      const nextIds = ids.filter((layerId) => fileIds.has(layerId));
      if (pendingId && ids.length === 0) return;
      if (pendingId && ids.includes(pendingId)) {
        setOverviewSelectedScreenIds((current) =>
          sameStringIds(current, nextIds) ? current : nextIds,
        );
        if (fileIds.has(pendingId)) {
          pendingOverviewScreenSelectionRef.current = null;
        }
        return;
      }
      if (pendingId) {
        pendingOverviewScreenSelectionRef.current = null;
        pendingOverviewLayerSelectionRef.current = null;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection(null);
      }
      setOverviewSelectedScreenIds((current) =>
        sameStringIds(current, nextIds) ? current : nextIds,
      );
      // BP-DEEP item 5 — Framer click-to-target: a click on EMPTY overview
      // canvas clears the screen selection (ids === []); that gesture also
      // returns the active edit scope to Base, mirroring clicking the base
      // frame itself. Two guards keep this from over-firing:
      // - viewModeRef: the selection-clear that fires while entering
      //   single-screen mode (enterSingleScreen flips the ref to "single"
      //   synchronously before any state settles) must not reset a
      //   breakpoint the user is about to keep editing in the focused view.
      // - overviewSelectedScreenIdsRef (still holding the PRE-update
      //   selection when this callback runs — it's re-assigned during
      //   render): MultiScreenCanvas's selection-report effect fires once on
      //   mount with [] before its prop sync, and an []→[] "transition" is
      //   that mount echo, not a user's empty-canvas click; without this
      //   guard every overview (re)mount would clobber a persisted/agent-set
      //   active breakpoint back to auto.
      if (
        ids.length === 0 &&
        overviewSelectedScreenIdsRef.current.length > 0 &&
        viewModeRef.current === "overview" &&
        activeBreakpointWidthStateRef.current !== undefined
      ) {
        handleBreakpointBarSelect(undefined);
      }
    },
    [
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      files,
      handleBreakpointBarSelect,
    ],
  );

  const shouldPreserveBlockedOverviewLayerSelectionRef = useRef<
    (screenId: string) => boolean
  >(() => false);

  const handleMoveTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("move");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
    });
  }, [canEditDesign]);

  const handleFrameTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("frame");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
      viewModeRef.current = "overview";
      setViewMode("overview");
    });
  }, [activeFile, canEditDesign]);

  const handleTextTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("text");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [activeFile, canEditDesign]);

  const handleShapeTool = useCallback(
    (tool: ShapeTool) => {
      if (!canEditDesign) return;
      blurActiveDesignEditableTarget();
      flushSync(() => {
        setActiveTool(tool);
        setShapeTool(tool);
        if (viewModeRef.current === "single" && activeFile) {
          setMode("edit");
          setDrawMode(false);
          setPinMode(false);
          setSelectedElement(null);
          return;
        }
        viewModeRef.current = "overview";
        setViewMode("overview");
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
      });
    },
    [activeFile, canEditDesign],
  );

  const handleRectTool = useCallback(() => {
    handleShapeTool("rect");
  }, [handleShapeTool]);

  const handleLineTool = useCallback(() => {
    handleShapeTool("line");
  }, [handleShapeTool]);

  const handleArrowTool = useCallback(() => {
    handleShapeTool("arrow");
  }, [handleShapeTool]);

  const handleEllipseTool = useCallback(() => {
    handleShapeTool("ellipse");
  }, [handleShapeTool]);

  const handleOverviewActiveToolChange = useCallback(
    (tool: MultiScreenCanvasTool) => {
      setActiveTool(tool === "rectangle" ? "rect" : (tool as DesignTool));
    },
    [],
  );

  const handlePenTool = useCallback(() => {
    if (!canEditDesign) return;
    blurActiveDesignEditableTarget();
    flushSync(() => {
      setActiveTool("pen");
      if (viewModeRef.current === "single" && activeFile) {
        setMode("edit");
        setDrawMode(false);
        setPinMode(false);
        setSelectedElement(null);
        return;
      }
      viewModeRef.current = "overview";
      setViewMode("overview");
      setMode("edit");
      setDrawMode(false);
      setPinMode(false);
      setSelectedElement(null);
    });
  }, [activeFile, canEditDesign]);

  const handleHandTool = useCallback(() => {
    blurActiveDesignEditableTarget();
    setActiveTool("hand");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
    if (viewModeRef.current === "single" && activeFile) {
      return;
    }
    viewModeRef.current = "overview";
    setViewMode("overview");
  }, [activeFile]);

  const [spacePanActive, setSpacePanActive] = useState(false);
  const spacePanStashedToolRef = useRef<DesignTool | null>(null);
  const broadcastSpaceHeldToIframes = useCallback((held: boolean) => {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:set-space-held", held },
          "*",
        );
      });
  }, []);
  const spaceForwardArmedRef = useRef(false);
  useEffect(() => {
    if (embedded || (pendingQuestions && pendingQuestions.length > 0)) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isNativeKeyboardActivationTarget(event.target)) return;
      if (isDesignHotkeyEditableTarget(event.target)) return;
      if (canEditDesignRef.current) {
        const armKeydown = resolveSpaceForwardTransition(
          "keydown",
          spaceForwardArmedRef.current,
          Boolean(activeEditorDragRef.current),
        );
        if (armKeydown.armed) {
          event.preventDefault();
          spaceForwardArmedRef.current = true;
          if (armKeydown.broadcast !== null) {
            broadcastSpaceHeldToIframes(armKeydown.broadcast);
          }
          return;
        }
      }
      if (spacePanStashedToolRef.current !== null) return;
      event.preventDefault();
      spacePanStashedToolRef.current = activeToolRef.current;
      setSpacePanActive(true);
      setActiveTool("hand");
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      const releaseKeyup = resolveSpaceForwardTransition(
        "keyup",
        spaceForwardArmedRef.current,
        Boolean(activeEditorDragRef.current),
      );
      if (releaseKeyup.broadcast !== null) {
        spaceForwardArmedRef.current = releaseKeyup.armed;
        event.preventDefault();
        broadcastSpaceHeldToIframes(releaseKeyup.broadcast);
        return;
      }
      const stashedTool = spacePanStashedToolRef.current;
      if (stashedTool === null) return;
      spacePanStashedToolRef.current = null;
      setSpacePanActive(false);
      setActiveTool((current) => (current === "hand" ? stashedTool : current));
      event.preventDefault();
    };

    const handleWindowBlur = () => {
      const releaseBlur = resolveSpaceForwardTransition(
        "blur",
        spaceForwardArmedRef.current,
        Boolean(activeEditorDragRef.current),
      );
      if (releaseBlur.broadcast !== null) {
        spaceForwardArmedRef.current = releaseBlur.armed;
        broadcastSpaceHeldToIframes(releaseBlur.broadcast);
      }
      const stashedTool = spacePanStashedToolRef.current;
      if (stashedTool === null) return;
      spacePanStashedToolRef.current = null;
      setSpacePanActive(false);
      setActiveTool((current) => (current === "hand" ? stashedTool : current));
    };

    window.addEventListener("keydown", handleWindowKeyDown, {
      capture: true,
    });
    window.addEventListener("keyup", handleWindowKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, {
        capture: true,
      });
      window.removeEventListener("keyup", handleWindowKeyUp, {
        capture: true,
      });
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [embedded, pendingQuestions, broadcastSpaceHeldToIframes]);

  const shiftKeyHeldRef = useRef(false);
  useEffect(() => {
    const handleShiftKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftKeyHeldRef.current = true;
    };
    const handleShiftKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftKeyHeldRef.current = false;
    };
    const handleShiftBlur = () => {
      shiftKeyHeldRef.current = false;
    };
    window.addEventListener("keydown", handleShiftKeyDown, { capture: true });
    window.addEventListener("keyup", handleShiftKeyUp, { capture: true });
    window.addEventListener("blur", handleShiftBlur);
    return () => {
      window.removeEventListener("keydown", handleShiftKeyDown, {
        capture: true,
      });
      window.removeEventListener("keyup", handleShiftKeyUp, {
        capture: true,
      });
      window.removeEventListener("blur", handleShiftBlur);
    };
  }, []);

  const handleScaleTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    blurActiveDesignEditableTarget();
    setActiveTool("scale");
    setMode("edit");
    setDrawMode(false);
    setPinMode(false);
  }, [activeFile, canEditDesign]);
  const scaleToolControls = useMemo<ScaleToolControls>(
    () => ({
      onScale: (factor, anchor) =>
        runScaleSelection(
          {
            selectedElement,
            boardFileId,
            activeBreakpointWidthPx: activeBreakpointWidthState,
            fallbackIframe: canvasIframeRef.current,
          },
          factor,
          anchor,
        ),
      onExit: handleMoveTool,
    }),
    [
      activeBreakpointWidthState,
      boardFileId,
      canvasIframeRef,
      handleMoveTool,
      selectedElement,
    ],
  );

  const handleDrawTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    setActiveTool("draw");
    setMode("annotate");
    setSelectedElement(null);
    setDrawMode(true);
    setPinMode(false);
  }, [activeFile, canEditDesign]);

  const handleExitOverviewDrawMode = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
    setOverviewAnnotationResetSignal((signal) => signal + 1);
  }, []);

  const handleExitFocusedDrawMode = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    setActiveTool("move");
    setMode("edit");
    setFocusedAnnotationResetSignal((signal) => signal + 1);
  }, []);

  const handleSendOverviewAnnotations = useCallback(
    async (
      annotations: DrawAnnotation[],
      instruction: string,
      canvasSize: { width: number; height: number },
    ) =>
      runSendOverviewAnnotations(
        {
          canvasContainerRef,
          design,
          handleExitOverviewDrawMode,
          id,
          overviewAnnotationSendingRef,
          overviewCanvasZoom,
          overviewScreens,
          setOverviewAnnotationSending,
          t,
        },
        annotations,
        instruction,
        canvasSize,
      ),
    [
      design?.title,
      handleExitOverviewDrawMode,
      id,
      overviewCanvasZoom,
      overviewScreens,
      t,
    ],
  );

  useEffect(() => {
    if (files.length > 0) resetAgentGenerating();
  }, [files.length, resetAgentGenerating]);

  const handleTweakPromptSubmit = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
    ) =>
      runTweakPromptSubmit(
        {
          activeFile,
          canEditDesign,
          design,
          handleTweakPromptOpenChange,
          id,
          tweakSelections,
          tweaks,
        },
        prompt,
        files,
        options,
      ),
    [
      activeFile,
      remoteVisualEditPending,
      canEditDesign,
      design,
      handleTweakPromptOpenChange,
      id,
      tweakSelections,
      tweaks,
    ],
  );

  useEffect(
    () =>
      runPublishAgentSelectionContext({
        activeBreakpointWidthState,
        activeCodeFile,
        activeFile,
        activeInspectorTab,
        activeLeftPanel,
        activeTool,
        design,
        designDataJson,
        layoutGrids,
        designSelectionOwnerIdRef,
        files,
        hoveredElement,
        id,
        isSignedIn,
        mode,
        motionDockOpen,
        pendingPersistedSelectionWriteRef,
        persistedSelectionContextRef,
        persistedSelectionStateRef,
        persistedSelectionWriteTimerRef,
        responsiveEditScope,
        selectedElement,
        selectedScreenIds,
        selectedStateId,
        viewMode,
        zoom,
      }),
    [
      id,
      design,
      activeFile,
      files,
      selectedScreenIds,
      selectedElement,
      hoveredElement,
      mode,
      activeTool,
      activeInspectorTab,
      activeLeftPanel,
      activeCodeFile,
      overviewSelectedScreenIds,
      viewMode,
      zoom,
      motionDockOpen,
      activeBreakpointWidthState,
      responsiveEditScope,
      designDataJson,
      layoutGrids,
      selectedStateId,
      isSignedIn,
    ],
  );

  const mirroredSelectionIdRef = useRef<string | null>(null);
  const mirroredExcerptRef = useRef<string | null>(null);
  const sentSelectionIdRef = useRef<string | null>(null);
  const composerContextHasOurKeyRef = useRef(true);

  const composerContextItemsForBookkeeping =
    useAgentChatContext(isSignedIn).items;
  useEffect(() => {
    const key = "design:selected-element";
    composerContextHasOurKeyRef.current =
      composerContextItemsForBookkeeping.some((item) => item.key === key);
  }, [composerContextItemsForBookkeeping]);

  useEffect(
    () =>
      runMirrorSelectionToAgentChat({
        activeFile,
        activeProjectionContent,
        composerContextHasOurKeyRef,
        design,
        id,
        isSignedIn,
        mirroredExcerptRef,
        mirroredSelectionIdRef,
        selectedCodeLayerNode,
        selectedElement,
        sentSelectionIdRef,
      }),
    [
      activeFile,
      activeProjectionContent,
      design?.title,
      id,
      isSignedIn,
      selectedCodeLayerNode,
      selectedElement,
    ],
  );

  useEffect(() => {
    const key = "design:design-system";
    if (!isSignedIn) return;
    const designSystemId = design?.designSystemId;
    if (!designSystemId) {
      removeAgentChatContextItem(key);
      return;
    }

    let cancelled = false;
    void loadDesignSystemGenerationContext(designSystemId).then((context) => {
      if (cancelled || !context.trim()) return;
      setAgentChatContextItem({
        key,
        title: "Selected design system" /* i18n-ignore agent context label */,
        context,
        openSidebar: false,
      });
    });

    return () => {
      cancelled = true;
      removeAgentChatContextItem(key);
    };
  }, [design?.designSystemId, isSignedIn]);

  const handleAssetInserted = useCallback(
    (selection: {
      fileId?: string;
      nodeId?: string;
      selector?: string;
      title?: string;
    }) => {
      if (viewModeRef.current === "single") {
        viewModeRef.current = "overview";
        setViewMode("overview");
      }
      if (selection.fileId) {
        setActiveFileId(selection.fileId);
        setOverviewSelectedScreenIds([selection.fileId]);
      }
      if (selection.nodeId) {
        setSelectedLayerIdsState([selection.nodeId]);
      }
      if (selection.selector || selection.nodeId) {
        setSelectedElement({
          tagName: "section",
          sourceId: selection.nodeId,
          selector:
            selection.selector ??
            `[data-agent-native-node-id="${selection.nodeId}"]`,
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 0, height: 0 },
          textContent: selection.title,
          isFlexChild: false,
          isFlexContainer: false,
        });
      }
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setActiveTool("move");
      setMode("edit");
    },
    [],
  );

  const designExtensionContext = useMemo<DesignExtensionSlotContext>(
    () => ({
      designId: id ?? "",
      designTitle: design?.title ?? null,
      activeFileId: activeFile?.id ?? null,
      activeFilename: activeFile?.filename ?? null,
      activeFileUpdatedAt: activeFile?.updatedAt ?? null,
      activeContent,
      viewMode,
      zoom,
      screens: files.map((file) => ({
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
      })),
      selectedScreenIds,
      selectedElement,
      mode,
      activeTool,
      tweakValues: tweakSelections,
      onShaderFillPreview: (_descriptor, css) => {
        setShaderFillPreview({
          selector: selectedElement?.selector ?? undefined,
          nodeId:
            selectedElement?.sourceId ?? selectedCodeLayerNode?.id ?? undefined,
          css,
        });
      },
      onShaderFillPreviewClear: clearShaderFillPreview,
      onShaderFillApplied: (fileId, content, updatedAt) => {
        applyFileContentUpdate(
          fileId,
          content,
          getPersistedContentHostSyncOptions({
            fileId,
            activeFileId: activeFile?.id ?? null,
            updatedAt,
          }),
        );
      },
      onAssetInserted: handleAssetInserted,
    }),
    [
      activeContent,
      activeFile?.filename,
      activeFile?.fileType,
      activeFile?.id,
      activeFile?.updatedAt,
      activeTool,
      applyFileContentUpdate,
      clearShaderFillPreview,
      design?.title,
      files,
      handleAssetInserted,
      id,
      mode,
      overviewSelectedScreenIds,
      selectedElement,
      selectedCodeLayerNode?.id,
      selectedScreenIds,
      tweakSelections,
      viewMode,
      zoom,
    ],
  );

  const handleScreenElementSelect = useCallback(
    (
      screenId: string,
      info: ElementInfo,
      intent?: ElementSelectionIntent,
      options: {
        persistPendingNodeId?: boolean;
        breakpointWidthPx?: number;
      } = {},
    ) => {
      const run = () => {
        runScreenElementSelect(
          {
            activeBreakpointWidthStateRef,
            applyFileContentUpdate,
            clearPendingOverviewLayerSelectionTimer,
            createdOverviewLayerSelection,
            focusDesignInspectorForSelection,
            getCodeLayerProjectionForScreen,
            getScreenContent,
            handleBreakpointBarSelect,
            id,
            liveScreenIds,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            renderedElementInfoByLayerKeyRef,
            selectedLayerIdsState,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            setHoveredElement,
            setHoveredElementScreenId,
            setMode,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            shouldPreserveBlockedOverviewLayerSelectionRef,
            t,
            viewModeRef,
          },
          screenId,
          info,
          intent,
          options,
        );
        rehydrateRenderedInfoAfterPreview();
      };
      if (!isUserOriginatedSelectionIntent(intent)) {
        run();
        return;
      }
      recordSelectionHistoryAroundChange(run);
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      clearPendingOverviewLayerSelectionTimer,
      createdOverviewLayerSelection,
      recordSelectionHistoryAroundChange,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      getScreenContent,
      handleBreakpointBarSelect,
      id,
      liveScreenIds,
      rehydrateRenderedInfoAfterPreview,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleScreenElementClear = useCallback(
    (screenId: string, breakpointWidthPx?: number) => {
      const pendingLayerId = pendingOverviewLayerSelectionRef.current;
      const pendingScreenId = pendingOverviewScreenSelectionRef.current;
      if (
        shouldIgnoreOverviewLayerCreationEcho({
          pendingLayerId,
          pendingScreenId,
          screenId,
          event: "clear",
        })
      ) {
        return;
      }
      if (shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId)) {
        return;
      }
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setActiveFileId(screenId);
      setSelectedElement(null);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState([]);
      invalidateRenderedElementInfo();
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
        if (breakpointWidthPx !== undefined) {
          handleBreakpointBarSelect(breakpointWidthPx);
        } else if (activeBreakpointWidthStateRef.current !== undefined) {
          handleBreakpointBarSelect(undefined);
        }
      }
      setActiveTool(resolveToolAfterSelection);
      setMode("edit");
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      handleBreakpointBarSelect,
      invalidateRenderedElementInfo,
    ],
  );

  const handleElementSelect = useCallback(
    (info: ElementInfo, intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        if (
          !intent &&
          isSupersededSelectionEcho(info, selectedElementRef.current)
        ) {
          return;
        }
        handleScreenElementSelect(screenId, info, intent);
        return;
      }
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      focusDesignInspectorForSelection();
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      focusDesignInspectorForSelection,
      handleScreenElementSelect,
    ],
  );

  const handleIframeElementSelect = useCallback(
    (
      screenId: string,
      info: ElementInfo,
      intent?: ElementSelectionIntent,
      options: {
        persistPendingNodeId?: boolean;
        breakpointWidthPx?: number;
      } = {},
    ) => {
      const currentSelection = selectedElementRef.current;
      const supersededEcho = intent
        ? false
        : isSupersededSelectionEcho(info, currentSelection);
      const inactiveScreenEcho =
        !intent &&
        activeFileIdRef.current !== null &&
        screenId !== activeFileIdRef.current;
      const droppedEcho = supersededEcho || inactiveScreenEcho;
      if (!intent && droppedEcho) {
        return;
      }
      handleScreenElementSelect(screenId, info, intent, options);
    },
    [handleScreenElementSelect],
  );

  const handleScreenElementDblClickText = useCallback(
    (screenId: string, info: ElementInfo) => {
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const projection = getCodeLayerProjectionForScreen(screenId);
      const canonical = projection
        ? canonicalizeElementInfoFromProjection(projection, info, screenId)
        : info;
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
        : null;
      setActiveFileId(screenId);
      setSelectedElement(canonical);
      setHoveredElement(null);
      setHoveredElementScreenId(null);
      setSelectedLayerIdsState(node ? [node.id] : []);
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
      }
      setMode("edit");
      focusDesignInspectorForSelection();
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      createdOverviewLayerSelection,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
    ],
  );

  const handleElementDblClickText = useCallback(
    (info: ElementInfo) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementDblClickText(screenId, info);
        return;
      }
      setSelectedElement(
        canonicalizeElementInfoFromProjection(activeCodeLayerProjection, info),
      );
      setMode("edit");
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementDblClickText,
    ],
  );

  const handleScreenElementHover = useCallback(
    (screenId: string, info: ElementInfo | null) => {
      if (isWheelCameraGestureActive()) return;
      const projection = getCodeLayerProjectionForScreen(screenId);
      const nextHovered = info
        ? projection
          ? canonicalizeElementInfoFromProjection(projection, info)
          : info
        : null;
      setHoveredElement((prev) => {
        if (prev === nextHovered) return prev;
        if (
          prev &&
          nextHovered &&
          prev.selector === nextHovered.selector &&
          prev.sourceId === nextHovered.sourceId &&
          prev.tagName === nextHovered.tagName
        ) {
          return prev;
        }
        return nextHovered;
      });
      setHoveredElementScreenId((prev) => {
        const next = info ? screenId : null;
        return prev === next ? prev : next;
      });
    },
    [getCodeLayerProjectionForScreen],
  );

  const handleElementHover = useCallback(
    (info: ElementInfo | null) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        handleScreenElementHover(screenId, info);
        return;
      }
      setHoveredElement(
        info
          ? canonicalizeElementInfoFromProjection(
              activeCodeLayerProjection,
              info,
            )
          : null,
      );
      setHoveredElementScreenId(info ? screenId : null);
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      activeFileId,
      handleScreenElementHover,
    ],
  );

  const handleIframeHotkey = useCallback((payload: IframeHotkeyPayload) => {
    if (!payload.key) return;
    const primary = payload.metaKey || payload.ctrlKey;
    if (
      primary &&
      !payload.altKey &&
      !payload.shiftKey &&
      payload.key.toLowerCase() === "k"
    ) {
      openCommandMenu();
      return;
    }
    const event = new KeyboardEvent("keydown", {
      key: payload.key,
      code: payload.code,
      metaKey: payload.metaKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      altKey: payload.altKey,
      repeat: payload.repeat,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "__agentNativeIframeHotkey", {
      value: true,
    });
    window.dispatchEvent(event);
  }, []);

  useEffect(() => {
    if (embedded || (pendingQuestions && pendingQuestions.length > 0)) return;
    const handleForwardedSpaceKeyUp = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; code?: unknown } | null;
      if (!data || data.type !== "design-hotkey-up" || data.code !== "Space") {
        return;
      }
      const keyupEvent = new KeyboardEvent("keyup", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(keyupEvent, "__agentNativeIframeHotkey", {
        value: true,
      });
      window.dispatchEvent(keyupEvent);
    };
    window.addEventListener("message", handleForwardedSpaceKeyUp);
    return () =>
      window.removeEventListener("message", handleForwardedSpaceKeyUp);
  }, [embedded, pendingQuestions]);

  const handleIframeContextMenu = useCallback(
    (payload: IframeContextMenuPayload) =>
      runIframeContextMenu(
        {
          activeFile,
          activeFileId,
          boardFileId,
          canvasContainerRef,
          canvasContextMenuRef,
          focusDesignInspectorForSelection,
          getCodeLayerProjectionForScreen,
          handleScreenElementSelect,
          overviewCanvasZoom,
          setCanvasLayerHitCandidates,
          viewMode,
          zoom,
        },
        payload,
      ),
    [
      activeFile?.id,
      activeFileId,
      boardFileId,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      handleScreenElementSelect,
      overviewCanvasZoom,
      viewMode,
      zoom,
    ],
  );

  const handleContextMenuSelectLayer = useCallback(
    (candidate: CanvasLayerHitCandidate) => {
      const screenId = candidate.screenId ?? activeFile?.id ?? activeFileId;
      if (!screenId) return;
      handleScreenElementSelect(screenId, candidate.info, undefined, {
        persistPendingNodeId: false,
        breakpointWidthPx: candidate.breakpointWidthPx,
      });
      focusDesignInspectorForSelection();
    },
    [
      activeFile?.id,
      activeFileId,
      focusDesignInspectorForSelection,
      handleScreenElementSelect,
    ],
  );

  const handleRepromptDraftConsumed = useCallback((nonce: number) => {
    setRepromptDraftRequest((current) =>
      current?.nonce === nonce ? null : current,
    );
  }, []);

  const openRepromptComposer = useCallback(
    (screenId: string, info: ElementInfo, breakpointWidthPx?: number) => {
      if (!id || !canEditDesign) return;
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      if (
        !screen ||
        resolveOverviewScreenSourceType(screen, designSourceType) !== "inline"
      ) {
        return;
      }
      const projection = getCodeLayerProjectionForScreen(screenId);
      const node = projection
        ? resolveCodeLayerNodeFromElementInfo(projection, info)
        : null;
      const stableNodeId =
        node?.dataAttributes["data-agent-native-node-id"]?.trim() ?? node?.id;
      const selector = node?.selector ?? info.selector;
      if (!stableNodeId && !selector) return;

      handleScreenElementSelect(screenId, info, undefined, {
        persistPendingNodeId: false,
        breakpointWidthPx,
      });
      setCommentsHidden(false);
      viewModeRef.current = "overview";
      setActiveFileId(screenId);
      setOverviewSelectedScreenIds([screenId]);
      setViewMode("overview");
      setActiveTool("comment");
      setMode("annotate");
      setPinMode(true);
      setDrawMode(false);
      setRepromptDraftRequest({
        nonce: Date.now() + Math.random(),
        fileId: screenId,
        target: {
          ...(stableNodeId ? { nodeId: stableNodeId } : {}),
          ...(selector ? { selector } : {}),
        },
      });
    },
    [
      canEditDesign,
      designSourceType,
      getCodeLayerProjectionForScreen,
      handleScreenElementSelect,
      id,
      overviewScreens,
    ],
  );

  const handleContextMenuReprompt = useCallback(() => {
    const screenId = activeFile?.id ?? activeFileId;
    if (!screenId || !selectedElement) return;
    openRepromptComposer(
      screenId,
      selectedElement,
      activeBreakpointWidthStateRef.current,
    );
  }, [activeFile?.id, activeFileId, openRepromptComposer, selectedElement]);

  const handleContextMenuRepromptLayer = useCallback(
    (candidate: CanvasLayerHitCandidate) => {
      const screenId = candidate.screenId ?? activeFile?.id ?? activeFileId;
      if (!screenId) return;
      openRepromptComposer(
        screenId,
        candidate.info,
        candidate.breakpointWidthPx,
      );
    },
    [activeFile?.id, activeFileId, openRepromptComposer],
  );

  const measureTargetSelector =
    selectedElement && sizeNeedsMeasurement(selectedElement.computedStyles)
      ? (selectedElement.runtimeSelector ?? selectedElement.selector ?? null)
      : null;
  const measureTargetScreenId = activeFile?.id ?? "";
  const measureTargetKey = measureTargetSelector
    ? [
        measureTargetScreenId,
        measureTargetSelector,
        selectedElement?.computedStyles.width ?? "",
        selectedElement?.computedStyles.height ?? "",
      ].join("|")
    : null;
  useEffect(() => {
    if (!measureTargetSelector || !measureTargetKey) return;
    let cancelled = false;
    void requestSelectionMeasurement({
      targetWindows: designPreviewWindows,
      screenId: measureTargetScreenId,
      selector: measureTargetSelector,
    }).then((measured) => {
      if (cancelled || !measured) return;
      setSelectedElement((prev) =>
        prev &&
        (prev.runtimeSelector ?? prev.selector) === measureTargetSelector
          ? {
              ...prev,
              boundingRect: measured.boundingRect,
              computedStyles: measured.computedStyles,
              inlineStyles: measured.inlineStyles,
              authoredSizeStyles: measured.authoredSizeStyles,
            }
          : prev,
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureTargetKey]);

  const pendingLiveStyleGestureIdForPhase = useCallback(
    (phase?: StyleChangeMeta["phase"]) => {
      return pendingVisualStyleGestureIdForPhase(
        pendingLiveStyleGestureStateRef.current,
        phase,
        isRunningAppSourceType(activeCanvasSourceType) &&
          selectedLayerTargetsRef.current.length > 1,
      );
    },
    [activeCanvasSourceType],
  );

  const commitVisualStyles = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      options: {
        runtimeApplied?: boolean;
        elementInfo?: ElementInfo;
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        pendingUndoGestureId?: string;
      } = {},
    ) => {
      const routePath =
        options.routePath ??
        (isRunningAppSourceType(activeCanvasSourceType)
          ? liveRoutePathsByScreenIdRef.current[activeFile?.id ?? ""]
          : undefined);
      runCommitVisualStyles(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeCanvasSourceType,
          activeCodeLayerProjection,
          activeFile,
          activeProjectionContent,
          applyLinkedComponentEdit,
          canApplyContentEdit,
          canEditDesign: canEditActiveVisualScreen,
          commitVisualStyles,
          getScreenContent,
          isSynced,
          lastDuplicateTransformRef,
          lastLocalContentRef,
          latestActiveContentRef,
          liveScreenSnapshotsById,
          onNoRenderedBox: () =>
            toast.error(t("designEditor.patchProof.noRenderedBox"), {
              id: "design-no-rendered-box",
              duration: 4000,
            }),
          queueFileContentSave,
          recordContentHistoryEntry,
          recordLocalContentHistoryChangeFallback,
          recordLocalContentHistoryEntry,
          recordPendingVisualStyleEdit,
          replacePreviewContent,
          responsiveEditScopeRef,
          selectedElement,
          setCollabContent,
          setCollabContentFileId,
          setContentRenderRevision,
          setPatchProof,
          setSelectedElement,
          setSelectedLayerIdsState,
          suppressContentHistoryRef,
          t,
          undoManagerRef,
          updateLiveScreenSnapshotContent,
          upsertMotionKeyframesFromStyles,
          viewModeRef,
          ydoc,
        },
        selector,
        styles,
        routePath ? { ...options, routePath } : options,
      );
      invalidateRenderedElementInfo();
    },
    [
      activeFile,
      activeBreakpointWidthState,
      activeBreakpointUpperBoundPx,
      activeCanvasSourceType,
      activeCodeLayerProjection,
      activeProjectionContent,
      applyLinkedComponentEdit,
      canApplyContentEdit,
      canEditActiveVisualScreen,
      getScreenContent,
      liveScreenSnapshotsById,
      queueFileContentSave,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      recordLocalContentHistoryChangeFallback,
      recordPendingVisualStyleEdit,
      replacePreviewContent,
      selectedElement,
      t,
      updateLiveScreenSnapshotContent,
      upsertMotionKeyframesFromStyles,
      ydoc,
      isSynced,
      invalidateRenderedElementInfo,
    ],
  );

  const commitStylesToSelectedLayers = useCallback(
    (
      styles: Record<string, string>,
      targets?: SelectedLayerTarget[],
      capturedOptions?: CapturedStyleTargetCommitOptions,
      pendingUndoGestureId?: string,
    ) => {
      const canEditSelectedVisualLayers =
        canEditDesign ||
        (selectedLayerTargetsRef.current.length > 0 &&
          selectedLayerTargetsRef.current.every((target) =>
            canEditLiveScreen(target.fileId),
          ));
      return runCommitStylesToSelectedLayers(
        {
          activeCanvasSourceType,
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          commitVisualStyles,
          canEditDesign: canEditSelectedVisualLayers,
          effectiveCodeLayerStateRef,
          getScreenContent,
          getProjectionContentForScreen,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          selectedLayerIdsStateRef,
          reportLinkedEditUnavailable: (reason) =>
            toast.error(
              t(
                {
                  scope:
                    "designEditor.componentInstances.linkedEditScopeUnsupported",
                  source:
                    "designEditor.componentInstances.linkedEditSourceUnsupported",
                  targets:
                    "designEditor.componentInstances.linkedEditTargetsUnavailable",
                }[reason],
              ),
            ),
          setSelectedElement,
        },
        styles,
        targets,
        capturedOptions,
        pendingUndoGestureId,
      );
    },
    [
      activeCanvasSourceType,
      activeBreakpointUpperBoundPx,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign,
      canEditLiveScreen,
      getScreenContent,
      getProjectionContentForScreen,
      t,
    ],
  );
  commitStylesToSelectedLayersRef.current = commitStylesToSelectedLayers;

  const commitRelativeStyleDeltaToSelectedLayers = useCallback(
    (
      property: string | string[],
      operation: number | ScrubRelativeExpression,
      pendingUndoGestureId?: string,
    ) => {
      const canEditSelectedVisualLayers =
        canEditDesign ||
        (selectedLayerTargetsRef.current.length > 0 &&
          selectedLayerTargetsRef.current.every((target) =>
            canEditLiveScreen(target.fileId),
          ));
      return runCommitRelativeStyleDeltaToSelectedLayers(
        {
          activeCanvasSourceType,
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          commitVisualStyles,
          canEditDesign: canEditSelectedVisualLayers,
          effectiveCodeLayerStateRef,
          getScreenContent,
          getProjectionContentForScreen,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          reportLinkedEditUnavailable: (reason) =>
            toast.error(
              t(
                {
                  scope:
                    "designEditor.componentInstances.linkedEditScopeUnsupported",
                  source:
                    "designEditor.componentInstances.linkedEditSourceUnsupported",
                  targets:
                    "designEditor.componentInstances.linkedEditTargetsUnavailable",
                }[reason],
              ),
            ),
          setSelectedElement,
        },
        property,
        operation,
        pendingUndoGestureId,
      );
    },
    [
      activeCanvasSourceType,
      activeBreakpointUpperBoundPx,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      commitVisualStyles,
      canEditDesign,
      canEditLiveScreen,
      getScreenContent,
      getProjectionContentForScreen,
      t,
    ],
  );

  const getFreshActiveContent = useCallback(
    () => (activeFile?.id ? getScreenContent(activeFile.id) : activeContent),
    [activeContent, activeFile?.id, getScreenContent],
  );
  const getFreshActivePreviewContent = useCallback(
    () =>
      livePreviewContentRef.current?.fileId === activeFile?.id
        ? livePreviewContentRef.current.content
        : null,
    [activeFile?.id],
  );

  const handleClearBreakpointOverride = useCallback(
    (property: string, maxWidthPx: number): boolean => {
      if (!canEditDesign || !activeFile?.id || !selectedElement?.sourceId) {
        return false;
      }
      const nodeId = selectedElement.sourceId;
      const baseContent = getFreshActiveContent();
      const overrideState = getBreakpointOverrideState({
        className: selectedElement.classes?.join(" ") ?? "",
        html: baseContent,
        nodeId,
        property,
        breakpointWidths: designBreakpoints.map((bp) => bp.widthPx),
        baseWidthPx: activeScreenBaseWidthPx,
        activeWidthPx: activeBreakpointWidthState,
      });
      const override = overrideState.overrides.find(
        (candidate) => candidate.maxWidthPx === maxWidthPx,
      );
      if (!override) return false;
      const nextContent =
        override.source === "media"
          ? removeBreakpointMediaDeclaration(baseContent, {
              nodeId,
              maxWidthPx,
              property,
            })
          : applyVisualEdit(
              baseContent,
              {
                kind: "responsive-class",
                target: { nodeId },
                prefix: "base",
                maxWidthPx,
                operation: "remove",
                stem: utilityStem(override.value),
              },
              {
                source: codeLayerSourceForScreen(activeFile.id),
              },
            ).content;
      if (nextContent === baseContent) return false;
      applyFileContentUpdate(activeFile.id, nextContent, {
        refreshPreview: false,
        forcePreviewFullDocument: true,
      });
      return true;
    },
    [
      activeBreakpointWidthState,
      activeFile?.id,
      activeScreenBaseWidthPx,
      applyFileContentUpdate,
      canEditDesign,
      codeLayerSourceForScreen,
      designBreakpoints,
      getFreshActiveContent,
      selectedElement,
    ],
  );

  const previewInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>) => {
      if (!selectedElement) return;
      const screenId = activeFile?.id;
      const routePath = screenId
        ? liveRoutePathsByScreenIdRef.current[screenId]
        : undefined;
      if (
        screenId &&
        sendLinkedScreenPreviewInteractionStateStyle(screenId, {
          routePath,
          selector: selectedCanvasSelector ?? selectedElement.selector ?? "",
          selectorCandidates: selectedCanvasSelectorCandidates,
          nodeId: selectedElement.sourceId ?? "",
          state,
          styles,
        })
      ) {
        return;
      }
      const sendPreview = (window as any)
        .__designCanvasSendInteractionStatePreviewStyle;
      if (typeof sendPreview !== "function") return;
      sendPreview({
        screenId,
        routePath,
        selector: selectedCanvasSelector ?? selectedElement.selector ?? "",
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement.sourceId ?? "",
        state,
        styles,
      });
    },
    [
      activeFile?.id,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedElement,
    ],
  );

  const commitInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>): boolean => {
      const canEditInteractionState =
        canEditDesign ||
        (isRunningAppSourceType(activeCanvasSourceType) &&
          canEditActiveVisualScreen);
      if (
        !canEditInteractionState ||
        !activeFile?.id ||
        !selectedElement?.sourceId
      ) {
        return false;
      }
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return false;
      const interactionStateTarget = resolveCodeLayerNodeFromElementInfo(
        activeCodeLayerProjection,
        selectedElement,
      );
      if (
        interactionStateTarget &&
        linkedComponentRootForNode(
          interactionStateTarget,
          activeCodeLayerProjection,
        )
      ) {
        toast.error(
          t("designEditor.componentInstances.linkedEditScopeUnsupported"),
          { duration: 4000 },
        );
        return true;
      }
      const nodeId = selectedElement.sourceId;
      if (isRunningAppSourceType(activeCanvasSourceType)) {
        recordPendingVisualStyleEdit(
          activeFile.id,
          selectedCanvasSelector ?? selectedElement.selector ?? "",
          Object.fromEntries(entries),
          selectedElement,
          {
            interactionState: state,
            routePath: liveRoutePathsByScreenIdRef.current[activeFile.id],
          },
        );
        previewInteractionStateStyles(state, Object.fromEntries(entries));
        return true;
      }
      const baseContent = getFreshActiveContent();
      const nextContent = applyInteractionStateStyleCommit(
        baseContent,
        nodeId,
        state,
        Object.fromEntries(entries),
        activeBreakpointUpperBoundPx,
      );
      if (nextContent === baseContent) return true;
      applyFileContentUpdate(activeFile.id, nextContent, {
        refreshPreview: false,
        forcePreviewFullDocument: true,
      });
      previewInteractionStateStyles(
        state,
        Object.fromEntries(entries.map(([property]) => [property, ""])),
      );
      return true;
    },
    [
      activeCodeLayerProjection,
      activeCanvasSourceType,
      activeBreakpointUpperBoundPx,
      activeFile?.id,
      applyFileContentUpdate,
      canEditActiveVisualScreen,
      canEditDesign,
      getFreshActiveContent,
      previewInteractionStateStyles,
      recordPendingVisualStyleEdit,
      selectedCanvasSelector,
      selectedElement,
      t,
    ],
  );

  const handleStyleChange = useCallback(
    (property: string, value: string, meta?: StyleChangeMeta) =>
      runStyleChange(
        {
          canEditLiveScreen,
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers: (
            property,
            operation,
            phase,
          ) =>
            commitRelativeStyleDeltaToSelectedLayers(
              property,
              operation,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitStylesToSelectedLayers: (styles, phase) =>
            commitStylesToSelectedLayers(
              styles,
              undefined,
              undefined,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitCapturedStyleTargets: (styles, targets, interactionState) =>
            commitCapturedStyleTargetsRef.current(
              styles,
              targets,
              interactionState,
            ),
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedScreenStyleChange: routeSelectedScreenStyleChange,
          selectedLayerTargetsRef,
          textEditingState,
        },
        property,
        value,
        meta,
      ),
    [
      commitInteractionStateStyles,
      canEditLiveScreen,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      pendingLiveStyleGestureIdForPhase,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedElement?.selector,
      selectedElement?.sourceId,
      selectedCanvasSelectorCandidates,
      routeSelectedScreenStyleChange,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  // BUG-DOUBLE-TOGGLE-RACE: commitVisualStyles commits Cmd+U/Cmd+Shift+X
  // through the SHORTHAND "textDecoration" property, but its synchronous
  // optimistic patch to selectedElement.computedStyles only merges the exact
  // key(s) it was given — it never decomposes "textDecoration" into the
  // LONGHAND "textDecorationLine" the toggle READS to decide its next value.
  // `textDecorationLine` only catches up once the bridge's async
  // getComputedStyle round trip lands. A second Cmd+U within that window
  // therefore recomputes nextTextDecorationLineValue from the STALE
  // pre-toggle value, lands on the SAME target the first press already
  // committed, and the style-commit pipeline dedupes the identical value as
  // a no-op — consecutive toggles silently stop alternating.
  //
  // Fix: track our own optimistic textDecorationLine value per selected
  // element, updated synchronously the instant we commit, and prefer it over
  // the (possibly still-stale) computedStyles reading for the SAME element.
  // Shared between underline and strikethrough since both toggle tokens
  // within the same textDecorationLine value — a separate ref per hotkey
  // would let one clobber the other's still-in-flight token.
  const optimisticTextDecorationLineRef =
    useRef<OptimisticTextDecorationLineEntry | null>(null);
  const readOptimisticTextDecorationLine = useCallback(() => {
    if (!selectedElement) return undefined;
    return resolveOptimisticTextDecorationLine(
      optimisticTextDecorationLineRef.current,
      selectedElement.sourceId ?? selectedElement.selector,
      selectedElement.computedStyles.textDecorationLine,
    );
  }, [selectedElement]);

  const handleToggleUnderlineHotkey = useCallback(() => {
    if (!canEditActiveVisualScreen || !selectedElement) return;
    const nextValue = nextTextDecorationLineValue(
      readOptimisticTextDecorationLine(),
      "underline",
    );
    const elementKey = selectedElement.sourceId ?? selectedElement.selector;
    if (elementKey) {
      optimisticTextDecorationLineRef.current = {
        key: elementKey,
        value: nextValue,
      };
    }
    handleStyleChange("textDecoration", nextValue);
  }, [
    canEditActiveVisualScreen,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleToggleStrikethroughHotkey = useCallback(() => {
    if (!canEditActiveVisualScreen || !selectedElement) return;
    const nextValue = nextTextDecorationLineValue(
      readOptimisticTextDecorationLine(),
      "line-through",
    );
    const elementKey = selectedElement.sourceId ?? selectedElement.selector;
    if (elementKey) {
      optimisticTextDecorationLineRef.current = {
        key: elementKey,
        value: nextValue,
      };
    }
    handleStyleChange("textDecoration", nextValue);
  }, [
    canEditActiveVisualScreen,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) =>
      runStylesChange(
        {
          canEditLiveScreen,
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers: (
            property,
            operation,
            phase,
          ) =>
            commitRelativeStyleDeltaToSelectedLayers(
              property,
              operation,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitStylesToSelectedLayers: (styles, phase) =>
            commitStylesToSelectedLayers(
              styles,
              undefined,
              undefined,
              pendingLiveStyleGestureIdForPhase(phase),
            ),
          commitCapturedStyleTargets: (styles, targets, interactionState) =>
            commitCapturedStyleTargetsRef.current(
              styles,
              targets,
              interactionState,
            ),
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedScreenStyleChange: routeSelectedScreenStyleChange,
          selectedLayerTargetsRef,
          textEditingState,
        },
        styles,
        meta,
      ),
    [
      commitInteractionStateStyles,
      canEditLiveScreen,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      pendingLiveStyleGestureIdForPhase,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedCanvasSelectorCandidates,
      selectedElement?.selector,
      selectedElement?.sourceId,
      routeSelectedScreenStyleChange,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  const handleFontUploaded = useCallback(
    async (font: UploadedFont) => {
      if (!activeFile?.id || activeCanvasSourceType !== "inline") {
        throw new Error(t("common.genericError"));
      }
      const currentContent = getFreshActiveContent();
      const nextContent = ensureUploadedFontFaceInHtml(currentContent, font);
      const result = applyFileContentUpdate(activeFile.id, nextContent, {
        forcePreviewFullDocument: true,
        refreshPreview: false,
        recordHistory: false,
      });
      if (result.status !== "accepted") {
        throw new Error(t("common.genericError"));
      }
      handleStyleChange(
        "fontFamily",
        `${JSON.stringify(font.family)}, sans-serif`,
      );
    },
    [
      activeCanvasSourceType,
      activeFile?.id,
      applyFileContentUpdate,
      ensureUploadedFontFaceInHtml,
      getFreshActiveContent,
      handleStyleChange,
      t,
    ],
  );

  const breakpointContext = useMemo(() => {
    if (designBreakpoints.length === 0 || activeScreenBaseWidthPx == null) {
      return undefined;
    }
    return {
      breakpointWidths: designBreakpoints.map((bp) => bp.widthPx),
      baseWidthPx: activeScreenBaseWidthPx,
      activeWidthPx: activeBreakpointWidthState ?? null,
      upperBoundPx: activeBreakpointUpperBoundPx,
      lowerBoundPx:
        responsiveEditScope === "only"
          ? (activeBreakpointWidthState ?? null)
          : null,
      html: activeContent,
    };
  }, [
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthState,
    activeContent,
    activeScreenBaseWidthPx,
    designBreakpoints,
    responsiveEditScope,
  ]);

  const handleVisualStyleChange = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        phase?: "preview" | "commit";
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        runtimeApplied?: boolean;
      },
    ) => {
      if (!activeFile?.id) return;
      if (metadata?.phase === "preview") {
        if (elementInfo) {
          setSelectedElement((current) =>
            current
              ? {
                  ...current,
                  computedStyles: elementInfo.computedStyles,
                  inlineStyles: elementInfo.inlineStyles,
                  authoredSizeStyles: elementInfo.authoredSizeStyles,
                  boundingRect: elementInfo.boundingRect,
                  parentBoundingRect: elementInfo.parentBoundingRect,
                }
              : current,
          );
        }
        return;
      }
      const gestureTarget = styleWriteTarget({
        selector,
        selectedElement: elementInfo,
      });
      const affectsEveryRow = gestureTarget !== selector;
      commitVisualStyles(gestureTarget, styles, {
        runtimeApplied: metadata?.runtimeApplied ?? !affectsEveryRow,
        elementInfo,
        originalStyles: metadata?.originalStyles,
        preserveSelection: metadata?.preserveSelection,
        routePath: metadata?.routePath,
      });
    },
    [activeFile?.id, commitVisualStyles],
  );

  const handleKScaleStyleBatchChange = useCallback(
    (screenId: string, changes: KScaleStyleChange[]) => {
      if (changes.length === 0) return true;
      if (!canEditDesign && !canEditLiveScreen(screenId)) return false;
      const screen = overviewScreens.find((entry) => entry.id === screenId);
      const sourceFile = files.find((file) => file.id === screenId);
      const sourceType = isBoardFile(sourceFile?.filename ?? "")
        ? "inline"
        : resolveOverviewScreenSourceType(
            screen,
            screenId === activeFile?.id
              ? activeCanvasSourceType
              : designSourceType,
          );
      if (isRunningAppSourceType(sourceType)) {
        const pendingUndoGestureId =
          changes.length > 1
            ? pendingVisualStyleGestureIdForPhase(
                pendingLiveStyleGestureStateRef.current,
                undefined,
                true,
              )
            : undefined;
        changes.forEach(
          ({
            selector,
            styles,
            elementInfo,
            originalStyles,
            preserveSelection,
          }) => {
            recordPendingVisualStyleEdit(
              screenId,
              selector,
              styles,
              elementInfo,
              {
                originalStyles,
                pendingUndoGestureId,
                preserveSelection,
                routePath: liveRoutePathsByScreenIdRef.current[screenId],
              },
            );
          },
        );
        return true;
      }
      const content =
        screenId === activeFile?.id
          ? getFreshActiveContent()
          : getScreenContent(screenId);
      if (!content || externalPreviewUrlForContent(content) !== null)
        return false;
      const patch = applyKScaleStyleChanges(
        content,
        changes,
        codeLayerSourceForScreen(screenId),
      );
      if (patch.status !== "applied") {
        toast.error(
          codeLayerPatchMessage(
            patch.reason,
            t("designEditor.patchProof.selectorMissing"),
          ),
        );
        return false;
      }
      if (patch.content === content) return true;
      applyFileContentUpdate(screenId, patch.content, {
        skipPreview: true,
      });
      return true;
    },
    [
      activeCanvasSourceType,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      codeLayerSourceForScreen,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      pendingVisualStyleGestureIdForPhase,
      recordPendingVisualStyleEdit,
      t,
    ],
  );

  const handleVisualStructureChange = useCallback(
    (
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
      },
    ) =>
      runVisualStructureChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          getFreshActiveContent,
          recordPendingLiveStructureEdit,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      ),
    [
      activeFile,
      activeCanvasSourceType,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      getFreshActiveContent,
      recordPendingLiveStructureEdit,
      t,
    ],
  );

  const componentCloneContextForFile = useCallback(
    (fileId: string): ComponentCloneBatchContext => {
      const documents = files.map((file) => ({
        source: codeLayerSourceForScreen(file.id),
        content: getScreenContent(file.id),
      }));
      return {
        sourceFileIds: [fileId],
        targetSource: codeLayerSourceForScreen(fileId),
        documents,
      };
    },
    [codeLayerSourceForScreen, files, getScreenContent],
  );

  const remapMotionTracksForClone = useCallback(
    (nodeIdMap: Map<string, string>, targetFileId: string) => {
      if (nodeIdMap.size === 0) return;
      if (previousMotionFileIdRef.current !== targetFileId) return;
      setMotionTracks((current) => {
        const cloned = current
          .filter((track) => nodeIdMap.has(track.targetNodeId))
          .map((track) => ({
            ...track,
            targetNodeId: nodeIdMap.get(track.targetNodeId)!,
          }));
        if (cloned.length === 0) return current;
        return [...current, ...cloned];
      });
      setMotionTracksDirty(true);
    },
    [],
  );

  const handleVisualDuplicateChange = useCallback(
    (
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
        anchorSelector?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        placement?: "before" | "after" | "inside";
      },
    ) => {
      if (isRunningAppSourceType(activeCanvasSourceType) && activeFile) {
        if (!canEditActiveVisualScreen) return false;
        recordPendingLiveStructureEdit(
          activeFile.id,
          elementInfo?.runtimeSelector ?? elementInfo?.selector ?? selector,
          details?.anchorSelector ?? selector,
          details?.placement ?? "after",
          elementInfo,
          {
            sourceId: elementInfo?.runtimeSourceId || elementInfo?.sourceId,
            anchorSourceId: details?.anchorSourceId || details?.sourceId,
            anchorElementInfo: details?.anchorElementInfo,
            requestId: details?.requestId,
            dropMode: details?.dropMode,
            forceFlowPositionOverride: details?.forceFlowPositionOverride,
            sourceRect: details?.sourceRect,
            anchorRect: details?.anchorRect,
            insertedHtml: cloneHtml,
          },
        );
        return "pending";
      }
      return runVisualDuplicateChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          componentLinks: activeFile
            ? componentCloneContextForFile(activeFile.id)
            : undefined,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          remapMotionTracksForClone,
          getFreshActiveContent,
          selectedElement,
          selectedLayerIdsState,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          undoManagerRef,
        },
        selector,
        cloneHtml,
        elementInfo,
        details,
      );
    },
    [
      remapMotionTracksForClone,
      applyLinkedComponentEdit,
      activeFile,
      activeCanvasSourceType,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      componentCloneContextForFile,
      getFreshActiveContent,
      recordPendingLiveStructureEdit,
      selectedElement,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleTextContentChange = useCallback(
    (
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: {
        html?: string;
        originalValue?: string;
        originalHtml?: string;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runTextContentChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          prepareTextCreationFinalization,
          getFreshActiveContent,
          liveScreenSnapshotsById,
          recordPendingLiveTextEdit,
          setActiveTool,
          setMode,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          updateLiveScreenSnapshotContent,
        },
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile,
      activeCanvasSourceType,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      prepareTextCreationFinalization,
      getFreshActiveContent,
      liveScreenSnapshotsById,
      recordPendingLiveTextEdit,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleScreenVisualStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        phase?: "preview" | "commit";
        originalStyles?: Record<string, string>;
        preserveSelection?: boolean;
        routePath?: string;
        runtimeApplied?: boolean;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runScreenVisualStyleChange(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          getScreenContent,
          handleVisualStyleChange,
          overviewScreens,
          recordPendingVisualStyleEdit,
          responsiveEditScopeRef,
          t,
        },
        screenId,
        selector,
        styles,
        elementInfo,
        metadata,
      ),
    [
      activeBreakpointUpperBoundPx,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      getScreenContent,
      handleVisualStyleChange,
      overviewScreens,
      recordPendingVisualStyleEdit,
    ],
  );

  const handleInspectorScreenStyleChange = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: StyleChangeMeta,
    ) => {
      if (!canEditDesign && !canEditLiveScreen(screenId)) return;
      const selectorCandidates = Array.from(
        new Set(
          [
            selector,
            elementInfo?.runtimeSelector,
            elementInfo?.selector,
            ...selectedCanvasSelectorCandidates,
          ].filter((candidate): candidate is string => Boolean(candidate)),
        ),
      );
      const textRangeOwnsScreen =
        textEditingState.hasRange &&
        textEditingState.screenId === screenId &&
        textEditingState.selector === selector;
      const interactionState = metadata?.interactionState;
      if (interactionState) {
        const relativeOperations = relativeOperationsForStyles(
          styles,
          metadata ?? {},
        );
        const routePath =
          metadata.routePath ?? liveRoutePathsByScreenIdRef.current[screenId];
        const previewInteractionState = (nextStyles: Record<string, string>) =>
          sendLinkedScreenPreviewInteractionStateStyle(screenId, {
            routePath,
            selector,
            selectorCandidates,
            nodeId: elementInfo?.runtimeSourceId ?? elementInfo?.sourceId ?? "",
            state: interactionState,
            styles: nextStyles,
          });
        if (metadata.phase === "preview" || metadata.phase === "cancel") {
          previewInteractionState(styles);
          return;
        }
        const screenSourceType = resolveOverviewScreenSourceType(
          overviewScreens.find((screen) => screen.id === screenId),
          designSourceType,
        );
        if (isRunningAppSourceType(screenSourceType)) {
          if (screenId === activeFile?.id) {
            commitInteractionStateStyles(interactionState, styles);
          } else {
            recordPendingVisualStyleEdit(
              screenId,
              selector,
              styles,
              elementInfo,
              {
                interactionState,
                routePath,
                ...(relativeOperations ? { relativeOperations } : {}),
              },
            );
            previewInteractionState(styles);
          }
          return;
        }
        if (!canEditDesign || !elementInfo?.sourceId) return;
        if (screenId === activeFile?.id) {
          commitInteractionStateStyles(interactionState, styles);
          return;
        }
        const baseContent = getScreenContent(screenId);
        const nextContent = applyInteractionStateStyleCommit(
          baseContent,
          elementInfo.sourceId,
          interactionState,
          styles,
          activeBreakpointUpperBoundPx,
        );
        if (nextContent === baseContent) return;
        applyFileContentUpdate(screenId, nextContent, {
          refreshPreview: false,
          forcePreviewFullDocument: true,
        });
        previewInteractionState(
          Object.fromEntries(
            Object.keys(styles).map((property) => [property, ""]),
          ),
        );
        return;
      }
      for (const [property, value] of Object.entries(styles)) {
        sendLinkedScreenPreviewStyleChange(
          screenId,
          selector,
          property,
          value,
          {
            selectorCandidates,
            nodeId: elementInfo?.runtimeSourceId ?? elementInfo?.sourceId,
            relativeOperation: relativeOperationsForStyles(
              { [property]: value },
              metadata,
            )?.[property],
          },
        );
      }
      if (
        metadata?.phase === "preview" ||
        metadata?.phase === "cancel" ||
        textRangeOwnsScreen
      )
        return;
      const relativeOperations = relativeOperationsForStyles(styles, metadata);
      handleScreenVisualStyleChange(screenId, selector, styles, elementInfo, {
        phase: metadata?.phase === "commit" ? "commit" : undefined,
        runtimeApplied: true,
        ...(relativeOperations ? { relativeOperations } : {}),
        routePath:
          metadata?.routePath ?? liveRoutePathsByScreenIdRef.current[screenId],
      });
    },
    [
      activeBreakpointUpperBoundPx,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      commitInteractionStateStyles,
      designSourceType,
      getScreenContent,
      handleScreenVisualStyleChange,
      overviewScreens,
      recordPendingVisualStyleEdit,
      selectedCanvasSelectorCandidates,
      textEditingState.hasRange,
      textEditingState.screenId,
      textEditingState.selector,
    ],
  );
  selectedScreenStyleChangeRef.current = handleInspectorScreenStyleChange;

  const handleScreenVisualStructureChange = useCallback(
    (
      screenId: string,
      selector: string,
      anchorSelector: string,
      placement: "before" | "after" | "inside",
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        transactionId?: string;
        routePath?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        gridPlacement?: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
        gridDisplacements?: Array<{
          sourceId?: string;
          selector?: string;
          placement: {
            column: number;
            columnEnd: number;
            row: number;
            rowEnd: number;
          };
        }>;
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        replacementElementInfo?: ElementInfo;
        replacementSnapshotHtml?: string;
      },
    ) =>
      runScreenVisualStructureChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          getScreenContent,
          handleVisualStructureChange,
          overviewScreens,
          recordPendingLiveStructureEdit,
          setActiveFileId,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        screenId,
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      getScreenContent,
      handleVisualStructureChange,
      overviewScreens,
      recordPendingLiveStructureEdit,
      applyLinkedComponentEdit,
      t,
    ],
  );

  const handleScreenGridGroupChange = useCallback(
    (screenId: string, moves: GridGroupStructureMove[]) => {
      const screen = overviewScreens.find(
        (candidate) => candidate.id === screenId,
      );
      const sourceType =
        normalizeDesignSourceType(screen?.sourceType) ?? designSourceType;
      if (isRunningAppSourceType(sourceType)) {
        const transactionId = moves[0]?.transactionId;
        const edits = moves.map((move) =>
          preparePendingLiveStructureEdit(
            {
              canEditDesign,
              files,
              localhostConnectionRootPathByIdRef,
              overviewScreens,
              runtimeLayerSnapshotsById,
            },
            screenId,
            move.selector,
            move.persistenceAnchorSelector ?? move.anchorSelector,
            move.persistencePlacement ?? move.placement ?? "inside",
            undefined,
            {
              sourceId: move.sourceId,
              anchorSourceId:
                move.persistenceAnchorSourceId ?? move.anchorSourceId,
              requestId: move.requestId,
              transactionId,
              dropMode: "flow-insert",
              gridPlacement: move.gridPlacement,
              gridDisplacements: move.gridDisplacements,
            },
          ),
        );
        if (
          !edits.every(
            (edit): edit is NonNullable<typeof edit> => edit !== undefined,
          )
        )
          return false;
        commitPendingLiveStructureEdits(
          {
            cancelPendingStructureVerification,
            pendingLiveNonStyleEditsRef,
            pendingLiveNonStyleRedoStackRef,
            pendingLiveNonStyleUndoStackRef,
            pendingStructureRedoReplayRef,
            pendingStructureRedoReplayTimerRef,
            pendingVisualStyleRedoStackRef,
            recordPendingHistoryEntry,
            setPendingLiveNonStyleEdits,
          },
          edits,
        );
        return "pending";
      }
      const screenFile = files.find((file) => file.id === screenId);
      if (!screenFile || !canEditDesign) return false;
      const content = getScreenContent(screenId);
      const linked = resolveGridGroupLinkedComponentTarget(
        content,
        screenId,
        moves,
      );
      if (linked.status === "mixed") return false;
      const nextContent = planVisualGridGroupStructureChange(
        screenFile,
        content,
        moves,
        t,
        linked.status === "linked",
      );
      if (nextContent === null) return false;
      if (linked.status === "linked") {
        applyLinkedComponentEdit(linked.fileId, linked.nodeId, {
          kind: "structure",
          before: content,
          after: nextContent,
          selectionNodeIds: moves.map((move) => move.sourceId),
        });
        setActiveFileId(screenId);
        return true;
      }
      const published = applyFileContentUpdate(screenId, nextContent, {
        skipPreview: true,
      });
      if (published.status !== "accepted") return false;
      setActiveFileId(screenId);
      return true;
    },
    [
      overviewScreens,
      designSourceType,
      files,
      canEditDesign,
      getScreenContent,
      t,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
    ],
  );

  const handleScreenVisualDuplicateChange = useCallback(
    (
      screenId: string,
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
        anchorSelector?: string;
        anchorSourceId?: string;
        anchorElementInfo?: ElementInfo;
        requestId?: string;
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        placement?: "before" | "after" | "inside";
      },
    ) =>
      runScreenVisualDuplicateChange(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          applyFileContentUpdate,
          canEditDesign,
          canEditLiveScreen,
          remapMotionTracksForClone,
          componentLinksForFile: componentCloneContextForFile,
          getScreenContent,
          handleVisualDuplicateChange,
          designSourceType,
          overviewScreens,
          recordPendingLiveStructureEdit,
          t,
        },
        screenId,
        selector,
        cloneHtml,
        elementInfo,
        details,
      ),
    [
      remapMotionTracksForClone,
      applyLinkedComponentEdit,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      componentCloneContextForFile,
      designSourceType,
      getScreenContent,
      handleVisualDuplicateChange,
      overviewScreens,
      recordPendingLiveStructureEdit,
      t,
    ],
  );

  const handleScreenTextContentChange = useCallback(
    (
      screenId: string,
      selector: string,
      value: string,
      elementInfo?: ElementInfo,
      details?: {
        html?: string;
        originalValue?: string;
        originalHtml?: string;
        routePath?: string;
        relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      },
    ) =>
      runScreenTextContentChange(
        {
          activeFile,
          applyFileContentUpdate,
          applyLinkedComponentEdit,
          canEditDesign,
          canEditLiveScreen,
          designSourceType,
          prepareTextCreationFinalization,
          getScreenContent,
          handleTextContentChange,
          liveScreenSnapshotsById,
          overviewScreens,
          recordPendingLiveTextEdit,
          setActiveFileId,
          setActiveTool,
          setMode,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          updateLiveScreenSnapshotContent,
        },
        screenId,
        selector,
        value,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLinkedComponentEdit,
      canEditDesign,
      canEditLiveScreen,
      designSourceType,
      prepareTextCreationFinalization,
      getScreenContent,
      handleTextContentChange,
      liveScreenSnapshotsById,
      overviewScreens,
      recordPendingLiveTextEdit,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const pendingTextHostCommitRef = useRef({
    commitText: handleScreenTextContentChange,
  });
  pendingTextHostCommitRef.current = {
    commitText: handleScreenTextContentChange,
  };
  useEffect(
    () =>
      registerPendingTextHostCommit((screenId, nodeId, text) =>
        runPendingTextHostCommit(
          pendingTextHostCommitRef.current.commitText,
          screenId,
          nodeId,
          text,
        ),
      ),
    [],
  );

  const getSelectedLayerSnapshots = useCallback(
    (
      selectedElementOverride?: ElementInfo | null,
      selectedElementsByLayerId?: ReadonlyMap<string, ElementInfo>,
    ) => {
      const renderedInfos = new Map(
        selectedLayerTargetsRef.current.map((target) => [
          target.layerId,
          renderedElementInfoByLayerKeyRef.current.get(
            `${target.fileId}:${target.layerId}`,
          ) ?? target.elementInfo,
        ]),
      );
      if (selectedElementLayerId && selectedElement) {
        renderedInfos.set(selectedElementLayerId, selectedElement);
      }
      return runGetSelectedLayerSnapshots({
        activeFile,
        designSourceType,
        files,
        getFreshActiveContent,
        getScreenContent,
        liveScreenSnapshotsById,
        overviewScreens,
        runtimeLayerSnapshotsById,
        selectedElement:
          selectedElementOverride === undefined
            ? selectedElement
            : selectedElementOverride,
        selectedElementsByLayerId: selectedElementsByLayerId ?? renderedInfos,
        selectedElementLayerId,
        selectedLayerIdsState,
      });
    },
    [
      activeFile,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      liveScreenSnapshotsById,
      overviewScreens,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedElementLayerId,
      selectedLayerIdsState,
    ],
  );

  const getCanvasClipboardEntries = useCallback(() => {
    if (copiedLayerEntriesRef.current.length > 0) {
      return copiedLayerEntriesRef.current;
    }
    return copiedLayerHtmlRef.current
      ? [
          {
            html: copiedLayerHtmlRef.current,
            sourceFileId: activeFile?.id ?? "",
          },
        ]
      : [];
  }, [activeFile?.id]);

  const getCanvasScreenClipboardEntries = useCallback(() => {
    return copiedScreenEntriesRef.current ?? [];
  }, []);

  const adoptDesignClipboardPayload = useCallback(
    (
      payload: DesignClipboardPayload,
      markerText: string,
      plainText?: string,
    ) => {
      copiedLayerEntriesRef.current = payload.entries;
      copiedLayerHtmlRef.current = markerText;
      copiedScreenEntriesRef.current = payload.screens ?? [];
      lastWrittenClipboardMarkerRef.current = markerText;
      if (plainText !== undefined) {
        lastWrittenClipboardPlainTextRef.current = plainText;
      }
      setHasCanvasClipboard(
        payload.entries.length > 0 || (payload.screens?.length ?? 0) > 0,
      );
    },
    [],
  );

  const refreshClipboardFromSystemClipboard = useCallback(async () => {
    const result = await readDesignClipboardPayloadFromSystem();
    if (
      result.status !== "found" ||
      result.value.markerText === lastWrittenClipboardMarkerRef.current
    ) {
      return;
    }
    adoptDesignClipboardPayload(
      result.value.payload,
      result.value.markerText,
      result.value.plainText,
    );
  }, [adoptDesignClipboardPayload]);

  const selectInsertedLayers = useCallback(
    (screenId: string, content: string, rootNodeIds: string[]) => {
      const projection = buildCodeLayerProjection(content, {
        source: codeLayerSourceForScreen(screenId),
      });
      const insertedNodes = rootNodeIds
        .map((rootNodeId) =>
          projection.nodes.find(
            (node) =>
              node.id === rootNodeId ||
              node.dataAttributes["data-agent-native-node-id"] === rootNodeId,
          ),
        )
        .filter((node): node is CodeLayerNode => Boolean(node));
      if (insertedNodes.length === 0) return;
      const lastNode = insertedNodes[insertedNodes.length - 1];
      if (lastNode) {
        pendingOverviewScreenSelectionRef.current =
          screenId === boardFileId ? null : screenId;
        pendingOverviewLayerSelectionRef.current = lastNode.id;
        clearPendingOverviewLayerSelectionTimer();
        setCreatedOverviewLayerSelection({
          screenId,
          layerId: lastNode.id,
        });
      }
      setActiveFileId(screenId);
      setSelectedLayerIdsState(insertedNodes.map((node) => node.id));
      setSelectedElement(
        lastNode ? elementInfoFromCodeLayerNode(lastNode) : null,
      );
      setActiveTool("move");
      setMode("edit");
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds(
          screenId === boardFileId ? [] : [screenId],
        );
      }
    },
    [
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerSourceForScreen,
    ],
  );

  const handleCopySelection = useCallback(
    async () =>
      runCopySelection({
        canvasFrameGeometryById,
        copiedLayerEntriesRef,
        copiedLayerHtmlRef,
        copiedScreenEntriesRef,
        designSourceType,
        files,
        getScreenContent,
        getSelectedLayerSnapshots,
        lastWrittenClipboardMarkerRef,
        lastWrittenClipboardPlainTextRef,
        liveScreenSnapshotsById,
        overviewScreens,
        overviewSelectedScreenIds,
        pasteCascadeRef,
        runtimeLayerSnapshotsById,
        setHasCanvasClipboard,
        t,
        viewModeRef,
      }),
    [
      canvasFrameGeometryById,
      designSourceType,
      files,
      getScreenContent,
      getSelectedLayerSnapshots,
      liveScreenSnapshotsById,
      overviewSelectedScreenIds,
      overviewScreens,
      runtimeLayerSnapshotsById,
      t,
    ],
  );

  const pasteCopiedScreens = useCallback(
    (
      screens: DesignClipboardScreenEntry[],
      position?: { x: number; y: number },
    ) =>
      runPasteCopiedScreens(
        {
          canEditDesign,
          canvasFrameGeometryById,
          createFileMutation,
          files,
          id,
          pasteCascadeRef,
          queryClient,
          queueFrameGeometrySave,
          setActiveFileId,
          setActiveTool,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          t,
          viewModeRef,
        },
        screens,
        position,
      ),
    [
      canEditDesign,
      canvasFrameGeometryById,
      createFileMutation,
      files,
      id,
      queryClient,
      queueFrameGeometrySave,
      t,
    ],
  );

  const handlePasteSelection = useCallback(
    async (position?: { x: number; y: number }) =>
      runPasteSelection(
        {
          activeFile,
          applyLinkedComponentEdit,
          selectionBefore: captureCurrentSelection(),
          designId: id,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          clearRedoStacks,
          clipboardPasteRedoStackRef,
          clipboardPasteUndoStackRef,
          files,
          getCanvasClipboardEntries,
          getCanvasScreenClipboardEntries,
          getFreshActiveContent,
          getScreenContent,
          historyOrderRef,
          latestClipboardMutationContentRef,
          pasteCascadeRef,
          pasteCopiedScreens,
          pendingLocalFileContentsRef,
          publishAuthoritativeClipboardMutation,
          refreshClipboardFromSystemClipboard,
          remapMotionTracksForClone,
          runtimeStructureInsertRevisionRef,
          selectInsertedLayers,
          selectedCanvasSelector,
          selectedElement,
          setRuntimeStructureInsertRequest,
          syncUndoRedoState,
          t,
          undoManagerRef,
          viewModeRef,
          zoom,
        },
        position,
      ),
    [
      applyLinkedComponentEdit,
      activeFile,
      id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      getCanvasClipboardEntries,
      getCanvasScreenClipboardEntries,
      getFreshActiveContent,
      getScreenContent,
      historyOrderRef,
      files,
      pasteCopiedScreens,
      publishAuthoritativeClipboardMutation,
      refreshClipboardFromSystemClipboard,
      remapMotionTracksForClone,
      selectInsertedLayers,
      selectedCanvasSelector,
      selectedElement,
      t,
      clearRedoStacks,
      syncUndoRedoState,
      zoom,
    ],
  );

  const resolveFigmaPasteSceneForEditor = useCallback(() => {
    const selectedNodeId =
      selectedElement?.runtimeSourceId ?? selectedElement?.sourceId ?? null;
    return resolveFigmaPasteScene({
      viewMode: viewModeRef.current,
      activeFileId: activeFile?.id,
      boardFileId,
      overviewSelectedScreenIds,
      selectedNodeId,
      selectedIsContainer:
        Boolean(selectedNodeId && activeFile) &&
        resolvePastePlacementForSelection({
          content: getScreenContent(activeFile!.id),
          selectedElement,
        })?.placement === "inside",
      canvasRoot: canvasContainerRef.current,
      screens: getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById,
      })
        .filter((entry) => entry.id !== boardFileId)
        .map((entry) => ({ fileId: entry.id, ...entry.geometry })),
      visibleCanvasRect: visibleCanvasRectRef.current?.() ?? null,
    });
  }, [
    activeFile,
    boardFileId,
    canvasFrameGeometryById,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
  ]);

  const insertFigmaPasteLayers = useCallback(
    (
      fileId: string,
      selector: string | null,
      layers: FigmaPasteLayerInsert[],
    ) =>
      runInsertFigmaPasteLayers(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          canvasContainerRef,
          getFreshActiveContent,
          getScreenContent,
          pendingLocalFileContentsRef,
          selectInsertedLayers,
          viewModeRef,
        },
        fileId,
        selector,
        layers,
      ),
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      getFreshActiveContent,
      getScreenContent,
      selectInsertedLayers,
    ],
  );

  const importFigmaClipboardIntoDesign = useCallback(
    async (content: string) =>
      runImportFigmaClipboardIntoDesign(
        {
          boardFileId,
          canEditDesign,
          figmaPasteImportingRef,
          id,
          insertPasteLayers: insertFigmaPasteLayers,
          navigate,
          queryClient,
          resolvePasteScene: resolveFigmaPasteSceneForEditor,
          showPastedImagesNotice,
          t,
        },
        content,
      ),
    [
      boardFileId,
      canEditDesign,
      id,
      insertFigmaPasteLayers,
      navigate,
      queryClient,
      resolveFigmaPasteSceneForEditor,
      t,
    ],
  );

  const showPastedImagesNotice = useCallback(
    ({ count, fileIds }: { count: number; fileIds: string[] }) => {
      if (figmaPasteImageNoticeDismissed()) return;
      toast.custom(
        (toastId) => (
          <FigmaPasteImagesNotice
            count={count}
            designId={id ?? ""}
            fileIds={fileIds}
            onConnect={() => {
              setFigmaHydrationFileIds(fileIds);
              setFigmaHydrationOpen(true);
            }}
            onDismissForever={dismissFigmaPasteImageNotice}
            onHydrated={() => {
              void queryClient.invalidateQueries({ queryKey: ["action"] });
            }}
            onClose={() => toast.dismiss(toastId)}
          />
        ),
        { duration: Infinity },
      );
    },
    [id, queryClient],
  );

  const handlePastedSvg = useCallback(
    (source: string, sourceScreenId?: string) => {
      const parsed = parsePastedSvg(source);
      if (!parsed || !canEditDesign || !activeFile?.id) return false;

      let targetFileId = activeFile.id;
      let point = { x: 120, y: 120 };
      const pastedIntoScreen =
        sourceScreenId &&
        sourceScreenId !== boardFileId &&
        files.some((file) => file.id === sourceScreenId);
      if (pastedIntoScreen) {
        targetFileId = sourceScreenId;
        const frame = getAllScreenFrameEntries({
          overviewScreens,
          canvasFrameGeometryById,
        }).find((candidate) => candidate.id === sourceScreenId);
        if (frame) {
          point = {
            x: frame.geometry.width / 2,
            y: frame.geometry.height / 2,
          };
        }
      } else if (viewModeRef.current === "single") {
        const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
          "[data-design-preview-iframe]",
        );
        const rect = iframe?.getBoundingClientRect();
        const factor = zoom / 100;
        point = rect
          ? {
              x: Math.max(0, rect.width / 2 / factor),
              y: Math.max(0, rect.height / 2 / factor),
            }
          : point;
      } else if (boardFileId) {
        const frames = getAllScreenFrameEntries({
          overviewScreens,
          canvasFrameGeometryById,
        });
        let anchor = (() => {
          if (overviewSelectedScreenIds.length === 1) {
            const selected = frames.find(
              (frame) => frame.id === overviewSelectedScreenIds[0],
            );
            if (selected) {
              return {
                x: selected.geometry.x + selected.geometry.width / 2,
                y: selected.geometry.y + selected.geometry.height / 2,
              };
            }
          }
          return getOverviewCanvasCenter(canvasContainerRef.current);
        })();
        const hitFrame = findScreenFrameAtCanvasPoint(
          anchor,
          frames,
          boardFileId,
        );
        targetFileId = hitFrame?.id ?? boardFileId;
        if (hitFrame) {
          anchor = {
            x: anchor.x - hitFrame.geometry.x,
            y: anchor.y - hitFrame.geometry.y,
          };
        }
        point = anchor;
      }

      const nodeId = uniqueLayerId("pasted-svg");
      const svgDocument = new DOMParser().parseFromString(
        parsed.svg,
        "image/svg+xml",
      );
      const root = svgDocument.documentElement;
      root.setAttribute("data-agent-native-node-id", nodeId);
      root.setAttribute("data-agent-native-layer-name", "Pasted SVG");
      root.setAttribute("data-an-primitive", "pasted-svg");
      root.setAttribute(
        "style",
        `${root.getAttribute("style") ?? ""};position:absolute;width:${parsed.width}px;height:${parsed.height}px;`,
      );
      const layerHtml = root.outerHTML;
      const baseContent =
        targetFileId === activeFile.id
          ? (getFreshActivePreviewContent() ?? getFreshActiveContent())
          : getScreenContent(targetFileId);
      const insertion = insertClonedHtmlLayers(baseContent, [layerHtml], {
        positions: [{ ...point, space: "visual" }],
      });
      if (!insertion) {
        toast.error(t("designEditor.toasts.duplicateElementFailed"));
        return true;
      }
      const nextContent = insertion.content;
      if (targetFileId === activeFile.id) {
        replacePreviewContent(nextContent, null, { forceFullDocument: true });
        applyLocalContentUpdate(nextContent, {
          forcePreviewFullDocument: true,
        });
      } else {
        applyFileContentUpdate(targetFileId, nextContent, {
          forcePreviewFullDocument: true,
        });
      }
      selectInsertedLayers(targetFileId, nextContent, insertion.rootNodeIds);
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canvasContainerRef,
      canvasFrameGeometryById,
      files,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectInsertedLayers,
      t,
      viewModeRef,
      zoom,
    ],
  );

  const handleCanvasFigmaClipboardPaste = useCallback(
    ({
      content,
      sourceScreenId,
      svg,
      svgFileError,
      html,
      text,
    }: IframeFigmaClipboardPastePayload) => {
      if (svgFileError) {
        if (canEditDesign) toast.error(t("common.genericError"));
        return;
      }
      if (content) {
        void importFigmaClipboardIntoDesign(content);
        return;
      }
      if (svg) {
        handlePastedSvg(svg, sourceScreenId);
        return;
      }
      const relayed = {
        getData: (type: string) =>
          type === "text/html"
            ? (html ?? "")
            : type === "text/plain"
              ? (text ?? "")
              : "",
      };
      if (!isAttemptedFigmaPaste(relayed)) return;
      toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
        description: t("designEditor.import.figmaPasteUnreadable"),
      });
    },
    [canEditDesign, handlePastedSvg, importFigmaClipboardIntoDesign, t],
  );

  const readFileAsDataUrl = useCallback((file: File) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : "");
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }, []);

  const uploadImageFileForHtml = useCallback(
    async (file: File) => {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl) return "";
      const result = (await callAction("upload-image", {
        data: dataUrl,
        filename: file.name,
      })) as { url?: string; error?: string };
      if (result.url) return result.url;
      toast.error(t("common.genericError"), {
        description:
          result.error ||
          "File storage is not configured. Connect an upload provider before inserting local images.",
      });
      return "";
    },
    [readFileAsDataUrl],
  );

  const uploadMediaFileForHtml = useCallback(
    (file: File) =>
      file.type.toLowerCase().startsWith("video/")
        ? uploadDesignVideoFile(file)
        : uploadImageFileForHtml(file),
    [uploadImageFileForHtml],
  );

  const handlePastedImageFiles = useCallback(
    (
      files: File[],
      target?: PastedImageFilesTarget | PastedImageFilesClientAnchor,
    ) =>
      runPastedImageFiles(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          getVisibleCanvasRect: () => visibleCanvasRectRef.current?.() ?? null,
          canvasFrameGeometryById,
          getFreshActiveContent,
          getFreshActivePreviewContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          replacePreviewContent,
          selectInsertedLayers,
          t,
          uploadMediaFileForHtml,
          viewModeRef,
          zoom,
        },
        files,
        target,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canvasFrameGeometryById,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectInsertedLayers,
      t,
      uploadMediaFileForHtml,
      zoom,
    ],
  );

  const handleCanvasImagePaste = useCallback(
    ({ files, screenId }: IframeImagePastePayload) => {
      if (files.length === 0 || !canEditDesign) return;
      const fileObjects = files.map(({ dataUrl, type, name }) => {
        const comma = dataUrl.indexOf(",");
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        return new File(
          [new Blob([bytes], { type })],
          name || "pasted-image.png",
          { type },
        );
      });
      const frame = screenId ? canvasFrameGeometryById[screenId] : undefined;
      const screen = screenId
        ? overviewScreens.find((candidate) => candidate.id === screenId)
        : undefined;
      handlePastedImageFiles(
        fileObjects,
        screenId
          ? {
              fileId: screenId,
              point: {
                x: (frame?.width ?? screen?.width ?? 0) / 2,
                y: (frame?.height ?? screen?.height ?? 0) / 2,
              },
            }
          : undefined,
      );
    },
    [
      canEditDesign,
      canvasFrameGeometryById,
      handlePastedImageFiles,
      overviewScreens,
    ],
  );

  const insertDroppedImageFiles = useCallback(
    (
      files: File[],
      targetFileId: string,
      localPoint: { x: number; y: number },
    ) =>
      runPastedImageFiles(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          getVisibleCanvasRect: () => visibleCanvasRectRef.current?.() ?? null,
          canvasFrameGeometryById,
          getFreshActiveContent,
          getFreshActivePreviewContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          replacePreviewContent,
          selectInsertedLayers,
          t,
          uploadMediaFileForHtml,
          viewModeRef,
          zoom,
        },
        files,
        { fileId: targetFileId, point: localPoint },
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canvasContainerRef,
      canvasFrameGeometryById,
      getFreshActiveContent,
      getFreshActivePreviewContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      replacePreviewContent,
      selectInsertedLayers,
      t,
      uploadMediaFileForHtml,
      viewModeRef,
      zoom,
    ],
  );

  const handleDesignMediaFiles = useCallback(
    async (files: File[]) => {
      const imageAndVideoFiles: File[] = [];
      for (const file of files) {
        const isSvg =
          file.name.toLowerCase().endsWith(".svg") ||
          file.type.toLowerCase() === "image/svg+xml";
        if (isSvg) {
          if (file.size > 1_000_000) {
            toast.error(t("common.genericError"));
            continue;
          }

          let source: string;
          try {
            source = await file.text();
          } catch {
            toast.error(t("common.genericError"));
            continue;
          }

          if (handlePastedSvg(source)) continue;
          toast.error(t("common.genericError"));
          continue;
        }
        imageAndVideoFiles.push(file);
      }
      handlePastedImageFiles(imageAndVideoFiles);
    },
    [handlePastedImageFiles, handlePastedSvg],
  );

  const handleOverviewDropFiles = useCallback(
    (files: File[], target: { canvasPoint: Point; frameId?: string }) => {
      if (!boardFileId) return;
      if (target.frameId) {
        const frame = getAllScreenFrameEntries({
          overviewScreens,
          canvasFrameGeometryById,
        }).find((entry) => entry.id === target.frameId);
        if (frame) {
          insertDroppedImageFiles(files, target.frameId, {
            x: target.canvasPoint.x - frame.geometry.x,
            y: target.canvasPoint.y - frame.geometry.y,
          });
          return;
        }
      }
      insertDroppedImageFiles(files, boardFileId, target.canvasPoint);
    },
    [
      boardFileId,
      canvasFrameGeometryById,
      insertDroppedImageFiles,
      overviewScreens,
    ],
  );

  const handleSingleScreenDropFiles = useCallback(
    (
      files: File[],
      target: { screenContentPoint: Point; screenId?: string },
    ) => {
      const targetFileId = target.screenId ?? activeFile?.id;
      if (!targetFileId) return;
      insertDroppedImageFiles(files, targetFileId, target.screenContentPoint);
    },
    [activeFile?.id, insertDroppedImageFiles],
  );

  const handleEditorPaste = useCallback(
    (event: ClipboardEvent) =>
      runEditorPaste(
        {
          adoptDesignClipboardPayload,
          canEditDesign,
          handlePasteSelection,
          handlePastedFiles: handleDesignMediaFiles,
          handlePastedSvg,
          hasCanvasClipboard,
          importFigmaClipboardIntoDesign,
          lastWrittenClipboardMarkerRef,
          lastWrittenClipboardPlainTextRef,
          t,
        },
        event,
      ),
    [
      adoptDesignClipboardPayload,
      canEditDesign,
      handlePasteSelection,
      handleDesignMediaFiles,
      handlePastedSvg,
      hasCanvasClipboard,
      importFigmaClipboardIntoDesign,
      t,
    ],
  );

  useEffect(() => {
    if (hostOwnsChrome) return;
    document.addEventListener("paste", handleEditorPaste, true);
    return () => {
      document.removeEventListener("paste", handleEditorPaste, true);
    };
  }, [handleEditorPaste, hostOwnsChrome]);

  const handlePasteOverSelection = useCallback(
    () =>
      runPasteOverSelection({
        activeFile,
        applyLocalContentUpdate,
        getCanvasClipboardEntries,
        getFreshActiveContent,
        handlePasteSelection,
        selectedElement,
        selectInsertedLayers,
        t,
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      handlePasteSelection,
      selectInsertedLayers,
      selectedElement,
      t,
    ],
  );

  const handleContextMenuPaste = useCallback(
    (point?: CanvasContextMenuPoint) =>
      runContextMenuPaste(
        {
          canEditDesign,
          clipboardFiles: menuClipboardFilesRef.current,
          handlePasteSelection,
          handlePastedImageFiles,
          insertDroppedImageFiles,
        },
        point,
      ),
    [
      canEditDesign,
      handlePasteSelection,
      handlePastedImageFiles,
      insertDroppedImageFiles,
    ],
  );

  const handlePasteToReplace = useCallback(
    async (menuClipboardFiles?: File[]) => {
      const replace = (externalLayerHtml?: string) =>
        runPasteToReplace(
          {
            activeFile,
            applyLocalContentUpdate,
            canEditDesign,
            getCanvasClipboardEntries,
            getFreshActiveContent,
            runtimeStructureInsertRevisionRef,
            selectInsertedLayers,
            selectedCanvasSelector,
            selectedElement,
            setRuntimeStructureInsertRequest,
            t,
          },
          externalLayerHtml,
        );
      let clipboardFiles: File[] | null;
      if (menuClipboardFiles !== undefined) {
        clipboardFiles = menuClipboardFiles;
      } else {
        const clipboardContents = await readSystemClipboard();
        clipboardFiles =
          clipboardContents === null ? null : clipboardContents.files;
      }
      await runSystemPasteToReplace({
        clipboardFiles,
        replaceWithLayerCopy: () => replace(),
        replaceWithHtml: replace,
        t,
        uploadImageFileForHtml,
      });
    },
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      uploadImageFileForHtml,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      selectedCanvasSelector,
      selectInsertedLayers,
      selectedElement?.boundingRect,
      selectedElement?.runtimeSelector,
      selectedElement?.runtimeSourceId,
      selectedElement?.selector,
      selectedElement?.sourceId,
      t,
    ],
  );

  const handleDuplicateSelection = useCallback(
    () =>
      runDuplicateSelection({
        activeFile,
        applyLinkedComponentEdit,
        selectionBefore: captureCurrentSelection(),
        designId: id,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        canEditLiveScreen: canEditActiveVisualScreen,
        files,
        getFreshActiveContent,
        getScreenContent,
        getSelectedLayerSnapshots,
        handleDuplicateScreen,
        lastDuplicateTransformRef,
        overviewSelectedScreenIds,
        remapMotionTracksForClone,
        runtimeStructureInsertRevisionRef,
        selectedCanvasSelector,
        selectedElement,
        selectedLayerIdsState,
        setRuntimeStructureInsertRequest,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
        viewModeRef,
      }),
    [
      applyLinkedComponentEdit,
      activeFile,
      id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      files,
      getFreshActiveContent,
      getScreenContent,
      getSelectedLayerSnapshots,
      handleDuplicateScreen,
      overviewSelectedScreenIds,
      remapMotionTracksForClone,
      runtimeStructureInsertRevisionRef,
      selectedCanvasSelector,
      selectedElement,
      t,
    ],
  );

  const handleDeleteSelection = useCallback(
    () =>
      runDeleteSelection({
        applyLinkedComponentEdit,
        t,
        activeBreakpointUpperBoundPx,
        activeBreakpointWidthStateRef,
        activeCanvasSourceType,
        activeFile,
        boardFileId,
        boardSelectionWorldBounds: boardSelectionWorldBoundsRef.current,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        canEditLiveScreen: canEditActiveVisualScreen,
        codeLayerOwnerByNodeIdRef,
        deleteRuntimeElement,
        files,
        getFreshActiveContent,
        getScreenContent,
        getSelectedLayerSnapshots,
        liveScreenSnapshotsById,
        previousMotionFileIdRef,
        pruneMotionTracksByNodeId,
        recordPendingLiveStructureEdit,
        responsiveEditScopeRef,
        selectedElement,
        selectedLayerIdsState,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        syncLiveScreenSnapshotPreview,
        undoManagerRef,
        updateLiveScreenSnapshotContent,
        viewModeRef,
      }),
    [
      applyLinkedComponentEdit,
      activeBreakpointUpperBoundPx,
      activeCanvasSourceType,
      activeFile,
      boardFileId,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      canEditActiveVisualScreen,
      deleteRuntimeElement,
      recordPendingLiveStructureEdit,
      files,
      getFreshActiveContent,
      getScreenContent,
      getSelectedLayerSnapshots,
      liveScreenSnapshotsById,
      pruneMotionTracksByNodeId,
      selectedElement,
      selectedLayerIdsState,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const sendRuntimeLayerSemanticHandoff = useCallback(
    (
      operation: "group" | "ungroup" | "auto-layout",
      layerIds: readonly string[],
      options: {
        desiredChange?: string;
        description?: string;
        commandContext?: string;
      } = {},
    ): boolean =>
      runSendRuntimeLayerSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        operation,
        layerIds,
        options,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const sendRuntimeLayerMoveSemanticHandoff = useCallback(
    (
      subjectLayerId: string,
      targetLayerId: string,
      placement: "before" | "after" | "inside",
    ): boolean =>
      runSendRuntimeLayerMoveSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        subjectLayerId,
        targetLayerId,
        placement,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const sendRuntimeLayerStateSemanticHandoff = useCallback(
    (
      layerId: string,
      state: "locked" | "hidden",
      enabled: boolean,
    ): true | "preview-only" | false =>
      runSendRuntimeLayerStateSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef,
          localhostConnectionRootPathByIdRef,
          overviewScreens,
          runtimeLayerSnapshotsById,
          setActiveLeftPanel,
          t,
        },
        layerId,
        state,
        enabled,
      ),
    [overviewScreens, runtimeLayerSnapshotsById, t],
  );

  const handleGroupSelection = useCallback(
    () =>
      runGroupSelection({
        activeBreakpointWidthState,
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        boardFileId,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeBreakpointWidthState,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleBooleanSubtractSelection = useCallback(
    () =>
      runBooleanSubtractSelection({
        activeFile,
        applyLocalContentUpdate,
        canEditDesign,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleFrameSelection = useCallback(
    () =>
      runFrameSelection({
        activeBreakpointWidthState,
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        boardFileId,
        canEditDesign,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        files,
        getFreshActiveContent,
        overviewSelectedScreenIds,
        selectedLayerIdsState,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
      }),
    [
      activeBreakpointWidthState,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      files,
      getFreshActiveContent,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      t,
    ],
  );

  const liveElementForNode = useCallback(
    (node: CodeLayerNode): HTMLElement | null => {
      if (typeof document === "undefined") return null;
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      const stableId = node.dataAttributes["data-agent-native-node-id"];
      const selectors = [
        ...(stableId
          ? [`[data-agent-native-node-id="${CSS.escape(stableId)}"]`]
          : []),
        ...node.selectors,
        node.selector,
      ];
      for (const selector of selectors) {
        if (!selector) continue;
        try {
          const found = doc.querySelectorAll<HTMLElement>(selector);
          if (found.length === 1) return found[0]!;
        } catch {
          // coercion-ok: a projection selector may not be valid CSS
        }
      }
      return null;
    },
    [],
  );

  const liveBoxesForNode = useCallback(
    (
      node: CodeLayerNode,
    ): {
      self: { x: number; y: number; width: number; height: number } | null;
      parent: { width: number; height: number } | null;
    } | null => {
      const el = liveElementForNode(node);
      if (!el) return null;
      const parent = el.parentElement;
      const offsetParent = el.offsetParent;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const self =
        offsetParent && parent
          ? offsetParent === parent
            ? { x: el.offsetLeft, y: el.offsetTop, ...size }
            : parent.offsetParent === offsetParent
              ? {
                  x: el.offsetLeft - parent.offsetLeft - parent.clientLeft,
                  y: el.offsetTop - parent.offsetTop - parent.clientTop,
                  ...size,
                }
              : null
          : null;
      return {
        self,
        parent:
          parent &&
          offsetParent === parent &&
          parent.clientWidth > 0 &&
          parent.clientHeight > 0
            ? { width: parent.clientWidth, height: parent.clientHeight }
            : null,
      };
    },
    [liveElementForNode],
  );

  const rectLiveFallbackForNode = useCallback(
    (node: CodeLayerNode) => liveBoxesForNode(node)?.self ?? null,
    [liveBoxesForNode],
  );

  const measureAlignParentBox = useCallback(
    (node: CodeLayerNode, parentNode: CodeLayerNode) => {
      const boxes = liveBoxesForNode(node);
      if (boxes) return boxes.parent;
      const width = authoredPxLength(parentNode.style.width);
      const height = authoredPxLength(parentNode.style.height);
      if (width === null || height === null) return null;
      return width > 0 && height > 0 ? { width, height } : null;
    },
    [liveBoxesForNode],
  );

  const liveComputedLayoutForNode = useCallback(
    (node: CodeLayerNode) => {
      const element = liveElementForNode(node);
      if (!element) return null;
      const computed =
        element.ownerDocument.defaultView?.getComputedStyle(element);
      if (!computed) return null;
      return {
        display: computed.display,
        transform: computed.transform,
        rotate: computed.rotate,
        scale: computed.scale,
      };
    },
    [liveElementForNode],
  );

  const rectFromCodeLayerNode = useCallback(
    (node: CodeLayerNode): AlignableRect => {
      const authoredX = authoredPxLength(node.style.left);
      const authoredY = authoredPxLength(node.style.top);
      const authoredWidth = authoredPxLength(node.style.width);
      const authoredHeight = authoredPxLength(node.style.height);
      const live =
        authoredX !== null &&
        authoredY !== null &&
        authoredWidth !== null &&
        authoredHeight !== null
          ? null
          : rectLiveFallbackForNode(node);
      return mergeAuthoredAndLiveRect({
        id: node.id,
        authored: {
          x: authoredX ?? undefined,
          y: authoredY ?? undefined,
          width: authoredWidth ?? undefined,
          height: authoredHeight ?? undefined,
        },
        live,
      });
    },
    [rectLiveFallbackForNode],
  );

  const getActiveFileSelectedNodeIds = useCallback(
    (content: string): string[] => {
      if (!activeFile?.id) return [];
      const fileIds = new Set(files.map((file) => file.id));
      const activeNodeIdSet = buildActiveFileNodeIdSet(
        buildCodeLayerProjection(content, {
          source: codeLayerSourceForScreen(activeFile.id),
        }),
      );
      return selectedLayerIdsState.filter(
        (layerId) =>
          !layerId.startsWith("__") &&
          !fileIds.has(layerId) &&
          activeNodeIdSet.has(layerId),
      );
    },
    [activeFile?.id, codeLayerSourceForScreen, files, selectedLayerIdsState],
  );

  const commitNodePositions = useCallback(
    (
      baseContent: string,
      positions: ReadonlyMap<string, { x: number; y: number }>,
      providedSource?: CodeLayerSource,
    ): boolean => {
      if (positions.size === 0 || !activeFile?.id) return false;
      if (providedSource && providedSource.fileId !== activeFile.id)
        return false;
      const source = providedSource ?? codeLayerSourceForScreen(activeFile.id);
      let content = baseContent;
      let appliedAny = false;
      for (const [nodeId, position] of positions) {
        const projection = buildCodeLayerProjection(content, { source });
        const node = projection.nodes.find((n) => n.id === nodeId);
        if (node && !isAbsoluteCodeLayerNode(node)) {
          const positionPatch = applyVisualEdit(
            content,
            {
              kind: "style",
              target: { nodeId },
              property: "position",
              value: "absolute",
            },
            { source },
          );
          if (positionPatch.result.status === "applied") {
            content = positionPatch.content;
          }
        }
        const leftPatch = applyVisualEdit(
          content,
          {
            kind: "style",
            target: { nodeId },
            property: "left",
            value: `${position.x}px`,
          },
          { source },
        );
        if (leftPatch.result.status !== "applied") continue;
        content = leftPatch.content;
        const topPatch = applyVisualEdit(
          content,
          {
            kind: "style",
            target: { nodeId },
            property: "top",
            value: `${position.y}px`,
          },
          { source },
        );
        if (topPatch.result.status !== "applied") continue;
        content = topPatch.content;
        appliedAny = true;
      }
      if (!appliedAny) return false;
      applyLocalContentUpdate(content, { forcePreviewFullDocument: true });
      return true;
    },
    [activeFile?.id, applyLocalContentUpdate, codeLayerSourceForScreen],
  );

  const handleApplyLayoutFlow = useCallback(
    (nodeId: string | null, containerStyles: Record<string, string>) => {
      const content = getFreshActiveContent();
      const selectedNodeIds = content
        ? getActiveFileSelectedNodeIds(content)
        : [];
      const selectedFileIds = new Set(files.map((file) => file.id));
      const selectableLayerIds = selectedLayerIdsState.filter(
        (layerId) => !layerId.startsWith("__") && !selectedFileIds.has(layerId),
      );
      if (
        selectableLayerIds.length > 1 &&
        selectedNodeIds.length !== selectableLayerIds.length
      ) {
        return "unsupported" as const;
      }
      const targetIds =
        selectedNodeIds.length > 0 ? selectedNodeIds : nodeId ? [nodeId] : [];
      return runApplyLayoutFlow(
        {
          applyLocalContentUpdate,
          canEditDesign,
          getFreshActiveContent,
          ...(activeFile?.id
            ? { source: codeLayerSourceForScreen(activeFile.id) }
            : {}),
          t,
        },
        targetIds,
        containerStyles,
      );
    },
    [
      applyLocalContentUpdate,
      canEditDesign,
      activeFile?.id,
      codeLayerSourceForScreen,
      files,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      selectedLayerIdsState,
      t,
    ],
  );

  const handleDisableAutoLayout = useCallback(
    (nodeId: string) => {
      if (!canEditDesign) return;
      if (!activeFile?.id) return;
      const baseContent = getFreshActiveContent();
      if (!baseContent) {
        trace("structure", "freeform-abandoned", {
          reason: "no active content",
          nodeId,
        });
        return;
      }
      const geometry = measureFreeformGeometry(nodeId);
      const patch = applyVisualEdit(
        baseContent,
        {
          kind: "autoLayout",
          targetId: nodeId,
          enabled: false,
          childRects: geometry.children,
          ...(geometry.container ? { containerRect: geometry.container } : {}),
        },
        { source: codeLayerSourceForScreen(activeFile.id) },
      );
      trace("structure", "freeform", {
        nodeId,
        measuredChildren: Object.keys(geometry.children).length,
        measuredContainer: geometry.container !== null,
        status: patch.result.status,
      });
      if (patch.result.status !== "applied") return;
      applyLocalContentUpdate(patch.content, {
        forcePreviewFullDocument: true,
      });
    },
    [
      activeFile?.id,
      applyLocalContentUpdate,
      canEditDesign,
      codeLayerSourceForScreen,
      getFreshActiveContent,
    ],
  );

  const handleAlignSelection = useCallback(
    (edge: DesignHotkeyAlignEdge) =>
      runAlignSelection(
        {
          activeFile,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          commitNodePositions,
          designDataJsonRef,
          files,
          getActiveFileSelectedNodeIds,
          getFreshActiveContent,
          handleGeometryCommit,
          measureAlignParentBox,
          overviewScreens,
          overviewSelectedScreenIds,
          rectFromCodeLayerNode,
          selectedElement,
          selectedLayerIdsState,
          viewModeRef,
        },
        edge,
      ),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      handleGeometryCommit,
      measureAlignParentBox,
      overviewScreens,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      rectFromCodeLayerNode,
    ],
  );

  const alignAvailability = useMemo(
    () =>
      alignSelectionAvailability({
        canEditDesign,
        fileIds: files.map((file) => file.id),
        measureAlignParentBox,
        overviewSelectedScreenIds,
        resolveNodesById: () =>
          new Map(
            activeCodeLayerProjection.nodes.map((node) => [node.id, node]),
          ),
        selectedElement,
        selectedLayerIds: selectedLayerIdsState,
        viewMode,
      }),
    [
      activeCodeLayerProjection,
      canEditDesign,
      files,
      measureAlignParentBox,
      overviewSelectedScreenIds,
      selectedElement,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  const handleDistributeSelection = useCallback(
    (axis: DesignHotkeyDistributeAxis) =>
      runDistributeSelection(
        {
          activeFile,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          commitNodePositions,
          designDataJsonRef,
          getActiveFileSelectedNodeIds,
          getFreshActiveContent,
          handleGeometryCommit,
          overviewScreens,
          overviewSelectedScreenIds,
          rectFromCodeLayerNode,
          viewModeRef,
        },
        axis,
      ),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      handleGeometryCommit,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
    ],
  );

  const getScreenGroupFootprint = useCallback(
    (
      screenId: string,
      geometry: CanvasFrameGeometry,
      breakpointWidthsOverride?: readonly number[],
    ): { x: number; y: number; width: number; height: number } => {
      const x = geometry.x ?? 0;
      const y = geometry.y ?? 0;
      const width = geometry.width ?? 0;
      const height = geometry.height ?? 0;
      const screen = overviewScreens.find((item) => item.id === screenId);
      if (!screen) return { x, y, width, height };
      return getResponsiveScreenCullGeometry(
        {
          id: screenId,
          metadata: {
            width: screen.width ?? width,
            height: screen.height ?? height,
          },
          breakpointWidths: breakpointWidthsOverride ?? screen.breakpointWidths,
        },
        { x, y, width, height, rotation: geometry.rotation },
        (widthPx) =>
          getResponsiveBreakpointHeightPx(
            { breakpointHeights: screen.breakpointHeights },
            widthPx,
          ),
      );
    },
    [overviewScreens],
  );

  const reflowOverviewScreensForBreakpoints = useCallback(
    (breakpointWidths: readonly number[]) => {
      if (!canEditDesignRef.current) return;
      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const candidates: ReflowCandidate[] = overviewScreens.map(
        (screen, index) => {
          const geometry = {
            ...getInitialFrameGeometry(index, {
              width: screen.width ?? 1280,
              height: screen.height ?? 2560,
            }),
            ...before[screen.id],
          };
          const footprint = getScreenGroupFootprint(
            screen.id,
            geometry,
            breakpointWidths,
          );
          return {
            id: screen.id,
            geometry,
            footprint: {
              id: screen.id,
              x: footprint.x,
              y: footprint.y,
              width: footprint.width,
              height: footprint.height,
            },
          };
        },
      );
      const reflowed = computeOverlapReflowGeometry(candidates);
      if (reflowed.size === 0) return;
      const after = cloneCanvasFrameGeometry(before);
      reflowed.forEach((geometry, screenId) => {
        after[screenId] = { ...after[screenId], ...geometry };
      });
      handleGeometryCommit(before, after);
    },
    [getScreenGroupFootprint, handleGeometryCommit, overviewScreens],
  );

  const handleTidyUp = useCallback(
    () =>
      runTidyUp({
        activeFile,
        boardFileId,
        boardFrameGeometry,
        canEditDesign,
        commitNodePositions,
        designDataJsonRef,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        getScreenGroupFootprint,
        handleGeometryCommit,
        overviewScreens,
        overviewSelectedScreenIds,
        rectFromCodeLayerNode,
        viewModeRef,
      }),
    [
      activeFile,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      commitNodePositions,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      getScreenGroupFootprint,
      handleGeometryCommit,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
    ],
  );

  const canSuggestAutoLayout = useMemo(() => {
    if (!canEditDesign || !activeFile || viewMode !== "single") return false;
    const resolvedSourceType = activeCanvasSourceType ?? designSourceType;
    if (resolvedSourceType !== "inline" && resolvedSourceType !== "localhost") {
      return false;
    }
    const sourceContent =
      resolvedSourceType === "localhost"
        ? runtimeLayerSnapshotsById[activeFile.id]?.html
        : getFreshActiveContent();
    if (!sourceContent) return false;
    const projection = buildCodeLayerProjection(sourceContent, {
      source: codeLayerSourceForScreen(activeFile.id),
    });
    const selectedIds = getActiveFileSelectedNodeIds(sourceContent);
    if (selectedIds.length !== 1) return false;
    const container = projection.nodes.find(
      (node) => node.id === selectedIds[0],
    );
    const computedLayout = container
      ? liveComputedLayoutForNode(container)
      : null;
    return Boolean(
      container &&
      container.children.length > 0 &&
      !isExistingFlowLayout({
        display: container.style.display,
        computedDisplay: computedLayout?.display,
        classes: container.classes,
      }),
    );
  }, [
    activeCanvasSourceType,
    activeFile,
    canEditDesign,
    codeLayerSourceForScreen,
    designSourceType,
    getActiveFileSelectedNodeIds,
    getFreshActiveContent,
    liveComputedLayoutForNode,
    runtimeLayerSnapshotsById,
    viewMode,
  ]);

  const handleSuggestAutoLayout = useCallback(
    () =>
      runSuggestAutoLayout({
        activeCanvasSourceType,
        activeFile,
        canEditDesign,
        designSourceType,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        liveComputedLayoutForNode,
        rectFromCodeLayerNode,
        runtimeLayerSnapshotsById,
        setAutoLayoutSuggestionPreview,
        t,
        viewModeRef,
      }),
    [
      activeCanvasSourceType,
      activeFile,
      canEditDesign,
      designSourceType,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      liveComputedLayoutForNode,
      rectFromCodeLayerNode,
      runtimeLayerSnapshotsById,
      t,
    ],
  );

  const handleApplyAutoLayoutSuggestion = useCallback(() => {
    const preview = autoLayoutSuggestionPreview;
    if (!preview) return;
    const currentContent =
      preview.sourceType === "localhost"
        ? runtimeLayerSnapshotsById[preview.screenId]?.html
        : getFreshActiveContent();
    if (
      !currentContent ||
      sourceContentHash(currentContent) !== preview.contentHash
    ) {
      toast.error(t("designEditor.autoLayoutSuggestion.stale"));
      setAutoLayoutSuggestionPreview(null);
      return;
    }

    if (preview.sourceType === "localhost") {
      const proposal = preview.suggestion;
      sendRuntimeLayerSemanticHandoff("auto-layout", [proposal.containerId], {
        desiredChange: `Apply the user-reviewed auto-layout proposal atomically: ${proposal.direction} flow; child source order ${proposal.orderedChildIds.join(", ")}; ${proposal.gap}px gap; padding ${proposal.padding.top}px ${proposal.padding.right}px ${proposal.padding.bottom}px ${proposal.padding.left}px; align-items ${proposal.alignItems}; justify-content ${proposal.justifyContent}; horizontal sizing ${proposal.horizontalSizing}; vertical sizing ${proposal.verticalSizing}. Preserve nested absolute-positioned descendants and unrelated responsive behavior.`,
        description: "apply the reviewed auto-layout suggestion",
        commandContext:
          "The user previewed and explicitly approved this measured geometry proposal. Make one source transaction so undo restores the exact prior structure.",
      });
      setAutoLayoutSuggestionPreview(null);
      return;
    }

    const result = applyAutoLayoutSuggestion(
      currentContent,
      preview.suggestion,
      codeLayerSourceForScreen(preview.screenId),
    );
    if (result.status !== "applied") {
      toast.error(t("designEditor.autoLayoutSuggestion.stale"));
      setAutoLayoutSuggestionPreview(null);
      return;
    }
    applyLocalContentUpdate(result.content, {
      forcePreviewFullDocument: true,
    });
    setAutoLayoutSuggestionPreview(null);
  }, [
    applyLocalContentUpdate,
    autoLayoutSuggestionPreview,
    codeLayerSourceForScreen,
    getFreshActiveContent,
    runtimeLayerSnapshotsById,
    sendRuntimeLayerSemanticHandoff,
    t,
  ]);

  const handleAddAutoLayout = useCallback(
    () =>
      runAddAutoLayout({
        activeFile,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        designSourceType,
        effectiveCodeLayerStateRef,
        files,
        getActiveFileSelectedNodeIds,
        getFreshActiveContent,
        getScreenContent,
        overviewScreens,
        overviewSelectedScreenIds,
        rectFromCodeLayerNode,
        runtimeLayerSnapshotsById,
        selectedElement,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        viewModeRef,
      }),
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      designSourceType,
      getActiveFileSelectedNodeIds,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      rectFromCodeLayerNode,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleToggleMinimalUi = useCallback(() => {
    setMinimalUi((current) => !current);
    setUiHidden(false);
  }, []);

  const handleToggleUi = useCallback(() => {
    setUiHidden((current) => !current);
  }, []);

  useEffect(() => {
    window.addEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
    return () =>
      window.removeEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
  }, [handleToggleUi]);

  useEffect(() => {
    const openHistory = () => setHistoryOpen(true);
    window.addEventListener(DESIGN_HISTORY_OPEN_EVENT, openHistory);
    return () =>
      window.removeEventListener(DESIGN_HISTORY_OPEN_EVENT, openHistory);
  }, []);

  const [commentsHidden, setCommentsHidden] = useState(false);
  const handleToggleComments = useCallback(() => {
    setCommentsHidden((current) => !current);
  }, []);

  const handleUngroupSelection = useCallback(
    () =>
      runUngroupSelection({
        activeFile,
        applyLinkedComponentEdit,
        applyLocalContentUpdate,
        canEditDesign,
        codeLayerOwnerByNodeIdRef,
        files,
        getFreshActiveContent,
        selectedLayerIdsState,
        sendRuntimeLayerSemanticHandoff,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
      }),
    [
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  const handleOverviewPrimitiveReparent = useCallback(
    (arg0: {
      sourceNodeId: string;
      sourceScreenId: string;
      targetNodeId: string;
      targetScreenId: string;
      targetIdentity?: ScreenProjectionNodeIdentity;
      preparedTargetNodeId?: string;
      placement?: "before" | "after" | "inside";
    }) =>
      runOverviewPrimitiveReparent(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          getScreenContent,
          overviewScreens,
          recordContentHistoryEntry,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        arg0,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      getScreenContent,
      overviewScreens,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleCrossScreenElementDrop = useCallback(
    (arg0: {
      sourceSelector: string;
      sourceNodeId?: string;
      sourceDeleteRequestId?: string;
      sourceProvenance?: SourceNodeProvenance;
      targetAnchorProvenance?: SourceNodeProvenance;
      sourceScreenId: string;
      targetScreenId: string;
      targetAnchorNodeId?: string;
      targetAnchorPendingNodeId?: string;
      targetAnchorSelector?: string;
      targetAnchorPlacement?: "before" | "after" | "inside";
      targetDropMode?: "flow-insert" | "absolute-container";
      targetAnchorRect?: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      targetCanvasPoint?: { x: number; y: number };
      targetLocalPoint?: { x: number; y: number };
      sourcePointerOffset?: { x: number; y: number };
      sourceComputedSize?: { width?: number; height?: number };
      sourceHtmlSnapshot?: string;
      duplicate?: boolean;
      sourceCloneHtml?: string;
      styleSnapshot?: PortableStyleSnapshot;
      styleSnapshotCaptureFailed?: boolean;
    }) => {
      const movedSourceId =
        arg0.sourceProvenance?.uniqueNodeId?.trim() ||
        arg0.sourceNodeId?.trim() ||
        undefined;
      const movedSourceSelector = arg0.sourceSelector.trim() || undefined;
      const sourceOwners = Array.from(
        codeLayerOwnerByNodeIdRef.current.entries(),
      ).filter(([, owner]) => owner.fileId === arg0.sourceScreenId);
      const sourceIdMatches = movedSourceId
        ? sourceOwners.filter(
            ([, owner]) =>
              bridgeSourceIdForCodeLayerNode(owner.node).trim() ===
              movedSourceId,
          )
        : [];
      const selectorMatches = movedSourceSelector
        ? sourceOwners.filter(([, owner]) =>
            codeLayerSelectorMatches(owner.node, movedSourceSelector),
          )
        : [];
      const movedSourceMatches =
        sourceIdMatches.length === 1
          ? sourceIdMatches
          : selectorMatches.length === 1
            ? selectorMatches
            : [];
      const movedSourceSelection = {
        movedSourceId,
        sourceIdMatches,
        movedSourceOwner: movedSourceMatches[0]?.[1],
        movedSourceLayerIds: new Set(
          movedSourceMatches.map(([layerId]) => layerId),
        ),
      };

      return runCrossScreenElementDrop(
        {
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          canEditLiveScreen,
          canEditLiveBoard: canEditDesign || publicVisualEdit,
          clearPendingOverviewLayerSelectionTimer,
          codeLayerOwnerByNodeIdRef,
          clearPendingHistory: clearPendingHistoryDirections,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          designSourceType,
          fileHistoryMutationPendingRef,
          fileSaveOperationRevisionRef,
          getCurrentFileSnapshot: (fileId) => {
            const file = rawServerFilesByIdRef.current.get(fileId);
            return {
              content: file?.content ?? "",
              updatedAt: file?.updatedAt,
            };
          },
          getCurrentSelectionFingerprint: () => {
            const selectedElement = selectedElementRef.current;
            const selectedElementSourceScreenId =
              selectedElement?.sourceLayerIdentity?.screenId?.trim() ||
              undefined;
            const selectedElementBelongsToSource =
              selectedElementSourceScreenId !== undefined &&
              selectedElementSourceScreenId === arg0.sourceScreenId;
            const selectedMovedSource =
              selectedElement !== null &&
              selectedElementBelongsToSource &&
              movedSourceSelection.movedSourceOwner !== undefined &&
              (movedSourceSelection.sourceIdMatches.length === 1
                ? selectedElement.sourceId?.trim() === movedSourceId
                : codeLayerSelectorMatches(
                    movedSourceSelection.movedSourceOwner.node,
                    selectedElement.selector,
                  ));
            const selectedLayerIds = selectedLayerIdsStateRef.current.filter(
              (layerId) => {
                const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
                if (owner) {
                  return !movedSourceSelection.movedSourceLayerIds.has(layerId);
                }
                return !selectedMovedSource;
              },
            );
            return JSON.stringify({
              activeFileId: activeFileIdRef.current,
              selectedLayerIds,
              overviewSelectedScreenIds: overviewSelectedScreenIdsRef.current,
              selectedElement:
                selectedElement && !selectedMovedSource
                  ? {
                      id: selectedElement.id ?? null,
                      selector: selectedElement.selector ?? null,
                      sourceId: selectedElement.sourceId ?? null,
                    }
                  : null,
              viewMode: viewModeRef.current,
            });
          },
          getScreenContent,
          id,
          overviewScreens,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          recordContentHistoryEntry,
          syncUndoRedoState,
          runtimeStructureInsertRevisionRef,
          runtimeStructurePendingTransactionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          setActiveFileId,
          setCreatedOverviewLayerSelection,
          setOverviewSelectedScreenIds,
          setRuntimeStructureInsertRequest,
          setRuntimeStructureDeleteRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
        },
        arg0,
      );
    },
    [
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      publicVisualEdit,
      clearPendingHistoryDirections,
      clearPendingOverviewLayerSelectionTimer,
      getScreenContent,
      id,
      recordContentHistoryEntry,
      sendRuntimeLayerMoveSemanticHandoff,
      syncUndoRedoState,
      designSourceType,
      overviewScreens,
      setRuntimeStructureDeleteRequest,
      t,
    ],
  );

  const discardPendingLiveStructureTransaction = useCallback(
    (transactionId: string) => {
      const matchesTransaction = (edit: PendingLiveStructureEdit) =>
        pendingLiveStructureEditsFromEdit(edit).some(
          (member) => member.transactionId === transactionId,
        );
      const nextPending = pendingLiveNonStyleEditsRef.current.filter(
        (edit) => edit.kind !== "structure" || !matchesTransaction(edit),
      );
      const nextUndo = pendingLiveNonStyleUndoStackRef.current.filter(
        (entry) =>
          entry.kind !== "structure" ||
          !pendingLiveStructureEditsFromUndoEntry(entry).some(
            (edit) => edit.transactionId === transactionId,
          ),
      );
      const nextRedo = pendingLiveNonStyleRedoStackRef.current.filter(
        (entry) =>
          entry.kind !== "structure" ||
          !pendingLiveStructureEditsFromUndoEntry(entry).some(
            (edit) => edit.transactionId === transactionId,
          ),
      );
      pendingLiveNonStyleEditsRef.current = nextPending;
      pendingLiveNonStyleUndoStackRef.current = nextUndo;
      pendingLiveNonStyleRedoStackRef.current = nextRedo;
      setPendingLiveNonStyleEdits(nextPending);
      syncUndoRedoState();
    },
    [syncUndoRedoState],
  );

  const handleRuntimeStructureInsertRejected = useCallback(
    (reason: string, transactionId?: string) => {
      if (reason.startsWith("verification-")) {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          transactionId,
        );
        cancelPendingStructureVerification("conflict");
        toast.error(t("designEditor.pendingVisualStyles.conflictToast"));
        return false;
      }
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn("[design] runtime structure insert rejected", { reason });
      }
      if (transactionId) {
        runtimeStructureRollbackRevisionRef.current += 1;
        const recovery = resolveCrossScreenMoveFailureRecovery({
          reason,
          transactionId,
          insertRequest: runtimeStructureInsertRequest,
          sourceDeleteRequest: runtimeStructureDeleteRequest,
          rollbackRequestId: `${transactionId}:recovery-rollback:${runtimeStructureRollbackRevisionRef.current}`,
          pendingTransactionRef: runtimeStructurePendingTransactionRef,
        });
        if (recovery.rollbackRequest) {
          setRuntimeStructureRollbackRequest(recovery.rollbackRequest);
        } else if (
          runtimeStructureRollbackRequest?.transactionId === transactionId
        ) {
          setRuntimeStructureRollbackRequest(null);
        }
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
        const sourceDeleteRequest = recovery.sourceDeleteRequest;
        if (sourceDeleteRequest !== undefined) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === transactionId
              ? sourceDeleteRequest
              : current,
          );
        }
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return Boolean(
          recovery.rollbackRequest ||
          recovery.sourceDeleteRequest?.cancelRequested,
        );
      }
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
      return false;
    },
    [
      cancelPendingStructureVerification,
      runtimeStructurePendingTransactionRef,
      runtimeStructureInsertRequest,
      runtimeStructureRollbackRequest,
      runtimeStructureDeleteRequest,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      setRuntimeStructureRollbackRequest,
      t,
    ],
  );

  useEffect(() => {
    if (!runtimeStructureInsertRequest?.transactionId) return;
    return scheduleCrossScreenInsertTimeout(
      runtimeStructureInsertRequest,
      boardFileId ?? null,
      (transactionId) =>
        handleRuntimeStructureInsertRejected(
          "cross-screen-insert-timeout",
          transactionId,
        ),
    );
  }, [
    boardFileId,
    handleRuntimeStructureInsertRejected,
    runtimeStructureInsertRequest,
  ]);

  const handleRuntimeStructureInsertApplied = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      routePath?: string;
      selector: string;
      sourceId?: string;
      applied?: boolean;
    }) => {
      const request = runtimeStructureInsertRequest;
      if (!request || !details.selector) return;
      const requestMatches = request.transactionId
        ? request.transactionId === details.transactionId
        : Number.isFinite(Number(details.requestId)) &&
          Math.floor(Number(details.requestId)) === request.requestId;
      if (!requestMatches) return;
      if (details.applied === false) {
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === request.transactionId ? null : current,
        );
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === request.transactionId &&
          current?.requestId === request.requestId
            ? null
            : current,
        );
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
        return;
      }
      recordPendingLiveStructureEdit(
        request.screenId,
        details.selector,
        request.anchor.selector,
        request.placement,
        undefined,
        {
          sourceId: details.sourceId,
          anchorSourceId: request.anchor.sourceId ?? undefined,
          routePath: details.routePath,
          insertedHtml: request.html,
          remintCollidingNodeIds: request.remintCollidingNodeIds,
          requestId: details.requestId,
          transactionId: request.transactionId,
        },
      );
      if (request.transactionId) {
        setRuntimeStructureDeleteRequest((current) =>
          current && current.transactionId === request.transactionId
            ? {
                ...current,
                waitForInsertTransaction: false,
                rollbackSelector: details.selector,
                rollbackSourceId: details.sourceId,
              }
            : current,
        );
      }
      setRuntimeStructureInsertRequest((current) =>
        current?.transactionId === request.transactionId &&
        current?.requestId === request.requestId
          ? null
          : current,
      );
      if (
        request.transactionId &&
        runtimeStructureDeleteRequest?.transactionId !==
          request.transactionId &&
        runtimeStructurePendingTransactionRef.current === request.transactionId
      ) {
        runtimeStructurePendingTransactionRef.current = null;
      }
    },
    [
      recordPendingLiveStructureEdit,
      runtimeStructureDeleteRequest,
      runtimeStructureInsertRequest,
      runtimeStructurePendingTransactionRef,
    ],
  );

  const handleRuntimeStructureDeleteApplied = useCallback(
    (details: {
      screenId?: string;
      requestId: string;
      selector: string;
      sourceId?: string;
      routePath?: string;
      info?: ElementInfo;
    }) => {
      const screenId = details.screenId;
      const request = runtimeStructureDeleteRequest;
      if (
        !screenId ||
        !request ||
        request.cancelRequested ||
        request.screenId !== screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      recordPendingLiveStructureEdit(
        screenId,
        details.selector,
        "",
        "after",
        details.info,
        {
          sourceId: details.sourceId,
          requestId: details.requestId,
          transactionId: request.transactionId,
          routePath: details.routePath,
          removed: true,
        },
      );
      if (
        request.transactionId &&
        runtimeStructurePendingTransactionRef.current === request.transactionId
      ) {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
      }
      setRuntimeStructureDeleteRequest(null);
    },
    [
      recordPendingLiveStructureEdit,
      runtimeStructureDeleteRequest,
      runtimeStructurePendingTransactionRef,
    ],
  );
  const handleRuntimeStructureDeleteRejected = useCallback(
    (details: {
      screenId?: string;
      requestId: string;
      transactionId?: string;
      reason: string;
      sourcePresent?: boolean;
    }) => {
      const request = runtimeStructureDeleteRequest;
      if (
        !request ||
        !details.screenId ||
        request.screenId !== details.screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      if (request.cancelRequested) {
        const retrySourceCancellation = () => {
          const retryRequest = retryCrossScreenDeleteCancellation(request);
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === request.transactionId &&
            current?.requestId === request.requestId
              ? retryRequest
              : current,
          );
        };
        if (crossScreenSourceCancellationNeedsRetry(details)) {
          retrySourceCancellation();
          return;
        }
        if (
          runtimeStructureRollbackRequest?.transactionId ===
          request.transactionId
        ) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === request.transactionId ? null : current,
          );
          return;
        }
        const recoveryRollbackRequest =
          crossScreenRollbackAfterSourceCancellation(
            request,
            true,
            `${request.transactionId}:recovery-rollback:${runtimeStructureRollbackRevisionRef.current + 1}`,
          );
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === request.transactionId ? null : current,
        );
        if (recoveryRollbackRequest) {
          runtimeStructureRollbackRevisionRef.current += 1;
          setRuntimeStructureRollbackRequest(recoveryRollbackRequest);
          return;
        }
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          request.transactionId,
        );
        if (request.rollbackSelector) {
          toast.error(t("designEditor.toasts.layerMoveFailed"), {
            duration: 4000,
          });
        }
        return;
      }
      const transactionId = request.transactionId;
      let recovery:
        | ReturnType<typeof resolveCrossScreenMoveFailureRecovery>
        | undefined;
      if (transactionId) {
        runtimeStructureRollbackRevisionRef.current += 1;
        recovery = resolveCrossScreenMoveFailureRecovery({
          reason: details.reason,
          transactionId,
          insertRequest: runtimeStructureInsertRequest,
          sourceDeleteRequest: request,
          rollbackRequestId: `${transactionId}:rollback:${runtimeStructureRollbackRevisionRef.current}`,
          pendingTransactionRef: runtimeStructurePendingTransactionRef,
        });
        if (recovery.rollbackRequest) {
          setRuntimeStructureRollbackRequest(recovery.rollbackRequest);
        }
        const sourceDeleteRequest = recovery.sourceDeleteRequest;
        if (sourceDeleteRequest !== undefined) {
          setRuntimeStructureDeleteRequest((current) =>
            current?.transactionId === transactionId
              ? sourceDeleteRequest
              : current,
          );
        }
      } else {
        setRuntimeStructureDeleteRequest(null);
      }
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn("[design] runtime structure delete rejected", details);
      }
      if (details.reason !== "cancelled") {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
      }
    },
    [
      runtimeStructureDeleteRequest,
      runtimeStructureRollbackRequest,
      runtimeStructurePendingTransactionRef,
      runtimeStructureInsertRequest,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureRollbackRequest,
      t,
    ],
  );
  useEffect(() => {
    const deleteRequest = runtimeStructureDeleteRequest;
    if (
      runtimeStructureRollbackRequest?.transactionId &&
      runtimeStructureRollbackRequest.transactionId ===
        deleteRequest?.transactionId
    ) {
      return;
    }
    return scheduleCrossScreenDeleteTimeout(
      deleteRequest,
      boardFileId ?? null,
      (request) =>
        handleRuntimeStructureDeleteRejected({
          screenId: request.screenId,
          requestId: request.requestId,
          transactionId: request.transactionId,
          reason: "source-delete-timeout",
        }),
    );
  }, [
    boardFileId,
    handleRuntimeStructureDeleteRejected,
    runtimeStructureDeleteRequest,
    runtimeStructureRollbackRequest,
  ]);
  const handleRuntimeStructureRollbackResult = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      applied: boolean;
      reason?: string;
    }) => {
      if (runtimeStructureRollbackRequest?.requestId !== details.requestId) {
        return;
      }
      cancelCrossScreenRollbackTimeout(
        runtimeStructureRollbackTimeoutCancelRef,
      );
      const rollbackRequest = runtimeStructureRollbackRequest;
      const transactionId = rollbackRequest.transactionId;
      const sourceCancellationAlreadyPending = Boolean(
        transactionId &&
        runtimeStructureDeleteRequest?.transactionId === transactionId &&
        runtimeStructureDeleteRequest.cancelRequested,
      );
      const destinationScreenExists =
        rollbackRequest.screenId === boardFileId ||
        overviewScreens.some(
          (screen) => screen.id === rollbackRequest.screenId,
        );
      if (
        details.reason === "rollback-timeout" &&
        transactionId &&
        destinationScreenExists &&
        !sourceCancellationAlreadyPending
      ) {
        const retryRevision = runtimeStructureRollbackRevisionRef.current + 1;
        const retryRequest = retryCrossScreenRollbackRequest(
          rollbackRequest,
          `${transactionId}:rollback:${retryRevision}`,
        );
        if (retryRequest) {
          runtimeStructureRollbackRevisionRef.current = retryRevision;
          setRuntimeStructureRollbackRequest((current) =>
            current?.requestId === rollbackRequest.requestId
              ? retryRequest
              : current,
          );
          return;
        }
        setRuntimeStructureRollbackRequest((current) =>
          current?.requestId === rollbackRequest.requestId ? null : current,
        );
      }
      const hasPendingInsert = Boolean(
        transactionId &&
        (pendingLiveNonStyleEditsRef.current.some(
          (edit) =>
            edit.kind === "structure" &&
            pendingLiveStructureEditsFromEdit(edit).some(
              (member) =>
                member.transactionId === transactionId &&
                Boolean(member.insertedHtml),
            ),
        ) ||
          pendingLiveNonStyleUndoStackRef.current.some(
            (entry) =>
              entry.kind === "structure" &&
              pendingLiveStructureEditsFromUndoEntry(entry).some(
                (member) =>
                  member.transactionId === transactionId &&
                  Boolean(member.insertedHtml),
              ),
          )),
      );
      const rollbackIsComplete = crossScreenRollbackIsComplete(
        rollbackRequest,
        details,
      );
      const disposition = crossScreenRollbackDisposition({
        applied: rollbackIsComplete,
        destinationHasPendingInsert: hasPendingInsert,
        destinationScreenExists,
      });
      const pendingSourceDelete =
        transactionId &&
        runtimeStructureDeleteRequest?.transactionId === transactionId
          ? runtimeStructureDeleteRequest
          : null;
      const pendingSourceCancellation =
        transactionId && pendingSourceDelete
          ? crossScreenSourceDeleteCancellation(
              pendingSourceDelete,
              transactionId,
            )
          : null;
      setRuntimeStructureRollbackRequest((current) =>
        current?.requestId === rollbackRequest.requestId ? null : current,
      );
      if (pendingSourceCancellation) {
        setRuntimeStructureInsertRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
        if (disposition === "discard") {
          if (transactionId) {
            discardPendingLiveStructureTransaction(transactionId);
          }
        }
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === transactionId
            ? pendingSourceCancellation
            : current,
        );
        if (!rollbackIsComplete) {
          toast.error(t("designEditor.toasts.layerMoveFailed"), {
            duration: 4000,
          });
        }
        return;
      }
      if (disposition === "retain-recovery") {
        releaseCrossScreenDropAdmission(
          runtimeStructurePendingTransactionRef,
          transactionId,
        );
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
        return;
      }
      if (transactionId && disposition === "discard") {
        discardPendingLiveStructureTransaction(transactionId);
      }
      releaseCrossScreenDropAdmission(
        runtimeStructurePendingTransactionRef,
        transactionId,
      );
      if (transactionId) {
        setRuntimeStructureDeleteRequest((current) =>
          current?.transactionId === transactionId ? null : current,
        );
      }
      if (!rollbackIsComplete) {
        toast.error(t("designEditor.toasts.layerMoveFailed"), {
          duration: 4000,
        });
      }
    },
    [
      discardPendingLiveStructureTransaction,
      runtimeStructureRollbackRequest,
      runtimeStructurePendingTransactionRef,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      setRuntimeStructureRollbackRequest,
      boardFileId,
      overviewScreens,
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleUndoStackRef,
      runtimeStructureDeleteRequest,
      t,
    ],
  );
  const runtimeStructureRollbackResultHandlerRef = useRef(
    handleRuntimeStructureRollbackResult,
  );
  runtimeStructureRollbackResultHandlerRef.current =
    handleRuntimeStructureRollbackResult;
  useEffect(() => {
    if (!runtimeStructureRollbackRequest?.transactionId) return;
    const cancel = scheduleCrossScreenRollbackTimeout(
      runtimeStructureRollbackRequest,
      (request) =>
        runtimeStructureRollbackResultHandlerRef.current({
          requestId: request.requestId,
          transactionId: request.transactionId,
          applied: false,
          reason: "rollback-timeout",
        }),
    );
    runtimeStructureRollbackTimeoutCancelRef.current = cancel;
    return () => {
      cancel();
      if (runtimeStructureRollbackTimeoutCancelRef.current === cancel) {
        runtimeStructureRollbackTimeoutCancelRef.current = null;
      }
    };
  }, [runtimeStructureRollbackRequest]);
  const handleRuntimeLayerRenameApplied = useCallback(
    (
      screenId: string,
      details: {
        requestId: number;
        selector: string;
        sourceId?: string;
        name: string;
        previousName?: string;
        routePath?: string;
      },
    ) => {
      const request = runtimeLayerRenameRequest;
      if (
        !request ||
        request.screenId !== screenId ||
        request.requestId !== details.requestId
      ) {
        return;
      }
      recordPendingLiveLayerNameEdit(
        request.layerId,
        details.name,
        details.previousName,
        details.routePath,
      );
      setRuntimeLayerRenameRequest(null);
    },
    [recordPendingLiveLayerNameEdit, runtimeLayerRenameRequest],
  );
  const runtimeLayerRenameForScreen = useCallback(
    (screenId: string): RuntimeLayerRenameRequest | null => {
      if (runtimeLayerRenameRequest?.screenId === screenId) {
        return runtimeLayerRenameRequest;
      }
      const replay = pendingLayerNameReplayRequest?.patches.find(
        (patch) =>
          patch.screenId === screenId &&
          (!patch.routePath ||
            patch.routePath === liveRoutePathsByScreenIdRef.current[screenId]),
      );
      return replay
        ? {
            requestId: pendingLayerNameReplayRequest!.requestId,
            selector: replay.selector,
            sourceId: replay.sourceId,
            routePath: replay.routePath,
            name: replay.name,
          }
        : null;
    },
    [pendingLayerNameReplayRequest, runtimeLayerRenameRequest],
  );

  const handleCutSelection = useCallback(async () => {
    const copied = await handleCopySelection();
    if (!copied) return;
    handleDeleteSelection();
  }, [handleCopySelection, handleDeleteSelection]);

  const performDeleteFiles = useCallback(
    (
      filesToDelete: DesignFile[],
      options?: {
        skipFileCreationRedoPrune?: boolean;
        recordDeletionHistory?: boolean;
        preserveHistory?: boolean;
        onMutationSettled?: (
          deletedFiles: DesignFile[],
          failedFiles: DesignFile[],
          deletedFileSnapshots: FileDeletionHistorySnapshot[],
        ) => void;
      },
    ) =>
      runDeleteFiles(
        {
          activeFile,
          canvasFrameGeometryById,
          clearRedoStacks,
          designDataJsonRef,
          clipboardPasteRedoStackRef,
          clipboardPasteUndoStackRef,
          contentRedoSelectionStackRef,
          contentRedoStackRef,
          contentUndoSelectionStackRef,
          contentUndoStackRef,
          deleteFileMutation,
          fileCreationRedoStackRef,
          fileCreationUndoStackRef,
          fileDeletionUndoStackRef,
          fileHistoryMutationPendingRef,
          clearPendingHistory: clearPendingHistoryDirections,
          files,
          geometryRedoStackRef,
          geometryUndoStackRef,
          historyOrderRef: historyOrderRef as React.RefObject<
            UndoRedoOrderKind[]
          >,
          id,
          latestClipboardMutationContentRef,
          localContentRedoStackRef,
          localContentUndoStackRef,
          queryClient,
          redoOrderRef: redoOrderRef as React.RefObject<UndoRedoOrderKind[]>,
          overviewSelectedScreenIds,
          selectedElement,
          selectedLayerIdsState,
          setActiveFileId,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
          syncUndoRedoState,
          t,
          writeFrameGeometrySnapshot,
        },
        filesToDelete,
        options,
      ),
    [
      activeFile,
      canvasFrameGeometryById,
      clearRedoStacks,
      clearPendingHistoryDirections,
      deleteFileMutation,
      overviewSelectedScreenIds,
      queryClient,
      selectedElement,
      selectedLayerIdsState,
      syncUndoRedoState,
      t,
      writeFrameGeometrySnapshot,
    ],
  );
  const handleDeleteInlineFile = useCallback(
    async (fileId: string) => {
      if (!canEditDesign) return;
      if (fileHistoryMutationPendingRef.current) {
        throw new Error(t("common.genericError"));
      }
      const queryKey = ["action", "get-design", { id }] as const;
      let file =
        files.find((candidate) => candidate.id === fileId) ??
        rawServerFilesByIdRef.current.get(fileId) ??
        historyFilesRef.current.find((candidate) => candidate.id === fileId);
      if (!file) {
        await queryClient.refetchQueries({ queryKey, exact: true });
        const refreshed = queryClient.getQueryData<{
          files?: DesignFile[];
        }>(queryKey);
        file = refreshed?.files?.find((candidate) => candidate.id === fileId);
      }
      if (!file) throw new Error(t("common.genericError"));

      const targetFile = file;
      let deleted = false;
      await performDeleteFiles([targetFile], {
        recordDeletionHistory: true,
        onMutationSettled: (deletedFiles) => {
          deleted = deletedFiles.some((candidate) => candidate.id === fileId);
        },
      });
      if (!deleted) throw new Error(t("common.genericError"));
    },
    [canEditDesign, files, id, performDeleteFiles, queryClient, t],
  );

  const handleOverviewNudgeSelection = useCallback(() => {
    if (
      overviewSelectionTargetsElement({
        selectedElement,
        selectedLayerIds: selectedLayerIdsState,
        fileIds: files.map((file) => file.id),
      })
    ) {
      return false;
    }
    return true;
  }, [files, selectedElement, selectedLayerIdsState]);

  const handleDeleteOverviewSelection = useCallback(
    (selectedIds: string[]) => {
      if (!canEditDesign) return false;
      if (fileHistoryMutationPendingRef.current) return false;
      if (
        overviewSelectionTargetsElement({
          selectedElement,
          selectedLayerIds: selectedLayerIdsState,
          fileIds: files.map((file) => file.id),
        })
      ) {
        handleDeleteSelection();
        return false;
      }
      if (!selectedIds.length || overviewScreens.length <= 1) return false;

      const selectedIdSet = new Set(selectedIds);
      const overviewScreenIds = new Set(
        overviewScreens.map((screen) => screen.id),
      );
      const selectedFiles = files.filter(
        (file) => selectedIdSet.has(file.id) && overviewScreenIds.has(file.id),
      );
      if (!selectedFiles.length) return false;

      const maxDeleteCount =
        selectedFiles.length >= overviewScreens.length
          ? Math.max(0, overviewScreens.length - 1)
          : selectedFiles.length;
      const filesToDelete = selectedFiles.slice(0, maxDeleteCount);
      if (!filesToDelete.length) return false;

      performDeleteFiles(filesToDelete, { recordDeletionHistory: true });
      return false;
    },
    [
      canEditDesign,
      files,
      performDeleteFiles,
      handleDeleteSelection,
      overviewScreens,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  const handleCopyProps = useCallback(() => {
    if (!selectedElement) return;
    copiedStylePropsRef.current = {
      color: selectedElement.computedStyles.color,
      backgroundColor: selectedElement.computedStyles.backgroundColor,
      borderColor: selectedElement.computedStyles.borderColor,
      borderStyle: selectedElement.computedStyles.borderStyle,
      borderWidth: selectedElement.computedStyles.borderWidth,
      borderRadius: selectedElement.computedStyles.borderRadius,
      boxShadow: selectedElement.computedStyles.boxShadow,
      opacity: selectedElement.computedStyles.opacity,
      fontFamily: selectedElement.computedStyles.fontFamily,
      fontSize: selectedElement.computedStyles.fontSize,
      fontWeight: selectedElement.computedStyles.fontWeight,
      lineHeight: selectedElement.computedStyles.lineHeight,
      letterSpacing: selectedElement.computedStyles.letterSpacing,
      textAlign: selectedElement.computedStyles.textAlign,
    };
    setHasPropsClipboard(true);
  }, [selectedElement]);

  const handlePasteProps = useCallback(() => {
    if (!canEditActiveVisualScreen) return;
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    handleStylesChange(styles);
  }, [canEditActiveVisualScreen, handleStylesChange, selectedElement]);

  const handleCopyAnimation = useCallback(() => {
    if (!selectedMotionTargetNodeId) return;
    const clip = copyLayerAnimation(motionTracks, selectedMotionTargetNodeId);
    if (!clip) return;
    copiedLayerAnimationRef.current = clip;
    setHasAnimationClipboard(true);
  }, [motionTracks, selectedMotionTargetNodeId]);

  const handlePasteAnimation = useCallback(() => {
    if (!canEditDesign) return;
    const clip = copiedLayerAnimationRef.current;
    if (!clip || !selectedMotionTargetNodeId) return;
    const targetNodeId = selectedMotionTargetNodeId;
    setMotionTracks(
      (current) =>
        pasteLayerAnimation(current, clip, targetNodeId) as MotionDockTrack[],
    );
    markMotionTracksDirty();
  }, [canEditDesign, markMotionTracksDirty, selectedMotionTargetNodeId]);

  const parseSelectionScaleValue = useCallback(
    (value: string | undefined): [number, number] => {
      const trimmed = (value ?? "").trim();
      if (!trimmed || trimmed === "none") return [1, 1];
      const parts = trimmed
        .split(/\s+/)
        .filter((token) => token !== "")
        .map(Number);
      const sx = Number.isFinite(parts[0]) ? parts[0]! : 1;
      const sy = Number.isFinite(parts[1]) ? parts[1]! : sx;
      return [sx, sy];
    },
    [],
  );

  const handleFlipHorizontal = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const [sx, sy] = parseSelectionScaleValue(
      selectedElement.computedStyles.scale,
    );
    handleStyleChange("scale", `${sx === -1 ? 1 : -1} ${sy}`);
  }, [
    canEditDesign,
    handleStyleChange,
    parseSelectionScaleValue,
    selectedElement,
  ]);

  const handleFlipVertical = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const [sx, sy] = parseSelectionScaleValue(
      selectedElement.computedStyles.scale,
    );
    handleStyleChange("scale", `${sx} ${sy === -1 ? 1 : -1}`);
  }, [
    canEditDesign,
    handleStyleChange,
    parseSelectionScaleValue,
    selectedElement,
  ]);

  const handleRotateSelectionClockwise = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const transform = selectedElement.computedStyles.transform;
    handleStyleChange(
      "transform",
      mergeRotationValue(transform, parseRotationValue(transform) + 90),
    );
  }, [canEditDesign, handleStyleChange, selectedElement]);

  const handleSwapFillStroke = useCallback(
    () =>
      runSwapFillStroke({
        canEditDesign,
        selectedElement,
        handleStylesChange,
      }),
    [canEditDesign, handleStylesChange, selectedElement],
  );

  const handleEyedropper = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    if (!hasEyeDropperSupport()) {
      toast.info(t("designEditor.toasts.eyedropperUnsupported"));
      return;
    }
    void (async () => {
      const hex = await beginEyedropperPick();
      if (!hex) return;
      const property = isTextElement(selectedElement)
        ? "color"
        : "backgroundColor";
      handleStyleChange(property, hex);
    })();
  }, [canEditDesign, handleStyleChange, selectedElement, t]);

  const changeSelectedZIndex = useCallback(
    (mode: "forward" | "front" | "backward" | "back") => {
      if (!canEditDesign && selectedLayerIdsState.length === 1) {
        const selectedId = selectedLayerIdsState[0]!;
        const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
        if (owner && canEditLiveScreen(owner.fileId)) {
          const siblingOrder = findCodeLayerSiblingOrder(
            owner.tree,
            owner.node.id,
          );
          if (!siblingOrder || siblingOrder.siblingIds.length < 2) return;
          const { index, siblingIds } = siblingOrder;
          const anchorId =
            mode === "forward"
              ? siblingIds[index + 1]
              : mode === "backward"
                ? siblingIds[index - 1]
                : mode === "front"
                  ? siblingIds[siblingIds.length - 1]
                  : siblingIds[0];
          if (!anchorId || anchorId === owner.node.id) return;
          const anchorOwner = codeLayerOwnerByNodeIdRef.current.get(anchorId);
          if (!anchorOwner) return;
          runtimeStructureMoveRevisionRef.current += 1;
          setRuntimeStructureMoveRequest({
            requestId: runtimeStructureMoveRevisionRef.current,
            screenId: owner.fileId,
            subject: {
              selector: preferredCodeLayerSelector(owner.node),
              sourceId: bridgeSourceIdForCodeLayerNode(owner.node),
            },
            anchor: {
              selector: preferredCodeLayerSelector(anchorOwner.node),
              sourceId: bridgeSourceIdForCodeLayerNode(anchorOwner.node),
            },
            placement:
              mode === "forward" || mode === "front" ? "after" : "before",
          });
          return;
        }
      }
      return runChangeSelectedZIndex(
        {
          activeFile,
          applyLinkedComponentEdit,
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          applyLocalContentUpdate,
          canEditDesign,
          codeLayerOwnerByNodeIdRef,
          commitVisualStyles,
          getFreshActiveContent,
          invalidateRenderedElementInfo,
          renderedElementInfoByLayerKeyRef,
          reportRefusal: (reason) =>
            toast.error(
              t(
                reason === "linked-component"
                  ? "designEditor.componentInstances.linkedEditScopeUnsupported"
                  : "designEditor.patchProof.selectorMissing",
              ),
              { duration: 4000 },
            ),
          responsiveEditScopeRef,
          selectedElement,
          selectedLayerIdsState,
          setSelectedElement,
        },
        mode,
      );
    },
    [
      activeFile,
      activeBreakpointUpperBoundPx,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      commitVisualStyles,
      getFreshActiveContent,
      invalidateRenderedElementInfo,
      t,
      selectedElement,
      selectedLayerIdsState,
      setRuntimeStructureMoveRequest,
    ],
  );

  const selectionChromeHiddenRef = useRef(false);
  const selectionChromeSettleTimerRef = useRef<number | undefined>(undefined);
  const restoreSelectionChrome = useCallback(() => {
    if (selectionChromeSettleTimerRef.current !== undefined) {
      window.clearTimeout(selectionChromeSettleTimerRef.current);
      selectionChromeSettleTimerRef.current = undefined;
    }
    if (!selectionChromeHiddenRef.current) return;
    selectionChromeHiddenRef.current = false;
    canvasIframeRef.current?.contentWindow?.postMessage(
      { type: "set-selection-chrome-hidden", hidden: false },
      "*",
    );
  }, [canvasIframeRef]);
  const hideSelectionChromeForNudge = useCallback(() => {
    if (!selectionChromeHiddenRef.current) {
      selectionChromeHiddenRef.current = true;
      canvasIframeRef.current?.contentWindow?.postMessage(
        { type: "set-selection-chrome-hidden", hidden: true },
        "*",
      );
    }
    if (selectionChromeSettleTimerRef.current !== undefined) {
      window.clearTimeout(selectionChromeSettleTimerRef.current);
    }
    selectionChromeSettleTimerRef.current = window.setTimeout(() => {
      selectionChromeSettleTimerRef.current = undefined;
      restoreSelectionChrome();
    }, 800);
  }, [canvasIframeRef, restoreSelectionChrome]);
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        restoreSelectionChrome();
      }
    };
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      if (selectionChromeSettleTimerRef.current !== undefined) {
        window.clearTimeout(selectionChromeSettleTimerRef.current);
      }
    };
  }, [restoreSelectionChrome]);

  const handleNudgeSelection = useCallback(
    (direction: "up" | "right" | "down" | "left", largeStep: boolean) =>
      runNudgeSelection(
        {
          activeFile,
          applyLinkedComponentEdit,
          applyLocalContentUpdate,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
          canEditLiveScreen: canEditActiveVisualScreen,
          isRunningAppSource: isRunningAppSourceType(activeCanvasSourceType),
          commitVisualStyles,
          designDataJsonRef,
          editorPreferences,
          files,
          getFreshActiveContent,
          handleGeometryCommit,
          hideSelectionChromeForNudge,
          overviewScreens,
          overviewSelectedScreenIds,
          selectedElement,
          selectedLayerIdsState,
          selectedLayerTargetsRef,
          renderedElementInfoByLayerKeyRef,
          setSelectedElement,
          setSelectedLayerIdsState,
          viewModeRef,
        },
        direction,
        largeStep,
      ),
    [
      activeCanvasSourceType,
      activeFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
      canEditActiveVisualScreen,
      commitVisualStyles,
      editorPreferences.nudge,
      files,
      getFreshActiveContent,
      handleGeometryCommit,
      hideSelectionChromeForNudge,
      liveScreenSnapshotsById,
      overviewScreens,
      overviewSelectedScreenIds,
      recordPendingLiveStructureEdit,
      runtimeLayerSnapshotsById,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  const applyDesignDataHistoryChanges = useCallback(
    (changes: readonly ContentHistoryChange[], direction: "undo" | "redo") => {
      const operations = changes.flatMap(
        (change) => change.designDataChange?.[direction] ?? [],
      );
      if (operations.length === 0) return true;
      if (!id) return false;
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        operations,
      );
      designDataJsonRef.current = nextData;
      const screenMetadata = getDesignDataRecord(nextData, "screenMetadata");
      for (const screenId of new Set(
        operations
          .filter(
            (operation) =>
              operation.path[0] === "screenMetadata" &&
              operation.path.length > 1,
          )
          .map((operation) => operation.path[1]),
      )) {
        const metadata = getDesignDataRecord(screenMetadata, screenId);
        if (
          resolveScreenHeightMode(
            metadata.heightMode,
            metadata.heightPinned === true,
            metadata.sourceType,
          ) === "fixed"
        ) {
          locallyPinnedHeightIdsRef.current.add(screenId);
        } else {
          locallyPinnedHeightIdsRef.current.delete(screenId);
        }
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
        old && typeof old === "object"
          ? { ...old, data: JSON.stringify(nextData) }
          : old,
      );
      return enqueueFrameGeometryDataSave(operations);
    },
    [enqueueFrameGeometryDataSave, id, queryClient],
  );
  applyGeometryHistoryContentChangesRef.current = (changes, direction) => {
    for (const change of changes) {
      const content = direction === "undo" ? change.before : change.after;
      if (change.before === change.after) continue;
      applyFileContentUpdate(change.fileId, content, {
        recordHistory: false,
      });
    }
    if (direction !== "commit") {
      applyDesignDataHistoryChanges(changes, direction);
    }
  };

  const runCurrentUndo = useCallback(
    () =>
      runUndo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyDesignDataHistoryChanges,
        applyGeometryHistoryContentChanges: (changes, direction) =>
          applyGeometryHistoryContentChangesRef.current(changes, direction),
        applyLocalContentUpdate,
        canEditDesign,
        allowPendingLiveEdits: canEditLiveScreens && !canEditDesign,
        clipboardPasteRedoStackRef,
        clipboardPasteUndoStackRef,
        codeLayerOwnerByNodeIdRef,
        contentHistorySelectionAfterRef,
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation,
        deleteFileMutation,
        designDataJsonRef,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        clearPendingHistory: clearPendingHistoryDirections,
        files,
        filesRef: historyFilesRef,
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent,
        getScreenContent,
        historyOrderRef,
        id,
        isSynced,
        lastLocalContentRef,
        resetGeometryCommitCoalescing,
        liveFrameGeometryRef,
        liveScreenSnapshotsById,
        localContentRedoStackRef,
        localContentUndoStackRef,
        markPendingLocalFileContent,
        optimisticallyInsertCreatedFile,
        pendingLiveNonStyleEditsRef,
        pendingLiveNonStyleRedoStackRef,
        pendingLiveNonStyleUndoStackRef,
        pendingLocalFileContentsRef,
        pendingVisualStyleEditsRef,
        pendingVisualStyleRedoStackRef,
        pendingVisualStyleUndoStackRef,
        performDeleteFiles,
        publishAuthoritativeClipboardMutation,
        queryClient,
        queueFileContentSave,
        redoOrderRef,
        replacePreviewContent,
        requestPendingLiveNonStyleRevert,
        requestPendingVisualStyleRevert,
        restoreSelectionSnapshot,
        selectionRedoStackRef,
        selectionUndoStackRef,
        setActiveFileId,
        setContentRenderRevision,
        setHoveredElement,
        setOverviewSelectedScreenIds,
        setPendingLiveNonStyleEdits,
        setPendingVisualStyleEdits,
        setSelectedElement,
        setSelectedLayerIdsState,
        suppressContentHistoryRef,
        syncLiveScreenSnapshotPreview,
        syncUndoRedoState,
        t,
        undoManagerRef,
        updateLiveScreenSnapshotContent,
        viewModeRef,
        writeFrameGeometrySnapshot,
        ydoc,
      }),
    [
      ydoc,
      activeFile,
      applyFileContentUpdate,
      applyDesignDataHistoryChanges,
      applyGeometryHistoryContentChangesRef,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreens,
      clearPendingHistoryDirections,
      createFileMutation,
      deleteFileMutation,
      files,
      getFreshActiveContent,
      getScreenContent,
      id,
      isSynced,
      liveScreenSnapshotsById,
      markPendingLocalFileContent,
      optimisticallyInsertCreatedFile,
      performDeleteFiles,
      publishAuthoritativeClipboardMutation,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
      resetGeometryCommitCoalescing,
      restoreSelectionSnapshot,
      requestPendingLiveNonStyleRevert,
      requestPendingVisualStyleRevert,
      syncLiveScreenSnapshotPreview,
      syncUndoRedoState,
      updateLiveScreenSnapshotContent,
      writeFrameGeometrySnapshot,
      t,
    ],
  );

  const runCurrentRedo = useCallback(
    () =>
      runRedo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyDesignDataHistoryChanges,
        applyGeometryHistoryContentChanges: (changes, direction) =>
          applyGeometryHistoryContentChangesRef.current(changes, direction),
        applyLocalContentUpdate,
        canEditDesign,
        allowPendingLiveEdits: canEditLiveScreens && !canEditDesign,
        clipboardPasteRedoStackRef,
        clipboardPasteUndoStackRef,
        codeLayerOwnerByNodeIdRef,
        contentHistorySelectionAfterRef,
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation,
        deleteFileMutation,
        deleteRuntimeElement,
        designDataJsonRef,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        clearPendingHistory: clearPendingHistoryDirections,
        files,
        filesRef: historyFilesRef,
        focusCreatedScreen,
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent,
        getScreenContent,
        historyOrderRef,
        id,
        isSynced,
        lastLocalContentRef,
        resetGeometryCommitCoalescing,
        liveFrameGeometryRef,
        liveScreenSnapshotsById,
        localContentRedoStackRef,
        localContentUndoStackRef,
        markPendingLocalFileContent,
        optimisticallyInsertCreatedFile,
        overviewScreens,
        pendingLiveNonStyleEditsRef,
        pendingLiveNonStyleRedoStackRef,
        pendingLiveNonStyleUndoStackRef,
        pendingLocalFileContentsRef,
        pendingStructureRedoReplayRef,
        pendingStructureRedoReplayTimerRef,
        pendingStructureRedoPreparedEditsRef,
        pendingVisualStyleEditsRef,
        pendingVisualStyleRedoStackRef,
        pendingVisualStyleUndoStackRef,
        replayPendingVisualStyleRuntime,
        performDeleteFiles,
        publishAuthoritativeClipboardMutation,
        queryClient,
        queueFileContentSave,
        recordLocalContentHistoryChangeFallback,
        redoOrderRef,
        replacePreviewContent,
        restoreSelectionSnapshot,
        runtimeStructureInsertRevisionRef,
        runtimeStructureMoveRevisionRef,
        selectionRedoStackRef,
        selectionUndoStackRef,
        setContentRenderRevision,
        setHoveredElement,
        setPendingLayerNameReplayRequest,
        setPendingLayerStateReplayRequest,
        setPendingLiveNonStyleEdits,
        setPendingTextRevertRequest,
        setPendingVisualStyleEdits,
        setPendingVisualStyleBaselineResetRequest,
        setPendingVisualStyleRevertRequest,
        setRuntimeStructureDeleteRequest,
        setRuntimeStructureInsertRequest,
        setRuntimeStructureMoveRequest,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        suppressContentHistoryRef,
        syncLiveScreenSnapshotPreview,
        syncUndoRedoState,
        t,
        undoManagerRef,
        updateDesignAsync,
        updateLiveScreenSnapshotContent,
        viewModeRef,
        writeFrameGeometrySnapshot,
        ydoc,
      }),
    [
      ydoc,
      activeFile,
      applyFileContentUpdate,
      applyDesignDataHistoryChanges,
      applyGeometryHistoryContentChangesRef,
      applyLocalContentUpdate,
      canEditDesign,
      canEditLiveScreens,
      clearPendingHistoryDirections,
      createFileMutation,
      deleteFileMutation,
      deleteRuntimeElement,
      files,
      focusCreatedScreen,
      getFreshActiveContent,
      getScreenContent,
      id,
      isSynced,
      liveScreenSnapshotsById,
      markPendingLocalFileContent,
      optimisticallyInsertCreatedFile,
      overviewScreens.length,
      performDeleteFiles,
      publishAuthoritativeClipboardMutation,
      queryClient,
      queueFileContentSave,
      recordLocalContentHistoryChangeFallback,
      replacePreviewContent,
      resetGeometryCommitCoalescing,
      replayPendingVisualStyleRuntime,
      restoreSelectionSnapshot,
      setPendingVisualStyleBaselineResetRequest,
      syncLiveScreenSnapshotPreview,
      syncUndoRedoState,
      t,
      updateDesignAsync,
      updateLiveScreenSnapshotContent,
      writeFrameGeometrySnapshot,
    ],
  );

  const historyDispatchRef = useRef({
    undo: runCurrentUndo,
    redo: runCurrentRedo,
  });
  historyDispatchRef.current = { undo: runCurrentUndo, redo: runCurrentRedo };
  const dispatchHistory = useCallback((direction: "undo" | "redo") => {
    if (fileHistoryMutationPendingRef.current) {
      pendingHistoryDirectionsRef.current.push(direction);
      return;
    }
    const pendingCountBefore =
      pendingVisualStyleEditsRef.current.length +
      pendingLiveNonStyleEditsRef.current.length;
    const run = () => {
      historyDispatchRef.current[direction]();
      const pendingCountAfter =
        pendingVisualStyleEditsRef.current.length +
        pendingLiveNonStyleEditsRef.current.length;
      if (pendingCountBefore > 0 && pendingCountAfter === 0) {
        clearPendingEditSessionRecoveryRef.current();
      }
    };
    const queue = linkedComponentMutationQueueRef.current?.queue;
    const pending = queue
      ? queue.dispatchHistory(queue.hasPending() ? () => flushSync(run) : run)
      : run();
    if (pending) void pending.catch((error) => toast.error(String(error)));
  }, []);
  replayPendingHistoryRef.current = dispatchHistory;
  const handleUndo = useCallback(
    () => dispatchHistory("undo"),
    [dispatchHistory],
  );
  const handleRedo = useCallback(
    () => dispatchHistory("redo"),
    [dispatchHistory],
  );

  const handleZoomIn = useCallback(() => {
    trace("tool", "zoom-in", {});
    setZoom((z) => getNextZoomStepUp(z));
  }, [setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => getNextZoomStepDown(z));
  }, [setZoom]);

  const handleZoomToFit = useCallback(() => {
    viewModeRef.current = "overview";
    setViewMode("overview");
    setActiveTool("move");
    const frames = withMeasuredFrameHeights(
      getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      }),
      measuredScreenHeightByIdRef.current,
      pinnedHeightScreenIds(overviewScreens),
      autoHeightScreenIds(overviewScreens),
    );
    const bounds = getFrameGroupBounds(frames);
    if (!bounds) {
      setExplicitOverviewCanvasZoom(100);
      return;
    }
    cameraCommandNonceRef.current += 1;
    setCameraCommand({
      fitBounds: bounds,
      nonce: cameraCommandNonceRef.current,
    });
  }, [
    boardFileId,
    boardContentBounds,
    exportCanvasFrameGeometryById,
    overviewScreens,
  ]);

  const handleZoomToSelectionFit = useCallback(() => {
    const allFrames = withMeasuredFrameHeights(
      getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      }),
      measuredScreenHeightByIdRef.current,
      pinnedHeightScreenIds(overviewScreens),
      autoHeightScreenIds(overviewScreens),
    );
    const layerTargets = selectedLayerTargetsRef.current;
    const screenFileIds = new Set(overviewScreens.map((screen) => screen.id));
    const selectedIds = new Set(
      layerTargets.length > 0
        ? selectedLayerIdsState.filter((layerId) => screenFileIds.has(layerId))
        : overviewSelectedScreenIds,
    );
    const selectedLayerFrames: FrameEntry[] = [];
    for (const target of layerTargets) {
      if (target.fileId === boardFileId) continue;
      const ownerFrame = allFrames.find((frame) => frame.id === target.fileId);
      const localRect = withMeasuredGeometry(
        target.elementInfo,
        target.fileId,
      ).boundingRect;
      if (
        !ownerFrame ||
        !localRect ||
        localRect.width <= 0 ||
        localRect.height <= 0
      ) {
        return;
      }
      const bounds = getElementWorldBoundsForZoomFit(
        ownerFrame.geometry,
        localRect,
      );
      selectedLayerFrames.push({
        id: target.layerId,
        geometry: {
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
      });
    }
    const boardTargets = layerTargets.filter(
      (target) => target.fileId === boardFileId,
    );
    const boardTarget = boardTargets[boardTargets.length - 1];

    if (boardTarget && boardFileId) {
      const currentSelectors = [
        boardTarget.elementInfo.runtimeSelector,
        boardTarget.elementInfo.selector,
      ].filter((selector): selector is string => Boolean(selector));
      const boardWorldBounds = getCurrentBoardSelectionWorldBounds({
        selection: boardSelectionWorldBoundsRef.current,
        boardFileId,
        ownerFileId: boardTarget.fileId,
        selectedLayerId: boardTarget.layerId,
        sourceLayerIdentity: boardTarget.elementInfo.sourceLayerIdentity,
        currentSelectors,
        currentSourceIds: boardTargets.map((target) =>
          bridgeSourceIdForCodeLayerNode(target.node),
        ),
      });
      if (!boardWorldBounds) return;
      const boardBounds = getBoardSelectionFitBounds({
        selectedFrameEntries: allFrames,
        selectedScreenIds: selectedIds,
        boardFileId,
        boardBounds: boardWorldBounds,
      });
      if (!boardBounds) return;
      const bounds = getFrameGroupBounds([
        {
          id: boardFileId,
          geometry: {
            x: boardBounds.left,
            y: boardBounds.top,
            width: boardBounds.width,
            height: boardBounds.height,
          },
        },
        ...selectedLayerFrames,
      ]);
      if (!bounds) return;
      cameraCommandNonceRef.current += 1;
      setCameraCommand({
        fitBounds: bounds,
        nonce: cameraCommandNonceRef.current,
      });
      return;
    }
    const hasSelection = selectedIds.size > 0 || layerTargets.length > 0;
    const selectedFrames = allFrames.filter((frame) =>
      selectedIds.has(frame.id),
    );
    const bounds = getFrameGroupBounds(
      hasSelection ? [...selectedFrames, ...selectedLayerFrames] : allFrames,
    );
    if (!bounds) {
      if (hasSelection) return;
      setZoom(150);
      return;
    }
    cameraCommandNonceRef.current += 1;
    setCameraCommand({
      fitBounds: bounds,
      nonce: cameraCommandNonceRef.current,
    });
  }, [
    boardFileId,
    boardContentBounds,
    exportCanvasFrameGeometryById,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedLayerIdsState,
    setZoom,
  ]);

  const runEditorViewTransition = useCallback((update: () => void) => {
    if (typeof document === "undefined") {
      update();
      return;
    }

    const startViewTransition = (
      document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      }
    ).startViewTransition;

    if (typeof startViewTransition !== "function") {
      update();
      return;
    }

    let transition:
      | {
          ready?: Promise<unknown>;
          finished?: Promise<unknown>;
          updateCallbackDone?: Promise<unknown>;
        }
      | undefined;
    try {
      transition = startViewTransition.call(document, () => {
        flushSync(update);
      }) as typeof transition;
    } catch {
      update();
      return;
    }
    transition?.ready?.catch(() => {});
    transition?.finished?.catch(() => {});
    transition?.updateCallbackDone?.catch(() => {});
  }, []);

  const getRestoredOverviewSelection = useCallback(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const restored = lastOverviewSelectedScreenIdsRef.current.filter((id) =>
      fileIds.has(id),
    );
    if (restored.length > 0) return restored;
    return activeFileId && fileIds.has(activeFileId) ? [activeFileId] : [];
  }, [activeFileId, files]);

  const enterOverviewFromZoom = useCallback(
    (nextMode?: EditorMode) => {
      if (viewModeRef.current === "overview") return;
      viewModeRef.current = "overview";
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      const restoredOverviewSelection = getRestoredOverviewSelection();
      runEditorViewTransition(() => {
        setDrawMode(nextMode === "annotate");
        setPinMode(false);
        setMode(
          (currentMode) =>
            nextMode ?? (currentMode === "annotate" ? "annotate" : "edit"),
        );
        setSelectedElement(null);
        setHoveredElement(null);
        setActiveTool(nextMode === "annotate" ? "draw" : "move");
        setOverviewSelectedScreenIds(restoredOverviewSelection);
        setSelectedLayerIdsState(restoredOverviewSelection);
        setViewMode("overview");
      });
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      getRestoredOverviewSelection,
      runEditorViewTransition,
    ],
  );

  const enterSingleScreen = useCallback(
    (fileId?: string | null, options?: EnterSingleScreenOptions) =>
      runEnterSingleScreen(
        {
          activeFileId,
          canvasFrameGeometryById,
          clearPendingOverviewLayerSelectionTimer,
          overviewScreens,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          runEditorViewTransition,
          screenZoomByIdRef,
          setActiveFileId,
          setActiveTool,
          setCreatedOverviewLayerSelection,
          setDrawMode,
          setHoveredElement,
          setInteractDeviceName,
          setInteractDeviceSize,
          setMode,
          setPinMode,
          setScreenZoom,
          setSelectedElement,
          setVectorEditingState,
          setViewMode,
          viewModeRef,
        },
        fileId,
        options,
      ),
    [
      activeFileId,
      canvasFrameGeometryById,
      clearPendingOverviewLayerSelectionTimer,
      overviewScreens,
      runEditorViewTransition,
    ],
  );
  const responsiveInteractActive =
    mode === "interact" && viewMode === "single" && !!activeFile && !embedded;
  const handleInteractDeviceChange = useCallback((name: string) => {
    setInteractDeviceName(name);
    const preset = findInteractDevicePreset(name);
    if (preset) {
      setInteractDeviceSize({ width: preset.width, height: preset.height });
    }
  }, []);
  const handleInteractWidthChange = useCallback((width: number) => {
    setInteractDeviceSize((size) => ({ ...size, width }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);
  const handleInteractHeightChange = useCallback((height: number) => {
    setInteractDeviceSize((size) => ({ ...size, height }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);

  const lastSettledSingleZoomRef = useRef<number | null>(null);
  const suppressOverviewPopForExplicitZoomRef = useRef(false);
  useEffect(() => {
    if (!activeFile || viewMode !== "single" || mode !== "edit") {
      lastSettledSingleZoomRef.current = null;
      return;
    }
    const previousZoom = lastSettledSingleZoomRef.current;
    lastSettledSingleZoomRef.current = zoom;
    const suppressPop = suppressOverviewPopForExplicitZoomRef.current;
    suppressOverviewPopForExplicitZoomRef.current = false;
    if (
      shouldPopToOverviewOnZoomChange({
        previousZoom,
        zoom,
        threshold: OVERVIEW_ZOOM_THRESHOLD,
        suppressExplicitZoom: suppressPop,
      })
    ) {
      enterOverviewFromZoom();
    }
  }, [activeFile, enterOverviewFromZoom, mode, viewMode, zoom]);

  const handleModeChange = useCallback(
    (
      next: EditorMode,
      options?: {
        discardPendingLiveEdits?: boolean;
        pendingLiveEditsAlreadyHandled?: boolean;
        targetFileId?: string;
      },
    ) =>
      runModeChange(
        {
          activeFile,
          canEditDesign,
          onPendingVisualEditsBlocked: () =>
            setPendingVisualEditRecoveryVisible(true),
          hasPendingVisualEdits:
            pendingVisualStyleEdits.length > 0 ||
            pendingLiveNonStyleEdits.length > 0 ||
            remoteVisualEditPending,
          clearPendingLiveEditState,
          enterOverviewFromZoom,
          enterSingleScreen,
          files,
          pendingLiveNonStyleEdits,
          pendingVisualStyleEdits,
          requestPendingLiveNonStyleRevert,
          requestPendingVisualStyleRevert,
          setActiveFileId,
          setActiveTool,
          setDrawMode,
          setMode,
          setPinMode,
          setSelectedElement,
          overviewInteractScreenId,
          setOverviewInteractScreenId,
          t,
          viewModeRef,
        },
        next,
        options,
      ),
    [
      activeFile,
      canEditDesign,
      setPendingVisualEditRecoveryVisible,
      remoteVisualEditPending,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      clearPendingLiveEditState,
      enterOverviewFromZoom,
      enterSingleScreen,
      requestPendingLiveNonStyleRevert,
      requestPendingVisualStyleRevert,
      t,
      files,
      overviewInteractScreenId,
    ],
  );
  const handleExitResponsiveInteract = useCallback(() => {
    setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
    handleModeChange("edit");
  }, [handleModeChange]);
  const handleOverviewFrameAction = useCallback(
    (screenId: string) => {
      if (overviewInteractScreenIdRef.current === screenId) {
        handleExitResponsiveInteract();
        return;
      }
      handleModeChange("interact", { targetFileId: screenId });
    },
    [handleExitResponsiveInteract, handleModeChange],
  );
  useEffect(() => {
    if (!responsiveInteractActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      handleExitResponsiveInteract();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [responsiveInteractActive, handleExitResponsiveInteract]);
  useEffect(() => {
    if (!responsiveInteractActive) return;
    const container = canvasContainerRef.current;
    if (!container) return;
    const updateZoomToFit = () => {
      setInteractZoom(
        computeInteractZoomToFit({
          availableWidth: Math.max(1, container.clientWidth - 48),
          availableHeight: Math.max(1, container.clientHeight - 48),
          deviceWidth: interactDeviceSize.width,
          deviceHeight: interactDeviceSize.height,
        }),
      );
    };
    updateZoomToFit();
    window.addEventListener("resize", updateZoomToFit);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateZoomToFit);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateZoomToFit);
    };
  }, [
    responsiveInteractActive,
    interactDeviceSize.width,
    interactDeviceSize.height,
  ]);

  useEffect(() => {
    if (
      embedded ||
      !activeFile ||
      !shouldAutoEnableDrawOverlay({ mode, activeTool, pinMode })
    ) {
      return;
    }
    if (!canEditDesign) return;
    setDrawMode(true);
  }, [activeFile?.id, activeTool, canEditDesign, embedded, mode, pinMode]);

  const handleViewModeToggle = useCallback(() => {
    if (viewModeRef.current === "overview") {
      handleModeChange("interact");
      return;
    }
    enterOverviewFromZoom();
  }, [enterOverviewFromZoom, handleModeChange]);

  const handleSidebarScreenSelect = useCallback(
    (screenId: string) => {
      if (
        viewModeRef.current === "overview" &&
        overviewSelectedScreenIds.length > 0
      ) {
        lastOverviewSelectedScreenIdsRef.current = [
          ...overviewSelectedScreenIds,
        ];
      }
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState([]);
      if (hostEmbeddedEditor) {
        enterSingleScreen(screenId, { mode });
        return;
      }
      handleModeChange("interact", { targetFileId: screenId });
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      enterSingleScreen,
      handleModeChange,
      hostEmbeddedEditor,
      mode,
      overviewSelectedScreenIds,
    ],
  );

  const handleReviewNodeRewrite = useCallback(
    (proposal: NodeRewriteProposal) => {
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      viewModeRef.current = "overview";
      setViewMode("overview");
      setActiveFileId(proposal.fileId);
      setOverviewSelectedScreenIds([proposal.fileId]);
      setSelectedLayerIdsState([proposal.fileId]);
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      setMode("edit");
      setPinMode(false);
      setDrawMode(false);
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
      const reviewFrame = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      }).find((frame) => frame.id === proposal.fileId);
      const reviewBounds = reviewFrame
        ? getFrameGroupBounds([reviewFrame])
        : null;
      if (reviewBounds) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          fitBounds: reviewBounds,
          nonce: cameraCommandNonceRef.current,
          paddingScreenPx: 96,
        });
      }
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      boardContentBounds,
      boardFileId,
      exportCanvasFrameGeometryById,
      handleBreakpointBarSelect,
      overviewScreens,
    ],
  );
  const handleReviewPendingScreen = useCallback(
    (screenId: string) => {
      const proposal = pendingNodeRewriteByFile.get(screenId);
      if (proposal) handleReviewNodeRewrite(proposal);
    },
    [handleReviewNodeRewrite, pendingNodeRewriteByFile],
  );

  const handleSidebarScreenOverview = useCallback(() => {
    const restoredOverviewSelection = getRestoredOverviewSelection();
    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setOverviewSelectedScreenIds(restoredOverviewSelection);
    setSelectedLayerIdsState(restoredOverviewSelection);
    if (viewModeRef.current === "overview") {
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setSelectedElement(null);
      setHoveredElement(null);
      setActiveTool("move");
      return;
    }
    enterOverviewFromZoom();
  }, [
    clearPendingOverviewLayerSelectionTimer,
    enterOverviewFromZoom,
    getRestoredOverviewSelection,
  ]);

  const handleExitReviewCommentMode = useCallback(() => {
    setPinMode(false);
    setOverviewCommentPinRequest(null);
    setDrawMode(false);
    setActiveTool("move");
    setMode("edit");
  }, []);

  const handleOverviewCommentPin = useCallback(
    (canvasPoint: { x: number; y: number }) => {
      overviewCommentPinNonceRef.current += 1;
      setOverviewCommentPinRequest({
        nonce: overviewCommentPinNonceRef.current,
        canvasPoint,
      });
    },
    [],
  );

  const handlePinToolToggle = useCallback(() => {
    if (!canCommentDesign) return;
    if (pinMode) {
      handleExitReviewCommentMode();
      return;
    }
    setCommentsHidden(false);
    setActiveInspectorTab("comments");
    if (viewMode !== "overview") {
      enterOverviewFromZoom("annotate");
    }
    setActiveTool("comment");
    setMode("annotate");
    setPinMode(true);
    setDrawMode(false);
  }, [
    canCommentDesign,
    enterOverviewFromZoom,
    handleExitReviewCommentMode,
    pinMode,
    viewMode,
  ]);

  const handleShowKeyboardShortcutsFromMenu = useCallback(() => {
    keyboardShortcutsReturnFocusRef.current = projectMenuTriggerRef.current;
    suppressProjectMenuReturnFocusRef.current = true;
    setMinimalUi(false);
    setUiHidden(false);
    setKeyboardShortcutsOpen(true);
  }, []);

  const handleCloseKeyboardShortcuts = useCallback(() => {
    setKeyboardShortcutsOpen(false);
    const returnFocusTarget = keyboardShortcutsReturnFocusRef.current;
    keyboardShortcutsReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus({ preventScroll: true });
      }
    });
  }, []);

  const handleToggleKeyboardShortcuts = useCallback(() => {
    if (keyboardShortcutsOpen) {
      handleCloseKeyboardShortcuts();
      return;
    }
    const activeElement = document.activeElement;
    keyboardShortcutsReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setMinimalUi(false);
    setUiHidden(false);
    setKeyboardShortcutsOpen(true);
  }, [handleCloseKeyboardShortcuts, keyboardShortcutsOpen]);

  useEffect(() => {
    if (embedded) return;
    const handleHelpHotkey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isShowKeyboardShortcutsHotkey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      handleToggleKeyboardShortcuts();
    };
    window.addEventListener("keydown", handleHelpHotkey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleHelpHotkey, {
        capture: true,
      });
  }, [embedded, handleToggleKeyboardShortcuts]);

  const handleEscapeHotkey = useCallback(() => {
    recordSelectionHistoryAroundChange(() =>
      runEscapeHotkey({
        activeBreakpointWidthStateRef,
        activeTool,
        cancelActiveEditorDrag,
        drawMode,
        enterOverviewFromZoom,
        focusedAnnotationSending,
        handleBreakpointBarSelect,
        handleCloseKeyboardShortcuts,
        handleExitFocusedDrawMode,
        handleExitOverviewDrawMode,
        keyboardShortcutsOpen,
        mode,
        overviewAnnotationSending,
        pinMode,
        selectedElement,
        setActiveTool,
        setDrawMode,
        setHoveredElement,
        setMode,
        setOverviewClearSelectionRequest,
        setOverviewSelectedScreenIds,
        setPinMode,
        setSelectedElement,
        setSelectedLayerIdsState,
        viewMode,
      }),
    );
  }, [
    activeTool,
    cancelActiveEditorDrag,
    drawMode,
    enterOverviewFromZoom,
    focusedAnnotationSending,
    handleBreakpointBarSelect,
    keyboardShortcutsOpen,
    handleCloseKeyboardShortcuts,
    handleExitFocusedDrawMode,
    handleExitOverviewDrawMode,
    mode,
    overviewAnnotationSending,
    pinMode,
    recordSelectionHistoryAroundChange,
    selectedElement,
    viewMode,
  ]);

  const SINGLE_MODE_TEXT_TAGS = useMemo(
    () =>
      new Set([
        "a",
        "button",
        "em",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "label",
        "li",
        "p",
        "span",
        "strong",
      ]),
    [],
  );
  const selectCodeLayerNodesForHotkey = useCallback(
    (
      fileId: string,
      nodes: CodeLayerNode[],
      expandedIds: readonly string[] = [],
    ): boolean => {
      if (nodes.length === 0) return false;
      setActiveFileId(fileId);
      setOverviewSelectedScreenIds([]);
      setSelectedLayerIdsState(nodes.map((node) => node.id));
      setSelectedElement(
        elementInfoFromCodeLayerNode(nodes[nodes.length - 1]!),
      );
      setExpandedLayerIds((current) => {
        const next = new Set(current);
        next.add(fileId);
        expandedIds.forEach((expandedId) => next.add(expandedId));
        return next.size === current.length ? current : Array.from(next);
      });
      return true;
    },
    [],
  );
  const enterVectorEditForSelection = useCallback(
    (owner: { fileId: string; node: CodeLayerNode }): boolean => {
      const penNodesAttr = owner.node.dataAttributes["data-an-pen-nodes"];
      const primitive = owner.node.dataAttributes["data-an-primitive"];
      const isEditablePrimitive = ["ellipse", "rect", "rectangle"].includes(
        primitive ?? "",
      );
      if (!penNodesAttr && !isEditablePrimitive) return false;
      const originCanvas = getScreenFrameOriginCanvas({
        screenId: owner.fileId,
        overviewScreens,
        canvasFrameGeometryById,
        boardFileId,
      });
      const nodeId =
        owner.node.dataAttributes["data-agent-native-node-id"] ?? owner.node.id;
      if (!originCanvas) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      const iframe = getOverviewFrameIframe(owner.fileId);
      const safeNodeId = nodeId.replace(/["\\]/g, "\\$&");
      const element = iframe?.contentDocument?.querySelector<Element>(
        `[data-agent-native-node-id="${safeNodeId}"]`,
      );
      if (!iframe || !element) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }

      if (penNodesAttr) {
        const path = parsePenNodes(penNodesAttr);
        const elementTag = element.tagName.toLowerCase();
        const svg =
          elementTag === "svg"
            ? (element as SVGSVGElement)
            : elementTag === "path"
              ? (element as SVGPathElement).ownerSVGElement
              : null;
        const isPastedChildPath =
          elementTag === "path" &&
          svg?.getAttribute("data-an-primitive") === "pasted-svg";
        const renderOffset =
          owner.fileId === boardFileId
            ? boardRenderOffset(element)
            : { x: 0, y: 0 };
        const editable =
          path &&
          svg &&
          (elementTag === "svg" ||
            (isPastedChildPath && penPathScreenContentOffset(svg)))
            ? penPathForVectorEdit(svg, path, renderOffset)
            : null;
        if (!editable) {
          toast.error(t("designEditor.toasts.vectorEditUnsupported"));
          return true;
        }
        setVectorEditingState({
          screenId: owner.fileId,
          nodeId,
          layerId: owner.node.id,
          path: editable.path,
          selectedAnchorIndex: null,
          sourceOffset: editable.sourceOffset,
          primitiveSource: null,
        });
        return true;
      }

      if (element.tagName.toLowerCase() === "svg") {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      const source = primitiveVectorEditSource(element as HTMLElement);
      if (!source) {
        toast.error(t("designEditor.toasts.vectorEditUnsupported"));
        return true;
      }
      setVectorEditingState({
        screenId: owner.fileId,
        nodeId,
        layerId: owner.node.id,
        path: source.path,
        selectedAnchorIndex: null,
        sourceOffset: { x: 0, y: 0 },
        primitiveSource: { geometry: source.geometry, fill: source.fill },
      });
      return true;
    },
    [
      boardFileId,
      canvasFrameGeometryById,
      getOverviewFrameIframe,
      overviewScreens,
      t,
    ],
  );
  const handleEnterHotkey = useCallback(
    () =>
      runEnterHotkey({
        SINGLE_MODE_TEXT_TAGS,
        activeFile,
        activeFileId,
        boardFileId,
        codeLayerOwnerByNodeIdRef,
        enterVectorEditForSelection,
        getProjectionContentForScreen,
        overviewSelectedScreenIds,
        selectedElement,
        selectCodeLayerNodesForHotkey,
        selectedLayerIdsState,
        setActiveFileId,
        setSelectedLayerIdsState,
        viewMode,
      }),
    [
      SINGLE_MODE_TEXT_TAGS,
      activeFile?.id,
      activeFileId,
      boardFileId,
      enterVectorEditForSelection,
      getProjectionContentForScreen,
      overviewSelectedScreenIds,
      selectedElement,
      selectCodeLayerNodesForHotkey,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  useEffect(() => {
    const getPreviewIframe = () =>
      document.querySelector(
        // i18n-ignore: DOM selector helper.
        "iframe[data-design-preview-iframe]",
      ) as HTMLIFrameElement | null;

    const updateIframePointerEvents = () => {
      const iframe = getPreviewIframe();
      if (!iframe) return;
      const wrappers = document.body.querySelectorAll(
        "[data-radix-popper-content-wrapper]",
      );
      const hasOpenPopperOverlay = Array.from(wrappers).some((wrapper) =>
        isRadixOverlayOpen(wrapper),
      );
      const hasOpenOverlay =
        hasOpenPopperOverlay ||
        Boolean(
          document.querySelector(
            "[data-radix-portal] [data-state='open']:not([data-agent-native-tooltip])",
          ),
        );
      iframe.style.pointerEvents = hasOpenOverlay ? "none" : "";
    };

    const observer = new MutationObserver(updateIframePointerEvents);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    return () => {
      observer.disconnect();
      const iframe = getPreviewIframe();
      if (iframe) iframe.style.pointerEvents = "";
    };
  }, []);

  const handleCycleFile = useCallback(
    (backwards: boolean) => {
      if (!overviewScreens.length || !activeFile) return;
      const currentIndex = Math.max(
        0,
        overviewScreens.findIndex((screen) => screen.id === activeFile.id),
      );
      const nextIndex =
        (currentIndex + (backwards ? -1 : 1) + overviewScreens.length) %
        overviewScreens.length;
      const nextScreen = overviewScreens[nextIndex];
      if (!nextScreen) return;
      setActiveFileId(nextScreen.id);
      setSelectedElement(null);
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
      });
      const nextFrame = frames.find((frame) => frame.id === nextScreen.id);
      const bounds = nextFrame ? getFrameGroupBounds([nextFrame]) : null;
      if (bounds) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          fitBounds: bounds,
          nonce: cameraCommandNonceRef.current,
          paddingScreenPx: 160,
        });
      }
    },
    [activeFile, exportCanvasFrameGeometryById, overviewScreens],
  );

  const handleCycleSibling = useCallback(
    (backwards: boolean) => {
      const selectedId =
        selectedLayerIdsState[selectedLayerIdsState.length - 1];
      if (!selectedId) return;
      const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
      if (!owner) return;
      const siblingOrder = findCodeLayerSiblingOrder(owner.tree, selectedId);
      if (!siblingOrder || siblingOrder.siblingIds.length < 2) return;
      const nextIndex =
        (siblingOrder.index +
          (backwards ? -1 : 1) +
          siblingOrder.siblingIds.length) %
        siblingOrder.siblingIds.length;
      const nextId = siblingOrder.siblingIds[nextIndex];
      if (!nextId) return;
      const nextOwner = codeLayerOwnerByNodeIdRef.current.get(nextId);
      if (!nextOwner || nextOwner.fileId !== owner.fileId) return;
      selectCodeLayerNodesForHotkey(
        nextOwner.fileId,
        [nextOwner.node],
        collectCodeLayerAncestors(nextOwner.tree, nextId),
      );
    },
    [selectCodeLayerNodesForHotkey, selectedLayerIdsState],
  );

  const handleSelectParentLayer = useCallback(() => {
    const selectedId = selectedLayerIdsState[selectedLayerIdsState.length - 1];
    if (!selectedId) return;
    const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
    if (!owner?.node.parentId) return;
    const parentOwner = codeLayerOwnerByNodeIdRef.current.get(
      owner.node.parentId,
    );
    if (!parentOwner || parentOwner.fileId !== owner.fileId) return;
    if (!hasSelectableCodeLayerParent({ parentNode: parentOwner.node })) {
      return;
    }
    selectCodeLayerNodesForHotkey(
      parentOwner.fileId,
      [parentOwner.node],
      collectCodeLayerAncestors(parentOwner.tree, parentOwner.node.id),
    );
  }, [selectCodeLayerNodesForHotkey, selectedLayerIdsState]);

  const handleSelectAllFrames = useCallback(() => {
    recordSelectionHistoryAroundChange(() => {
      const projection = activeFile
        ? buildCodeLayerProjection(getFreshActiveContent(), {
            source: codeLayerSourceForScreen(activeFile.id),
          })
        : null;
      const decision = projection
        ? runSelectAll({
            tree: buildCodeLayerTree(projection),
            selectedLayerIds: selectedLayerIdsState,
            nonLayerIds: new Set(files.map((file) => file.id)),
            fallback:
              viewModeRef.current === "single" ? "top-level-layers" : "screens",
          })
        : ({ kind: "screens" } as const);
      if (projection && decision.kind === "layers") {
        setSelectedLayerIdsState(decision.layerIds);
        const lastId = decision.layerIds[decision.layerIds.length - 1];
        const lastNode = projection.nodes.find((n) => n.id === lastId);
        if (lastNode)
          setSelectedElement(elementInfoFromCodeLayerNode(lastNode));
        return;
      }
      if (!overviewScreens.length) return;
      setDrawMode(false);
      setPinMode(false);
      setMode("edit");
      setActiveTool("move");
      viewModeRef.current = "overview";
      setViewMode("overview");
      setOverviewSelectedScreenIds(overviewScreens.map((screen) => screen.id));
      setOverviewSelectAllRequest((request) => request + 1);
    });
  }, [
    activeFile,
    codeLayerSourceForScreen,
    files,
    getFreshActiveContent,
    overviewScreens,
    recordSelectionHistoryAroundChange,
    selectedLayerIdsState,
  ]);

  const shouldHandleEditorHotkey = useCallback((event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const primary = event.metaKey || event.ctrlKey;
    const plainPasteHotkey =
      primary && key === "v" && !event.altKey && !event.shiftKey;
    if (!plainPasteHotkey) return true;
    return (
      (event as KeyboardEvent & { __agentNativeIframeHotkey?: boolean })
        .__agentNativeIframeHotkey === true
    );
  }, []);

  const handleShowLayersPanel = useCallback(() => {
    setMinimalUi(false);
    setUiHidden(false);
    setActiveLeftPanel("file");
  }, []);

  const handleShowAssetsPanel = useCallback(() => {
    setMinimalUi(false);
    setUiHidden(false);
    setActiveLeftPanel("assets");
  }, []);

  const handleFindLayers = useCallback(() => {
    handleShowLayersPanel();
    window.requestAnimationFrame(() => layersPanelRef.current?.focusSearch());
  }, [handleShowLayersPanel]);

  const opacitySelectionKey =
    canEditDesign && !textEditingState.active
      ? selectedElement
        ? `${activeFileId ?? activeFile?.id ?? ""}:${selectedLayerIdsState.length > 1 ? [...selectedLayerIdsState].sort().join(",") : ""}:${selectedElement.selector ?? selectedElement.sourceId ?? ""}`
        : viewMode === "overview" && overviewSelectedScreenIds.length > 0
          ? overviewSelectedScreenIds.length === 1
            ? `screen:${overviewSelectedScreenIds[0]}`
            : `screens:${[...overviewSelectedScreenIds].sort().join(",")}`
          : null
      : null;

  useDesignHotkeys({
    enabled:
      !hostOwnsChrome &&
      !responsiveInteractActive &&
      !(pendingQuestions && pendingQuestions.length > 0),
    shouldHandleEvent: shouldHandleEditorHotkey,
    canClaimBoundChords: canEditDesign || canEditLiveScreens,
    onMoveTool: canEditDesign ? handleMoveTool : undefined,
    onFrameTool: canEditDesign
      ? () => {
          setFrameToolDraws("frame");
          handleFrameTool();
        }
      : undefined,
    onRectangleTool: canEditDesign ? handleRectTool : undefined,
    onLineTool: canEditDesign ? handleLineTool : undefined,
    onArrowTool: canEditDesign ? handleArrowTool : undefined,
    onEllipseTool: canEditDesign ? handleEllipseTool : undefined,
    onTextTool: canEditDesign ? handleTextTool : undefined,
    onPenTool: canEditDesign ? handlePenTool : undefined,
    onHandTool: handleHandTool,
    onCommentTool: canCommentDesign ? handlePinToolToggle : undefined,
    onDrawTool: canEditDesign ? handleDrawTool : undefined,
    onScaleTool: canEditDesign ? handleScaleTool : undefined,
    onCopy: handleCopySelection,
    onCopyAsPng:
      canEditDesign &&
      (Boolean(selectedElement) ||
        (viewMode === "overview" && selectedScreenIds.length === 1))
        ? () => void handleCopyAsPng()
        : undefined,
    onPaste: canEditDesign ? () => void handlePasteSelection() : undefined,
    onCut: canEditDesign ? handleCutSelection : undefined,
    onPasteOver: canEditDesign ? handlePasteOverSelection : undefined,
    onPasteToReplace: canEditDesign
      ? () => void handlePasteToReplace()
      : undefined,
    onCopyProps: canEditActiveVisualScreen ? handleCopyProps : undefined,
    onPasteProps: canEditActiveVisualScreen ? handlePasteProps : undefined,
    onDuplicate: canEditActiveVisualScreen
      ? handleDuplicateSelection
      : undefined,
    onDelete:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => {
            if (!canEditDesign && canEditSelectedLiveLayer) {
              handleDeleteSelection();
              return;
            }
            handleDeleteOverviewSelection(overviewSelectedScreenIds);
          }
        : undefined,
    onRename: () => {
      if (!canEditDesign && !canEditSingleSelectedLiveLayer) return;
      const layerId = getSingleSelectedRenamableLayerId();
      if (layerId) {
        layersPanelRef.current?.beginRename(layerId);
        return;
      }
      if (!canEditDesign) return;
      setTitleDraft(design?.title ?? "");
      setTitleEditing(true);
    },
    onFind: initialGenerationChromeLimited ? undefined : handleFindLayers,
    onShowLayersPanel: initialGenerationChromeLimited
      ? undefined
      : handleShowLayersPanel,
    onShowAssetsPanel:
      initialGenerationChromeLimited || !SHOW_DESIGN_SECONDARY_LEFT_PANELS
        ? undefined
        : handleShowAssetsPanel,
    onGroup: canEditDesign ? handleGroupSelection : undefined,
    onUngroup: canEditDesign ? handleUngroupSelection : undefined,
    onFrameSelection: canEditDesign ? handleFrameSelection : undefined,
    onBooleanSubtract: canEditDesign
      ? handleBooleanSubtractSelection
      : undefined,
    onToggleHidden:
      canEditDesign || canEditLiveScreens
        ? () => handleToggleHiddenForSelection()
        : undefined,
    onToggleLocked:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => handleToggleLockedForSelection()
        : undefined,
    onSelectAll: handleSelectAllFrames,
    onUndo: canEditDesign || canEditLiveScreens ? handleUndo : undefined,
    onRedo: canEditDesign || canEditLiveScreens ? handleRedo : undefined,
    onBringForward:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("forward")
        : undefined,
    onBringToFront:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("front")
        : undefined,
    onSendBackward:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("backward")
        : undefined,
    onSendToBack:
      canEditDesign || canEditSelectedLiveLayerRef.current
        ? () => changeSelectedZIndex("back")
        : undefined,
    onEscape: responsiveInteractActive ? undefined : handleEscapeHotkey,
    onEnter: handleEnterHotkey,
    onSelectParent: handleSelectParentLayer,
    onTab: ({ backwards }) => handleCycleSibling(backwards),
    onNextFrame: () => handleCycleFile(false),
    onPreviousFrame: () => handleCycleFile(true),
    onNudge: ({ direction, largeStep }) =>
      handleNudgeSelection(direction, largeStep),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: () => setZoom(100),
    onZoomToFit: handleZoomToFit,
    onZoomToSelection: () => {
      if (viewMode === "overview") {
        handleZoomToSelectionFit();
        return;
      }
      if (selectedElement) setZoom(150);
    },
    onCreateComponent: canEditDesign ? handleCreateComponentHotkey : undefined,
    onDetachInstance:
      canEditDesign && selectedInstanceActionNodeId
        ? handleDetachInstanceMenuAction
        : undefined,
    opacitySelectionKey,
    onOpacityChange: opacitySelectionKey
      ? ({ opacity }) => {
          const value = String(opacity / 100);
          if (selectedElement) {
            handleStyleChange("opacity", value);
          } else if (
            viewMode === "overview" &&
            overviewSelectedScreenIds.length > 1
          ) {
            commitOverviewScreenStylesRef.current(overviewSelectedScreenIds, {
              opacity: value,
            });
          } else {
            handleSelectedScreenStyleChange("opacity", value);
          }
        }
      : undefined,
    onToggleUnderline:
      canEditDesign && selectedElement
        ? handleToggleUnderlineHotkey
        : undefined,
    onToggleStrikethrough:
      canEditDesign && selectedElement
        ? handleToggleStrikethroughHotkey
        : undefined,
    onFlipHorizontal: canEditDesign ? handleFlipHorizontal : undefined,
    onFlipVertical: canEditDesign ? handleFlipVertical : undefined,
    onSwapFillStroke: canEditDesign ? handleSwapFillStroke : undefined,
    onEyedropper: canEditDesign ? handleEyedropper : undefined,
    onAlignSelection: canEditDesign
      ? ({ edge }) => handleAlignSelection(edge)
      : undefined,
    onDistributeSelection: canEditDesign
      ? ({ axis }) => handleDistributeSelection(axis)
      : undefined,
    onTidyUp: canEditDesign ? handleTidyUp : undefined,
    onAddAutoLayout: canEditDesign ? handleAddAutoLayout : undefined,
    onToggleUi: handleToggleUi,
    onToggleMinimalUi: handleToggleMinimalUi,
    onToggleComments: handleToggleComments,
    onToggleLayoutGrids: canEditDesign ? handleToggleLayoutGrids : undefined,
    onShowKeyboardShortcuts: handleToggleKeyboardShortcuts,
  });

  const startRetryGeneration = useCallback(
    async (
      promptState: NonNullable<typeof retryablePrompt>,
      attempt: number,
      mode: "manual" | "auto",
    ) =>
      runStartRetryGeneration(
        {
          agentSubmit,
          canEditDesign,
          clearAutoRetryTimer,
          clearGenerationCompleteTimer,
          design,
          generationModelRef,
          id,
          setGenerationChatTabId,
          setGenerationIssue,
          setHasPendingGeneration,
          setRetryablePrompt,
        },
        promptState,
        attempt,
        mode,
      ),
    [
      agentSubmit,
      canEditDesign,
      clearAutoRetryTimer,
      clearGenerationCompleteTimer,
      design,
      id,
    ],
  );

  const handleRetryGeneration = useCallback(() => {
    if (!retryablePrompt || !canEditDesign) return;
    void startRetryGeneration(
      retryablePrompt,
      (retryablePrompt.attempt ?? 1) + 1,
      "manual",
    );
  }, [canEditDesign, retryablePrompt, startRetryGeneration]);

  useEffect(() => {
    clearAutoRetryTimer();
    if (
      !retryablePrompt ||
      !generationIssue ||
      !canEditDesign ||
      generating ||
      pendingGenerationActive
    ) {
      return;
    }
    const completedAttempt = retryablePrompt.attempt ?? 1;
    if (completedAttempt >= MAX_GENERATION_ATTEMPTS) return;

    autoRetryTimerRef.current = window.setTimeout(() => {
      autoRetryTimerRef.current = null;
      void startRetryGeneration(retryablePrompt, completedAttempt + 1, "auto");
    }, AUTO_RETRY_DELAY_MS);

    return clearAutoRetryTimer;
  }, [
    canEditDesign,
    retryablePrompt,
    generationIssue,
    generating,
    pendingGenerationActive,
    startRetryGeneration,
    clearAutoRetryTimer,
  ]);

  const ensureCodingHandoff = useCallback(
    async (options?: { refresh?: boolean; silent?: boolean }) => {
      if (!id) return null;
      if (!options?.refresh && codingHandoffResult) return codingHandoffResult;
      try {
        setCodingHandoffError(null);
        setCodingHandoffLoading(true);
        const result = await callAction<CodingHandoffResult>(
          "export-coding-handoff",
          {
            id,
            origin: window.location.origin,
            format: "markdown",
          } as any,
        );
        setCodingHandoffResult(result);
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("designEditor.toasts.codingHandoffError");
        setCodingHandoffError(message);
        if (!options?.silent) toast.error(message);
        return null;
      } finally {
        setCodingHandoffLoading(false);
      }
    },
    [codingHandoffResult, id, t],
  );

  const getCodingHandoffClipboardText = useCallback(
    (result: CodingHandoffResult | null) => {
      return typeof result?.clipboardText === "string"
        ? result.clipboardText
        : typeof result?.prompt === "string"
          ? result.prompt
          : "";
    },
    [],
  );

  const handleCopyCodingHandoff = useCallback(async () => {
    const result = await ensureCodingHandoff({ refresh: true });
    const text = getCodingHandoffClipboardText(result);
    if (!text) {
      toast.error(t("designEditor.toasts.codingHandoffError"));
      return;
    }
    try {
      if (!(await writeClipboardText(text))) {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
        return;
      }
      toast.success(t("designEditor.toasts.codingHandoffCopied"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [ensureCodingHandoff, getCodingHandoffClipboardText, t]);

  const hasPendingVisualStyleEdits =
    pendingVisualStyleEdits.length > 0 || pendingLiveNonStyleEdits.length > 0;
  usePendingLiveEditUnloadGuard(hasPendingVisualStyleEdits);
  const pendingVisualStyleNavigationBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        shouldBlockPendingVisualStyleNavigation({
          hasPendingVisualStyleEdits,
          currentPathname: currentLocation.pathname,
          nextPathname: nextLocation.pathname,
        }),
      [hasPendingVisualStyleEdits],
    ),
  );
  const pendingVisualStyleWarningOpen =
    pendingVisualStyleNavigationBlocker.state === "blocked";
  const handleStayOnPendingVisualStyleNavigation = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    pendingVisualStyleNavigationBlocker.reset();
  }, [pendingVisualStyleNavigationBlocker]);
  const handleDiscardPendingVisualStylesAndNavigate = useCallback(() => {
    if (pendingVisualStyleNavigationBlocker.state !== "blocked") return;
    requestPendingVisualStyleRevert(pendingVisualStyleEdits);
    requestPendingLiveNonStyleRevert(pendingLiveNonStyleEdits);
    clearPendingLiveEditState();
    pendingVisualStyleNavigationBlocker.proceed();
  }, [
    clearPendingLiveEditState,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEdits,
    pendingVisualStyleNavigationBlocker,
    requestPendingLiveNonStyleRevert,
    requestPendingVisualStyleRevert,
  ]);

  const pendingVisualEditCount = useMemo(
    () =>
      getPendingVisualEditCount(
        pendingVisualStyleEdits,
        pendingLiveNonStyleEdits,
      ),
    [pendingLiveNonStyleEdits, pendingVisualStyleEdits],
  );
  const pendingVisualEditHandoffQuery = useActionQuery<{
    status: "empty" | "ready";
    revision: number | null;
  }>(
    "get-visual-edit-pending",
    { designId: id! },
    {
      enabled: Boolean(id) && canEditDesign && pendingVisualEditCount > 0,
      refetchInterval:
        canEditDesign && pendingVisualEditCount > 0 ? 10_000 : false,
      refetchIntervalInBackground: false,
    },
  );
  useEffect(() => {
    if (!id) return;
    if (pendingVisualEditCount > 0) {
      pendingEditSessionDesignIdRef.current = id;
      const result = writePendingEditSessionMarker(id, pendingVisualEditCount);
      setPendingEditSessionMarker(
        result.status === "stored"
          ? { status: "absent" }
          : { status: "unavailable", reason: result.reason },
      );
      return;
    }
    if (pendingEditSessionDesignIdRef.current === id) {
      pendingEditSessionDesignIdRef.current = null;
      const result = clearPendingEditSessionMarker(id);
      if (result.status === "unavailable") {
        setPendingEditSessionMarker(result);
      }
    }
  }, [id, pendingVisualEditCount]);
  const pendingVisualStyleScreenSourceTypes = useMemo(
    () =>
      new Map<string, unknown>(
        overviewScreens.map((screen) => [
          screen.id,
          resolveOverviewScreenSourceType(screen, designSourceType),
        ]),
      ),
    [designSourceType, overviewScreens],
  );
  const screenRoutesById = useMemo(() => {
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
    const routes: Record<string, string> = {};
    for (const [fileId, entry] of Object.entries(metadataByFileId ?? {})) {
      const path = (entry as { path?: unknown })?.path;
      if (typeof path === "string" && path) routes[fileId] = path;
    }
    return routes;
  }, [designDataJson]);
  const showPendingVisualStyleApply = useMemo(
    () =>
      shouldShowPendingVisualStyleApply({
        edits: pendingVisualStyleEdits,
        liveEdits: pendingLiveNonStyleEdits,
        screenSourceTypes: pendingVisualStyleScreenSourceTypes,
        fallbackSourceType: activeCanvasSourceType ?? designSourceType,
      }),
    [
      activeCanvasSourceType,
      designSourceType,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      pendingVisualStyleScreenSourceTypes,
    ],
  );
  const pendingStructureVerificationBusy =
    pendingStructureVerificationStatus === "checking-source" ||
    pendingStructureVerificationStatus === "awaiting-source" ||
    pendingStructureVerificationStatus === "awaiting-runtime";
  const pendingVisualStylePrompt = useMemo(
    () =>
      formatPendingVisualStylePrompt({
        designId: id,
        designTitle: design?.title,
        activeFileId: activeFile?.id,
        activeFilename: activeFile?.filename,
        localhostConnectionId: activeOverviewScreen?.connectionId,
        edits: pendingVisualStyleEdits,
        liveEdits: pendingLiveNonStyleEdits,
        audience: "coding-agent",
        screenRoutes: screenRoutesById,
      }),
    [
      activeFile?.filename,
      activeFile?.id,
      activeOverviewScreen?.connectionId,
      design?.title,
      id,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      screenRoutesById,
    ],
  );
  const hasLocalPendingVisualEdits =
    pendingVisualStyleEdits.length > 0 || pendingLiveNonStyleEdits.length > 0;
  const remoteVisualEditPrompt =
    !hasLocalPendingVisualEdits && remoteVisualEditPending
      ? `${visualEditPendingQuery.data!.prompt}\n\nAfter applying and verifying these source changes, acknowledge only revision ${visualEditPendingQuery.data!.revision} with acknowledge-visual-edit-pending, then call get-visual-edit-pending again to verify it cleared.`
      : undefined;
  const showSharedVisualEditApply = Boolean(remoteVisualEditPrompt);
  const showVisualEditApply =
    showPendingVisualStyleApply ||
    showSharedVisualEditApply ||
    pendingVisualEditRecoveryVisible;
  useEffect(() => {
    if (!hasLocalPendingVisualEdits && !remoteVisualEditPending) {
      setPendingVisualEditRecoveryVisible(false);
    }
  }, [hasLocalPendingVisualEdits, remoteVisualEditPending]);
  useEffect(() => {
    if (
      !id ||
      !shouldPublishVisualEditPending({
        designId: id,
        canEditDesign,
        canEditLiveScreen: canEditLiveScreen(activeOverviewScreen?.id),
      })
    ) {
      return;
    }
    if (
      pendingVisualEditCount === 0 &&
      pendingVisualEditClearRequestedRef.current !== id &&
      pendingVisualEditHadPendingRef.current !== id
    ) {
      return;
    }
    const revision = pendingVisualEditPublicationRevisionRef.current + 1;
    pendingVisualEditPublicationRevisionRef.current = revision;
    const pending =
      pendingVisualEditCount > 0
        ? {
            designId: id,
            publisherId: pendingVisualEditPublisherIdRef.current,
            revision,
            pending: {
              designId: id,
              pendingEditCount: pendingVisualEditCount,
              status: "ready" as const,
              prompt: pendingVisualStylePrompt,
            },
          }
        : {
            designId: id,
            publisherId: pendingVisualEditPublisherIdRef.current,
            revision,
            pending: null,
          };
    if (pendingVisualEditCount > 0) {
      pendingVisualEditClearRequestedRef.current = null;
      pendingVisualEditHadPendingRef.current = id;
    }
    const publish = () =>
      runPublishVisualEditPending({
        activeScreenBridgeUrl,
        activeScreenPreviewToken,
        activeScreenLiveEditCapability,
        callAction,
        canPublishDurableHandoff: canEditDesign,
        designId: id,
        fetchImpl: fetch,
        pending,
        pendingVisualEditClearRequestedRef,
        pendingVisualEditHadPendingRef,
        setPendingVisualEditPublicationFailed,
        showHandoffErrorToast: (error) => {
          const errorCode = (error as { errorCode?: unknown } | undefined)
            ?.errorCode;
          toast.error(
            errorCode === "visual_edit_pending_conflict"
              ? t("designEditor.toasts.visualEditPendingConflict")
              : errorCode === "visual_edit_handoff_unconfirmed"
                ? t("designEditor.toasts.codingHandoffError")
                : (actionErrorMessage(error) ??
                  t("designEditor.toasts.codingHandoffError")),
            { id: "design-visual-edit-pending-publication" },
          );
        },
      });
    pendingVisualEditPublicationQueueRef.current =
      pendingVisualEditPublicationQueueRef.current
        .catch((error) => {
          console.error(
            "[design:visual-edit] queued handoff publication failed",
            error,
          );
        })
        .then(publish);
  }, [
    activeScreenBridgeUrl,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    activeOverviewScreen?.id,
    canEditLiveScreen,
    canEditDesign,
    id,
    pendingVisualEditCount,
    pendingVisualStylePrompt,
    t,
  ]);
  useEffect(() => {
    if (
      !id ||
      !canEditDesign ||
      pendingVisualEditHadPendingRef.current !== id ||
      pendingVisualEditClearRequestedRef.current === id
    ) {
      return;
    }
    const localPendingCount =
      pendingVisualStyleEditsRef.current.length +
      pendingLiveNonStyleEditsRef.current.length;
    const currentRevision = pendingVisualEditPublicationRevisionRef.current;
    const handoff = pendingVisualEditHandoffQuery.data;
    if (
      !handoff ||
      !isVisualEditHandoffAcknowledged({
        currentRevision,
        pendingEditCount: localPendingCount,
        revision: handoff.revision,
        status: handoff.status,
      })
    ) {
      return;
    }
    clearPendingLiveEditStateRef.current();
  }, [
    clearPendingLiveEditState,
    canEditDesign,
    id,
    pendingLiveNonStyleEdits,
    pendingVisualEditHandoffQuery.data,
    pendingVisualStyleEdits,
  ]);
  const visualEditPromptResult = useCallback<
    () => VisualEditPromptResult
  >(() => {
    if (pendingVisualEditCount > 0) {
      return {
        designId: id ?? null,
        pendingEditCount: pendingVisualEditCount,
        status: "ready",
        prompt: pendingVisualStylePrompt,
      };
    }
    const recoveryMarker = pendingEditSessionRecoveryMarker;
    if (recoveryMarker.status === "present") {
      const count = recoveryMarker.marker.count;
      return {
        designId: id ?? null,
        pendingEditCount: count,
        status: "session-ended",
        prompt: `The previous visual-edit session ended with ${count} pending edit${count === 1 ? "" : "s"}. Those live edits are no longer recoverable; recreate them in the canvas before asking the agent to apply source changes.`,
      };
    }
    if (recoveryMarker.status === "unavailable") {
      return {
        designId: id ?? null,
        pendingEditCount: 0,
        status: "unknown",
        prompt: `The previous visual-edit session marker could not be read (${recoveryMarker.reason}). Do not treat an empty prompt as proof that no edits were lost; inspect the source and recreate the intended canvas changes before applying.`,
      };
    }
    if (pendingEditSessionMarker.status === "unavailable") {
      return {
        designId: id ?? null,
        pendingEditCount: 0,
        status: "unknown",
        prompt: `The current visual-edit session marker could not be read (${pendingEditSessionMarker.reason}). Do not treat an empty prompt as proof that no edits were lost; inspect the source and recreate the intended canvas changes before applying.`,
      };
    }
    return {
      designId: id ?? null,
      pendingEditCount: 0,
      status: "empty",
      prompt: pendingVisualStylePrompt,
    };
  }, [
    id,
    pendingEditSessionMarker,
    pendingEditSessionRecoveryMarker,
    pendingVisualEditCount,
    pendingVisualStylePrompt,
  ]);
  const handleApplyPendingVisualStylesWithAgent = useCallback(
    async (promptOverride?: string) =>
      runApplyPendingVisualStylesWithAgent({
        cancelPendingStructureVerification,
        clearPendingLiveEditState,
        id,
        overviewScreens,
        pendingAgentHandoffBusyRef,
        pendingLiveNonStyleEdits,
        stagedHandoffStartTimerRef,
        stagedSourceHandoffRef,
        pendingStructureVerificationRevisionRef,
        pendingStructureVerificationSessionRef,
        pendingStructureVerificationSnapshotsRef,
        pendingLiveNonStyleEditsRef,
        pendingStructureVerificationStatus,
        pendingVisualStyleEdits,
        pendingVisualStylePrompt: promptOverride ?? pendingVisualStylePrompt,
        allowPromptOnly: promptOverride !== undefined,
        setActiveLeftPanel,
        setApplyingViaHost,
        setPendingAgentHandoffBusy,
        setPendingLiveNonStyleEdits,
        setPendingStructureAckRequest,
        setPendingStructureVerificationStatus,
        setPendingVisualStyleBaselineResetRequest,
        setPendingVisualStyleRevertRequest,
        setRuntimeStructureVerificationRequest,
        t,
      }),
    [
      cancelPendingStructureVerification,
      clearPendingLiveEditState,
      id,
      overviewScreens,
      pendingLiveNonStyleEdits,
      pendingStructureVerificationStatus,
      pendingVisualStyleEdits,
      pendingVisualStylePrompt,
      t,
    ],
  );
  const handleAbortPendingVisualStyles = useCallback(() => {
    if (
      pendingVisualStyleEdits.length === 0 &&
      pendingLiveNonStyleEdits.length === 0
    ) {
      return;
    }
    requestPendingVisualStyleRevert(pendingVisualStyleEdits);
    requestPendingLiveNonStyleRevert(pendingLiveNonStyleEdits);
    clearPendingLiveEditState();
    window.setTimeout(() => {
      handleModeChange("interact", { pendingLiveEditsAlreadyHandled: true });
    }, 50);
    toast.success(t("designEditor.pendingVisualStyles.abortedToast"));
  }, [
    clearPendingLiveEditState,
    handleModeChange,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEdits,
    requestPendingLiveNonStyleRevert,
    requestPendingVisualStyleRevert,
    t,
  ]);
  const handleCopyPendingVisualStylePrompt = useCallback(
    async (promptOverride?: string, fullPrompt = false) => {
      if (
        promptOverride === undefined &&
        pendingVisualStyleEdits.length === 0 &&
        pendingLiveNonStyleEdits.length === 0
      ) {
        return;
      }
      try {
        const host =
          externalAgentHost?.id === "chatgpt" ||
          externalAgentHost?.id === "claude"
            ? externalAgentHost.id
            : pageHasWebMcpHost()
              ? "webmcp"
              : null;
        const clipboardPrompt = formatVisualEditClipboardPrompt(
          promptOverride ?? pendingVisualStylePrompt,
          host,
          fullPrompt,
          id,
        );
        if (!(await writeClipboardText(clipboardPrompt))) {
          toast.error(t("designEditor.toasts.clipboardBlocked"));
          return;
        }
        toast.success(t("designEditor.pendingVisualStyles.copiedToast"), {
          description: t(
            "designEditor.pendingVisualStyles.copiedToastDescription",
          ),
        });
      } catch {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
      }
    },
    [
      pendingLiveNonStyleEdits.length,
      pendingVisualStyleEdits.length,
      pendingVisualStylePrompt,
      externalAgentHost,
      id,
      t,
    ],
  );

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const fallbackExportName = useCallback(
    (extension: string, suffix = "") => {
      const safeTitle =
        design?.title?.replace(/[^a-zA-Z0-9_-]/g, "-") || "design";
      const safeSuffix = suffix.trim().replace(/[^a-zA-Z0-9@._-]/g, "-");
      return `${safeTitle}${safeSuffix ? `-${safeSuffix}` : ""}.${extension}`;
    },
    [design?.title],
  );

  const handleDownloadHtml = useCallback(() => {
    if (!id) return;
    exportHtmlMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.html !== "string") {
          toast.error(t("designEditor.toasts.htmlCreateError"));
          return;
        }
        triggerBlobDownload(
          new Blob([result.html], { type: "text/html;charset=utf-8" }),
          result.filename || fallbackExportName("html"),
        );
        toast.success(t("designEditor.toasts.htmlDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.htmlExportError"));
      },
    });
  }, [exportHtmlMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadZip = useCallback(() => {
    if (!id) return;
    exportZipMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.zipBase64 !== "string") {
          toast.error(t("designEditor.toasts.zipCreateError"));
          return;
        }
        const binary = window.atob(result.zipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        triggerBlobDownload(
          new Blob([bytes], { type: "application/zip" }),
          result.filename || fallbackExportName("zip"),
        );
        toast.success(t("designEditor.toasts.zipDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.zipExportError"));
      },
    });
  }, [exportZipMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const pngSelectedElements = useMemo(() => {
    const selectedIds = new Set(selectedLayerIdsState);
    const projected = activeCodeLayerProjection.nodes
      .filter((node) => selectedIds.has(node.id))
      .map((node) => ({
        ...elementInfoFromCodeLayerNode(node),
        ...(activeCodeLayerProjection.source?.fileId
          ? {
              sourceLayerIdentity: {
                screenId: activeCodeLayerProjection.source.fileId,
                nodeId: node.id,
              },
            }
          : {}),
      }));
    return projected.length > 0
      ? projected
      : selectedElement
        ? [selectedElement]
        : [];
  }, [activeCodeLayerProjection.nodes, selectedElement, selectedLayerIdsState]);

  const resolvePngCaptureTarget = useCallback(
    (scope: PngCaptureScope) => {
      let iframe = canvasIframeRef.current;
      let cropSelection: ElementInfo | readonly ElementInfo[] | null =
        viewMode === "single" || scope === "element"
          ? pngSelectedElements.length > 0
            ? pngSelectedElements
            : selectedElement
          : null;

      if (scope === "screens" && viewMode === "overview") {
        const screenId =
          selectedScreenIds.length === 1 ? selectedScreenIds[0] : null;
        iframe = screenId
          ? document.querySelector<HTMLIFrameElement>(
              `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
            )
          : null;
        cropSelection = null;
      } else if (scope === "element" && viewMode === "overview") {
        const ownerFileId =
          pngSelectedElements[0]?.sourceLayerIdentity?.screenId ??
          selectedElement?.sourceLayerIdentity?.screenId ??
          activeFile?.id;
        iframe =
          ownerFileId === boardFileId
            ? document.querySelector<HTMLIFrameElement>(
                "[data-board-surface-layer] iframe[data-design-preview-iframe]",
              )
            : ownerFileId
              ? document.querySelector<HTMLIFrameElement>(
                  `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(ownerFileId)}"]`,
                )
              : null;
      }

      if (!iframe) throw new PngCaptureError("no-preview");

      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
      if (!doc) {
        const sourceType =
          normalizeDesignSourceType(iframe.dataset.designSourceType) ??
          activeCanvasSourceType;
        if (sourceType !== "inline") {
          throw new PngCaptureError("external-preview");
        }
        if (!canEditDesign) {
          throw new PngCaptureError("read-only-preview");
        }
        throw new PngCaptureError("no-preview");
      }

      return { cropSelection, doc, iframe };
    },
    [
      activeCanvasSourceType,
      canEditDesign,
      canvasIframeRef,
      activeFile?.id,
      boardFileId,
      pngSelectedElements,
      selectedElement,
      selectedScreenIds,
      viewMode,
    ],
  );

  const renderPngBlob = useCallback(
    async (arg0: {
      scope: PngCaptureScope;
      settings?: Partial<ExportSettingsValue>;
      format?: "png" | "jpg" | "webp";
    }): Promise<Blob> =>
      runRenderPngBlob(
        {
          activeCanvasSourceType,
          canEditDesign,
          canvasFrameGeometryById: exportCanvasFrameGeometryById,
          overviewScreens,
          resolvePngCaptureTarget,
          selectedScreenIds,
          viewMode,
        },
        arg0,
      ),
    [
      activeCanvasSourceType,
      canEditDesign,
      exportCanvasFrameGeometryById,
      overviewScreens,
      resolvePngCaptureTarget,
      selectedScreenIds,
      viewMode,
    ],
  );

  const showRasterCaptureError = useCallback(
    (error: unknown, format: "png" | "pdf" = "png") => {
      if (error instanceof PngCaptureError) {
        if (format === "pdf") {
          toast.error(t("designEditor.toasts.pdfExportError"));
          return;
        }
        const copy = {
          externalPreview:
            "designEditor.toasts.pngLivePreviewUnavailable" as const,
          readOnlyPreview:
            "designEditor.toasts.pngReadOnlyUnavailable" as const,
          selectionUnresolved: "designEditor.toasts.pngCreateError" as const,
          blobFailed: "designEditor.toasts.pngCreateError" as const,
          noPreview: "designEditor.toasts.openScreenPng" as const,
        };
        const key =
          error.code === "external-preview"
            ? copy.externalPreview
            : error.code === "read-only-preview"
              ? copy.readOnlyPreview
              : error.code === "blob-failed"
                ? copy.blobFailed
                : error.code === "selection-unresolved"
                  ? copy.selectionUnresolved
                  : copy.noPreview;
        toast.error(t(key));
        return;
      }
      console.error(`${format.toUpperCase()} capture failed:`, error);
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              format === "pdf"
                ? "designEditor.toasts.pdfExportError"
                : "designEditor.toasts.pngExportError",
            ),
      );
    },
    [t],
  );

  const handleDownloadPng = useCallback(
    async (
      settings?: Partial<ExportSettingsValue>,
      format: "png" | "jpg" | "webp" = "png",
      scope: PngCaptureScope = "document",
    ) => {
      if (pngExportingRef.current) return;
      pngExportingRef.current = true;
      setPngExporting(true);
      try {
        const blob = await renderPngBlob({
          scope,
          settings,
          format,
        });
        triggerBlobDownload(blob, fallbackExportName(format, settings?.suffix));
        toast.success(t("designEditor.toasts.pngDownloaded"));
      } catch (error) {
        showRasterCaptureError(error);
      } finally {
        pngExportingRef.current = false;
        setPngExporting(false);
      }
    },
    [
      fallbackExportName,
      renderPngBlob,
      showRasterCaptureError,
      t,
      triggerBlobDownload,
    ],
  );

  const handleDownloadPdf = useCallback(
    async (settings?: Partial<ExportSettingsValue>) =>
      runDownloadPdf(
        {
          fallbackExportName,
          pngExportingRef,
          renderPngBlob,
          resolvePngCaptureTarget,
          setPngExporting,
          showRasterCaptureError,
          t,
          triggerBlobDownload,
        },
        settings,
      ),
    [
      fallbackExportName,
      renderPngBlob,
      resolvePngCaptureTarget,
      t,
      triggerBlobDownload,
    ],
  );

  const handleDownloadAllScreensPdf = useCallback(
    async () =>
      runDownloadAllScreensPdf({
        activeCanvasSourceType,
        canEditDesign,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
        fallbackExportName,
        overviewScreens,
        prepareScreenForExport: setExportPreviewScreenId,
        releaseScreenFromExport: () => setExportPreviewScreenId(null),
        pngExportingRef,
        setPngExporting,
        showRasterCaptureError,
        t,
        triggerBlobDownload,
      }),
    [
      activeCanvasSourceType,
      canEditDesign,
      exportCanvasFrameGeometryById,
      fallbackExportName,
      overviewScreens,
      setExportPreviewScreenId,
      showRasterCaptureError,
      t,
      triggerBlobDownload,
    ],
  );

  const handleCopyAsPng = useCallback(async () => {
    if (pngExportingRef.current) return;
    if (!canCopyPngToClipboard()) {
      toast.error(t("designEditor.toasts.pngClipboardUnsupported"));
      return;
    }

    pngExportingRef.current = true;
    setPngExporting(true);
    try {
      const pngBlob = renderPngBlob({ scope: "screens" });
      await copyPngPromiseToClipboard(pngBlob);
      toast.success(t("designEditor.toasts.pngCopied"));
    } catch (error) {
      if (error instanceof PngClipboardError) {
        const key =
          error.code === "blocked"
            ? "designEditor.toasts.pngClipboardBlocked"
            : error.code === "unsupported"
              ? "designEditor.toasts.pngClipboardUnsupported"
              : "designEditor.toasts.pngClipboardWriteError";
        toast.error(t(key));
      } else {
        showRasterCaptureError(error);
      }
    } finally {
      pngExportingRef.current = false;
      setPngExporting(false);
    }
  }, [renderPngBlob, showRasterCaptureError, t]);

  const resolveLiveFigmaSvgSource = useCallback(
    (targetFileId: string | undefined): LiveFigmaSvgSource | null => {
      const iframe =
        (targetFileId
          ? document.querySelector<HTMLIFrameElement>(
              `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(targetFileId)}"]`,
            )
          : null) ?? canvasIframeRef.current;
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        if (!doc?.documentElement) doc = null;
      } catch {
        doc = null;
      }
      if (!doc) return null;
      const screen = targetFileId
        ? overviewScreens.find((candidate) => candidate.id === targetFileId)
        : null;
      const geometry = targetFileId
        ? exportCanvasFrameGeometryById[targetFileId]
        : undefined;
      return {
        document: doc,
        title: design?.title ?? activeFile?.filename ?? null,
        width: selectedElementLayerId
          ? null
          : (geometry?.width ?? screen?.width ?? activeScreenBaseWidthPx),
        height: selectedElementLayerId
          ? null
          : (geometry?.height ?? screen?.height ?? null),
      };
    },
    [
      activeFile?.filename,
      activeScreenBaseWidthPx,
      exportCanvasFrameGeometryById,
      canvasIframeRef,
      design?.title,
      overviewScreens,
      selectedElementLayerId,
    ],
  );

  const resolveLiveFigmaSvgSnapshot = useCallback(
    (targetFileId: string | undefined): LiveFigmaSvgSnapshot | null => {
      if (!targetFileId) return null;
      const snapshot = runtimeLayerSnapshotsById[targetFileId];
      if (!snapshot?.html) return null;
      const screen = overviewScreens.find(
        (candidate) => candidate.id === targetFileId,
      );
      const geometry = exportCanvasFrameGeometryById[targetFileId];
      return {
        html: snapshot.html,
        title: design?.title ?? activeFile?.filename ?? null,
        width: selectedElementLayerId
          ? null
          : (geometry?.width ?? screen?.width ?? activeScreenBaseWidthPx),
        height: selectedElementLayerId
          ? null
          : (geometry?.height ?? screen?.height ?? null),
      };
    },
    [
      activeFile?.filename,
      activeScreenBaseWidthPx,
      exportCanvasFrameGeometryById,
      design?.title,
      overviewScreens,
      runtimeLayerSnapshotsById,
      selectedElementLayerId,
    ],
  );

  const handleCopyAsFigmaSvg = useCallback(
    async () =>
      runCopyAsFigmaSvg({
        activeFile,
        figmaSvgExportingRef,
        id,
        resolveLiveFigmaSvgSnapshot,
        resolveLiveFigmaSvgSource,
        selectedElementLayerId,
        selectedScreenIds,
        setFigmaSvgExporting,
        t,
      }),
    [
      activeFile?.id,
      id,
      resolveLiveFigmaSvgSource,
      resolveLiveFigmaSvgSnapshot,
      selectedElementLayerId,
      selectedScreenIds,
      t,
    ],
  );

  const handleDownloadFigmaSvg = useCallback(async () => {
    if (figmaSvgExportingRef.current) return;
    const targetFileId = activeFile?.id ?? selectedScreenIds[0] ?? undefined;
    if (!targetFileId) {
      toast.error(t("designEditor.toasts.openScreenSvg"));
      return;
    }
    figmaSvgExportingRef.current = true;
    setFigmaSvgExporting(true);
    try {
      const result = await exportDesignAsFigmaSvg(
        {
          designId: id,
          fileId: targetFileId,
          nodeId: selectedElementLayerId ?? undefined,
        },
        {
          liveSource: resolveLiveFigmaSvgSource(targetFileId),
          liveSnapshot: resolveLiveFigmaSvgSnapshot(targetFileId),
        },
      );
      triggerBlobDownload(
        new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
        result.filename || fallbackExportName("svg", "figma"),
      );
      toast.success(t("designEditor.toasts.figmaSvgDownloaded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.figmaSvgExportError"),
      );
    } finally {
      figmaSvgExportingRef.current = false;
      setFigmaSvgExporting(false);
    }
  }, [
    activeFile?.id,
    fallbackExportName,
    id,
    resolveLiveFigmaSvgSource,
    resolveLiveFigmaSvgSnapshot,
    selectedElementLayerId,
    selectedScreenIds,
    t,
    triggerBlobDownload,
  ]);

  const handleDownloadSvg = useCallback(
    async (settings?: Partial<ExportSettingsValue>) => {
      const exportScreenId =
        viewMode === "overview" && overviewSelectedScreenIds.length === 1
          ? (overviewSelectedScreenIds[0] ?? activeOverviewScreenId)
          : activeOverviewScreenId;
      const exportScreen = overviewScreens.find(
        (screen) => screen.id === exportScreenId,
      );
      const activePreviewFrameId =
        exportScreenId &&
        activeBreakpointWidthState !== undefined &&
        exportScreen?.breakpointWidths?.includes(activeBreakpointWidthState)
          ? getBreakpointIframeId(exportScreenId, activeBreakpointWidthState)
          : exportScreenId;
      return runDownloadSvg(
        {
          activePreviewFrameId,
          design,
          fallbackExportName,
          selectedElement,
          setSvgExporting,
          t,
          triggerBlobDownload,
        },
        settings,
      );
    },
    [
      activeBreakpointWidthState,
      activeOverviewScreenId,
      design?.title,
      fallbackExportName,
      overviewScreens,
      overviewSelectedScreenIds,
      selectedElement,
      t,
      triggerBlobDownload,
      viewMode,
    ],
  );

  const inspectorRasterScope: PngCaptureScope =
    pngSelectedElements.length > 0
      ? "element"
      : viewMode === "overview" && overviewSelectedScreenIds.length > 0
        ? "screens"
        : "document";

  const handleRenderExportPreview = useCallback(
    () =>
      renderPngBlob({ scope: inspectorRasterScope, settings: { scale: 1 } }),
    [inspectorRasterScope, renderPngBlob],
  );

  const handleInspectorExport = useCallback(
    async (settingsList: ExportSettingsValue[]) => {
      for (const settings of settingsList) {
        if (settings.format === "svg") {
          await handleDownloadSvg(settings);
        } else if (settings.format === "pdf") {
          await handleDownloadPdf(settings);
        } else if (settings.format === "jpg" || settings.format === "webp") {
          await handleDownloadPng(
            settings,
            settings.format,
            inspectorRasterScope,
          );
        } else {
          await handleDownloadPng(settings, "png", inspectorRasterScope);
        }
      }
    },
    [
      handleDownloadPdf,
      handleDownloadPng,
      handleDownloadSvg,
      inspectorRasterScope,
    ],
  );

  const shareExportOptions: Array<{
    value: ShareExportFormat;
    title: string;
    extension: string;
    description: string;
    Icon: typeof IconCode;
    disabled: boolean;
    onDownload: () => void;
  }> = [
    {
      value: "html",
      title: "Standalone HTML" /* i18n-ignore share export format */,
      extension: ".html",
      description:
        // i18n-ignore share export description
        "One self-contained file that works offline.",
      Icon: IconCode,
      disabled: !activeFile || exportHtmlMutation.isPending,
      onDownload: handleDownloadHtml,
    },
    {
      value: "png",
      title: "PNG image" /* i18n-ignore share export format */,
      extension: ".png",
      description:
        // i18n-ignore share export description
        "Snapshot of the current screen.",
      Icon: IconPhoto,
      disabled: !activeFile || pngExporting,
      onDownload: () => void handleDownloadPng(),
    },
    {
      value: "svg",
      title: "SVG image" /* i18n-ignore share export format */,
      extension: ".svg",
      description:
        // i18n-ignore share export description
        "Scalable snapshot of the current screen.",
      Icon: IconCode,
      disabled: !activeFile || svgExporting,
      onDownload: () => void handleDownloadSvg(),
    },
    {
      value: "zip",
      title: "Project archive" /* i18n-ignore share export format */,
      extension: ".zip",
      description:
        // i18n-ignore share export description
        "Every file in this design, zipped.",
      Icon: IconArchive,
      disabled: !activeFile || exportZipMutation.isPending,
      onDownload: handleDownloadZip,
    },
  ];
  const selectedShareExportOption =
    shareExportOptions.find((option) => option.value === shareExportFormat) ??
    shareExportOptions[0];
  const codingHandoffPreviewFallback = [
    "Copy this prompt into your agent to import this design:",
    editorShareUrl,
    "",
    `Implement: ${activeFile?.filename ?? design?.title ?? "current design"}`,
  ].join("\n");
  const codingHandoffPreviewText =
    getCodingHandoffClipboardText(codingHandoffResult) ||
    (codingHandoffError
      ? `Unable to create agent prompt: ${codingHandoffError}`
      : codingHandoffLoading
        ? "Preparing agent prompt..."
        : codingHandoffPreviewFallback);
  const shareExportTab = (
    <div className="space-y-3">
      <div className="!text-[11px] font-semibold uppercase text-muted-foreground">
        {"Format" /* i18n-ignore share export section label */}
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative flex min-h-[76px] items-start gap-2.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-2.5 text-left transition-colors hover:bg-[var(--design-editor-panel-raised-bg)]",
                selected
                  ? "bg-[var(--design-editor-panel-raised-bg)] ring-1 ring-[var(--design-editor-accent-color)]"
                  : "",
              )}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--design-editor-panel-raised-bg)] text-muted-foreground">
                <ExportIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {option.title}{" "}
                  <span className="!text-[11px] font-medium text-muted-foreground">
                    {option.extension}
                  </span>
                </span>
                <span className="mt-0.5 block !text-[11px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute right-2.5 top-2.5 inline-flex size-4 items-center justify-center rounded-full border",
                  selected
                    ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)]"
                    : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)]",
                )}
              >
                {selected ? <IconCheck className="size-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">
            {selectedShareExportOption.title}
          </div>
          <div className="!text-[11px] text-muted-foreground">
            {selectedShareExportOption.description}
          </div>
        </div>
        <Button
          type="button"
          onClick={selectedShareExportOption.onDownload}
          disabled={selectedShareExportOption.disabled}
          className="h-8 gap-1.5 rounded-md bg-[var(--design-editor-accent-color)] px-3 text-[12px] text-[var(--design-editor-accent-contrast-color)] shadow-none hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <IconDownload className="size-3.5" />
          {"Download" /* i18n-ignore share export action */}
        </Button>
      </div>
    </div>
  );
  const shareSendToTab = (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-8 items-center border-b border-neutral-800 px-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-500" />
            <span className="size-2.5 rounded-full bg-yellow-400" />
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-3.5 text-neutral-500" />
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void handleCopyCodingHandoff()}
          disabled={codingHandoffLoading}
          className="h-8 gap-1.5 rounded-md px-3 text-[12px]"
        >
          <IconClipboard className="size-3.5" />
          {"Copy agent prompt" /* i18n-ignore share send action */}
        </Button>
      </div>
    </div>
  );
  const designSharePopoverClassName =
    "z-[100010] !w-[min(620px,calc(100vw-32px))] !p-3 " +
    "[&_[role=tablist]]:!inline-flex [&_[role=tablist]]:!w-fit [&_[role=tablist]]:!max-w-full [&_[role=tablist]]:!self-start [&_[role=tablist]]:!overflow-x-auto [&_[role=tablist]]:justify-start [&_[role=tablist]]:gap-1 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border [&_[role=tablist]]:border-[var(--design-editor-panel-divider-color)] [&_[role=tablist]]:bg-[var(--design-editor-panel-raised-bg)] [&_[role=tablist]]:p-1 " +
    "[&_[role=tab]]:!h-8 [&_[role=tab]]:!flex-none [&_[role=tab]]:rounded-md [&_[role=tab]]:px-3 [&_[role=tab]]:!text-[12px] [&_[role=tab]]:font-semibold [&_[role=tab]]:shadow-none [&_[role=tab]]:ring-0 " +
    "[&_[role=tab]:hover]:text-foreground " +
    "[&_[role=tab][aria-selected=true]]:!bg-background dark:[&_[role=tab][aria-selected=true]]:!bg-[var(--design-editor-panel-bg)] [&_[role=tab][aria-selected=true]]:text-foreground";
  const designShareTabs = {
    shareLabel: "Share link" /* i18n-ignore share tab label */,
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: t("designEditor.export"),
        content: shareExportTab,
      },
      {
        value: "send",
        label: "Send to agent" /* i18n-ignore share tab label */,
        content: shareSendToTab,
      },
      ...(hasLocalhostScreens &&
      sessionResolved &&
      (!isSignedIn || canEditDesign)
        ? [
            {
              value: "live-collaboration",
              label: t("designEditor.liveCollaboration.title"),
              content: isSignedIn ? (
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {t("designEditor.liveCollaboration.title")}
                    </div>
                    {liveCollaborationSaving ? (
                      <p className="text-xs text-muted-foreground">
                        {t("designEditor.liveCollaboration.saving")}
                      </p>
                    ) : null}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch
                        checked={liveCollaborationEnabled}
                        disabled={liveCollaborationSaving}
                        aria-label={t("designEditor.liveCollaboration.title")}
                        onCheckedChange={(enabled) =>
                          void handleLiveCollaborationChange(enabled)
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("designEditor.liveCollaboration.description")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex justify-end py-1">
                  <Button asChild size="sm">
                    <a href={signInToShareHref}>
                      {t("designEditor.signUpToShareLiveCanvas")}
                    </a>
                  </Button>
                </div>
              ),
            },
          ]
        : []),
      ...(creativeContextEnabled
        ? [
            {
              value: "context",
              label: t("creativeContext.share.tabLabel", {
                defaultValue: "Context",
              }),
              content: (
                <CreativeContextShareTab
                  resource={{
                    appId: "design",
                    resourceType: "design",
                    resourceId: id ?? "",
                    title: design?.title ?? "Untitled design",
                    updatedAt: design?.updatedAt ?? undefined,
                    preview: { kind: "document", label: "Design project" }, // i18n-ignore share-tab preview descriptor, template pages are raw-English
                  }}
                />
              ),
            },
          ]
        : []),
    ],
  };

  useEffect(() => {
    if (viewMode === "overview" && !motionDockOpen) return;
    if (!activeFile || !activeContent.trim()) return;
    const stamped = normalizeScreenHtml(activeContent, {
      source: {
        kind: "design-file",
        designId: id,
        fileId: activeFile.id,
        filename: activeFile.filename,
      },
    });
    if (!stamped.changed || stamped.content === activeContent) return;
    applyLocalContentUpdate(stamped.content, { recordHistory: false });
  }, [
    activeContent,
    activeFile,
    applyLocalContentUpdate,
    id,
    motionDockOpen,
    viewMode,
  ]);
  const activeCodeLayerTree = useMemo(
    () => buildCodeLayerTree(activeCodeLayerProjection),
    [activeCodeLayerProjection],
  );
  const activeCodeLayerNodeById = useMemo(
    () =>
      new Map(activeCodeLayerProjection.nodes.map((node) => [node.id, node])),
    [activeCodeLayerProjection],
  );
  const overviewScreenById = useMemo(
    () => new Map(overviewScreens.map((screen) => [screen.id, screen])),
    [overviewScreens],
  );
  type CodeLayerFileModel = {
    fileId: string;
    projection: CodeLayerProjection;
    sourceProjection: CodeLayerProjection;
    sourceContent: string;
    sourceNodeIdAttrs: ReadonlySet<string>;
    runtimeOnly: boolean;
    structurePreviewKey: string;
    tree: CodeLayerTreeNode[];
    nodeById: Map<string, CodeLayerNode>;
  };
  const codeLayerModelCacheRef = useRef<Map<string, CodeLayerFileModel>>(
    new Map(),
  );
  const codeLayerModelsArrayRef = useRef<CodeLayerFileModel[]>([]);
  const [coveredLayerModelFileIds, setCoveredLayerModelFileIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const layerModelsCoverAll = files.every((file) =>
    coveredLayerModelFileIds.has(file.id),
  );
  const layerModelDemand = useMemo(
    () =>
      layerModelsCoverAll
        ? null
        : {
            searching: layersSearchQuery.trim() !== "",
            boardFileId,
            expandedIds: new Set(expandedLayerIds),
            lockedLayerIds,
            hiddenLayerIds,
            routeSelectionFileId:
              initialRouteSelectionId && initialRouteScreenTarget
                ? findDesignFileByScreenTarget(files, initialRouteScreenTarget)
                    ?.id
                : undefined,
            selectedLayerIds: [
              ...selectedLayerIdsState,
              createdOverviewLayerSelection?.layerId,
              initialRouteSelectionId,
            ],
            activeStoredContent: activeFile?.content ?? "",
          },
    [
      activeFile?.content,
      boardFileId,
      createdOverviewLayerSelection?.layerId,
      expandedLayerIds,
      files,
      hiddenLayerIds,
      initialRouteScreenTarget,
      initialRouteSelectionId,
      layerModelsCoverAll,
      layersSearchQuery,
      lockedLayerIds,
      selectedLayerIdsState,
    ],
  );
  const sourceLayerStateByFileIdRef = useRef(
    new Map<string, { content: string; present: boolean }>(),
  );
  const codeLayerModelsByFile = useMemo(() => {
    const cache = codeLayerModelCacheRef.current;
    const liveFileIds = new Set(files.map((file) => file.id));
    const demand = layerModelDemand;
    const sourceLayerStates = sourceLayerStateByFileIdRef.current;
    const hasSourceLayerState = (fileId: string) => {
      const content = getProjectionContentForScreen(fileId);
      const known = sourceLayerStates.get(fileId);
      if (known?.content === content) return known.present;
      const present =
        content.includes("data-agent-native-locked") ||
        content.includes("data-agent-native-hidden");
      sourceLayerStates.set(fileId, { content, present });
      return present;
    };
    const isNeeded = (fileId: string) =>
      !demand ||
      demand.searching ||
      cache.has(fileId) ||
      fileId === activeFile?.id ||
      fileId === demand.boardFileId ||
      fileId === demand.routeSelectionFileId ||
      demand.lockedLayerIds.has(fileId) ||
      demand.hiddenLayerIds.has(fileId) ||
      demand.expandedIds.has(fileId) ||
      Boolean(layerStructurePreviewByFileId[fileId]) ||
      Boolean(runtimeLayerSnapshotsById[fileId]) ||
      nonActiveProjectionCacheRef.current.has(fileId) ||
      hasSourceLayerState(fileId);
    const buildModel = (file: (typeof files)[number]): CodeLayerFileModel => {
      const sourceContent = getScreenContent(file.id);
      const cached = cache.get(file.id);
      const structurePreview = layerStructurePreviewByFileId[file.id];
      const structurePreviewKey = structurePreview
        ? `${structurePreview.sourceId}:${structurePreview.anchorId}:${structurePreview.placement}:${structurePreview.insert}`
        : "";
      const projectionContent = getProjectionContentForScreen(file.id);
      const sourceProjection =
        getCodeLayerProjectionForScreen(file.id) ??
        buildCodeLayerProjection(projectionContent, {
          source: codeLayerSourceForScreen(file.id),
        });
      const sourceNodeIdAttrs =
        cached?.sourceContent === sourceContent
          ? cached.sourceNodeIdAttrs
          : codeLayerSourceNodeIdAttrs(
              projectionContent === sourceContent
                ? sourceProjection
                : sourceContent,
            );
      const runtimeSnapshot = runtimeLayerSnapshotsById[file.id];
      const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
        screen: overviewScreenById.get(file.id),
        fallbackSourceType: designSourceType,
        content: file.content,
      });
      const runtimeProjection =
        runtimeSnapshot && runtimeProjectionEligible
          ? getRuntimeCodeLayerProjection(file.id, runtimeSnapshot.html)
          : null;
      const useRuntimeProjection = shouldPreferRuntimeLayerProjection({
        eligible: runtimeProjectionEligible,
        runtimeNodeCount: runtimeProjection?.nodes.length ?? 0,
        sourceNodeCount: sourceProjection.nodes.length,
      });
      const projection = useRuntimeProjection
        ? runtimeProjection!
        : sourceProjection;
      if (
        cached &&
        cached.projection === projection &&
        cached.sourceProjection === sourceProjection &&
        cached.sourceContent === sourceContent &&
        cached.runtimeOnly === useRuntimeProjection &&
        cached.structurePreviewKey === structurePreviewKey
      ) {
        return cached;
      }
      const baseTree = useRuntimeProjection
        ? buildCodeLayerTree(projection)
        : file.id === activeFile?.id
          ? activeCodeLayerTree
          : buildCodeLayerTree(projection);
      const tree = structurePreview
        ? (() => {
            const sourceNode = resolveCodeLayerNodeFromBridge(
              projection,
              undefined,
              structurePreview.sourceId,
            );
            const anchorNode = resolveCodeLayerNodeFromBridge(
              projection,
              undefined,
              structurePreview.anchorId,
            );
            return sourceNode && anchorNode
              ? (previewCodeLayerTreeMove(baseTree, {
                  ...structurePreview,
                  sourceId: sourceNode.id,
                  anchorId: anchorNode.id,
                }) ?? baseTree)
              : baseTree;
          })()
        : baseTree;
      const model: CodeLayerFileModel = {
        fileId: file.id,
        projection,
        sourceProjection,
        sourceContent,
        sourceNodeIdAttrs,
        runtimeOnly: useRuntimeProjection,
        structurePreviewKey,
        tree,
        nodeById: new Map(projection.nodes.map((node) => [node.id, node])),
      };
      cache.set(file.id, model);
      return model;
    };
    const models = buildNeededLayerModels({
      files,
      isNeeded,
      contentLength: (fileId) => getProjectionContentForScreen(fileId).length,
      buildModel,
      namesUnbuiltLayer: (built) => {
        let activeStoredNodeIds: Set<string> | undefined;
        const ownedByActiveFile = (layerId: string) => {
          const activeId = activeFile?.id;
          if (!activeId) return false;
          activeStoredNodeIds ??= new Set(
            buildCodeLayerProjection(demand?.activeStoredContent ?? "", {
              source: codeLayerSourceForScreen(activeId),
            }).nodes.map((node) => node.id),
          );
          return activeStoredNodeIds.has(layerId);
        };
        return [
          ...(demand?.selectedLayerIds ?? []),
          pendingOverviewLayerSelectionRef.current,
        ].some(
          (layerId) =>
            layerId &&
            !liveFileIds.has(layerId) &&
            !built.some((model) => model.nodeById.has(layerId)) &&
            !ownedByActiveFile(layerId),
        );
      },
    });
    for (const fileId of cache.keys()) {
      if (!liveFileIds.has(fileId)) cache.delete(fileId);
    }
    for (const fileId of sourceLayerStates.keys()) {
      if (!liveFileIds.has(fileId)) sourceLayerStates.delete(fileId);
    }
    for (const fileId of runtimeProjectionCacheRef.current.keys()) {
      if (!liveFileIds.has(fileId)) {
        runtimeProjectionCacheRef.current.delete(fileId);
      }
    }
    for (const fileId of nonActiveProjectionCacheRef.current.keys()) {
      if (!liveFileIds.has(fileId)) {
        nonActiveProjectionCacheRef.current.delete(fileId);
      }
    }
    const previousModels = codeLayerModelsArrayRef.current;
    if (
      previousModels.length === models.length &&
      models.every((model, index) => model === previousModels[index])
    ) {
      return previousModels;
    }
    codeLayerModelsArrayRef.current = models;
    return models;
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerSourceForScreen,
    designSourceType,
    files,
    getCodeLayerProjectionForScreen,
    getProjectionContentForScreen,
    getRuntimeCodeLayerProjection,
    getScreenContent,
    layerModelDemand,
    overviewScreenById,
    runtimeLayerSnapshotsById,
    layerStructurePreviewByFileId,
  ]);
  const getCodeLayerProjectionForScreenRef = useRef(
    getCodeLayerProjectionForScreen,
  );
  getCodeLayerProjectionForScreenRef.current = getCodeLayerProjectionForScreen;
  useEffect(() => {
    if (layerModelsCoverAll) return;
    const projected: string[] = [];
    let next = 0;
    return runInIdleSlices((deadline) => {
      const pending = historyFilesRef.current;
      do {
        const file = pending[next];
        if (!file) {
          setCoveredLayerModelFileIds(
            (covered) => new Set([...covered, ...projected]),
          );
          return true;
        }
        next += 1;
        if (coveredLayerModelFileIds.has(file.id)) continue;
        getCodeLayerProjectionForScreenRef.current(file.id);
        projected.push(file.id);
      } while (performance.now() < deadline);
      return false;
    });
  }, [coveredLayerModelFileIds, layerModelsCoverAll]);
  const codeLayerModelByFileId = useMemo(
    () => new Map(codeLayerModelsByFile.map((model) => [model.fileId, model])),
    [codeLayerModelsByFile],
  );
  const codeLayerOwnerByNodeId = useMemo(() => {
    const owners = new Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        sourceProjection: CodeLayerProjection;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >();
    codeLayerModelsByFile.forEach((model) => {
      model.projection.nodes.forEach((node) => {
        owners.set(node.id, {
          fileId: model.fileId,
          node,
          sourceProjection: model.sourceProjection,
          tree: model.tree,
          runtimeOnly: isCodeLayerNodeRuntimeOnly({
            fileIsRuntimeProjected: model.runtimeOnly,
            nodeIdAttr: node.dataAttributes["data-agent-native-node-id"],
            sourceNodeIdAttrs: model.sourceNodeIdAttrs,
          }),
        });
      });
    });
    return owners;
  }, [codeLayerModelsByFile]);
  const resolvedInitialRouteSelectionId = useMemo(() => {
    if (!initialRouteSelectionId) return null;
    const targetFile = initialRouteScreenTarget
      ? findDesignFileByScreenTarget(files, initialRouteScreenTarget)
      : null;
    if (initialRouteScreenTarget && !targetFile) return null;
    const directOwner = codeLayerOwnerByNodeId.get(initialRouteSelectionId);
    if (directOwner && (!targetFile || directOwner.fileId === targetFile.id)) {
      return initialRouteSelectionId;
    }
    if (!targetFile) return null;
    const model = codeLayerModelByFileId.get(targetFile.id);
    if (!model) return null;

    const runtimeHtml = runtimeLayerSnapshotsById[targetFile.id]?.html;
    const legacyProjections = [
      buildCodeLayerProjection(getProjectionContentForScreen(targetFile.id)),
      ...(runtimeHtml ? [buildCodeLayerProjection(runtimeHtml)] : []),
    ];
    const mappedIds = new Set<string>();
    for (const legacyProjection of legacyProjections) {
      const mappedId = remapLegacyCodeLayerNodeId(
        legacyProjection,
        model.projection,
        initialRouteSelectionId,
      );
      if (mappedId) mappedIds.add(mappedId);
    }
    const sourceProjectionId = model.sourceProjection.nodes.find(
      (node) => node.id === initialRouteSelectionId,
    );
    if (sourceProjectionId) {
      const mappedId = remapLegacyCodeLayerNodeId(
        model.sourceProjection,
        model.projection,
        initialRouteSelectionId,
      );
      if (mappedId) mappedIds.add(mappedId);
    }
    return mappedIds.size === 1 ? [...mappedIds][0]! : null;
  }, [
    codeLayerModelByFileId,
    codeLayerOwnerByNodeId,
    files,
    getProjectionContentForScreen,
    initialRouteScreenTarget,
    initialRouteSelectionId,
    runtimeLayerSnapshotsById,
  ]);
  codeLayerOwnerByNodeIdRef.current = codeLayerOwnerByNodeId;
  commitCapturedStyleTargetsRef.current = (
    styles,
    capturedTargets,
    interactionState,
  ) => {
    const scope = capturedTargets[0];
    const failClosed = () => {
      toast.error(t("designEditor.patchProof.selectorMissing"));
    };
    if (!scope || capturedTargets.length === 0) {
      failClosed();
      return;
    }

    const ownerByNodeId = codeLayerOwnerByNodeIdRef.current;
    const resolvedTargets: SelectedLayerTarget[] = [];
    for (const captured of capturedTargets) {
      const identity = captured.elementInfo.sourceLayerIdentity;
      if (
        !captured.fileId ||
        !captured.layerId ||
        identity?.screenId !== captured.fileId ||
        identity.nodeId !== captured.layerId ||
        captured.upperBoundPx !== scope.upperBoundPx ||
        captured.lowerBoundPx !== scope.lowerBoundPx
      ) {
        failClosed();
        return;
      }

      let owner = ownerByNodeId.get(captured.layerId);
      if (owner?.fileId !== captured.fileId) owner = undefined;
      if (!owner) {
        const fileNodes = [...ownerByNodeId.values()]
          .filter((candidate) => candidate.fileId === captured.fileId)
          .map((candidate) => candidate.node);
        const resolvedNode = resolveCodeLayerNodeFromElementInfo(
          {
            nodes: fileNodes,
            source: { fileId: captured.fileId },
          },
          captured.elementInfo,
        );
        owner = resolvedNode ? ownerByNodeId.get(resolvedNode.id) : undefined;
        if (owner?.fileId !== captured.fileId) owner = undefined;
      }
      if (!owner) {
        failClosed();
        return;
      }
      resolvedTargets.push({
        layerId: owner.node.id,
        fileId: owner.fileId,
        node: owner.node,
        tree: owner.tree,
        elementInfo: elementInfoForOwnedCodeLayerNode({
          info: captured.elementInfo,
          node: owner.node,
          ownerFileId: owner.fileId,
        }),
      });
    }

    const applied = commitStylesToSelectedLayersRef.current(
      styles,
      resolvedTargets,
      {
        capturedTargetIds: resolvedTargets.map((target) => target.layerId),
        interactionState,
        scope: {
          upperBoundPx: scope.upperBoundPx,
          lowerBoundPx: scope.lowerBoundPx,
        },
      },
    );
    if (!applied) failClosed();
  };
  const effectiveCodeLayerState = useMemo(() => {
    const state: EffectiveCodeLayerState = {
      lockedIds: new Set(),
      hiddenIds: new Set(),
    };
    codeLayerModelsByFile.forEach((model) => {
      const fileLocked = lockedLayerIds.has(model.fileId);
      const fileHidden = hiddenLayerIds.has(model.fileId);
      const fileLockedLayerIds = layerStateIdsForScreen(
        lockedLayerIds,
        model.fileId,
      );
      const fileHiddenLayerIds = layerStateIdsForScreen(
        hiddenLayerIds,
        model.fileId,
      );
      if (fileLocked) state.lockedIds.add(model.fileId);
      if (fileHidden) state.hiddenIds.add(model.fileId);
      collectEffectiveCodeLayerState(
        model.tree,
        fileLockedLayerIds,
        fileHiddenLayerIds,
        fileLocked,
        fileHidden,
        state,
      );
    });
    return state;
  }, [codeLayerModelsByFile, hiddenLayerIds, lockedLayerIds]);
  effectiveCodeLayerStateRef.current = effectiveCodeLayerState;
  useEffect(() => {
    shouldPreserveBlockedOverviewLayerSelectionRef.current = (
      screenId: string,
    ) => {
      if (viewModeRef.current !== "overview") return false;
      return selectedLayerIdsState.some((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        if (!owner || owner.fileId !== screenId) return false;
        return (
          effectiveCodeLayerState.lockedIds.has(screenId) ||
          effectiveCodeLayerState.hiddenIds.has(screenId) ||
          effectiveCodeLayerState.lockedIds.has(layerId) ||
          effectiveCodeLayerState.hiddenIds.has(layerId)
        );
      });
    };
  }, [codeLayerOwnerByNodeId, effectiveCodeLayerState, selectedLayerIdsState]);
  useEffect(() => {
    const fileIds = new Set(files.map((file) => file.id));
    const lockedFromSource = new Set(
      codeLayerModelsByFile.flatMap((model) =>
        model.projection.nodes
          .filter(
            (node) =>
              node.dataAttributes["data-agent-native-locked"] === "true",
          )
          .map((node) => scopedLayerStateId(model.fileId, node.id)),
      ),
    );
    const hiddenFromSource = new Set(
      codeLayerModelsByFile.flatMap((model) =>
        model.projection.nodes
          .filter(
            (node) =>
              node.dataAttributes["data-agent-native-hidden"] === "true",
          )
          .map((node) => scopedLayerStateId(model.fileId, node.id)),
      ),
    );
    const allLayerIds = new Set([
      ...fileIds,
      ...codeLayerModelsByFile.flatMap((model) =>
        model.projection.nodes.map((node) =>
          scopedLayerStateId(model.fileId, node.id),
        ),
      ),
    ]);
    const reconcile = (
      current: Set<string>,
      sourceIds: Set<string>,
      kind: "hidden" | "locked",
    ): Set<string> => {
      const next = new Set(sourceIds);
      current.forEach((id) => {
        if (fileIds.has(id)) next.add(id);
      });
      layerStateOverridesRef.current.forEach((override, id) => {
        if (!allLayerIds.has(id)) {
          layerStateOverridesRef.current.delete(id);
          return;
        }
        const value = override[kind];
        if (value === undefined) return;
        if (!fileIds.has(id) && sourceIds.has(id) === value) {
          const remaining = { ...override };
          delete remaining[kind];
          if (
            remaining.hidden === undefined &&
            remaining.locked === undefined
          ) {
            layerStateOverridesRef.current.delete(id);
          } else {
            layerStateOverridesRef.current.set(id, remaining);
          }
          return;
        }
        if (value) next.add(id);
        else next.delete(id);
      });
      if (
        next.size === current.size &&
        Array.from(next).every((id) => current.has(id))
      ) {
        return current;
      }
      return next;
    };

    setLockedLayerIds((current) =>
      reconcile(current, lockedFromSource, "locked"),
    );
    setHiddenLayerIds((current) =>
      reconcile(current, hiddenFromSource, "hidden"),
    );
  }, [codeLayerModelsByFile, files]);
  const lockedLayerSelectors = useMemo(() => {
    const activeLayerIds = activeFile?.id
      ? layerStateIdsForScreen(lockedLayerIds, activeFile.id)
      : new Set<string>();
    const selectors = Array.from(activeLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && lockedLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, lockedLayerIds]);
  const hiddenLayerSelectors = useMemo(() => {
    const activeLayerIds = activeFile?.id
      ? layerStateIdsForScreen(hiddenLayerIds, activeFile.id)
      : new Set<string>();
    const selectors = Array.from(activeLayerIds)
      .flatMap((layerId) =>
        codeLayerSelectorAliases(activeCodeLayerNodeById.get(layerId)),
      )
      .filter(Boolean);
    if (activeFile?.id && hiddenLayerIds.has(activeFile.id)) {
      selectors.push("body");
    }
    return Array.from(new Set(selectors));
  }, [activeCodeLayerNodeById, activeFile?.id, hiddenLayerIds]);
  const layerSelectorsCacheRef = useRef(
    new WeakMap<
      Set<string>,
      Map<string, { modelRef: unknown; value: string[] }>
    >(),
  );
  const getLayerSelectorsForFile = useCallback(
    (fileId: string, layerIds: Set<string>) => {
      const model = codeLayerModelByFileId.get(fileId);
      let cache = layerSelectorsCacheRef.current.get(layerIds);
      if (!cache) {
        cache = new Map();
        layerSelectorsCacheRef.current.set(layerIds, cache);
      }
      const cached = cache.get(fileId);
      if (cached && cached.modelRef === model) return cached.value;
      const fileLayerIds = layerStateIdsForScreen(layerIds, fileId);
      const selectors = Array.from(fileLayerIds)
        .flatMap((layerId) =>
          codeLayerSelectorAliases(model?.nodeById.get(layerId)),
        )
        .filter(Boolean);
      if (fileLayerIds.has(fileId)) selectors.push("body");
      const value =
        selectors.length > 0 ? Array.from(new Set(selectors)) : NO_SELECTORS;
      cache.set(fileId, { modelRef: model, value });
      return value;
    },
    [codeLayerModelByFileId],
  );
  const visualScreenFileIds = useMemo(
    () => new Set(overviewScreens.map((screen) => screen.id)),
    [overviewScreens],
  );
  const canonicalOverviewScreenIds = useMemo(
    () => getCanonicalScreenStack(overviewScreens, canvasFrameGeometryById),
    [canvasFrameGeometryById, overviewScreens],
  );
  const canonicalVisualFiles = useMemo(() => {
    const visualFileById = new Map(
      files
        .filter((file) => visualScreenFileIds.has(file.id))
        .map((file) => [file.id, file] as const),
    );
    return canonicalOverviewScreenIds
      .map((screenId) => visualFileById.get(screenId))
      .filter((file): file is (typeof files)[number] => Boolean(file));
  }, [canonicalOverviewScreenIds, files, visualScreenFileIds]);
  const layerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      canonicalVisualFiles.map((file) => ({
        id: file.id,
        name: prettyScreenName(file.filename),
        filename: file.filename,
        fileType: file.fileType,
        detail: file.filename,
        locked: lockedLayerIds.has(file.id),
        hidden: hiddenLayerIds.has(file.id),
        lockable: true,
        hideable: true,
        renamable: true,
      })),
    [canonicalVisualFiles, hiddenLayerIds, lockedLayerIds],
  );
  const overviewLayerPanelFiles = useMemo<LayersPanelFile[]>(
    () =>
      canonicalVisualFiles.map((file) => {
        const model = codeLayerModelByFileId.get(file.id);
        return {
          id: file.id,
          name: prettyScreenName(file.filename),
          filename: file.filename,
          fileType: file.fileType,
          detail: file.filename,
          locked: lockedLayerIds.has(file.id),
          hidden: hiddenLayerIds.has(file.id),
          lockable: true,
          hideable: true,
          renamable: true,
          layers: codeLayerTreeToPanelNodes(
            model?.tree ?? [],
            layerStateIdsForScreen(lockedLayerIds, file.id),
            layerStateIdsForScreen(hiddenLayerIds, file.id),
          ),
        };
      }),
    [
      canonicalVisualFiles,
      codeLayerModelByFileId,
      hiddenLayerIds,
      lockedLayerIds,
    ],
  );

  const boardElements = useMemo<LayersPanelNode[] | undefined>(() => {
    if (!boardFileId) return undefined;
    const model = codeLayerModelByFileId.get(boardFileId);
    if (!model?.tree?.length) return undefined;
    const nodes = codeLayerTreeToPanelNodes(
      model.tree,
      layerStateIdsForScreen(lockedLayerIds, boardFileId),
      layerStateIdsForScreen(hiddenLayerIds, boardFileId),
    );
    return nodes.length > 0 ? nodes : undefined;
  }, [boardFileId, codeLayerModelByFileId, lockedLayerIds, hiddenLayerIds]);

  const designIsEmpty = useMemo(
    () => overviewScreens.length === 0 && (boardElements?.length ?? 0) === 0,
    [boardElements, overviewScreens.length],
  );

  const firstRunTemplatesQuery = useActionQuery(
    "list-design-templates",
    { includePreview: "true" },
    { enabled: canEditDesign && designIsEmpty },
  );
  const firstRunTemplates = useMemo(
    () =>
      (firstRunTemplatesQuery.data?.templates ?? []).map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        category: template.category,
        width: template.width,
        height: template.height,
        previewHtml: template.previewHtml,
        designSystemId: template.designSystemId,
        isBuiltIn: template.isBuiltIn,
      })),
    [firstRunTemplatesQuery.data?.templates],
  );
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(
    null,
  );
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const showFirstRunStart = designIsEmpty && chatMessageCount === 0;
  const applyTemplate = useActionMutation("create-design-from-template");
  const handleFirstRunTemplate = useCallback(
    async (templateId: string) => {
      if (!id || applyingTemplateId) return;
      setApplyingTemplateId(templateId);
      try {
        await applyTemplate.mutateAsync({
          templateId,
          targetDesignId: id,
          ...(selectedPromptDesignSystemId
            ? { designSystemId: selectedPromptDesignSystemId }
            : {}),
        });
        await queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setApplyingTemplateId(null);
      }
    },
    [
      applyTemplate,
      applyingTemplateId,
      id,
      queryClient,
      selectedPromptDesignSystemId,
    ],
  );

  const designAgentSuggestions = useMemo(
    () => [
      t("chat.suggestionLandingPage"),
      t("chat.suggestionBrandMatch"),
      t("chat.suggestionMobile"),
    ],
    [t],
  );
  const designAgentSuggestionConfig = useMemo(
    () => ({
      getSuggestions: (context: AgentDynamicSuggestionContext) =>
        designIsEmpty
          ? designAgentSuggestions
          : buildDynamicAgentSuggestions(context),
    }),
    [designAgentSuggestions, designIsEmpty],
  );

  const activeLayerPanelNodes = useMemo<LayersPanelNode[]>(() => {
    const activeTree = activeFile?.id
      ? (codeLayerModelByFileId.get(activeFile.id)?.tree ?? activeCodeLayerTree)
      : activeCodeLayerTree;
    return codeLayerTreeToPanelNodes(
      activeTree,
      activeFile?.id
        ? layerStateIdsForScreen(lockedLayerIds, activeFile.id)
        : new Set(),
      activeFile?.id
        ? layerStateIdsForScreen(hiddenLayerIds, activeFile.id)
        : new Set(),
    );
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerModelByFileId,
    hiddenLayerIds,
    lockedLayerIds,
  ]);

  const singleBlankScreenLayerPanelFiles = useMemo<
    LayersPanelFile[] | undefined
  >(() => {
    if (viewMode === "overview" || activeLayerPanelNodes.length > 0) {
      return undefined;
    }
    const active = layerPanelFiles.find((file) => file.id === activeFile?.id);
    return active ? [{ ...active, layers: [] }] : undefined;
  }, [activeFile?.id, activeLayerPanelNodes.length, layerPanelFiles, viewMode]);

  const selectedLayerIds = useMemo(() => {
    const validIds = new Set(
      (viewMode === "overview"
        ? codeLayerModelsByFile.flatMap((model) => model.projection.nodes)
        : activeFile?.id
          ? (codeLayerModelByFileId.get(activeFile.id)?.projection.nodes ??
            activeCodeLayerProjection.nodes)
          : activeCodeLayerProjection.nodes
      ).map((node) => node.id),
    );
    const fileIds = new Set(files.map((file) => file.id));
    const pendingOverviewScreenId = pendingOverviewScreenSelectionRef.current;
    const pendingOverviewLayerId = pendingOverviewLayerSelectionRef.current;
    if (pendingOverviewScreenId) {
      validIds.add(pendingOverviewScreenId);
      fileIds.add(pendingOverviewScreenId);
    }
    if (pendingOverviewLayerId) {
      validIds.add(pendingOverviewLayerId);
    }
    if (createdOverviewLayerSelection) {
      validIds.add(createdOverviewLayerSelection.layerId);
    }
    if (selectedElementLayerId) validIds.add(selectedElementLayerId);
    files.forEach((file) => validIds.add(file.id));
    const selectedStateIds = selectedLayerIdsState.filter((layerId) =>
      validIds.has(layerId),
    );
    const hasOverviewCodeLayerSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => !fileIds.has(layerId));
    const hasOverviewFileSelection =
      viewMode === "overview" &&
      selectedStateIds.some((layerId) => fileIds.has(layerId));
    const baseSelection =
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : viewMode === "overview" && !hasOverviewCodeLayerSelection
          ? overviewSelectedScreenIds.length > 0 || !hasOverviewFileSelection
            ? overviewSelectedScreenIds
            : selectedLayerIdsState
          : selectedLayerIdsState;
    const filtered = baseSelection.filter((layerId) => validIds.has(layerId));
    return resolveEffectiveSelectedLayerIds(filtered, selectedElementLayerId);
  }, [
    activeCodeLayerProjection.nodes,
    activeFile?.id,
    codeLayerModelByFileId,
    codeLayerModelsByFile,
    createdOverviewLayerSelection,
    files,
    overviewSelectedScreenIds,
    selectedElementLayerId,
    selectedLayerIdsState,
    viewMode,
  ]);
  const getSingleSelectedRenamableLayerId = useCallback((): string | null => {
    return selectedLayerIds.length === 1 ? selectedLayerIds[0]! : null;
  }, [selectedLayerIds]);
  const selectedLiveLayerIds = useMemo(
    () =>
      selectedLayerIds.filter((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        return Boolean(owner && canEditLiveScreen(owner.fileId));
      }),
    [canEditLiveScreen, codeLayerOwnerByNodeId, selectedLayerIds],
  );
  const canEditSelectedLiveLayer = selectedLiveLayerIds.length > 0;
  const canEditSingleSelectedLiveLayer =
    selectedLiveLayerIds.length === 1 && selectedLayerIds.length === 1;
  canEditSelectedLiveLayerRef.current = canEditSelectedLiveLayer;

  const selectedUrlSelectionId = useMemo(
    () =>
      selectedElementLayerId ??
      [...selectedLayerIds]
        .reverse()
        .find((layerId) => codeLayerOwnerByNodeId.has(layerId)) ??
      null,
    [codeLayerOwnerByNodeId, selectedElementLayerId, selectedLayerIds],
  );

  const handleShaderEditCode = useCallback(
    (_shaderId: string) => {
      const targetFileId = activeFile?.id ?? activeFileId;
      if (!targetFileId) return;
      setActiveLeftPanel("code");
      const nextSearch = getDesignEditorStateUrlSearch({
        currentSearch: location.search,
        viewMode,
        screenId: activeFile?.id ?? activeFileId ?? undefined,
        leftPanel: "code",
        codeFileId: targetFileId,
        selectionId: selectedUrlSelectionId,
        zoom,
        tool: activeTool,
        mode,
      });
      if (nextSearch === location.search) return;
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [
      activeFile?.id,
      activeFileId,
      activeTool,
      location.hash,
      location.pathname,
      location.search,
      navigate,
      selectedUrlSelectionId,
      mode,
      viewMode,
      zoom,
    ],
  );
  const selectedLayerIdsRef = useRef<string[]>(selectedLayerIds);

  useLayoutEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

  useEffect(() => {
    if (!id) return;
    if (initialUrlSelectionHydratedForIdRef.current === id) return;
    if (!initialRouteSelectionId) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    if (!resolvedInitialRouteSelectionId) return;
    if (
      selectedUrlSelectionId &&
      selectedUrlSelectionId !== resolvedInitialRouteSelectionId
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(resolvedInitialRouteSelectionId);
    if (!owner) return;
    if (viewModeRef.current === "single") {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const selectionBlocked =
      effectiveCodeLayerState.lockedIds.has(owner.fileId) ||
      effectiveCodeLayerState.hiddenIds.has(owner.fileId) ||
      effectiveCodeLayerState.lockedIds.has(resolvedInitialRouteSelectionId) ||
      effectiveCodeLayerState.hiddenIds.has(resolvedInitialRouteSelectionId);
    if (
      activeFileId === owner.fileId &&
      selectedLayerIds.includes(resolvedInitialRouteSelectionId) &&
      (selectionBlocked ||
        selectedElementLayerId === resolvedInitialRouteSelectionId)
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }

    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setActiveFileId(owner.fileId);
    setSelectedLayerIdsState([resolvedInitialRouteSelectionId]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    setSelectedElement(
      selectionBlocked ? null : elementInfoFromCodeLayerNode(owner.node),
    );
    setHoveredElement(null);
    setHoveredElementScreenId(null);
    setActiveTool("move");
    setMode("edit");
    if (!selectionBlocked) {
      focusDesignInspectorForSelection();
    }
    initialUrlSelectionHydratedForIdRef.current = id;
  }, [
    activeFileId,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    focusDesignInspectorForSelection,
    id,
    initialRouteSelectionId,
    selectedElementLayerId,
    selectedLayerIds,
    selectedUrlSelectionId,
    resolvedInitialRouteSelectionId,
  ]);

  useEffect(() => {
    if (!id || files.length === 0) return;
    const guardedInitialRouteScreenTarget = initialRouteScreenGuardRef.current;
    const currentScreenId = activeFileId ?? activeFile?.id;
    const initialRouteScreen = guardedInitialRouteScreenTarget
      ? findDesignFileByScreenTarget(files, guardedInitialRouteScreenTarget)
      : undefined;
    if (
      guardedInitialRouteScreenTarget &&
      !initialRouteScreen &&
      !activeFileId
    ) {
      return;
    }
    if (initialRouteScreen && currentScreenId !== initialRouteScreen.id) {
      return;
    }
    if (initialRouteScreen && currentScreenId === initialRouteScreen.id) {
      initialRouteScreenGuardRef.current = null;
    }
    const preserveInitialRouteSelection = Boolean(
      (resolvedInitialRouteSelectionId || initialRouteSelectionId) &&
      initialUrlSelectionHydratedForIdRef.current !== id &&
      resolvedInitialRouteSelectionId !== selectedUrlSelectionId &&
      codeLayerOwnerByNodeId.size === 0,
    );
    const nextSearch = getDesignEditorStateUrlSearch({
      currentSearch: location.search,
      viewMode,
      screenId: activeFileId ?? activeFile?.id,
      leftPanel: activeLeftPanel,
      codeFileId: activeLeftPanel === "code" ? activeCodeFile?.fileId : null,
      codeFilename: activeLeftPanel === "code" ? activeCodeFile?.path : null,
      selectionId:
        selectedUrlSelectionId ??
        (preserveInitialRouteSelection
          ? (resolvedInitialRouteSelectionId ?? initialRouteSelectionId)
          : null),
      zoom,
      tool: activeTool,
      mode,
    });
    const nextScreenId = activeFileId ?? activeFile?.id ?? null;
    const screenChanged =
      urlSyncScreenIdRef.current !== null &&
      nextScreenId !== urlSyncScreenIdRef.current;
    urlSyncScreenIdRef.current = nextScreenId;
    if (nextSearch === location.search) return;
    if (urlSyncTimerRef.current !== null) {
      window.clearTimeout(urlSyncTimerRef.current);
      urlSyncTimerRef.current = null;
    }
    if (screenChanged) {
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
      return;
    }
    urlSyncTimerRef.current = window.setTimeout(() => {
      urlSyncTimerRef.current = null;
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
          hash: location.hash,
        },
        { replace: true, preventScrollReset: true },
      );
    }, 150);
    return () => {
      if (urlSyncTimerRef.current !== null) {
        window.clearTimeout(urlSyncTimerRef.current);
        urlSyncTimerRef.current = null;
      }
    };
  }, [
    activeFile?.id,
    activeFileId,
    activeCodeFile?.fileId,
    activeCodeFile?.path,
    activeLeftPanel,
    activeTool,
    codeLayerOwnerByNodeId.size,
    files,
    id,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    initialRouteSelectionId,
    resolvedInitialRouteSelectionId,
    selectedUrlSelectionId,
    mode,
    viewMode,
    zoom,
  ]);

  const selectedElementScreenId = useMemo(() => {
    const ownerFileIds = selectedLayerIds
      .map((layerId) => codeLayerOwnerByNodeId.get(layerId)?.fileId)
      .filter((fileId): fileId is string => Boolean(fileId));
    const first = ownerFileIds[0];
    return first && ownerFileIds.every((fileId) => fileId === first)
      ? first
      : null;
  }, [codeLayerOwnerByNodeId, selectedLayerIds]);

  const selectedLayerTargets = useMemo<SelectedLayerTarget[]>(
    () =>
      selectedLayerIds
        .map((layerId) => {
          const owner = codeLayerOwnerByNodeId.get(layerId);
          if (!owner) return null;
          return {
            layerId,
            fileId: owner.fileId,
            node: owner.node,
            tree: owner.tree,
            elementInfo: elementInfoForOwnedCodeLayerNode({
              info: selectedElement,
              node: owner.node,
              ownerFileId: owner.fileId,
            }),
          };
        })
        .filter((target): target is SelectedLayerTarget => Boolean(target)),
    [
      codeLayerOwnerByNodeId,
      selectedElement,
      selectedElementScreenId,
      selectedLayerIds,
    ],
  );

  useLayoutEffect(() => {
    selectedLayerTargetsRef.current = selectedLayerTargets;
  }, [selectedLayerTargets]);

  const selectedBoardCanvasSelectorCandidates = useMemo(() => {
    const boardTarget = [...selectedLayerTargets]
      .reverse()
      .find((target) => target.fileId === boardFileId);
    return boardTarget
      ? codeLayerSelectorAliases(boardTarget.node)
      : activeFileId === boardFileId
        ? selectedCanvasSelectorCandidates
        : [];
  }, [
    activeFileId,
    boardFileId,
    selectedCanvasSelectorCandidates,
    selectedLayerTargets,
  ]);
  const selectedBoardCanvasSourceId = useMemo(() => {
    const boardTarget = [...selectedLayerTargets]
      .reverse()
      .find((target) => target.fileId === boardFileId);
    return boardTarget
      ? bridgeSourceIdForCodeLayerNode(boardTarget.node)
      : activeFileId === boardFileId
        ? (selectedElement?.runtimeSourceId ??
          selectedElement?.sourceId ??
          null)
        : null;
  }, [
    activeFileId,
    boardFileId,
    selectedElement?.runtimeSourceId,
    selectedElement?.sourceId,
    selectedLayerTargets,
  ]);

  const selectedLayerSelectorGroupsByScreen = useMemo(() => {
    const groupsByScreen: Record<string, string[][]> = {};
    selectedLayerTargets.forEach((target) => {
      const selectorGroup = codeLayerSelectorAliases(target.node);
      if (selectorGroup.length === 0) return;
      groupsByScreen[target.fileId] = [
        ...(groupsByScreen[target.fileId] ?? []),
        selectorGroup,
      ];
    });
    return groupsByScreen;
  }, [selectedLayerTargets]);

  const selectedInspectorElements = useMemo(
    () =>
      selectedLayerTargets.length > 0
        ? selectedLayerTargets.map((target) =>
            withMeasuredGeometry(target.elementInfo, target.fileId),
          )
        : selectedElement
          ? [withMeasuredGeometry(selectedElement, activeFile?.id)]
          : [],
    [selectedElement, selectedLayerTargets],
  );
  const selectedScreenGeometry = useMemo<ScreenGeometrySelection | null>(() => {
    return getSelectedScreenGeometryForInspector({
      selectedInspectorElementCount: selectedInspectorElements.length,
      selectedScreenIds:
        viewMode === "overview" ? overviewSelectedScreenIds : [],
      overviewScreens,
      canvasFrameGeometryById,
      naturalHeightsById: screenContentNaturalHeights,
      screenRootComputedStylesById,
    });
  }, [
    canvasFrameGeometryById,
    overviewSelectedScreenIds,
    overviewScreens,
    screenContentNaturalHeights,
    screenRootComputedStylesById,
    selectedInspectorElements.length,
    viewMode,
  ]);
  const selectedScreenSource = useMemo<ScreenSourceSelection | null>(() => {
    if (!selectedScreenGeometry) return null;
    const screen = overviewScreens.find(
      (candidate) => candidate.id === selectedScreenGeometry.id,
    );
    if (!screen) return null;
    const sourceType = resolveOverviewScreenSourceType(
      screen,
      designSourceType,
    );
    return sourceType === "localhost"
      ? {
          sourceType: "url",
          url: screen.url ?? screen.previewUrl ?? screen.content,
          connectionId: screen.connectionId,
        }
      : { sourceType: "static" };
  }, [designSourceType, overviewScreens, selectedScreenGeometry]);
  const handleRemoveSelectedScreen = useCallback(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId) return;
    handleDeleteOverviewSelection([screenId]);
  }, [handleDeleteOverviewSelection, selectedScreenGeometry?.id]);

  const handleScreenSourceChange = useCallback(
    (
      screenId: string,
      next: {
        sourceType: "static" | "url";
        url?: string;
        connectionId?: string;
      },
    ) => {
      if (!id || !canEditDesign) return;
      const snapshotHtml =
        next.sourceType === "static"
          ? (runtimeLayerSnapshotsById[screenId]?.html ??
            liveScreenSnapshotsById[screenId]?.html)
          : undefined;
      updateScreenSourceMutation.mutate(
        {
          designId: id,
          fileId: screenId,
          sourceType: next.sourceType,
          ...(next.url ? { url: next.url } : {}),
          ...(next.connectionId ? { connectionId: next.connectionId } : {}),
          ...(snapshotHtml ? { snapshotHtml } : {}),
        } as never,
        {
          onSuccess: (rawResult) => {
            const result = rawResult as UpdateScreenSourceActionResult;
            if (next.sourceType === "static") {
              runInvalidateVisualEditSnapshotPublication(
                visualEditSnapshotPublicationState,
                screenId,
              );
            }
            queryClient.setQueryData(
              ["action", "get-design", { id }],
              (old: any) => {
                if (!old || typeof old !== "object") return old;
                const currentData = parseDesignDataJson(old.data);
                const nextData = {
                  ...currentData,
                  screenMetadata: {
                    ...getDesignDataRecord(currentData, "screenMetadata"),
                    [screenId]: result.metadata,
                  },
                  localhostScreens: {
                    ...getDesignDataRecord(currentData, "localhostScreens"),
                    [screenId]: result.metadata,
                  },
                };
                return {
                  ...old,
                  data: JSON.stringify(nextData),
                  files: Array.isArray(old.files)
                    ? old.files.map((file: DesignFile) =>
                        file.id === screenId
                          ? {
                              ...file,
                              content: result.content,
                              ...(result.updatedAt
                                ? { updatedAt: result.updatedAt }
                                : {}),
                            }
                          : file,
                      )
                    : old.files,
                };
              },
            );
            if (viewMode === "single" && activeFile?.id === screenId) {
              setCollabContent(result.content);
              setCollabContentFileId(screenId);
            }
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            toast.success(t("designEditor.toasts.screenSourceUpdated"));
          },
          onError: (error) => {
            toast.error(
              actionErrorMessage(error) ??
                (error instanceof Error && error.message
                  ? error.message
                  : t("designEditor.toasts.screenSourceUpdateFailed")),
            );
          },
        },
      );
    },
    [
      canEditDesign,
      id,
      activeFile?.id,
      liveScreenSnapshotsById,
      queryClient,
      runtimeLayerSnapshotsById,
      setCollabContent,
      setCollabContentFileId,
      t,
      updateScreenSourceMutation,
      viewMode,
    ],
  );

  const selectedScreenLayoutGrid = selectedScreenGeometry
    ? (layoutGrids[selectedScreenGeometry.id] ?? null)
    : null;
  const selectedScreenOwnsItsMarkup = useMemo(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId) return false;
    return externalPreviewUrlForContent(getScreenContent(screenId)) === null;
  }, [getScreenContent, selectedScreenGeometry]);
  const screenStylePreviewRef = useRef<
    Map<string, { before: string; after: string }>
  >(new Map());
  const commitSelectedScreenStyles = useCallback(
    (
      screenId: string,
      patch: Record<string, string>,
      meta?: StyleChangeMeta,
    ) => {
      if (!screenId || !canEditDesignRef.current) return;
      const previewOnly = meta?.phase === "preview";
      const content = getScreenContent(screenId);
      if (!content || externalPreviewUrlForContent(content) !== null) return;
      const preview = screenStylePreviewRef.current.get(screenId);
      if (preview && preview.after !== content) {
        screenStylePreviewRef.current.delete(screenId);
      }
      const rootStyles = {
        ...screenRootComputedStylesByIdRef.current[screenId],
        ...patch,
      };
      if (patch.borderRadius !== undefined) {
        rootStyles.borderTopLeftRadius = patch.borderRadius;
        rootStyles.borderTopRightRadius = patch.borderRadius;
        rootStyles.borderBottomRightRadius = patch.borderRadius;
        rootStyles.borderBottomLeftRadius = patch.borderRadius;
      }
      const screenMetadata = getDesignDataRecord(
        getDesignDataRecord(designDataJsonRef.current, "screenMetadata"),
        screenId,
      );
      const nextBodyStyles = setBodyInlineStyles(content, patch);
      if (nextBodyStyles === null) return;
      setScreenRootComputedStylesById((current) => ({
        ...current,
        [screenId]: rootStyles,
      }));
      const next = setScreenRootFrameRenderingStyles(
        nextBodyStyles,
        screenRootFrameRenderingOptions(
          rootStyles,
          screenMetadata.heightPinned === true,
        ),
      );
      const historyBeforeContent =
        screenStylePreviewRef.current.get(screenId)?.before;
      if (
        next === content &&
        (previewOnly || historyBeforeContent === undefined)
      )
        return;
      if (previewOnly) {
        screenStylePreviewRef.current.set(screenId, {
          before: historyBeforeContent ?? content,
          after: next,
        });
      } else {
        screenStylePreviewRef.current.delete(screenId);
      }
      applyFileContentUpdate(screenId, next, {
        immediateSave: !previewOnly,
        persist: !previewOnly,
        recordHistory: !previewOnly,
        historyBeforeContent: previewOnly ? undefined : historyBeforeContent,
      });
    },
    [applyFileContentUpdate, getScreenContent],
  );
  const commitSelectedScreenStylesRef = useRef(commitSelectedScreenStyles);
  commitSelectedScreenStylesRef.current = commitSelectedScreenStyles;
  const commitOverviewScreenStyles = useCallback(
    (screenIds: string[], patch: Record<string, string>) => {
      if (
        !canEditDesignRef.current ||
        viewModeRef.current !== "overview" ||
        screenIds.length < 2
      ) {
        return;
      }
      const changes: ContentHistoryChange[] = [];
      const computedStylesByScreen: Record<string, Record<string, string>> = {};
      for (const screenId of new Set(screenIds)) {
        const content = getProjectionContentForScreen(screenId);
        if (!content || externalPreviewUrlForContent(content) !== null)
          continue;
        const nextBodyStyles = setBodyInlineStyles(content, patch);
        if (nextBodyStyles === null) continue;
        const rootStyles = {
          ...screenRootComputedStylesById[screenId],
          ...patch,
        };
        if (patch.borderRadius !== undefined) {
          rootStyles.borderTopLeftRadius = patch.borderRadius;
          rootStyles.borderTopRightRadius = patch.borderRadius;
          rootStyles.borderBottomRightRadius = patch.borderRadius;
          rootStyles.borderBottomLeftRadius = patch.borderRadius;
        }
        const screenMetadata = getDesignDataRecord(
          getDesignDataRecord(designDataJson, "screenMetadata"),
          screenId,
        );
        const next = setScreenRootFrameRenderingStyles(
          nextBodyStyles,
          screenRootFrameRenderingOptions(
            rootStyles,
            screenMetadata.heightPinned === true,
          ),
        );
        if (next === content) continue;
        computedStylesByScreen[screenId] = rootStyles;
        applyFileContentUpdate(screenId, next, {
          persist: true,
          recordHistory: false,
        });
        changes.push({ fileId: screenId, before: content, after: next });
      }
      if (Object.keys(computedStylesByScreen).length > 0) {
        setScreenRootComputedStylesById((current) => ({
          ...current,
          ...computedStylesByScreen,
        }));
      }
      if (changes.length > 0) recordContentHistoryEntry({ changes });
    },
    [
      applyFileContentUpdate,
      designDataJson,
      getProjectionContentForScreen,
      recordContentHistoryEntry,
      screenRootComputedStylesById,
    ],
  );
  commitOverviewScreenStylesRef.current = commitOverviewScreenStyles;
  const handleSelectedScreenStyleChange = useCallback(
    (property: string, value: string, meta?: StyleChangeMeta) => {
      const screenId = selectedScreenGeometry?.id;
      if (!screenId) return;
      commitSelectedScreenStylesRef.current(
        screenId,
        { [property]: value },
        meta,
      );
    },
    [selectedScreenGeometry?.id],
  );
  const handleSelectedScreenStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) => {
      const screenId = selectedScreenGeometry?.id;
      if (!screenId) return;
      commitSelectedScreenStylesRef.current(screenId, styles, meta);
    },
    [selectedScreenGeometry?.id],
  );
  const persistedCanvasBackground = useMemo(
    () => getDesignCanvasBackground(designDataJson),
    [designDataJson],
  );
  const [canvasBackgroundDraft, setCanvasBackgroundDraft] = useState<
    string | null
  >(null);
  const canvasBackground = canvasBackgroundDraft ?? persistedCanvasBackground;
  const [themedCanvasBackground, setThemedCanvasBackground] = useState<
    string | null
  >(null);
  canvasBackgroundRef.current = canvasBackground ?? themedCanvasBackground;
  useEffect(() => {
    if (canvasBackground) return;
    // A throwaway element, not the raw token: the token is space-separated
    // HSL, which the colour parser rejects. After a frame, because next-themes
    // sets the `dark` class in an ancestor effect React runs after this one.
    const frame = requestAnimationFrame(() => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;background-color:var(--design-editor-canvas-bg)";
      document.body.append(probe);
      const painted = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      setThemedCanvasBackground(painted || null);
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasBackground, resolvedTheme]);
  const handleCanvasBackgroundChange = useCallback(
    (value: string, meta?: { phase?: "preview" | "commit" | "cancel" }) => {
      if (!id || !canEditDesignRef.current) return;
      if (meta?.phase === "cancel") {
        setCanvasBackgroundDraft(null);
        return;
      }
      if (meta?.phase === "preview") {
        setCanvasBackgroundDraft(sanitizeCanvasBackground(value));
        return;
      }
      setCanvasBackgroundDraft(null);
      const trimmed = value.trim();
      const operations: DesignDataOperation[] = [
        trimmed
          ? { op: "set", path: ["canvasBackground"], value: trimmed }
          : { op: "delete", path: ["canvasBackground"] },
      ];
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        operations,
      );
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, data: JSON.stringify(nextData) };
      });
      enqueueFrameGeometryDataSave(operations);
    },
    [enqueueFrameGeometryDataSave, id, queryClient],
  );

  const handleScreenGeometryChange = useCallback(
    (
      screenId: string,
      next: Partial<{ x: number; y: number; width: number; height: number }>,
    ) => {
      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const screenIndex = overviewScreens.findIndex(
        (screen) => screen.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      if (!screen) return;
      const current = {
        ...getInitialFrameGeometry(screenIndex, {
          width: screen.width ?? 1280,
          height: screen.height ?? 2560,
        }),
        ...(before[screenId] ?? canvasFrameGeometryById[screenId] ?? {}),
      };
      const after = {
        ...before,
        [screenId]: {
          ...current,
          ...(next.x !== undefined ? { x: next.x } : {}),
          ...(next.y !== undefined ? { y: next.y } : {}),
          ...(next.width !== undefined
            ? {
                width: Math.max(
                  MIN_FRAME_SIZE_PX,
                  clampScreenDimension(
                    next.width,
                    "width",
                    readScreenSizeConstraints(
                      screenRootComputedStylesById[screenId],
                    ),
                  ),
                ),
              }
            : {}),
          ...(next.height !== undefined
            ? {
                height: Math.max(
                  MIN_FRAME_SIZE_PX,
                  clampScreenDimension(
                    next.height,
                    "height",
                    readScreenSizeConstraints(
                      screenRootComputedStylesById[screenId],
                    ),
                  ),
                ),
              }
            : {}),
        },
      };
      handleGeometryCommit(before, after);
    },
    [
      canvasFrameGeometryById,
      handleGeometryCommit,
      overviewScreens,
      screenRootComputedStylesById,
    ],
  );

  const handleScreenHeightModeChange = useCallback(
    (screenId: string, mode: ScreenHeightMode) => {
      if (!canEditDesignRef.current) return;
      flushPendingFrameGeometrySave();
      const designData = designDataJsonRef.current;
      const screenMetadata = getDesignDataRecord(
        getDesignDataRecord(designData, "screenMetadata"),
        screenId,
      );
      const previousMode = resolveScreenHeightMode(
        screenMetadata.heightMode,
        screenMetadata.heightPinned === true,
        screenMetadata.sourceType,
      );
      const operations: DesignDataOperation[] = [];
      if (mode === "auto") {
        if (screenMetadata.heightMode !== "auto") {
          operations.push({
            op: "set",
            path: ["screenMetadata", screenId, "heightMode"],
            value: "auto",
          });
        }
      } else if (screenMetadata.heightMode !== mode) {
        operations.push({
          op: "set",
          path: ["screenMetadata", screenId, "heightMode"],
          value: mode,
        });
      }
      const heightPinned = mode === "fixed";
      if (screenMetadata.heightPinned !== heightPinned) {
        operations.push({
          op: "set",
          path: ["screenMetadata", screenId, "heightPinned"],
          value: heightPinned,
        });
      }
      const screenIndex = overviewScreens.findIndex(
        (candidate) => candidate.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      const naturalHeight = screenContentNaturalHeightByIdRef.current[screenId];
      if (
        previousMode === "hug" &&
        mode === "fixed" &&
        screen &&
        typeof naturalHeight === "number" &&
        naturalHeight > 0
      ) {
        const persistedGeometry = getCanvasFrameGeometry(designData)[screenId];
        const currentGeometry =
          canvasFrameGeometryById[screenId] ??
          persistedGeometry ??
          getInitialFrameGeometry(screenIndex, {
            width: screen.width ?? 1280,
            height: screen.height ?? 2560,
          });
        const nextGeometry = {
          ...currentGeometry,
          height: clampScreenDimension(
            naturalHeight,
            "height",
            readScreenSizeConstraints(screenRootComputedStylesById[screenId]),
          ),
        };
        if (
          !persistedGeometry ||
          JSON.stringify(persistedGeometry) !== JSON.stringify(nextGeometry)
        ) {
          operations.push({
            op: "set",
            path: ["canvasFrames", screenId],
            value: nextGeometry,
          });
        }
      }

      const undoOperations = invertDesignDataOperations(designData, operations);
      if (operations.length > 0) {
        const nextData = applyDesignDataOperations(designData, operations);
        designDataJsonRef.current = nextData;
        queryClient.setQueryData(
          ["action", "get-design", { id }],
          (old: any) => {
            if (!old || typeof old !== "object") return old;
            return { ...old, data: JSON.stringify(nextData) };
          },
        );
        enqueueFrameGeometryDataSave(operations);
      }
      if (heightPinned) locallyPinnedHeightIdsRef.current.add(screenId);
      else locallyPinnedHeightIdsRef.current.delete(screenId);

      let historyBefore = "";
      let historyAfter = "";
      if (
        screen &&
        externalPreviewUrlForContent(getScreenContent(screenId)) === null
      ) {
        const content = getProjectionContentForScreen(screenId);
        historyBefore = content;
        const rootStyles = screenRootComputedStylesById[screenId] ?? {};
        const withHeightMode = setScreenRootDefaultHeightMode(content, mode);
        const next = setScreenRootFrameRenderingStyles(
          withHeightMode,
          screenRootFrameRenderingOptions(rootStyles, heightPinned),
        );
        historyAfter = next;
        if (next !== content) {
          applyFileContentUpdate(screenId, next, {
            persist: true,
            recordHistory: false,
          });
        }
      }
      if (historyBefore !== historyAfter || operations.length > 0) {
        recordContentHistoryEntry({
          fileId: screenId,
          before: historyBefore,
          after: historyAfter,
          ...(operations.length > 0
            ? {
                designDataChange: {
                  undo: undoOperations,
                  redo: operations,
                },
              }
            : {}),
        });
      }
    },
    [
      applyFileContentUpdate,
      canvasFrameGeometryById,
      enqueueFrameGeometryDataSave,
      flushPendingFrameGeometrySave,
      getProjectionContentForScreen,
      getScreenContent,
      id,
      overviewScreens,
      queryClient,
      recordContentHistoryEntry,
      screenRootComputedStylesById,
    ],
  );

  const layerPanelSelectedIds = useMemo(
    () =>
      viewMode === "overview" && createdOverviewLayerSelection
        ? [createdOverviewLayerSelection.layerId]
        : selectedLayerIds,
    [createdOverviewLayerSelection, selectedLayerIds, viewMode],
  );

  const layerPanelExpandedIds = useMemo(() => {
    if (viewMode !== "overview" || !createdOverviewLayerSelection) {
      return expandedLayerIds;
    }
    const next = new Set(expandedLayerIds);
    next.add(createdOverviewLayerSelection.screenId);
    return Array.from(next);
  }, [createdOverviewLayerSelection, expandedLayerIds, viewMode]);

  useEffect(() => {
    const pendingLayerId = pendingOverviewLayerSelectionRef.current;
    if (!pendingLayerId) return;
    if (!selectedLayerIdsState.includes(pendingLayerId)) {
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(pendingLayerId);
    if (!owner) return;
    schedulePendingOverviewLayerSelectionClear(pendingLayerId);
    setActiveFileId(owner.fileId);
    setSelectedElement(
      elementInfoForOwnedCodeLayerNode({
        info: selectedElementRef.current,
        node: owner.node,
        ownerFileId: owner.fileId,
      }),
    );
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      next.add(owner.fileId);
      collectCodeLayerAncestors(owner.tree, pendingLayerId).forEach((id) =>
        next.add(id),
      );
      return next.size === current.length ? current : Array.from(next);
    });
  }, [
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeId,
    schedulePendingOverviewLayerSelectionClear,
    selectedLayerIdsState,
  ]);
  const selectedScreenElement = useMemo(() => {
    const screenId = selectedScreenGeometry?.id;
    if (!screenId || !selectedScreenOwnsItsMarkup) return null;
    const projection = getCodeLayerProjectionForScreen(screenId);
    const body = projection?.nodes.find((node) => node.tag === "body");
    if (!body) return null;
    const element = elementInfoFromCodeLayerNode(body);
    const styleSnapshotKey =
      activeBreakpointWidthState === undefined
        ? screenId
        : getBreakpointIframeId(screenId, activeBreakpointWidthState);
    const authoredBackgroundImage = element.computedStyles.backgroundImage;
    return {
      ...element,
      ...(authoredBackgroundImage !== undefined
        ? {
            inlineStyles: {
              ...element.inlineStyles,
              backgroundImage: authoredBackgroundImage,
            },
          }
        : {}),
      computedStyles: {
        ...element.computedStyles,
        ...screenRootComputedStylesById[styleSnapshotKey],
        ...(authoredBackgroundImage !== undefined
          ? { backgroundImage: authoredBackgroundImage }
          : {}),
      },
    };
  }, [
    activeBreakpointWidthState,
    getBreakpointIframeId,
    getCodeLayerProjectionForScreen,
    screenRootComputedStylesById,
    selectedScreenGeometry,
    selectedScreenOwnsItsMarkup,
  ]);

  const selectionColorPreviewHistoryRef = useRef(
    new Map<string, SelectionColorPreviewHistoryEntry>(),
  );
  const selectionColorPickerSessionRef = useRef(
    new Map<string, SelectionColorPickerSessionEntry>(),
  );

  const selectionColorScopes = useMemo<SelectionColorScope[]>(() => {
    const sourceIsInline = (fileId: string, content: string) =>
      resolveOverviewScreenSourceType(
        overviewScreens.find((screen) => screen.id === fileId),
        designSourceType,
      ) === "inline" &&
      externalPreviewUrlForContent(getScreenContent(fileId)) === null &&
      externalPreviewUrlForContent(content) === null;

    if (selectedLayerTargets.length > 0) {
      return selectedLayerTargets.flatMap((target) => {
        const content =
          target.fileId === activeFile?.id
            ? activeContent
            : getScreenContent(target.fileId);
        return sourceIsInline(target.fileId, content)
          ? [
              {
                fileId: target.fileId,
                content,
                source: codeLayerSourceForScreen(target.fileId),
                sourceId: bridgeSourceIdForCodeLayerNode(target.node),
                selector: target.node.selector,
              },
            ]
          : [];
      });
    }
    if (selectedElement && activeFile?.id) {
      if (!sourceIsInline(activeFile.id, activeContent)) return [];
      return [
        {
          fileId: activeFile.id,
          content: activeContent,
          source: codeLayerSourceForScreen(activeFile.id),
          sourceId: selectedElement.sourceId,
          selector: selectedElement.selector,
        },
      ];
    }
    if (viewMode !== "overview") return [];
    return overviewSelectedScreenIds.flatMap((screenId) => {
      const content = getProjectionContentForScreen(screenId);
      return content && sourceIsInline(screenId, content)
        ? [
            {
              fileId: screenId,
              content,
              source: codeLayerSourceForScreen(screenId),
              wholeDocument: true,
            },
          ]
        : [];
    });
  }, [
    activeContent,
    codeLayerSourceForScreen,
    designSourceType,
    activeFile?.id,
    getProjectionContentForScreen,
    getScreenContent,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
    selectedLayerTargets,
    viewMode,
  ]);

  const selectionColorScopeIdentity = JSON.stringify(
    selectionColorScopes.map(
      ({ fileId, sourceId, selector, wholeDocument }) => ({
        fileId,
        sourceId,
        selector,
        wholeDocument,
      }),
    ),
  );

  const getFreshSelectionColorScopes = useCallback(
    () =>
      selectionColorScopes.map((scope) => ({
        ...scope,
        content:
          scope.fileId === activeFile?.id
            ? getFreshActiveFileContent({
                activeContent,
                latestContent: latestActiveContentRef.current,
                lastLocalContent: lastLocalContentRef.current,
              })
            : getScreenContent(scope.fileId),
      })),
    [activeContent, activeFile?.id, getScreenContent, selectionColorScopes],
  );

  useEffect(() => {
    selectionColorPreviewHistoryRef.current.clear();
    selectionColorPickerSessionRef.current.clear();
  }, [selectionColorScopeIdentity]);

  useEffect(
    () => () => {
      selectionColorPreviewHistoryRef.current.clear();
      selectionColorPickerSessionRef.current.clear();
    },
    [],
  );

  const handleSelectionColorChange = useCallback(
    (from: string, to: string, meta?: StyleChangeMeta) => {
      const result = runSelectionColorChange(
        {
          activeFileId: activeFile?.id,
          applyFileContentUpdate,
          canEditDesign,
          recordContentHistoryEntry,
          scopes: getFreshSelectionColorScopes(),
          previewHistoryRef: selectionColorPreviewHistoryRef,
          pickerSessionRef: selectionColorPickerSessionRef,
        },
        from,
        to,
        meta,
      );
      if (result.status === "refused" && meta?.phase !== "cancel") {
        toast.error(t("designEditor.toasts.groupFillApplyFailed"), {
          duration: 4000,
          id: "selection-color-apply-failed",
        });
      }
      return result.status === "refused" ? false : undefined;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getFreshSelectionColorScopes,
      recordContentHistoryEntry,
      t,
    ],
  );

  const handleSelectionColorPickerOpenChange = useCallback(
    (from: string, open: boolean) => {
      setSelectionColorPickerSession(
        {
          pickerSessionRef: selectionColorPickerSessionRef,
          previewHistoryRef: selectionColorPreviewHistoryRef,
          scopes: getFreshSelectionColorScopes(),
        },
        from,
        open,
      );
    },
    [getFreshSelectionColorScopes],
  );

  const canSelectSelectionColorTarget = useCallback(
    (color: string) =>
      selectionColorTargets(getFreshSelectionColorScopes(), color).length > 0,
    [getFreshSelectionColorScopes],
  );

  const handleGroupFillStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) => {
      if (!canEditDesign) return false;
      for (const [fileId, session] of selectionColorPickerSessionRef.current) {
        selectionColorPickerSessionRef.current.set(fileId, {
          ...session,
          invalidated: true,
        });
        if (selectionColorPreviewHistoryRef.current.get(fileId)?.from) {
          selectionColorPreviewHistoryRef.current.delete(fileId);
        }
      }
      if (meta?.phase === "cancel") {
        const scopesByFile = new Map<
          string,
          ReturnType<typeof getFreshSelectionColorScopes>
        >();
        for (const scope of getFreshSelectionColorScopes()) {
          scopesByFile.set(scope.fileId, [
            ...(scopesByFile.get(scope.fileId) ?? []),
            scope,
          ]);
        }
        let restored = true;
        for (const [scopeFileId, scopes] of scopesByFile) {
          if (!selectionColorPreviewHistoryRef.current.has(scopeFileId))
            continue;
          const content = scopes[0]?.content;
          const result = restoreSelectionColorPreview(
            {
              activeFileId: activeFile?.id,
              applyFileContentUpdate,
              previewHistoryRef: selectionColorPreviewHistoryRef,
            },
            scopeFileId,
            scopes.every((scope) => scope.content === content)
              ? content
              : undefined,
          );
          if (result !== "accepted") restored = false;
        }
        return restored;
      }
      const currentScopes = getFreshSelectionColorScopes();
      const result = rewriteSelectionFillStyles(currentScopes, styles);
      if (result.status !== "applied") {
        toast.error(t("designEditor.toasts.groupFillApplyFailed"), {
          duration: 4000,
        });
        console.warn("Group Fill update was refused:", result.message);
        return false;
      }

      const previewOnly = meta?.phase === "preview";
      for (const update of result.updates) {
        const beforeContent = currentScopes.find(
          (scope) => scope.fileId === update.fileId,
        )?.content;
        if (beforeContent === undefined) continue;

        const previousPreview = selectionColorPreviewHistoryRef.current.get(
          update.fileId,
        );
        if (previousPreview && previousPreview.after !== beforeContent) {
          selectionColorPreviewHistoryRef.current.delete(update.fileId);
        }
        const activePreview = selectionColorPreviewHistoryRef.current.get(
          update.fileId,
        );
        const applyResult = applyFileContentUpdate(
          update.fileId,
          update.content,
          {
            forcePreviewFullDocument: update.fileId === activeFile?.id,
            persist: !previewOnly,
            recordHistory: !previewOnly,
            historyBeforeContent: previewOnly
              ? undefined
              : activePreview?.before,
          },
        );
        if (
          previewOnly &&
          (applyResult?.status === "accepted" ||
            applyResult?.status === "deferred")
        ) {
          selectionColorPreviewHistoryRef.current.set(update.fileId, {
            before: activePreview?.before ?? beforeContent,
            after:
              applyResult.status === "accepted"
                ? applyResult.content
                : prepareCanonicalSourceContent(update.content, {
                    fileId: update.fileId,
                  }).content,
          });
        } else if (
          !previewOnly &&
          (applyResult?.status === "accepted" ||
            applyResult?.status === "deferred")
        ) {
          selectionColorPreviewHistoryRef.current.delete(update.fileId);
        }
      }
      return true;
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getFreshSelectionColorScopes,
      t,
    ],
  );

  const handleSelectionColorTarget = useCallback(
    (color: string) => {
      const targets = selectionColorTargets(
        getFreshSelectionColorScopes(),
        color,
      );
      if (targets.length === 0) return;

      recordSelectionHistoryAroundChange(() => {
        const nextLayerIds: string[] = [];
        const nextScreenIds: string[] = [];
        const addUnique = (ids: string[], id: string) => {
          if (!ids.includes(id)) ids.push(id);
        };
        const ownerForTarget = (target: (typeof targets)[number]) =>
          codeLayerOwnerByNodeId.get(target.nodeId) ??
          Array.from(codeLayerOwnerByNodeId.values()).find(
            (candidate) =>
              candidate.fileId === target.fileId &&
              candidate.node.tag === target.tag &&
              candidate.node.selector === target.selector,
          );

        for (const target of targets) {
          if (target.tag === "html" || target.tag === "body") {
            addUnique(nextScreenIds, target.fileId);
          } else {
            addUnique(nextLayerIds, target.nodeId);
          }
          const owner = ownerForTarget(target);
          if (owner) {
            addUnique(nextLayerIds, owner.node.id);
            addUnique(nextScreenIds, owner.fileId);
          }
        }

        if (viewModeRef.current === "overview") {
          const nextActiveFileId = nextScreenIds[0] ?? targets[0]?.fileId;
          if (nextActiveFileId) setActiveFileId(nextActiveFileId);
          setOverviewSelectedScreenIds(nextScreenIds);
          setSelectedLayerIdsState(
            nextScreenIds.length > 0
              ? [...nextScreenIds, ...nextLayerIds]
              : nextLayerIds,
          );
        } else {
          const fileId = targets[0]?.fileId;
          if (fileId) setActiveFileId(fileId);
          setOverviewSelectedScreenIds([]);
          setSelectedLayerIdsState(nextLayerIds);
        }

        const lastLayerTarget = [...targets]
          .reverse()
          .find((target) => target.tag !== "html" && target.tag !== "body");
        const lastOwner = lastLayerTarget
          ? ownerForTarget(lastLayerTarget)
          : null;
        const lastRootTarget = [...targets]
          .reverse()
          .find((target) => target.tag === "html" || target.tag === "body");
        const selectedOwner =
          lastOwner ?? (lastRootTarget ? ownerForTarget(lastRootTarget) : null);
        if (selectedOwner) {
          setSelectedElement(
            elementInfoForOwnedCodeLayerNode({
              info: selectedElement,
              node: selectedOwner.node,
              ownerFileId: selectedOwner.fileId,
            }),
          );
        } else if (lastRootTarget) {
          setSelectedElement((current) => current);
        } else {
          setSelectedElement(null);
        }
        setActiveTool("move");
        setMode("edit");
        setExpandedLayerIds((current) => {
          const currentIds = new Set(current);
          const next = new Set(currentIds);
          for (const target of targets) {
            const owner = ownerForTarget(target);
            if (!owner) continue;
            next.add(owner.fileId);
            collectCodeLayerAncestors(owner.tree, owner.node.id).forEach(
              (ancestorId) => next.add(ancestorId),
            );
          }
          return next.size === currentIds.size ? current : Array.from(next);
        });
        if (viewModeRef.current === "overview") {
          window.requestAnimationFrame(() => handleZoomToSelectionFit());
        }
      });
    },
    [
      codeLayerOwnerByNodeId,
      getFreshSelectionColorScopes,
      handleZoomToSelectionFit,
      recordSelectionHistoryAroundChange,
      selectedElement,
    ],
  );

  useEffect(() => {
    const pendingScreenId = pendingOverviewScreenSelectionRef.current;
    if (!pendingScreenId) return;
    if (files.some((file) => file.id === pendingScreenId)) {
      pendingOverviewScreenSelectionRef.current = null;
    }
  }, [files]);

  useEffect(() => {
    setSelectedLayerIdsState((current) => {
      if (!selectedElementLayerId) {
        return current;
      }
      if (current.includes(selectedElementLayerId)) return current;
      if (current.length > 1) return [...current, selectedElementLayerId];
      return [selectedElementLayerId];
    });
  }, [selectedElementLayerId]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const ancestorIds = collectCodeLayerAncestors(
      owner?.tree ?? activeCodeLayerTree,
      selectedElementLayerId,
    );
    if (ancestorIds.length === 0) return;
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (owner?.fileId) next.add(owner.fileId);
      ancestorIds.forEach((ancestorId) => next.add(ancestorId));
      return next.size === current.length ? current : Array.from(next);
    });
  }, [activeCodeLayerTree, codeLayerOwnerByNodeId, selectedElementLayerId]);

  useEffect(() => {
    const selectedCodeLayerIds = selectedLayerIds.filter((layerId) =>
      codeLayerOwnerByNodeId.has(layerId),
    );
    if (selectedCodeLayerIds.length === 0) return;
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      selectedCodeLayerIds.forEach((layerId) => {
        const owner = codeLayerOwnerByNodeId.get(layerId);
        if (!owner) return;
        next.add(owner.fileId);
        collectCodeLayerAncestors(owner.tree, layerId).forEach((ancestorId) =>
          next.add(ancestorId),
        );
      });
      return next.size === current.length ? current : Array.from(next);
    });
  }, [codeLayerOwnerByNodeId, selectedLayerIds]);

  useEffect(() => {
    if (!selectedElementLayerId) return;
    const owner = codeLayerOwnerByNodeId.get(selectedElementLayerId);
    const selectedPathIds = [
      ...collectCodeLayerAncestors(
        owner?.tree ?? activeCodeLayerTree,
        selectedElementLayerId,
      ),
      selectedElementLayerId,
    ];
    const activeFileLocked =
      activeFile?.id && effectiveCodeLayerState.lockedIds.has(activeFile.id);
    const selectionBlocked =
      Boolean(activeFileLocked) ||
      selectedPathIds.some((layerId) =>
        effectiveCodeLayerState.lockedIds.has(layerId),
      );
    if (!selectionBlocked) return;
    setSelectedElement(null);
  }, [
    activeCodeLayerTree,
    activeFile?.id,
    codeLayerOwnerByNodeId,
    effectiveCodeLayerState,
    selectedElementLayerId,
  ]);

  const activeScreenPreviewUrl = useMemo(() => {
    if (activeScreenSnapshotOnly) return undefined;
    if (builderPreviewUrl) return builderPreviewUrl;
    const screen = overviewScreens.find((item) => item.id === activeFile?.id);
    return (
      screen?.url ||
      screen?.previewUrl ||
      externalPreviewUrlForContent(activeContent)
    );
  }, [
    activeContent,
    activeFile?.id,
    activeScreenSnapshotOnly,
    builderPreviewUrl,
    overviewScreens,
  ]);

  const statesPanelBreakpoints = useMemo<
    Array<{ id: string; label: string; widthPx: number }>
  >(() => {
    try {
      const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).breakpoints)
      ) {
        const bps = (
          raw as {
            breakpoints: Array<{
              id: string;
              widthPx: number;
              label?: string;
            }>;
          }
        ).breakpoints;
        return bps.map((bp) => ({
          id: bp.id,
          widthPx: bp.widthPx,
          label:
            bp.label ??
            (bp.widthPx >= 1024
              ? "Desktop"
              : bp.widthPx >= 600
                ? "Tablet"
                : "Mobile"),
        }));
      }
    } catch {
      // ignore
    }
    return [];
  }, [designDataJson]);

  const statesPanelActiveBreakpointId = useMemo<string>(() => {
    if (activeBreakpointWidthState == null) return "auto";
    const match = statesPanelBreakpoints.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    if (match) return match.id;
    const defaultMatch = DEFAULT_STATES_PANEL_BREAKPOINTS.find(
      (bp) => bp.widthPx === activeBreakpointWidthState,
    );
    return defaultMatch?.id ?? "auto";
  }, [activeBreakpointWidthState, statesPanelBreakpoints]);

  const handleStatesPanelBreakpointSelect = useCallback(
    (breakpointId: string) => {
      if (breakpointId === "auto") {
        activeBreakpointWidthStateRef.current = undefined;
        setActiveBreakpointWidthState(undefined);
        if (id) {
          persistActiveBreakpoint("auto", responsiveEditScopeRef.current);
        }
        return;
      }
      const bp =
        statesPanelBreakpoints.find((b) => b.id === breakpointId) ??
        DEFAULT_STATES_PANEL_BREAKPOINTS.find((b) => b.id === breakpointId);
      if (!bp) return;
      activeBreakpointWidthStateRef.current = bp.widthPx;
      setActiveBreakpointWidthState(bp.widthPx);
      if (id) {
        persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
      }
    },
    [id, persistActiveBreakpoint, statesPanelBreakpoints],
  );

  const handleStatesPanelAddBreakpoint = useCallback(() => {
    if (viewMode !== "overview") {
      viewModeRef.current = "overview";
      setViewMode("overview");
    }
  }, [viewMode]);

  const statesPanelProps = useMemo(() => {
    if (!id) return undefined;
    return {
      activeStateId: selectedStateId,
      activeBreakpointId: statesPanelActiveBreakpointId,
      breakpoints: statesPanelBreakpoints,
      onStateSelect: handleDesignStateSelect,
      onBreakpointSelect: handleStatesPanelBreakpointSelect,
      onAddBreakpoint: handleStatesPanelAddBreakpoint,
    };
  }, [
    id,
    selectedStateId,
    statesPanelActiveBreakpointId,
    statesPanelBreakpoints,
    handleDesignStateSelect,
    handleStatesPanelBreakpointSelect,
    handleStatesPanelAddBreakpoint,
  ]);

  const publishDesignTitle = design?.title?.trim() || "Untitled design";

  const handleOpenDesignPreview = useCallback(() => {
    if (activeScreenSnapshotOnly) return;
    let previewUrl = activeScreenPreviewUrl;
    let blobUrl: string | null = null;
    if (!previewUrl) {
      if (!activeContent.trim()) return;
      blobUrl = URL.createObjectURL(
        new Blob([fullPreviewHtml(activeContent)], { type: "text/html" }),
      );
      previewUrl = blobUrl;
    }

    openPreviewUrl(
      previewUrl,
      (url, target) => window.open(url, target),
      (url) => window.location.assign(url),
    );
    if (blobUrl) {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl!), 60_000);
    }
  }, [activeContent, activeScreenPreviewUrl, activeScreenSnapshotOnly]);

  const handleJoinPublishWaitlist = useCallback(async () => {
    if (!isSignedIn) {
      handleSignInToSave();
      return;
    }

    setJoiningPublishWaitlist(true);
    setPublishWaitlistError(null);

    try {
      const res = await fetch(
        new URL(
          agentNativePath("/_agent-native/builder/branch-waitlist"),
          window.location.origin,
        ).href,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageUrl: window.location.href,
            prompt: `Publish design "${publishDesignTitle}" as an app.`,
            source: "design_editor_publish_app_menu",
            useCase: "design_publish_app",
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Request failed (${res.status})`,
        );
      }

      setPublishWaitlistJoined(true);
    } catch (err) {
      setPublishWaitlistError(
        err instanceof Error
          ? err.message
          : "Couldn't join the waitlist. Please try again.",
      );
    } finally {
      setJoiningPublishWaitlist(false);
    }
  }, [handleSignInToSave, isSignedIn, publishDesignTitle]);

  const activeLayerId =
    selectedLayerIds[selectedLayerIds.length - 1] ??
    selectedElementLayerId ??
    activeFile?.id ??
    "";
  const selectedElementFullViewScreenId =
    viewMode === "overview" && selectedElement
      ? selectedElementLayerId
        ? (codeLayerOwnerByNodeId.get(selectedElementLayerId)?.fileId ??
          activeFileId)
        : activeFileId
      : null;
  const fullViewScreenIds = useMemo(
    () =>
      selectedElementFullViewScreenId ? [selectedElementFullViewScreenId] : [],
    [selectedElementFullViewScreenId],
  );

  const singleSelectedOverviewScreenId =
    viewMode === "overview" &&
    !selectedElement &&
    overviewSelectedScreenIds.length === 1
      ? overviewSelectedScreenIds[0]
      : null;
  const selectedFrameBackgroundImage =
    singleSelectedOverviewScreenId &&
    singleSelectedOverviewScreenId === activeFileId
      ? pageStyles.backgroundImage
      : undefined;
  const gradientEditTarget = useMemo<GradientEditOverlayTarget | null>(() => {
    if (!singleSelectedOverviewScreenId) return null;
    if (!selectedFrameBackgroundImage?.trim().startsWith("linear-gradient("))
      return null;
    const frameOrDraftId = singleSelectedOverviewScreenId;
    return {
      frameOrDraftId,
      cssValue: selectedFrameBackgroundImage,
      onChange: (nextCss, meta) => {
        handleStyleChange("backgroundImage", nextCss, meta);
      },
    };
  }, [
    handleStyleChange,
    selectedFrameBackgroundImage,
    singleSelectedOverviewScreenId,
  ]);

  const inScreenGradientEditNodeId = useMemo(() => {
    if (!selectedElement || isScreenRootElementInfo(selectedElement))
      return null;
    return selectedElement.sourceId ?? null;
  }, [selectedElement]);
  const inScreenGradientEditScreenId = useMemo(() => {
    if (!inScreenGradientEditNodeId) return null;
    if (viewMode !== "overview") return activeFile?.id ?? null;
    return (
      (selectedElementLayerId
        ? codeLayerOwnerByNodeId.get(selectedElementLayerId)?.fileId
        : undefined) ?? activeFileId
    );
  }, [
    activeFile?.id,
    activeFileId,
    codeLayerOwnerByNodeId,
    inScreenGradientEditNodeId,
    selectedElementLayerId,
    viewMode,
  ]);
  const inScreenBackgroundImage =
    selectedElement?.inlineStyles?.backgroundImage ??
    selectedElement?.computedStyles.backgroundImage;
  const inScreenGradientEditCssValue =
    inScreenGradientEditNodeId &&
    inScreenBackgroundImage?.trim().startsWith("linear-gradient(")
      ? inScreenBackgroundImage
      : null;
  const inScreenGradientEditTarget = useMemo<{
    screenId: string;
    nodeId: string;
    cssValue: string;
  } | null>(() => {
    if (
      !inScreenGradientEditScreenId ||
      !inScreenGradientEditNodeId ||
      !inScreenGradientEditCssValue
    ) {
      return null;
    }
    return {
      screenId: inScreenGradientEditScreenId,
      nodeId: inScreenGradientEditNodeId,
      cssValue: inScreenGradientEditCssValue,
    };
  }, [
    inScreenGradientEditCssValue,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
  ]);
  const handleInScreenGradientEditChange = useCallback(
    (nodeId: string, cssValue: string, phase: "preview" | "commit") => {
      if (
        !inScreenGradientEditTarget ||
        inScreenGradientEditTarget.nodeId !== nodeId
      ) {
        return;
      }
      handleStyleChange("backgroundImage", cssValue, { phase });
    },
    [handleStyleChange, inScreenGradientEditTarget],
  );
  const pendingInspectorInteractionStateStyles = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      !inScreenGradientEditScreenId ||
      !inScreenGradientEditNodeId
    ) {
      return undefined;
    }
    const stylesByState: Partial<
      Record<InteractionState, Record<string, string>>
    > = {};
    for (const edit of pendingVisualStyleEdits) {
      if (
        !edit.interactionState ||
        edit.screenId !== inScreenGradientEditScreenId ||
        (edit.sourceId !== inScreenGradientEditNodeId &&
          edit.selector !== selectedCanvasSelector)
      ) {
        continue;
      }
      stylesByState[edit.interactionState] = {
        ...(stylesByState[edit.interactionState] ?? {}),
        ...edit.styles,
      };
    }
    return Object.keys(stylesByState).length > 0 ? stylesByState : undefined;
  }, [
    activeCanvasSourceType,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
    pendingVisualStyleEdits,
    selectedCanvasSelector,
  ]);
  const statePreviewTarget = useMemo(() => {
    const target = deriveStatePreviewTarget(
      activeInteractionStateState,
      inScreenGradientEditScreenId,
      inScreenGradientEditNodeId,
    );
    if (!target) return null;
    const pendingStateEdit = isRunningAppSourceType(activeCanvasSourceType)
      ? pendingVisualStyleEdits.find(
          (edit) =>
            edit.screenId === target.screenId &&
            edit.interactionState === target.state &&
            (edit.sourceId === target.nodeId ||
              edit.selector === selectedCanvasSelector),
        )
      : undefined;
    return {
      ...target,
      selector: selectedCanvasSelector,
      selectorCandidates: selectedCanvasSelectorCandidates,
      previewStyles: pendingStateEdit?.styles ?? null,
    };
  }, [
    activeCanvasSourceType,
    activeInteractionStateState,
    inScreenGradientEditNodeId,
    inScreenGradientEditScreenId,
    pendingVisualStyleEdits,
    selectedCanvasSelector,
    selectedCanvasSelectorCandidates,
  ]);
  const handleInteractionStateChange = useCallback(
    (next: InteractionState | null) => {
      setActiveInteractionStateState(next);
    },
    [],
  );
  const activeLayerLocked = Boolean(
    activeLayerId && effectiveCodeLayerState.lockedIds.has(activeLayerId),
  );
  const activeLayerHidden = Boolean(
    activeLayerId && effectiveCodeLayerState.hiddenIds.has(activeLayerId),
  );

  const activeScreenIsLocalSource =
    Boolean(activeFile) && activeOverviewScreen?.sourceType === "localhost";
  const activeScreenRouteSourceFile = activeScreenIsLocalSource
    ? getLocalhostRouteSourceFile({
        sourceFile: activeOverviewScreen?.sourceFile,
        source: activeOverviewScreen?.source,
      })
    : undefined;
  const activeLocalhostConnectionId = activeScreenIsLocalSource
    ? ((activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "")
    : "";

  const { data: activeLocalhostConnectionResult } = useActionQuery<{
    connections?: Array<{
      id: string;
      name?: string | null;
      devServerUrl?: string | null;
      rootPath?: string | null;
    }>;
  }>(
    "list-localhost-connections",
    { designId: id },
    {
      enabled: Boolean(id && canEditDesign),
    },
  );
  localhostConnectionRootPathByIdRef.current = new Map(
    (activeLocalhostConnectionResult?.connections ?? []).flatMap((connection) =>
      connection.rootPath
        ? ([[connection.id, connection.rootPath]] as Array<[string, string]>)
        : [],
    ),
  );
  const activeLocalhostConnectionRootPath =
    activeLocalhostConnectionResult?.connections?.find(
      (connection) => connection.id === activeLocalhostConnectionId,
    )?.rootPath ?? undefined;

  const componentRuntime = useMemo(() => {
    if (
      activeCanvasSourceType !== "localhost" ||
      !selectedComponentNodeId ||
      !selectedCodeLayerNode
    ) {
      return undefined;
    }
    const runtimeIdentity = selectedElement?.runtimeComponent;
    const name =
      selectedCodeLayerNode.dataAttributes[
        "data-agent-native-component"
      ]?.trim() ??
      runtimeIdentity?.name?.trim() ??
      selectedElement?.provenance?.component?.trim();
    if (!name) return undefined;

    const runtimeSource = selectedElement?.runtimeComponent;
    const sourceFile = runtimeSource?.sourceFile?.trim();
    const canWriteAuthoredJsx =
      runtimeIdentity?.writeCapability === "authored-jsx-literal";
    const local = canWriteAuthoredJsx
      ? selectedComponentLocalSource
      : undefined;

    return {
      name,
      nodeId: selectedComponentNodeId,
      selector:
        selectedElement?.runtimeSelector ??
        selectedElement?.selector ??
        selectedCodeLayerNode.selector,
      props: runtimeIdentity?.props?.length
        ? runtimeIdentity.props
        : extractProps(selectedCodeLayerNode),
      ...(selectedComponentLiteralProps
        ? { literalProps: selectedComponentLiteralProps }
        : {}),
      ...(runtimeIdentity?.componentId
        ? { componentId: runtimeIdentity.componentId }
        : {}),
      sourceLocation: sourceFile
        ? {
            filePath:
              selectedComponentLocalSource?.path ??
              projectRelativeSourcePath({
                sourceFile,
                rootPath: activeLocalhostConnectionRootPath,
              }) ??
              sourceFile,
            ...(runtimeSource?.name ? { exportName: runtimeSource.name } : {}),
          }
        : undefined,
      local,
    };
  }, [
    activeCanvasSourceType,
    activeLocalhostConnectionRootPath,
    selectedCodeLayerNode,
    selectedComponentNodeId,
    selectedElement,
    selectedComponentLiteralProps,
    selectedComponentLocalSource,
  ]);

  const requestLocalhostWrite = useCallback(
    (opts: {
      files: string[];
      onGranted: LocalhostWriteConsentPayload["onGranted"];
      onCancel?: () => void;
    }) => {
      if (!id || !canEditDesign) return;
      if (!activeLocalhostConnectionId) {
        toast.error(NO_LOCALHOST_CONNECTION_MESSAGE);
        return;
      }

      const rootPath =
        activeLocalhostConnectionRootPath ??
        activeScreenRouteSourceFile ??
        activeLocalhostConnectionId;

      setLocalhostConsentConnectionId(activeLocalhostConnectionId);
      setLocalhostWriteConsentPayload({
        rootPath,
        files: opts.files,
        onGranted: opts.onGranted,
        onCancel: opts.onCancel ?? (() => {}),
      });
      setLocalhostWriteConsentOpen(true);
    },
    [
      activeLocalhostConnectionId,
      activeLocalhostConnectionRootPath,
      activeScreenRouteSourceFile,
      canEditDesign,
      id,
    ],
  );
  requestLocalhostWriteRef.current = requestLocalhostWrite;

  const workbenchLocalhostConnections = useMemo(() => {
    const seen = new Map<
      string,
      { connectionId: string; label: string; rootPath?: string }
    >();
    for (const screen of overviewScreens) {
      if (screen.sourceType !== "localhost" || !screen.connectionId) continue;
      if (seen.has(screen.connectionId)) continue;
      let label = "Local app"; /* i18n-ignore */
      const screenUrl = screen.url ?? screen.previewUrl;
      if (screenUrl) {
        try {
          label = new URL(screenUrl).host || label;
        } catch {
          // Keep the fallback label for malformed screen URLs.
        }
      }
      const rootPath = activeLocalhostConnectionResult?.connections?.find(
        (connection) => connection.id === screen.connectionId,
      )?.rootPath;
      const rootName = rootPath
        ?.replace(/[\\/]+$/, "")
        .split(/[\\/]+/)
        .pop();
      seen.set(screen.connectionId, {
        connectionId: screen.connectionId,
        label: rootName || label,
        rootPath: rootPath ?? undefined,
      });
    }
    return [...seen.values()];
  }, [activeLocalhostConnectionResult?.connections, overviewScreens]);

  const [addLocalhostScreenOpen, setAddLocalhostScreenOpen] = useState(false);
  const handleOpenAddLocalhostScreen = useCallback(
    () => setAddLocalhostScreenOpen(true),
    [],
  );
  const addLocalhostScreenConnectionId =
    designSourceType === "localhost"
      ? activeLocalhostConnectionId ||
        workbenchLocalhostConnections[0]?.connectionId
      : undefined;
  const addLocalhostScreenFallbackPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const screen of overviewScreens) {
      if (screen.sourceType !== "localhost") continue;
      const screenUrl = screen.url ?? screen.previewUrl;
      if (!screenUrl) continue;
      try {
        const parsed = new URL(screenUrl);
        paths.add(`${parsed.pathname}${parsed.search}`);
      } catch {
        // Skip malformed screen URLs.
      }
    }
    return [...paths];
  }, [overviewScreens]);
  const addLocalhostScreenPosition = useMemo(
    () => nextLocalhostScreenPosition(canvasFrameGeometryById),
    [canvasFrameGeometryById],
  );
  const handleAddScreenAffordance = useCallback(() => {
    if (designSourceType === "localhost") {
      setAddLocalhostScreenOpen(true);
      return;
    }
    handleAddScreen();
  }, [designSourceType, handleAddScreen]);

  const handleWorkbenchLocalWriteConsent = useCallback(
    (connectionId: string, retry: () => void, filePath?: string) => {
      if (!id || !canEditDesign) return;
      setLocalhostConsentConnectionId(connectionId);
      setLocalhostWriteConsentPayload({
        rootPath:
          workbenchLocalhostConnections.find(
            (connection) => connection.connectionId === connectionId,
          )?.rootPath ??
          workbenchLocalhostConnections.find(
            (connection) => connection.connectionId === connectionId,
          )?.label ??
          connectionId,
        files: filePath ? [filePath] : [],
        onGranted: () => retry(),
        onCancel: () => {},
      });
      setLocalhostWriteConsentOpen(true);
    },
    [canEditDesign, id, workbenchLocalhostConnections],
  );

  const activeLocalhostRelPath = useMemo<string | undefined>(() => {
    if (!activeScreenIsLocalSource) return undefined;
    const sf = activeScreenRouteSourceFile;
    if (sf?.trim()) return sf.trim();
    const url = activeOverviewScreen?.url;
    if (!url) return undefined;
    try {
      const pathname = new URL(url).pathname.replace(/^\//, "");
      return pathname || undefined;
    } catch {
      return undefined;
    }
  }, [
    activeScreenIsLocalSource,
    activeScreenRouteSourceFile,
    activeOverviewScreen?.url,
  ]);

  const activeLocalhostWriteExtension =
    (activeLocalhostRelPath?.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "";
  const activeLocalhostRouteIsWritable =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_WRITE_EXTENSIONS.has(activeLocalhostWriteExtension);
  const activeLocalhostSourceSnapshot = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]
    : undefined;
  const currentLocalhostPreviewUrl = activeOverviewScreen?.url;
  const activeLocalhostSourceSnapshotHtml =
    activeLocalhostSourceSnapshot &&
    currentLocalhostPreviewUrl &&
    activeLocalhostSourceSnapshot.url === currentLocalhostPreviewUrl
      ? activeLocalhostSourceSnapshot.html
      : undefined;
  const activeLocalhostSourceWriteContent = resolveLocalhostSourceWriteContent({
    extension: activeLocalhostWriteExtension,
    persistedContent: activeContent,
    liveSnapshotHtml: activeLocalhostSourceSnapshotHtml,
  });
  const activeLocalhostRouteIsCompiledSource =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_COMPILED_SOURCE_EXTENSIONS.has(activeLocalhostWriteExtension);

  function stripEditorOnlyAttributes(html: string): string {
    if (typeof window === "undefined") return html;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const STRIP_ATTRS = [
        "data-agent-native-node-id",
        "data-code-layer-id",
      ] as const;
      for (const attr of STRIP_ATTRS) {
        doc.querySelectorAll(`[${attr}]`).forEach((el) => {
          el.removeAttribute(attr);
        });
      }
      const doctype = doc.doctype
        ? new XMLSerializer().serializeToString(doc.doctype) + "\n"
        : "";
      const htmlEl = doc.documentElement;
      return doctype + htmlEl.outerHTML;
    } catch {
      return html;
    }
  }

  const handleApplyToSource = useCallback(
    () =>
      runApplyToSource({
        activeLocalhostConnectionId,
        activeLocalhostRelPath,
        activeLocalhostSourceSnapshotHtml,
        canEditDesign,
        id,
        latestActiveContentRef,
        requestLocalhostWrite,
        setApplyToSourcePending,
        stripEditorOnlyAttributes,
        t,
      }),
    [
      id,
      canEditDesign,
      activeFile?.id,
      activeLocalhostConnectionId,
      activeLocalhostRelPath,
      activeLocalhostSourceSnapshotHtml,
      requestLocalhostWrite,
      t,
    ],
  );

  const fileIdSet = new Set(files.map((f) => f.id));
  const selectedDomLayerIds = selectedLayerIds.filter(
    (id) => !id.startsWith("__") && !fileIdSet.has(id),
  );
  const selectedActiveFileNodeIds = useMemo(
    () => getActiveFileSelectedNodeIds(activeContent),
    [activeContent, getActiveFileSelectedNodeIds],
  );
  const canOfferBooleanSubtract =
    canEditDesign &&
    Boolean(activeFile) &&
    selectedLayerIdsState.length === selectedActiveFileNodeIds.length &&
    selectedActiveFileNodeIds.length >= 2;
  const selectedDomLayerOwners = selectedDomLayerIds.map((layerId) =>
    codeLayerOwnerByNodeId.get(layerId),
  );
  const selectedRuntimeLayerOwners = selectedDomLayerOwners.filter(
    (owner) => owner?.runtimeOnly,
  );
  const selectedLayersUseCompatibleSourceBackend =
    selectedRuntimeLayerOwners.length === 0 ||
    (selectedRuntimeLayerOwners.length === selectedDomLayerIds.length &&
      selectedRuntimeLayerOwners.every(
        (owner) => owner?.fileId === selectedRuntimeLayerOwners[0]?.fileId,
      ));
  const canGroup =
    canEditDesign &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 1 &&
    selectedLayersUseCompatibleSourceBackend;
  const canUngroup =
    canEditDesign &&
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 1 &&
    selectedLayersUseCompatibleSourceBackend &&
    selectedDomLayerIds.every((id) => {
      const node = codeLayerOwnerByNodeIdRef.current.get(id)?.node;
      return Boolean(node) && node!.children.length > 0;
    });

  const handleScreenLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) => {
      const nextOrder = reorderCanonicalScreenStack({
        orderedIds: canonicalOverviewScreenIds,
        draggedIds: intent.draggedIds,
        targetId: intent.targetId,
        placement: intent.placement,
      });
      if (!nextOrder) return;

      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const after = cloneCanvasFrameGeometry(before);
      nextOrder.forEach((screenId, z) => {
        const screenIndex = overviewScreens.findIndex(
          (screen) => screen.id === screenId,
        );
        const screen = overviewScreens[screenIndex];
        if (!screen || screenIndex < 0) return;
        const fallback = getInitialFrameGeometry(screenIndex, {
          width: screen.width ?? 1280,
          height: screen.height ?? 2560,
        });
        after[screenId] = { ...fallback, ...before[screenId], z };
      });
      handleGeometryCommit(before, after);
    },
    [canonicalOverviewScreenIds, handleGeometryCommit, overviewScreens],
  );

  const canMoveLayer = useCallback(
    (intent: LayersPanelMoveIntent) =>
      runCanMoveLayer(
        {
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          liveScreenIds,
          lockedLayerIds,
          visualScreenFileIds,
        },
        intent,
      ),
    [
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      liveScreenIds,
      lockedLayerIds,
      visualScreenFileIds,
    ],
  );

  const handleLayerMoveToScreen = useCallback(
    (intent: LayersPanelMoveIntent, targetFileId: string) =>
      runLayerMoveToScreen(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          activeFile,
          applyFileContentUpdate,
          boardFileId,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          recordContentHistoryEntry,
          recordLocalContentHistoryEntry,
          runtimeStructureInsertRevisionRef,
          setExpandedLayerIds,
          setRuntimeStructureInsertRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
        },
        intent,
        targetFileId,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      boardFileId,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      t,
    ],
  );

  const handleLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) =>
      runLayerMove(
        {
          activeBreakpointWidthState,
          activeFileId,
          overviewSelectedScreenIds,
          contentUndoStackRef,
          contentHistorySelectionAfterRef,
          activeFile,
          applyLinkedComponentEdit,
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          canEditLiveScreen,
          canMoveLayer,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          handleLayerMoveToScreen,
          handleScreenLayerMove,
          recordContentHistoryEntry,
          recordLocalContentHistoryEntry,
          remapMotionTracksForClone,
          runtimeLayerSnapshotsById,
          runtimeStructureInsertRevisionRef,
          runtimeStructureMoveRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          setExpandedLayerIds,
          setRuntimeStructureDeleteRequest,
          setRuntimeStructureInsertRequest,
          setRuntimeStructureMoveRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
          visualScreenFileIds,
        },
        intent,
      ),
    [
      activeFileId,
      overviewSelectedScreenIds,
      activeBreakpointWidthState,
      activeFile?.id,
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      canEditLiveScreen,
      canMoveLayer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      handleLayerMoveToScreen,
      handleScreenLayerMove,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      remapMotionTracksForClone,
      runtimeLayerSnapshotsById,
      sendRuntimeLayerMoveSemanticHandoff,
      applyLinkedComponentEdit,
      setRuntimeStructureDeleteRequest,
      setRuntimeStructureInsertRequest,
      t,
      visualScreenFileIds,
    ],
  );

  const handleLayerHover = useCallback(
    (layerId: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (!owner) return;
      setHoveredElement(elementInfoFromCodeLayerNode(owner.node));
      setHoveredElementScreenId(owner.fileId);
    },
    [codeLayerOwnerByNodeId],
  );

  const handleLayerLeave = useCallback((_layerId: string) => {
    setHoveredElement(null);
    setHoveredElementScreenId(null);
  }, []);

  const hydrateRenderedLayerInfoForIds = useCallback((ids: string[]) => {
    const hydrationRevision = ++layerSelectionHydrationRevisionRef.current;
    const renderedRevision = renderedElementInfoRevisionRef.current;
    const breakpointWidth = activeBreakpointWidthStateRef.current;
    const ownerByNodeId = codeLayerOwnerByNodeIdRef.current;
    const currentBoardFileId = boardFileIdRef.current;
    type RenderedLayerOwner = {
      fileId: string;
      node: CodeLayerNode;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    };
    const ownersToMeasure = new Map<string, RenderedLayerOwner>();
    for (const layerId of ids) {
      const owner = ownerByNodeId.get(layerId);
      if (!owner || owner.runtimeOnly) continue;
      ownersToMeasure.set(layerId, owner);
      for (const siblingId of findCodeLayerSiblingOrder(owner.tree, layerId)
        ?.siblingIds ?? []) {
        const siblingOwner = ownerByNodeId.get(siblingId);
        if (
          siblingOwner &&
          siblingOwner.fileId === owner.fileId &&
          !siblingOwner.runtimeOnly
        ) {
          ownersToMeasure.set(siblingId, siblingOwner);
        }
      }
      const pendingDescendants = [...owner.node.children];
      while (pendingDescendants.length > 0) {
        const descendantId = pendingDescendants.pop()!;
        const descendantOwner = ownerByNodeId.get(descendantId);
        if (
          !descendantOwner ||
          descendantOwner.fileId !== owner.fileId ||
          descendantOwner.runtimeOnly
        ) {
          continue;
        }
        ownersToMeasure.set(descendantId, descendantOwner);
        pendingDescendants.push(...descendantOwner.node.children);
      }
    }
    const cache = (
      layerId: string,
      owner: RenderedLayerOwner,
      measured: ElementInfo,
    ) => {
      const currentOwner = codeLayerOwnerByNodeIdRef.current.get(layerId);
      if (
        layerSelectionHydrationRevisionRef.current !== hydrationRevision ||
        renderedElementInfoRevisionRef.current !== renderedRevision ||
        activeBreakpointWidthStateRef.current !== breakpointWidth ||
        currentOwner?.fileId !== owner.fileId ||
        currentOwner?.node.id !== owner.node.id
      ) {
        return;
      }
      const stableId = owner.node.dataAttributes["data-agent-native-node-id"];
      renderedElementInfoByLayerKeyRef.current.set(
        `${owner.fileId}:${owner.node.id}`,
        measured,
      );
      if (stableId) {
        renderedElementInfoByLayerKeyRef.current.set(
          `${owner.fileId}:${stableId}`,
          measured,
        );
      }
      if (selectedLayerIdsStateRef.current.includes(layerId)) {
        setSelectedElement((current) => {
          if (!current) return measured;
          const currentId = current.sourceId ?? current.runtimeSourceId;
          const ownerId =
            owner.node.dataAttributes["data-agent-native-node-id"] ??
            bridgeSourceIdForCodeLayerNode(owner.node);
          return currentId === ownerId
            ? {
                ...measured,
                ...current,
                sourceLayerIdentity: measured.sourceLayerIdentity,
                boundingRect: measured.boundingRect,
                parentBoundingRect:
                  measured.parentBoundingRect ?? current.parentBoundingRect,
                computedStyles: {
                  ...measured.computedStyles,
                  ...current.computedStyles,
                },
              }
            : current;
        });
      }
      if (
        measured.boundingRect.width <= 0 ||
        measured.boundingRect.height <= 0
      ) {
        return;
      }
    };
    for (const [layerId, owner] of ownersToMeasure) {
      const synchronouslyMeasured = readRenderedLayerInfo(
        owner,
        breakpointWidth,
        currentBoardFileId,
      );
      if (synchronouslyMeasured) {
        cache(layerId, owner, synchronouslyMeasured);
        continue;
      }
      void requestSelectionMeasurement({
        targetWindows: () =>
          designPreviewWindowsForScreen(
            owner.fileId,
            breakpointWidth,
            currentBoardFileId,
          ),
        screenId: owner.fileId,
        selector: preferredCodeLayerSelector(owner.node),
      }).then((measured) => {
        if (!measured) return;
        cache(layerId, owner, measured);
      });
    }
  }, []);
  rehydrateRenderedElementInfoRef.current = () =>
    hydrateRenderedLayerInfoForIds(selectedLayerIdsStateRef.current);

  const handleLayerSelectionChange = useCallback(
    (
      ids: string[],
      _intent: {
        additive: boolean;
        currentSelectedIds?: string[];
        id: string;
        range: boolean;
      },
    ) => {
      recordSelectionHistoryAroundChange(() => {
        const effectiveIds = runLayerSelectionChange(
          {
            applyFileContentUpdate,
            activeFile,
            clearPendingOverviewLayerSelectionTimer,
            codeLayerOwnerByNodeId,
            effectiveCodeLayerState,
            files,
            getScreenContent,
            focusDesignInspectorForSelection,
            overviewSelectedScreenIds,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            selectedElement,
            setMode,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            setViewMode,
            viewModeRef,
          },
          ids,
          _intent,
        );
        hydrateRenderedLayerInfoForIds(effectiveIds);
        queueMicrotask(() => hydrateRenderedLayerInfoForIds(effectiveIds));
      });
    },
    [
      activeFile?.id,
      activeFileId,
      applyFileContentUpdate,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      focusDesignInspectorForSelection,
      getScreenContent,
      activeBreakpointWidthStateRef,
      overviewSelectedScreenIds,
      recordSelectionHistoryAroundChange,
      selectedElement,
      layerSelectionHydrationRevisionRef,
      hydrateRenderedLayerInfoForIds,
    ],
  );

  const handleLayerMarqueeSelectionChange = useCallback(
    (
      selection: CanvasLayerMarqueeSelection[],
      intent: ElementSelectionIntent,
    ) => {
      recordMarqueeSelectionHistoryAroundChange(() => {
        runLayerMarqueeSelectionChange(
          {
            clearPendingOverviewLayerSelectionTimer,
            focusDesignInspectorForSelection,
            getCodeLayerProjectionForScreen,
            hasActiveSelectionRef,
            lastMarqueeSelectionSignatureRef,
            pendingOverviewLayerSelectionRef,
            pendingOverviewScreenSelectionRef,
            renderedElementInfoByLayerKeyRef,
            setActiveFileId,
            setActiveTool,
            setCreatedOverviewLayerSelection,
            setMode,
            setOverviewClearSelectionRequest,
            setOverviewSelectedScreenIds,
            setSelectedElement,
            setSelectedLayerIdsState,
            viewModeRef,
          },
          selection,
          intent,
        );
      }, intent);
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      recordMarqueeSelectionHistoryAroundChange,
    ],
  );

  const handleScreenElementMarqueeSelect = useCallback(
    (
      screenId: string,
      infos: ElementInfo[],
      intent?: ElementSelectionIntent,
    ) => {
      handleLayerMarqueeSelectionChange(
        infos.map((info) => ({ screenId, info })),
        {
          additive: resolveMarqueeAdditive(intent),
          range: Boolean(intent?.range || intent?.shiftKey),
          source: "marquee",
          final: intent?.final === true,
          shiftKey: Boolean(intent?.shiftKey),
          metaKey: Boolean(intent?.metaKey),
          ctrlKey: Boolean(intent?.ctrlKey),
        },
      );
    },
    [handleLayerMarqueeSelectionChange],
  );

  const handleElementMarqueeSelect = useCallback(
    (infos: ElementInfo[], intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (!screenId) return;
      handleScreenElementMarqueeSelect(screenId, infos, intent);
    },
    [activeFile?.id, activeFileId, handleScreenElementMarqueeSelect],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (owner && canEditLiveScreen(owner.fileId) && !canEditDesign) {
        runtimeLayerRenameRevisionRef.current += 1;
        setRuntimeLayerRenameRequest({
          requestId: runtimeLayerRenameRevisionRef.current,
          screenId: owner.fileId,
          layerId,
          selector: preferredCodeLayerSelector(owner.node),
          sourceId: bridgeSourceIdForCodeLayerNode(owner.node),
          routePath: liveRoutePathsByScreenIdRef.current[owner.fileId],
          name,
        });
        return;
      }
      runLayerRename(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          getScreenContent,
          id,
          overviewScreens,
          queryClient,
          renameScreenMutation,
          serverFiles,
          setSelectedLayerIdsState,
          t,
        },
        layerId,
        name,
      );
    },
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canEditLiveScreen,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      getScreenContent,
      id,
      liveScreenSnapshotsById,
      overviewScreens,
      queryClient,
      renameScreenMutation,
      serverFiles,
      setRuntimeLayerRenameRequest,
      syncLiveScreenSnapshotPreview,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string, locked: boolean) =>
      runToggleLayerLocked(
        {
          activeFile,
          applyFileContentUpdate,
          applyLayerStatePreview,
          canEditDesign,
          canEditLiveScreens: editableLiveScreenIds,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          liveScreenSnapshotsById,
          lockedLayerIds,
          overviewScreens,
          recordPendingLiveLayerStateEdit,
          sendRuntimeLayerStateSemanticHandoff,
          syncLiveScreenSnapshotPreview,
          updateLiveScreenSnapshotContent,
        },
        layerId,
        locked,
      ),
    [
      activeFile?.id,
      applyLayerStatePreview,
      applyFileContentUpdate,
      canEditDesign,
      editableLiveScreenIds,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      liveScreenSnapshotsById,
      lockedLayerIds,
      overviewScreens,
      recordPendingLiveLayerStateEdit,
      sendRuntimeLayerStateSemanticHandoff,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const handleToggleLayerHidden = useCallback(
    (layerId: string, hidden: boolean) =>
      runToggleLayerHidden(
        {
          activeFile,
          applyFileContentUpdate,
          applyLayerStatePreview,
          canEditDesign,
          canEditLiveScreens: editableLiveScreenIds,
          codeLayerOwnerByNodeId,
          designSourceType,
          files,
          getFreshActiveContent,
          hiddenLayerIds,
          liveScreenSnapshotsById,
          overviewScreens,
          recordPendingLiveLayerStateEdit,
          sendRuntimeLayerStateSemanticHandoff,
          syncLiveScreenSnapshotPreview,
          updateLiveScreenSnapshotContent,
        },
        layerId,
        hidden,
      ),
    [
      activeFile?.id,
      applyLayerStatePreview,
      applyFileContentUpdate,
      canEditDesign,
      editableLiveScreenIds,
      codeLayerOwnerByNodeId,
      designSourceType,
      files,
      getFreshActiveContent,
      hiddenLayerIds,
      liveScreenSnapshotsById,
      overviewScreens,
      recordPendingLiveLayerStateEdit,
      sendRuntimeLayerStateSemanticHandoff,
      syncLiveScreenSnapshotPreview,
      updateLiveScreenSnapshotContent,
    ],
  );

  const layerPanelHandlers = {
    onRename: handleLayerRename,
    onToggleLocked: handleToggleLayerLocked,
    onToggleHidden: handleToggleLayerHidden,
    onHoverLayer: handleLayerHover,
    onMoveLayer: handleLayerMove,
    canMoveLayer,
    onSelectionChange: handleLayerSelectionChange,
    onCopyLayer: handleCopySelection,
    onDuplicateLayer: handleDuplicateSelection,
    onDeleteLayer: handleDeleteSelection,
    onGroupSelection: handleGroupSelection,
    onUngroupSelection: handleUngroupSelection,
    onReorderLayer: changeSelectedZIndex,
    onPasteToReplace: handlePasteToReplace,
    onFrameSelection: handleFrameSelection,
    onFlipHorizontal: handleFlipHorizontal,
    onFlipVertical: handleFlipVertical,
  };
  const layerPanelHandlersRef = useRef(layerPanelHandlers);
  layerPanelHandlersRef.current = layerPanelHandlers;
  const layerPanelCallbacks = useMemo(() => {
    const latest = () => layerPanelHandlersRef.current;
    return {
      onRename: (...args: Parameters<typeof handleLayerRename>) =>
        latest().onRename(...args),
      onToggleLocked: (...args: Parameters<typeof handleToggleLayerLocked>) =>
        latest().onToggleLocked(...args),
      onToggleHidden: (...args: Parameters<typeof handleToggleLayerHidden>) =>
        latest().onToggleHidden(...args),
      onHoverLayer: (...args: Parameters<typeof handleLayerHover>) =>
        latest().onHoverLayer(...args),
      onMoveLayer: (...args: Parameters<typeof handleLayerMove>) =>
        latest().onMoveLayer(...args),
      canMoveLayer: (...args: Parameters<typeof canMoveLayer>) =>
        latest().canMoveLayer(...args),
      onSelectionChange: (
        ...args: Parameters<typeof handleLayerSelectionChange>
      ) => latest().onSelectionChange(...args),
      onCopyLayer: () => latest().onCopyLayer(),
      onDuplicateLayer: () => latest().onDuplicateLayer(),
      onDeleteLayer: () => latest().onDeleteLayer(),
      onGroupSelection: () => latest().onGroupSelection(),
      onUngroupSelection: () => latest().onUngroupSelection(),
      onReorderLayer: (
        _ids: string[],
        direction: Parameters<typeof changeSelectedZIndex>[0],
      ) => latest().onReorderLayer(direction),
      onPasteToReplace: () => latest().onPasteToReplace(),
      onFrameSelection: () => latest().onFrameSelection(),
      onFlipHorizontal: () => latest().onFlipHorizontal(),
      onFlipVertical: () => latest().onFlipVertical(),
    };
  }, []);

  const handleToggleHiddenForSelection = useCallback(() => {
    if (!canEditDesign && !canEditLiveScreens) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextHidden = !activeLayerHidden;
    targets.forEach((layerId) => handleToggleLayerHidden(layerId, nextHidden));
  }, [
    activeLayerHidden,
    canEditDesign,
    canEditLiveScreens,
    handleToggleLayerHidden,
    selectedLayerIds,
  ]);

  const handleToggleLockedForSelection = useCallback(() => {
    if (!canEditDesign && !canEditSelectedLiveLayer) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextLocked = !activeLayerLocked;
    targets.forEach((layerId) => handleToggleLayerLocked(layerId, nextLocked));
  }, [
    activeLayerLocked,
    canEditDesign,
    canEditSelectedLiveLayer,
    handleToggleLayerLocked,
    selectedLayerIds,
  ]);

  const resolveAssetScreenPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      const container = canvasContainerRef.current;
      if (!container) return null;

      if (viewMode === "single") {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        return resolveScreenDropPoint({
          clientX,
          clientY,
          screenId: activeFile?.id,
          iframeRect: iframe?.getBoundingClientRect(),
          zoomPercent: zoom,
        });
      }

      const frameShell = document
        .elementsFromPoint(clientX, clientY)
        .map((element) => element.closest<HTMLElement>("[data-frame-id]"))
        .find((element): element is HTMLElement => Boolean(element));
      const screenId = frameShell?.dataset.frameId;
      const iframe = Array.from(
        frameShell?.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ) ?? [],
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      });
      const liveOverviewZoom = readOverviewZoomPercentFromTransform(
        container.querySelector<HTMLElement>("[data-multi-screen-canvas-world]")
          ?.style.transform,
        overviewCanvasZoom,
      );
      return resolveScreenDropPoint({
        clientX,
        clientY,
        screenId,
        iframeRect: iframe?.getBoundingClientRect(),
        zoomPercent: liveOverviewZoom,
      });
    },
    [activeFile?.id, overviewCanvasZoom, viewMode, zoom],
  );

  const getContextCanvasPoint = useCallback(
    ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      if (viewMode === "single") {
        const iframe = canvasContainerRef.current?.querySelector<HTMLElement>(
          "[data-design-preview-iframe]",
        );
        const point = computeIframeLocalCanvasPoint({
          clientX,
          clientY,
          iframeRect: iframe?.getBoundingClientRect() ?? null,
          zoomPercent: zoom,
        });
        if (point) return point;
      }
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 120, y: 120 };
      return {
        x: Math.max(0, clientX - rect.left),
        y: Math.max(0, clientY - rect.top),
      };
    },
    [zoom, viewMode],
  );

  const zoomLabel = `${Math.round(zoom)}%`;
  const [openZoomControl, setOpenZoomControl] = useState<
    "toolbar" | "inspector" | null
  >(null);
  const [zoomInputValue, setZoomInputValue] = useState(zoomLabel);
  useEffect(() => {
    if (!openZoomControl) setZoomInputValue(zoomLabel);
  }, [zoomLabel, openZoomControl]);
  const commitZoomInput = useCallback(() => {
    const next = Number(zoomInputValue.replace("%", "").trim());
    if (!Number.isFinite(next)) {
      setZoomInputValue(zoomLabel);
      return;
    }
    suppressOverviewPopForExplicitZoomRef.current = true;
    setZoom(clampZoom(next));
    setOpenZoomControl(null);
  }, [setZoom, zoomInputValue, zoomLabel]);

  const handleTokensApplied = useCallback(
    (resolvedCssVars: Record<string, string>) => {
      if (!canEditDesign || !id) return;
      setTweakSelections((prev) => ({
        ...prev,
        ...resolvedCssVars,
      }));
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        let currentData: Record<string, unknown> = {};
        if (typeof old.data === "string" && old.data) {
          try {
            const parsed = JSON.parse(old.data);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              currentData = parsed;
            }
          } catch {
            currentData = {};
          }
        }
        const currentSelections =
          currentData.tweakSelections &&
          typeof currentData.tweakSelections === "object" &&
          !Array.isArray(currentData.tweakSelections)
            ? currentData.tweakSelections
            : {};
        return {
          ...old,
          data: JSON.stringify({
            ...currentData,
            tweakSelections: {
              ...currentSelections,
              ...resolvedCssVars,
            },
          }),
        };
      });
    },
    [canEditDesign, id, queryClient],
  );

  type OverviewScreenRenderer = NonNullable<
    React.ComponentProps<typeof MultiScreenCanvas>["renderScreenContent"]
  >;
  type OverviewBreakpointRenderer = NonNullable<
    React.ComponentProps<typeof MultiScreenCanvas>["renderBreakpointContent"]
  >;
  type OverviewScreenRendererArgs = Parameters<OverviewScreenRenderer>;
  type OverviewBreakpointRendererArgs = Parameters<OverviewBreakpointRenderer>;
  const renderEditableScreenContent = useCallback(
    (
      screen: OverviewScreenRendererArgs[0],
      metadata: OverviewScreenRendererArgs[1],
      geometry: OverviewScreenRendererArgs[2],
      breakpointFrame?: OverviewBreakpointRendererArgs[2],
      renderOptions?: ScreenContentRenderOptions,
    ) => {
      const breakpointWidthPx = breakpointFrame?.widthPx;
      const screenIsActive =
        screen.id === activeFile?.id &&
        (breakpointWidthPx === undefined
          ? activeBreakpointWidthState === undefined
          : activeBreakpointWidthState === breakpointWidthPx);
      const screenSelectedLayerGroups =
        selectedLayerSelectorGroupsByScreen[screen.id] ?? NO_SELECTOR_GROUPS;
      const screenOwnsSelection =
        selectedElementScreenId === screen.id ||
        screenSelectedLayerGroups.length > 0;
      const screenContent = getScreenContent(screen.id);
      const screenSourceType = resolveOverviewScreenSourceType(
        screen,
        metadata.source ?? designSourceType,
      );
      const screenSnapshotOnly = Boolean(
        isLiveCanvasShareLink &&
        designAccessRole &&
        designAccessRole !== "owner" &&
        screenSourceType === "localhost",
      );
      const screenBridgeUrl = screenSnapshotOnly ? undefined : screen.bridgeUrl;
      const screenPreviewUrl = screen.url ?? screen.previewUrl;
      const currentLiveRoutePath =
        liveRoutePathsByScreenIdRef.current[screen.id];
      const screenPreviewToken =
        effectivePreviewTokensByScreenId[screen.id] ??
        ("previewToken" in screen && typeof screen.previewToken === "string"
          ? screen.previewToken
          : (publicVisualEditPreviewTokenQuery.data?.connections?.[
              screen.connectionId ?? ""
            ]?.previewToken ??
            (screen.connectionId === publicVisualEditConnectionId
              ? publicVisualEditPreviewTokenQuery.data?.previewToken
              : undefined)));
      const screenLiveEditCapability =
        effectiveLiveEditCapabilitiesByScreenId[screen.id] ??
        publicVisualEditPreviewTokenQuery.data?.connections?.[
          screen.connectionId ?? ""
        ]?.liveEditCapability ??
        (screen.connectionId === publicVisualEditConnectionId
          ? publicVisualEditPreviewTokenQuery.data?.liveEditCapability
          : undefined);
      const screenLiveEditRegistrationCapability =
        effectiveLiveEditRegistrationCapabilitiesByScreenId[screen.id] ??
        publicVisualEditPreviewTokenQuery.data?.connections?.[
          screen.connectionId ?? ""
        ]?.liveEditRegistrationCapability ??
        (screen.connectionId === publicVisualEditConnectionId
          ? publicVisualEditPreviewTokenQuery.data
              ?.liveEditRegistrationCapability
          : undefined);
      const screenSnapshot = liveScreenSnapshotsById[screen.id]?.html;
      const useRuntimeReplacement = shouldUseOverviewRuntimeReplacement({
        sourceType: screenSourceType,
        externalSnapshotHtml: screenSnapshot,
      });
      const runtimeReplacementKey = useRuntimeReplacement
        ? getOverviewScreenRuntimeReplacementKey({
            screenId: screen.id,
            updatedAt: screen.updatedAt,
            content: screenContent,
          })
        : undefined;
      const baseScreenContentKey = getOverviewScreenContentKey({
        screenId: screen.id,
        screenIsActive,
        contentRenderRevision,
        updatedAt: screen.updatedAt,
        content: screenContent,
        useRuntimeReplacement,
      });
      const screenContentKey =
        breakpointWidthPx === undefined
          ? baseScreenContentKey
          : `${baseScreenContentKey}::breakpoint-${breakpointWidthPx}`;
      const activateResponsiveScope = () => {
        if (breakpointWidthPx === undefined) return;
        handleBreakpointBarSelect(breakpointWidthPx);
      };

      return (
        <DesignCanvas
          layoutGridStep={layoutGrids[screen.id]?.size ?? 1}
          content={screenContent}
          contentKey={screenContentKey}
          runtimeReplacementContent={
            useRuntimeReplacement ? screenContent : undefined
          }
          runtimeReplacementKey={runtimeReplacementKey}
          styleRevertRequest={
            pendingVisualStyleRevertRequest
              ? {
                  requestId: pendingVisualStyleRevertRequest.requestId,
                  patches: pendingVisualStyleRevertRequest.patches.filter(
                    (patch) => patch.screenId === screen.id,
                  ),
                }
              : null
          }
          pendingStylePreviewPatches={pendingVisualStyleEdits}
          styleBaselineResetRequest={pendingVisualStyleBaselineResetRequest}
          textRevertRequest={
            pendingTextRevertRequest
              ? {
                  requestId: pendingTextRevertRequest.requestId,
                  patches: pendingTextRevertRequest.patches.filter(
                    (patch) => patch.screenId === screen.id,
                  ),
                }
              : null
          }
          structureAckRequest={
            pendingStructureAckRequest
              ? {
                  requestId: pendingStructureAckRequest.requestId,
                  acks: pendingStructureAckRequest.acks.filter(
                    (ack) => ack.screenId === screen.id,
                  ),
                }
              : null
          }
          runtimeStructureMoveRequest={
            runtimeStructureMoveRequest?.screenId === screen.id
              ? runtimeStructureMoveRequest
              : null
          }
          runtimeStructureInsertRequest={
            runtimeStructureInsertRequest?.screenId === screen.id
              ? runtimeStructureInsertRequest
              : null
          }
          runtimeStructureDeleteRequest={
            runtimeStructureDeleteRequest?.screenId === screen.id
              ? runtimeStructureDeleteRequest
              : null
          }
          runtimeStructureRollbackRequest={
            runtimeStructureRollbackRequest?.screenId === screen.id
              ? runtimeStructureRollbackRequest
              : null
          }
          runtimeStructureTargetTransactionId={
            runtimeStructureDeleteRequest?.rollbackScreenId === screen.id
              ? runtimeStructureDeleteRequest.transactionId
              : null
          }
          runtimeLayerRenameRequest={runtimeLayerRenameForScreen(screen.id)}
          runtimeLayerSnapshotRequest={runtimeLayerSnapshotRequest}
          onRuntimeStructureInsertRejected={
            handleRuntimeStructureInsertRejected
          }
          onRuntimeStructureInsertApplied={handleRuntimeStructureInsertApplied}
          onRuntimeStructureDeleteApplied={handleRuntimeStructureDeleteApplied}
          onRuntimeStructureDeleteRejected={
            handleRuntimeStructureDeleteRejected
          }
          onRuntimeStructureRollbackResult={
            handleRuntimeStructureRollbackResult
          }
          onRuntimeLayerRenameApplied={(details) =>
            handleRuntimeLayerRenameApplied(screen.id, details)
          }
          runtimeVerificationRequest={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? {
                  requestId: runtimeStructureVerificationRequest.requestId,
                }
              : null
          }
          screenId={screen.id}
          previewUrlOverride={
            !screenSnapshotOnly && screenSourceType === "localhost"
              ? previewUrlAtLiveRoute(screenPreviewUrl, currentLiveRoutePath)
              : undefined
          }
          previewFrameId={
            breakpointWidthPx === undefined
              ? undefined
              : getBreakpointIframeId(screen.id, breakpointWidthPx)
          }
          zoom={100}
          deviceFrame="none"
          sourceType={screenSourceType}
          bridgeUrl={screenBridgeUrl}
          connectionId={screenSnapshotOnly ? undefined : screen.connectionId}
          nativePreviewActive={screenIsActive}
          sharedSnapshotPollActive={screenIsActive}
          previewToken={screenSnapshotOnly ? undefined : screenPreviewToken}
          liveEditCapability={
            screenSnapshotOnly ? undefined : screenLiveEditCapability
          }
          liveEditRegistrationCapability={
            screenSnapshotOnly
              ? undefined
              : screenLiveEditRegistrationCapability
          }
          onPreviewTokenChange={
            screenSnapshotOnly ? undefined : handleEffectivePreviewTokenChange
          }
          onLiveEditCapabilityChange={
            screenSnapshotOnly ? undefined : handleLiveEditCapabilityChange
          }
          onLiveEditRegistrationCapabilityChange={
            screenSnapshotOnly
              ? undefined
              : handleLiveEditRegistrationCapabilityChange
          }
          onRoutePathChange={
            screenSnapshotOnly ? undefined : handleLiveRoutePathChange
          }
          publicVisualEdit={!screenSnapshotOnly && publicVisualEdit}
          externalSnapshotHtml={screenSnapshotOnly ? undefined : screenSnapshot}
          snapshotOnly={screenSnapshotOnly}
          blockPreviewInteraction={
            remoteVisualEditPending &&
            (mode === "interact" || overviewInteractScreenId === screen.id)
          }
          onBootStart={renderOptions?.onBootStart}
          onBootReady={renderOptions?.onBootReady}
          onExternalContentSnapshot={
            screenSnapshotOnly
              ? undefined
              : (snapshot) =>
                  handleScreenExternalContentSnapshot(screen.id, snapshot)
          }
          onRuntimeLayerSnapshot={
            shouldUseRuntimeLayerProjection({
              screen,
              fallbackSourceType: designSourceType,
              content: screenContent,
            })
              ? getRuntimeLayerSnapshotCallback(screen.id)
              : undefined
          }
          onReserveVisualEditSnapshot={
            !screenSnapshotOnly &&
            canEditDesign &&
            liveCollaborationEnabled &&
            id &&
            screenSourceType === "localhost"
              ? reserveVisualEditSnapshot
              : undefined
          }
          onScreenRootComputedStyles={getScreenRootComputedStylesCallback(
            breakpointWidthPx === undefined
              ? screen.id
              : getBreakpointIframeId(screen.id, breakpointWidthPx),
          )}
          onRuntimeVerificationSnapshot={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? getRuntimeVerificationSnapshotCallback(screen.id)
              : undefined
          }
          fusionUrl={designFusionUrl}
          onComponentSourceJump={handleComponentSourceJump}
          motionTracks={screenIsActive ? motionTracksWire : NO_MOTION_TRACKS}
          motionDefaultEase={motionDefaultEase}
          motionDurationMs={motionDurationMs}
          gradientEditTarget={
            inScreenGradientEditTarget?.screenId === screen.id
              ? inScreenGradientEditTarget
              : null
          }
          onGradientEditChange={handleInScreenGradientEditChange}
          statePreviewTarget={
            statePreviewTarget?.screenId === screen.id
              ? statePreviewTarget
              : null
          }
          embeddedFrame={
            breakpointFrame
              ? {
                  viewportWidth: breakpointFrame.widthPx,
                  viewportHeight: breakpointFrame.viewportHeight,
                  displayWidth: breakpointFrame.displayWidth,
                  displayHeight: breakpointFrame.displayHeight,
                }
              : getEmbeddedFrame(screen.id, geometry.width, geometry.height)
          }
          fitRootBodyToFrame={metadata.heightMode !== "hug"}
          editorChromeScaleX={overviewCanvasZoom / 100}
          editorChromeScaleY={overviewCanvasZoom / 100}
          editMode={
            screenSnapshotOnly ||
            (mode === "edit" && overviewInteractScreenId !== screen.id)
          }
          interactMode={
            !screenSnapshotOnly &&
            (mode === "interact" || overviewInteractScreenId === screen.id)
          }
          readOnly={!canEditDesign && !canEditLiveScreen(screen.id)}
          scaleMode={screenIsActive && activeTool === "scale"}
          handToolActive={activeTool === "hand"}
          spacePanActive={spacePanActive}
          clearSelectionRequest={overviewClearSelectionRequest}
          registerRuntimeBridge={screenIsActive}
          selectedSelector={screenOwnsSelection ? selectedCanvasSelector : null}
          selectedSelectorCandidates={
            screenOwnsSelection
              ? selectedCanvasSelectorCandidates
              : NO_SELECTORS
          }
          selectedSelectorGroups={screenSelectedLayerGroups}
          passiveSelectionStyle={
            screen.breakpointWidths?.length && !screenIsActive
              ? "soft"
              : "default"
          }
          hoveredSelector={
            hoveredElementScreenId === screen.id ? hoveredCanvasSelector : null
          }
          hoveredSelectorCandidates={
            hoveredElementScreenId === screen.id
              ? hoveredCanvasSelectorCandidates
              : NO_SELECTORS
          }
          lockedSelectors={getLayerSelectorsForFile(screen.id, lockedLayerIds)}
          hiddenSelectors={getLayerSelectorsForFile(screen.id, hiddenLayerIds)}
          onElementSelect={(info, intent) => {
            activateResponsiveScope();
            handleIframeElementSelect(screen.id, info, intent, {
              breakpointWidthPx,
            });
          }}
          onElementMarqueeSelect={(infos, intent) => {
            activateResponsiveScope();
            handleScreenElementMarqueeSelect(screen.id, infos, intent);
          }}
          onElementHover={(info) => handleScreenElementHover(screen.id, info)}
          onEditorDragStateChange={handleEditorDragStateChange}
          onClearSelection={() => {
            activateResponsiveScope();
            handleScreenElementClear(screen.id, breakpointWidthPx);
          }}
          onIframeHotkey={handleIframeHotkey}
          onFigmaClipboardPaste={handleCanvasFigmaClipboardPaste}
          onImagePaste={handleCanvasImagePaste}
          onIframeContextMenu={(payload) =>
            handleIframeContextMenu({ ...payload, breakpointWidthPx })
          }
          onVisualStyleChange={(selector, styles, info, metadata) => {
            activateResponsiveScope();
            handleScreenVisualStyleChange(
              screen.id,
              selector,
              styles,
              info,
              metadata,
            );
          }}
          onVisualStyleBatchChange={(changes) => {
            activateResponsiveScope();
            return handleKScaleStyleBatchChange(screen.id, changes);
          }}
          onVisualStructureChange={(
            selector,
            anchorSelector,
            placement,
            info,
            details,
          ) => {
            activateResponsiveScope();
            return handleScreenVisualStructureChange(
              screen.id,
              selector,
              anchorSelector,
              placement,
              info,
              details,
            );
          }}
          onVisualGridGroupChange={(moves) => {
            activateResponsiveScope();
            return handleScreenGridGroupChange(screen.id, moves);
          }}
          onVisualDuplicateChange={(selector, cloneHtml, info, details) => {
            activateResponsiveScope();
            return handleScreenVisualDuplicateChange(
              screen.id,
              selector,
              cloneHtml,
              info,
              details,
            );
          }}
          onTextContentChange={(selector, value, info, details) => {
            activateResponsiveScope();
            handleScreenTextContentChange(
              screen.id,
              selector,
              value,
              info,
              details,
            );
          }}
          onTextEditingStateChange={(state) =>
            handleTextEditingStateChangeForScreen(screen.id, state)
          }
          onElementDblClickText={(info) =>
            handleScreenElementDblClickText(screen.id, info)
          }
          tweakValues={cssVarValues}
          drawMode={false}
          pinMode={screenIsActive && pinMode}
          commentPinsHidden={commentsHidden || !screenIsActive}
          onExitPinMode={handleExitReviewCommentMode}
          designId={id}
          reviewCanPost={canCommentDesign}
          reviewCanResolve={canEditDesign}
          reviewCurrentUserEmail={session?.email}
          reviewFocusRequest={reviewFocusRequest}
          onDispatchCommentToAgent={handleDispatchCommentToAgent}
          onSendThreadToAgent={handleSendReviewThreadToAgent}
          reviewSendingThreadId={reviewSendingThreadId}
          designTitle={design?.title}
          commentContextId={`${id}:${screen.id}`}
          commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(screen.filename)}`}
          repromptDraftRequest={
            repromptDraftRequest?.fileId === screen.id
              ? repromptDraftRequest
              : null
          }
          nodeRewriteCanvasTarget={screenIsActive}
          onRepromptDraftConsumed={handleRepromptDraftConsumed}
        />
      );
    },
    [
      activeFile?.id,
      activeBreakpointWidthState,
      getScreenContent,
      handleBreakpointBarSelect,
      designSourceType,
      liveScreenSnapshotsById,
      pendingVisualStyleEdits,
      pendingVisualStyleRevertRequest,
      pendingVisualStyleBaselineResetRequest,
      pendingTextRevertRequest,
      pendingStructureAckRequest,
      runtimeStructureMoveRequest,
      runtimeStructureInsertRequest,
      runtimeStructureDeleteRequest,
      runtimeStructureRollbackRequest,
      handleRuntimeStructureInsertRejected,
      handleRuntimeStructureDeleteApplied,
      handleRuntimeStructureInsertApplied,
      handleRuntimeStructureDeleteRejected,
      handleRuntimeStructureRollbackResult,
      handleLiveRoutePathChange,
      liveRoutePathsByScreenId,
      handleRuntimeStructureDeleteApplied,
      runtimeStructureVerificationRequest,
      contentRenderRevision,
      handleScreenExternalContentSnapshot,
      getRuntimeLayerSnapshotCallback,
      getScreenRootComputedStylesCallback,
      getRuntimeVerificationSnapshotCallback,
      designFusionUrl,
      handleComponentSourceJump,
      motionTracksWire,
      motionDefaultEase,
      motionDurationMs,
      inScreenGradientEditTarget,
      handleInScreenGradientEditChange,
      statePreviewTarget,
      getEmbeddedFrame,
      overviewCanvasZoom,
      mode,
      overviewInteractScreenId,
      remoteVisualEditPending,
      isVisualEditSurface,
      isLiveCanvasShareLink,
      publicVisualEditConnectionId,
      publicVisualEditPreviewTokenQuery.data?.previewToken,
      publicVisualEditPreviewTokenQuery.data?.connections,
      designAccessRole,
      scheduleVisualEditSnapshotPublication,
      canEditDesign,
      canEditLiveScreen,
      effectivePreviewTokensByScreenId,
      effectiveLiveEditCapabilitiesByScreenId,
      handleEffectivePreviewTokenChange,
      handleLiveEditCapabilityChange,
      canCommentDesign,
      activeTool,
      pinMode,
      commentsHidden,
      spacePanActive,
      overviewClearSelectionRequest,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedLayerSelectorGroupsByScreen,
      selectedElementScreenId,
      hoveredElementScreenId,
      hoveredCanvasSelector,
      hoveredCanvasSelectorCandidates,
      getLayerSelectorsForFile,
      lockedLayerIds,
      hiddenLayerIds,
      handleIframeElementSelect,
      handleScreenElementMarqueeSelect,
      handleScreenElementHover,
      handleEditorDragStateChange,
      handleScreenElementClear,
      handleIframeHotkey,
      handleCanvasFigmaClipboardPaste,
      handleCanvasImagePaste,
      handleIframeContextMenu,
      handleScreenVisualStyleChange,
      handleScreenVisualStructureChange,
      handleScreenVisualDuplicateChange,
      handleScreenTextContentChange,
      handleTextEditingStateChangeForScreen,
      handleScreenElementDblClickText,
      cssVarValues,
      id,
      design?.title,
      session?.email,
      reviewFocusRequest,
      handleDispatchCommentToAgent,
      handleSendReviewThreadToAgent,
      reviewSendingThreadId,
      repromptDraftRequest,
      handleRepromptDraftConsumed,
      handleExitReviewCommentMode,
      layoutGrids,
      t,
    ],
  );
  const renderScreenContent = useCallback<OverviewScreenRenderer>(
    (screen, metadata, geometry, options) => {
      recordDesignPerformance("renderScreenContent");
      return renderEditableScreenContent(
        screen,
        metadata,
        geometry,
        undefined,
        options,
      );
    },
    [renderEditableScreenContent],
  );
  const renderBreakpointContent = useCallback<OverviewBreakpointRenderer>(
    (screen, metadata, frame) =>
      renderEditableScreenContent(
        screen,
        metadata,
        {
          x: 0,
          y: 0,
          width: frame.displayWidth,
          height: frame.displayHeight,
        },
        frame,
        {
          onBootStart: frame.onBootStart,
          onBootReady: frame.onBootReady,
        },
      ),
    [renderEditableScreenContent],
  );

  const overviewScreenContentRenderKey = [
    runtimeStructureMoveRequest?.requestId ?? "",
    runtimeStructureInsertRequest?.requestId ?? "",
    runtimeStructureInsertRequest?.transactionId ?? "",
    runtimeStructureDeleteRequest?.requestId ?? "",
    runtimeStructureRollbackRequest?.requestId ?? "",
  ].join("|");

  const handleBoardElementSelect = useCallback<
    NonNullable<
      React.ComponentProps<typeof MultiScreenCanvas>["onBoardElementSelect"]
    >
  >(
    (info, intent) => {
      if (!boardFileId) return;
      handleIframeElementSelect(boardFileId, info, intent);
    },
    [boardFileId, handleIframeElementSelect],
  );
  const handleBoardSelectionWorldBoundsChange = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardSelectionWorldBoundsChange"]
    >
  >((selection) => {
    boardSelectionWorldBoundsRef.current = selection;
  }, []);
  const handleBoardElementMarqueeSelect = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardElementMarqueeSelect"]
    >
  >(
    (infos, intent) => {
      if (!boardFileId) return;
      handleScreenElementMarqueeSelect(boardFileId, infos, intent);
    },
    [boardFileId, handleScreenElementMarqueeSelect],
  );
  const handleBoardElementHover = useCallback<
    NonNullable<
      React.ComponentProps<typeof MultiScreenCanvas>["onBoardElementHover"]
    >
  >(
    (info) => {
      if (!boardFileId) return;
      handleScreenElementHover(boardFileId, info);
    },
    [boardFileId, handleScreenElementHover],
  );
  const handleBoardElementClear = useCallback(() => {
    if (!boardFileId) return;
    handleScreenElementClear(boardFileId);
  }, [boardFileId, handleScreenElementClear]);
  const handleBoardTextEditingStateChange = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardTextEditingStateChange"]
    >
  >(
    (state) => {
      handleTextEditingStateChangeForScreen(boardFileId ?? "__board__", state);
    },
    [boardFileId, handleTextEditingStateChangeForScreen],
  );
  const handleBoardElementDblClickText = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardElementDblClickText"]
    >
  >(
    (info) => {
      if (!boardFileId) return;
      handleScreenElementDblClickText(boardFileId, info);
    },
    [boardFileId, handleScreenElementDblClickText],
  );
  const handleBoardVisualStyleChange = useCallback<
    NonNullable<
      React.ComponentProps<typeof MultiScreenCanvas>["onBoardVisualStyleChange"]
    >
  >(
    (selector, styles, info, metadata) => {
      if (!boardFileId) return;
      handleScreenVisualStyleChange(
        boardFileId,
        selector,
        styles,
        info,
        metadata,
      );
    },
    [boardFileId, handleScreenVisualStyleChange],
  );
  const handleBoardVisualStyleBatchChange = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardVisualStyleBatchChange"]
    >
  >(
    (changes) => {
      if (!boardFileId) return false;
      return handleKScaleStyleBatchChange(boardFileId, changes);
    },
    [boardFileId, handleKScaleStyleBatchChange],
  );
  const handleBoardVisualStructureChange = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardVisualStructureChange"]
    >
  >(
    (selector, anchorSelector, placement, info, details) => {
      if (!boardFileId) return;
      return handleScreenVisualStructureChange(
        boardFileId,
        selector,
        anchorSelector,
        placement,
        info,
        details,
      );
    },
    [boardFileId, handleScreenVisualStructureChange],
  );
  const handleBoardVisualDuplicateChange = useCallback<
    NonNullable<
      React.ComponentProps<
        typeof MultiScreenCanvas
      >["onBoardVisualDuplicateChange"]
    >
  >(
    (selector, cloneHtml, info, details) => {
      if (!boardFileId) return;
      return handleScreenVisualDuplicateChange(
        boardFileId,
        selector,
        cloneHtml,
        info,
        details,
      );
    },
    [boardFileId, handleScreenVisualDuplicateChange],
  );
  const handleBoardTextContentChange = useCallback<
    NonNullable<
      React.ComponentProps<typeof MultiScreenCanvas>["onBoardTextContentChange"]
    >
  >(
    (selector, value, info, details) => {
      if (!boardFileId) return;
      handleScreenTextContentChange(
        boardFileId,
        selector,
        value,
        info,
        details,
      );
    },
    [boardFileId, handleScreenTextContentChange],
  );
  // PF8: rare, discrete interactions (add/activate a breakpoint) — not a
  // per-frame gesture path. addBreakpointMutation/setActiveBreakpointMutation
  // are useActionMutation(...) results (packages/core/src/client/use-action.ts),
  // which return a fresh object every render (untyped passthrough of
  // TanStack Query's useMutation with an inline mutationFn/onSuccess), so
  // these deps still change every render — same as the ~24 other
  // useCallback([...Mutation...]) call sites already in this file. Hoisting
  // still centralizes the closure and keeps the JSX prop list declarative;
  // full stabilization would require a latest-ref wrapper around
  // useActionMutation itself, out of scope for a call-site-only fix.
  // (handleBreakpointBarSelect itself now lives up near designBreakpoints'
  // own declaration — see the comment there — so handleEscapeHotkey, which
  // is defined earlier in this component than this line, can reference it.)
  // BP-DEEP item 5 — Framer-style click-to-target: picking a BASE screen
  // frame (a regular Screen, not one of its breakpoint sub-frames) always
  // returns the active edit target to Base. This mirrors clicking the Base
  // chip in BreakpointBar (handleBreakpointBarSelect(undefined)) so the two
  // entry points ("click the frame" vs "click the chip") stay in sync
  // instead of leaving activeBreakpointWidthState pointed at a breakpoint
  // that's no longer the visibly-focused frame. Only resets when a
  // breakpoint is ACTUALLY active, so plain screen-to-screen picking while
  // already on Base doesn't fire a redundant mutation on every click.
  // PF8: onPick has no unstable deps (state setters + refs + a
  // zero-dep useCallback) — hoisting removes a fresh-arrow-per-render prop
  // on MultiScreenCanvas without changing behavior.
  const handleOverviewScreenPick = useCallback(
    (pickedId: string) => {
      pendingOverviewScreenSelectionRef.current = null;
      pendingOverviewLayerSelectionRef.current = null;
      clearPendingOverviewLayerSelectionTimer();
      setCreatedOverviewLayerSelection(null);
      setSelectedElement(null);
      setHoveredElement(null);
      // PICK-RACE — see computeOverviewScreenPickSelectionIds's doc comment
      // (design-editor/selection-state.ts) for the full race this closes:
      // MultiScreenCanvas's shift-click toggle can't report its full
      // multi-id array through the single-id onPick signature, so a
      // shift-held pick must leave the current selection alone rather than
      // clobber it to a wrong singleton.
      if (!shiftKeyHeldRef.current) {
        setOverviewSelectedScreenIds([pickedId]);
      }
      setSelectedLayerIdsState((current) =>
        computeOverviewScreenPickSelectionIds({
          pickedId,
          shiftKeyHeld: shiftKeyHeldRef.current,
          currentSelectedLayerIds: current,
        }),
      );
      setActiveFileId(pickedId);
      setActiveTool(resolveToolAfterSelection);
      setMode("edit");
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
    },
    [clearPendingOverviewLayerSelectionTimer, handleBreakpointBarSelect],
  );
  const addDesignBreakpoint = useCallback(
    (widthPx: number, label?: string) => {
      if (!id) return;
      const resolvedLabel = label ?? breakpointLabelForWidth(widthPx);
      const existingWidths = getDesignBreakpointWidths(
        designDataJsonRef.current,
      );
      if (existingWidths.includes(widthPx)) return;
      const nextWidths = [...new Set([...existingWidths, widthPx])];
      const optimisticId = `optimistic-bp-${widthPx}`;
      const geometryBefore = cloneCanvasFrameGeometry(
        getCanvasFrameGeometry(designDataJsonRef.current),
      );
      const { rollback } = beginOptimisticBreakpointSetPatch({
        designId: id,
        queryClient,
        designDataJsonRef,
        nextData: optimisticAddBreakpointData(designDataJsonRef.current, {
          id: optimisticId,
          label: resolvedLabel,
          widthPx,
        }),
      });
      reflowOverviewScreensForBreakpoints(nextWidths);
      void addBreakpointMutation
        .mutateAsync({
          designId: id,
          id: optimisticId,
          label: resolvedLabel,
          widthPx,
        })
        .catch((error) => {
          rollback();
          const geometryAfter = getCanvasFrameGeometry(
            designDataJsonRef.current,
          );
          handleGeometryCommit(geometryAfter, geometryBefore);
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.addBreakpoint"),
          });
        });
    },
    [
      addBreakpointMutation,
      handleGeometryCommit,
      id,
      queryClient,
      reflowOverviewScreensForBreakpoints,
      t,
    ],
  );
  const handleBreakpointBarAdd = useCallback(
    (widthPx: number, label: string) => addDesignBreakpoint(widthPx, label),
    [addDesignBreakpoint],
  );
  const handleBreakpointBarRemove = useCallback(
    (breakpointId: string) => {
      if (!id) return;
      const removed = designBreakpoints.find((b) => b.id === breakpointId);
      const clearedActive =
        removed != null && removed.widthPx === activeBreakpointWidthState;
      const priorWidthPx = activeBreakpointWidthState;
      const priorEditScope = responsiveEditScopeRef.current;
      if (clearedActive) {
        setActiveBreakpointWidthState(undefined);
        lastAppliedActiveBreakpointIdRef.current = "auto";
        persistActiveBreakpoint("auto", priorEditScope);
      }
      const { rollback } = beginOptimisticBreakpointSetPatch({
        designId: id,
        queryClient,
        designDataJsonRef,
        nextData: optimisticRemoveBreakpointData(
          designDataJsonRef.current,
          breakpointId,
        ),
      });
      void removeBreakpointMutation
        .mutateAsync({ designId: id, breakpointId })
        .catch((error) => {
          rollback();
          if (clearedActive && removed && priorWidthPx !== undefined) {
            setActiveBreakpointWidthState(priorWidthPx);
            lastAppliedActiveBreakpointIdRef.current = removed.id;
            persistActiveBreakpoint(removed.id, priorEditScope);
          }
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.remove"),
          });
        });
    },
    [
      id,
      designBreakpoints,
      activeBreakpointWidthState,
      removeBreakpointMutation,
      persistActiveBreakpoint,
      queryClient,
      t,
    ],
  );
  const handleBreakpointChangeWidth = useCallback(
    (breakpointId: string, widthPx: number) => {
      if (!id) return;
      const existing = designBreakpoints.find((bp) => bp.id === breakpointId);
      if (!existing || existing.widthPx === widthPx) return;
      if (
        designBreakpoints.some(
          (bp) => bp.id !== breakpointId && bp.widthPx === widthPx,
        )
      ) {
        return;
      }
      const label = breakpointLabelForWidth(widthPx);
      void updateBreakpointMutation
        .mutateAsync({
          designId: id,
          breakpointId,
          label,
          widthPx,
        })
        .then((result) => {
          if (!result?.updated) {
            toast.error(t("common.genericError"), {
              description:
                result?.reason ?? t("designEditor.breakpointBar.changeWidth"),
            });
            return;
          }
          const reconcilePending = (
            result as { collabReconcilePending?: unknown } | undefined
          )?.collabReconcilePending;
          if (Array.isArray(reconcilePending) && reconcilePending.length > 0) {
            toast.warning(t("visualEditor.changesSaveWhenReconnected"));
          }
          if (activeBreakpointWidthStateRef.current === existing.widthPx) {
            handleBreakpointBarSelect(widthPx, breakpointId);
          }
        })
        .catch((error) => {
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.changeWidth"),
          });
        });
    },
    [
      id,
      designBreakpoints,
      handleBreakpointBarSelect,
      t,
      updateBreakpointMutation,
    ],
  );

  const handleOverviewAddBreakpoint = useCallback(
    (widthPx: number) => addDesignBreakpoint(widthPx),
    [addDesignBreakpoint],
  );
  const handleOverviewActiveBreakpointChange = useCallback(
    (_screenId: string, widthPx: number | undefined) => {
      activeBreakpointWidthStateRef.current = widthPx;
      setActiveBreakpointWidthState(widthPx);
      if (!id) return;
      const bpSet = (() => {
        try {
          const raw = (designDataJson as Record<string, unknown>)
            ?.breakpointSet;
          if (
            raw &&
            typeof raw === "object" &&
            Array.isArray((raw as Record<string, unknown>).breakpoints)
          ) {
            return raw as {
              breakpoints: Array<{ id: string; widthPx: number }>;
            };
          }
        } catch {
          // Ignore malformed design data; the mutation below can still clear
          // back to auto.
        }
        return null;
      })();
      const bp = bpSet?.breakpoints.find((b) => b.widthPx === widthPx);
      const breakpointId = widthPx !== undefined && bp ? bp.id : "auto";
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [id, designDataJson, persistActiveBreakpoint],
  );
  const handleOverviewRemoveBreakpoint = useCallback(
    (_screenId: string, widthPx: number) => {
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      if (!bp) return;
      handleBreakpointBarRemove(bp.id);
    },
    [designBreakpoints, handleBreakpointBarRemove],
  );
  const handleOverviewChangeBreakpointWidth = useCallback(
    (_screenId: string, widthPx: number, nextWidthPx: number) => {
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      if (!bp) return;
      handleBreakpointChangeWidth(bp.id, nextWidthPx);
    },
    [designBreakpoints, handleBreakpointChangeWidth],
  );
  const handleOverviewEditBreakpoint = useCallback(
    (screenId: string, _widthPx: number) => {
      handleOverviewFrameAction(screenId);
    },
    [handleOverviewFrameAction],
  );

  const handleApplyReviewFeedback = useCallback(() => {
    if (
      !id ||
      !canEditDesign ||
      reviewAgentQueueCount === 0 ||
      reviewFeedbackApplying
    )
      return;
    submitReviewFeedback(
      "Apply all open design review feedback for this design. After each change, verify it in the affected screen and resolve the corresponding thread only after the saved edit is confirmed.",
      `Design id: ${id}. Start by reading the current screen and fetching the open review feedback queue. Apply one thread at a time with persisted edits and verification.`,
      { openSidebar: true, newTab: true },
    );
  }, [
    canEditDesign,
    id,
    reviewAgentQueueCount,
    reviewFeedbackApplying,
    submitReviewFeedback,
  ]);

  useEffect(() => {
    if (!id) void navigate("/home");
  }, [id, navigate]);

  if (!id) return null;

  if (
    designLoading ||
    (!design &&
      (pendingGenerationActive ||
        shellMode ||
        designAccessStatusLoading ||
        (!designAccessStatus && !designAccessStatusError)))
  ) {
    return (
      <DesignEditorSkeleton
        embedded={embedded}
        pendingGeneration={pendingGenerationActive}
      />
    );
  }

  if (!design) {
    return (
      <DesignAccessState
        accessStatus={designAccessStatus}
        accessStatusError={
          designAccessStatusError ||
          !designAccessStatus ||
          designAccessStatus.hasAccess
        }
        accessRequestPending={requestDesignAccessMutation.isPending}
        accessRequestSent={designAccessRequestSent}
        signInHref={buildSignInHrefForComment()}
        onRequestAccess={() => void handleRequestDesignAccess()}
        onRetryAccessCheck={() => {
          void Promise.all([refetchDesign(), refetchDesignAccessStatus()]);
        }}
      />
    );
  }

  const questionFlowActive = pendingQuestionsVisible;

  const deviceFrameControl = (
    <BreakpointDeviceControl
      breakpoints={designBreakpoints}
      activeWidthPx={activeBreakpointWidthState}
      baseWidthPx={activeScreenBaseWidthPx}
      canEdit={canEditDesign}
      mutationPending={
        addBreakpointMutation.isPending ||
        removeBreakpointMutation.isPending ||
        updateBreakpointMutation.isPending
      }
      showAllFrames={!breakpointFramesHidden}
      onShowAllFramesChange={(value) => setBreakpointFramesHidden(!value)}
      onSelect={handleBreakpointBarSelect}
      onAdd={canEditDesign ? handleBreakpointBarAdd : undefined}
      onRemove={canEditDesign ? handleBreakpointBarRemove : undefined}
      onChangeWidth={canEditDesign ? handleBreakpointChangeWidth : undefined}
    />
  );
  const responsiveEditScopeControl =
    activeBreakpointWidthState === undefined ? null : (
      <Select
        value={responsiveEditScope}
        onValueChange={(value) =>
          handleResponsiveEditScopeChange(value as ResponsiveEditScope)
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger
              className="size-7 shrink-0 justify-center p-0 [&>svg:last-child]:hidden"
              aria-label={t("designEditor.breakpointBar.scope.label")}
              title={
                responsiveEditScope === "only"
                  ? t("designEditor.breakpointBar.scope.only")
                  : t("designEditor.breakpointBar.scope.cascadeSmaller")
              }
            >
              <IconArrowsDown className="size-3.5" aria-hidden="true" />
              <SelectValue className="sr-only" />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {responsiveEditScope === "only"
              ? t("designEditor.breakpointBar.scope.only")
              : t("designEditor.breakpointBar.scope.cascadeSmaller")}
          </TooltipContent>
        </Tooltip>
        <SelectContent>
          <SelectItem value="cascade-smaller">
            {t("designEditor.breakpointBar.scope.cascadeSmaller")}
          </SelectItem>
          <SelectItem value="only">
            {t("designEditor.breakpointBar.scope.only")}
          </SelectItem>
        </SelectContent>
      </Select>
    );

  const screenBreakpointControls = (
    <div className="design-sidebar-property-group">
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {deviceFrameControl}
        </div>
        {responsiveEditScopeControl}
      </div>
    </div>
  );

  const projectMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={projectMenuTriggerRef}
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[calc(var(--spacing)*5.5)]"
          aria-label={t("designEditor.more")}
        >
          <AgentNativeMenuMark className="size-[calc(var(--spacing)*5.5)] text-foreground dark:text-white" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="design-editor-app-menu-content w-64"
        onCloseAutoFocus={(event) => {
          if (!suppressProjectMenuReturnFocusRef.current) return;
          event.preventDefault();
          suppressProjectMenuReturnFocusRef.current = false;
        }}
      >
        <DropdownMenuItem asChild>
          <Link to="/home">
            <IconArrowLeft className="h-4 w-4" />
            {t("designEditor.backToDesigns")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setSaveTemplateOpen(true)}
          disabled={!canEditDesign || files.length === 0}
        >
          <IconTemplate className="h-4 w-4" />
          {t("designEditor.saveAsTemplate")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHistoryOpen(true)} disabled={!id}>
          <IconHistory className="h-4 w-4" />
          {"Version history" /* i18n-ignore */}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconFileExport className="h-4 w-4" />
            {t("designEditor.export")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-56">
            <DropdownMenuItem
              onClick={handleDownloadHtml}
              disabled={!activeFile || exportHtmlMutation.isPending}
            >
              <IconCode className="mr-2 h-4 w-4" />
              {t("designEditor.downloadHtml")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDownloadPng()}
              disabled={!activeFile || pngExporting}
            >
              <IconPhoto className="mr-2 h-4 w-4" />
              {t("designEditor.downloadPng")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDownloadSvg()}
              disabled={!activeFile || svgExporting}
            >
              <IconCode className="mr-2 h-4 w-4" />
              {t("designEditor.downloadSvg")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void handleDownloadFigmaSvg()}
              disabled={!activeFile || figmaSvgExporting}
            >
              <IconFileExport className="mr-2 h-4 w-4" />
              {t("designEditor.downloadFigmaSvg")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDownloadZip}
              disabled={!activeFile || exportZipMutation.isPending}
            >
              <IconArchive className="mr-2 h-4 w-4" />
              {t("designEditor.downloadZip")}
            </DropdownMenuItem>
            {viewMode === "overview" && overviewScreens.length >= 2 ? (
              <DropdownMenuItem
                onClick={() => void handleDownloadAllScreensPdf()}
                disabled={pngExporting}
              >
                <IconFileStack className="mr-2 h-4 w-4" />
                {t("designEditor.downloadPdfAllScreens")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleCopyCodingHandoff}
              disabled={!activeFile || codingHandoffLoading}
            >
              <IconDownload className="mr-2 h-4 w-4" />
              {t("designEditor.copyCodingHandoff")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconPencil className="h-4 w-4" />
            {t("designEditor.modes.edit")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>
              {t("designEditor.undo")}
              <DropdownMenuShortcut>{shortcut("$mod+z")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>
              {t("designEditor.redo")}
              <DropdownMenuShortcut>
                {shortcut("$mod+shift+z")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDuplicateSelection}
              disabled={!activeFile}
            >
              {"Duplicate" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>{shortcut("$mod+d")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (viewMode === "overview") {
                  handleDeleteOverviewSelection(overviewSelectedScreenIds);
                } else {
                  handleDeleteSelection();
                }
              }}
              disabled={
                viewMode === "overview"
                  ? !overviewSelectionTargetsElement({
                      selectedElement,
                      selectedLayerIds: selectedLayerIdsState,
                      fileIds: files.map((file) => file.id),
                    }) &&
                    (overviewScreens.length <= 1 ||
                      overviewSelectedScreenIds.length === 0)
                  : !selectedElement && !activeFile
              }
            >
              {"Delete" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconLayoutGrid className="h-4 w-4" />
            {"View" /* i18n-ignore design menu section */}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleViewModeToggle}>
              {viewMode === "overview"
                ? t("designEditor.currentScreen")
                : t("designEditor.screenOverview")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleZoomOut}>
              {t("designEditor.zoomOut")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleZoomIn}>
              {t("designEditor.zoomIn")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onClick={handlePinToolToggle}
          disabled={!activeFile || !canCommentDesign}
        >
          <IconPin className="h-4 w-4" />
          {pinMode
            ? t("designEditor.stopPinningComments")
            : t("designEditor.pinComment")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleShowKeyboardShortcutsFromMenu}>
          <IconKeyboard className="h-4 w-4" />
          {t("designEditor.keyboardShortcuts.title")}
          <DropdownMenuShortcut>
            {/* Control, not Command: ⌘⇧? is the macOS Help-menu shortcut and
                the browser consumes it before the page ever sees it. */}
            {shortcut("ctrl+shift+?")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {isSignedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                handleOpenMakeReal();
              }}
            >
              <IconRocket className="h-4 w-4" />
              {"Make this a real app" /* i18n-ignore */}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const projectTitleControl =
    titleEditing && canEditDesign ? (
      <Input
        autoFocus
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitleEdit}
        onKeyDown={handleTitleInputKeyDown}
        className="-mx-1 h-7 min-w-0 flex-1 border-transparent bg-[var(--design-editor-panel-raised-bg)] px-1 py-0 text-[13px] font-medium text-foreground shadow-none ring-offset-0 focus-visible:border-[var(--design-editor-control-border)] focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
      />
    ) : canEditDesign ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (!canEditDesign) return;
              setTitleDraft(design.title);
              setTitleEditing(true);
            }}
            disabled={!canEditDesign}
            className="-mx-1 min-w-0 flex-1 cursor-text truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
          >
            {design.title}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.clickToRename")}</TooltipContent>
      </Tooltip>
    ) : (
      <span className="-mx-1 min-w-0 flex-1 truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90">
        {design.title}
      </span>
    );

  const minimalUiToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-md"
          aria-label={
            minimalUi
              ? "Exit minimal UI" /* i18n-ignore minimal UI chrome */
              : "Minimize UI" /* i18n-ignore minimal UI chrome */
          }
          aria-pressed={minimalUi}
          data-design-minimal-toggle="ui"
          onClick={handleToggleMinimalUi}
        >
          <IconLayoutSidebar className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {
          minimalUi
            ? "Exit minimal UI" /* i18n-ignore minimal UI chrome */
            : "Minimize UI" /* i18n-ignore minimal UI chrome */
        }
      </TooltipContent>
    </Tooltip>
  );

  const renderZoomControl = (controlId: "toolbar" | "inspector") => (
    <DropdownMenu
      open={openZoomControl === controlId}
      onOpenChange={(open) => {
        if (open) {
          setZoomInputValue(zoomLabel);
          setOpenZoomControl(controlId);
          return;
        }
        setOpenZoomControl((current) =>
          current === controlId ? null : current,
        );
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-0.5 px-1 text-[10px] tabular-nums text-muted-foreground cursor-pointer hover:text-foreground"
            >
              {zoomLabel}
              <IconChevronDown className="size-2.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.zoom")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="design-editor-app-menu-content w-52 rounded-lg bg-[var(--design-editor-panel-bg)] p-1"
      >
        <div className="px-1 pb-1 pt-0.5">
          <Input
            autoFocus
            value={zoomInputValue}
            onChange={(event) => setZoomInputValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitZoomInput();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setZoomInputValue(zoomLabel);
                setOpenZoomControl(null);
              }
            }}
            className="h-7 rounded-[5px] border-[var(--design-editor-accent-color)] bg-[var(--design-editor-control-bg)] px-2 text-[12px] font-medium tabular-nums text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            aria-label={"Zoom percentage" /* i18n-ignore zoom field */}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleZoomIn}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom in" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("$mod+=")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomOut}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom out" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("$mod+-")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomToFit}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom to fit" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {shortcut("shift+1")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {[50, 100, 200].map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => {
              suppressOverviewPopForExplicitZoomRef.current = true;
              setZoom(preset);
            }}
            className="h-6 px-2 py-0 text-[12px]"
          >
            <span className="flex-1">
              {"Zoom to " /* i18n-ignore */}
              {preset}%
            </span>
            {preset === 100 ? (
              <DropdownMenuShortcut className="tracking-normal">
                {shortcut("$mod+0")}
              </DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const signedOutPersistenceActions = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 min-w-0 shrink cursor-pointer gap-1.5 rounded-md bg-[var(--design-editor-panel-raised-bg)] px-3 text-sm shadow-none"
            aria-label={t("designEditor.signUpToSave")}
          >
            <a href={signInToSaveHref}>
              <span className="truncate">{t("designEditor.signUpToSave")}</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.signUpToSave")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="default"
            size="sm"
            className="h-8 cursor-pointer gap-1.5 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
            aria-label={t(
              hasLocalhostScreens
                ? "designEditor.signUpToShareLiveCanvas"
                : "designEditor.share",
            )}
          >
            <a href={signInToShareHref}>
              <span>
                {t(
                  hasLocalhostScreens
                    ? "designEditor.signUpToShareLiveCanvas"
                    : "designEditor.share",
                )}
              </span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t(
            hasLocalhostScreens
              ? "designEditor.signUpToShareLiveCanvas"
              : "designEditor.signUpToShare",
          )}
        </TooltipContent>
      </Tooltip>
    </>
  );

  const rightToolbarCompact = rightSidebarWidth < 320;
  const pendingNodeRewriteLabel = t("designEditor.nodeRewrite.pendingReview", {
    count: pendingNodeRewriteProposals.length,
  });
  const pendingNodeRewriteButtonContent = (
    <>
      {!rightToolbarCompact ? (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
      <IconFileStack className="size-3.5 shrink-0" />
      {rightToolbarCompact ? (
        <span className="min-w-4 rounded bg-primary/10 px-1 text-center text-[10px] font-semibold tabular-nums text-primary">
          {pendingNodeRewriteProposals.length}
        </span>
      ) : (
        <span className="truncate">{pendingNodeRewriteLabel}</span>
      )}
    </>
  );
  const pendingNodeRewriteButtonClassName = cn(
    "h-8 rounded-md border-primary/30 bg-primary/5 text-xs hover:bg-primary/10",
    rightToolbarCompact ? "min-w-10 gap-1 px-1.5" : "max-w-44 gap-1.5 px-2",
  );
  const pendingNodeRewriteControl =
    pendingNodeRewriteProposals.length ===
    0 ? null : pendingNodeRewriteProposals.length === 1 ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={pendingNodeRewriteButtonClassName}
            aria-label={pendingNodeRewriteLabel}
            onClick={() =>
              handleReviewNodeRewrite(pendingNodeRewriteProposals[0]!)
            }
          >
            {pendingNodeRewriteButtonContent}
          </Button>
        </TooltipTrigger>
        {rightToolbarCompact ? (
          <TooltipContent>{pendingNodeRewriteLabel}</TooltipContent>
        ) : null}
      </Tooltip>
    ) : (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={pendingNodeRewriteButtonClassName}
                aria-label={pendingNodeRewriteLabel}
              >
                {pendingNodeRewriteButtonContent}
                {!rightToolbarCompact ? (
                  <IconChevronDown className="size-3 shrink-0 opacity-70" />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {rightToolbarCompact ? (
            <TooltipContent>{pendingNodeRewriteLabel}</TooltipContent>
          ) : null}
        </Tooltip>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("designEditor.nodeRewrite.pendingReviewMenu")}
          </DropdownMenuLabel>
          {pendingNodeRewriteProposals.map((proposal) => (
            <DropdownMenuItem
              key={proposal.proposalId}
              onClick={() => handleReviewNodeRewrite(proposal)}
            >
              <IconFileStack className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {prettyScreenName(proposal.filename)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {proposal.variants.length}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const publishWaitlistControl = (
    <Popover
      open={hostEmbeddedEditor ? false : publishWaitlistPopoverOpen}
      onOpenChange={(open) => {
        setPublishWaitlistPopoverOpen(open);
        setPublishWaitlistPopoverView("actions");
        if (open) {
          setPublishWaitlistError(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-[var(--design-row-height)] cursor-pointer gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-foreground hover:bg-accent hover:text-foreground",
                hostEmbeddedEditor && "hidden",
              )}
              aria-label={"Preview or publish app" /* i18n-ignore */}
            >
              <IconPlayerPlay className="size-5" />
              <IconChevronDown className="size-3 opacity-70" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Preview or publish app" /* i18n-ignore */}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[100010] w-72 space-y-3 p-3"
      >
        {publishWaitlistPopoverView === "actions" ? (
          <div className="space-y-1">
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => {
                if (activeScreenSnapshotOnly) return;
                handleOpenDesignPreview();
                setPublishWaitlistPopoverOpen(false);
              }}
              disabled={
                activeScreenSnapshotOnly ||
                (!activeScreenPreviewUrl && !activeContent.trim())
              }
            >
              <IconPlayerPlay className="size-4" />
              {t("designEditor.designPreview")}
            </Button>
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => setPublishWaitlistPopoverView("waitlist")}
            >
              <IconArrowUpRight className="size-4" />
              {"Publish app" /* i18n-ignore */}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {
                  publishWaitlistJoined
                    ? "You're on the waitlist" /* i18n-ignore */
                    : "Publish app" /* i18n-ignore */
                }
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {
                  publishWaitlistJoined
                    ? "We'll follow up when app publishing is ready for your workspace." /* i18n-ignore */
                    : isSignedIn
                      ? "Publish directly from Design is opening soon. Want early access?" /* i18n-ignore */
                      : "Publish directly from Design is opening soon. Sign in to join the waitlist." /* i18n-ignore */
                }
              </p>
            </div>
            {publishWaitlistError ? (
              <p role="alert" className="text-xs text-destructive">
                {publishWaitlistError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer"
                onClick={() => setPublishWaitlistPopoverOpen(false)}
              >
                {
                  publishWaitlistJoined
                    ? "Done" /* i18n-ignore */
                    : "Not now" /* i18n-ignore */
                }
              </Button>
              {!publishWaitlistJoined && (
                <Button
                  size="sm"
                  className="h-8 cursor-pointer"
                  onClick={() => void handleJoinPublishWaitlist()}
                  disabled={joiningPublishWaitlist}
                >
                  {joiningPublishWaitlist ? (
                    <>
                      <Spinner className="mr-1.5 size-3.5" />
                      {"Joining" /* i18n-ignore */}
                    </>
                  ) : isSignedIn ? (
                    "Add me to waitlist" /* i18n-ignore */
                  ) : (
                    "Sign in to join" /* i18n-ignore */
                  )}
                </Button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );

  const rightSidebarActions = (
    <div
      data-design-chrome-region="right-toolbar"
      className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-[var(--design-baseline-unit)] py-[var(--design-baseline-half)]"
    >
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="flex min-h-[var(--design-row-height)] items-center gap-[var(--design-baseline-half)]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-[var(--design-baseline-half)]">
          {hostEmbeddedEditor ? null : (
            <>
              <PresenceBar
                activeUsers={[
                  ...(currentUser ? [currentUser] : []),
                  ...(activeUsers ?? []),
                ]}
                agentPresent={agentPresent}
                agentActive={agentActive}
                currentUserEmail={currentUser?.email}
                showCurrentUser
                followingEmail={followingEmail}
                onAvatarClick={handleAvatarClick}
                disableAgentClick
                className="shrink-0"
              />
              {sessionResolved && !isSignedIn ? publishWaitlistControl : null}
            </>
          )}
        </div>

        {/* Not shrink-0: the signed-out CTA ("Sign up") is a
            nowrap label wide enough to push this row past the right rail's
            edge on its own, and a shrink-0 row has no way to give that space
            back — it just overflows the panel. */}
        <div className="flex min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {pendingNodeRewriteControl}
          {canEditDesign && reviewAgentQueueCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[var(--design-row-height)] gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-xs"
              onClick={handleApplyReviewFeedback}
              disabled={reviewFeedbackApplying}
            >
              {reviewFeedbackApplying ? (
                <Spinner className="size-3.5" />
              ) : (
                <IconMessageCircle className="size-3.5" />
              )}
              {reviewFeedbackApplying
                ? t("review.applyingFeedback")
                : t("review.applyFeedback", { count: reviewAgentQueueCount })}
            </Button>
          ) : null}
          {!sessionResolved || isSignedIn ? publishWaitlistControl : null}

          {hostEmbeddedEditor ? null : canRenderAuthenticatedShare ? (
            <ShareButton
              resourceType="design"
              resourceId={id}
              resourceTitle={design.title}
              hideTriggerIcon
              defaultOpen={shouldOpenShare}
              shareUrl={editorShareUrl}
              shareUrlLabel={t(
                hasLocalhostScreens
                  ? "designEditor.liveCanvasLink"
                  : "designEditor.shareEditorLink",
              )}
              shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
              roleCopy={{
                commenter: {
                  label: t("designEditor.commenterRoleLabel"),
                  description: t("designEditor.commenterRoleDescription"),
                },
              }}
              shareTabs={designShareTabs}
              popoverClassName={designSharePopoverClassName}
              triggerClassName="h-[var(--design-row-height)] rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-[calc(var(--design-baseline-unit)*1.5)] text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
            />
          ) : sessionResolved ? (
            signedOutPersistenceActions
          ) : null}
        </div>
      </div>
      {activeScreenIsLocalSource &&
      viewMode === "single" &&
      !activeScreenSnapshotOnly &&
      activeScreenPreviewUrl ? (
        <div className="mt-[var(--design-baseline-half)] flex h-[var(--design-row-height)] min-w-0 items-center gap-[var(--design-baseline-half)]">
          <a
            href={activeScreenPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[var(--design-control-height)] min-w-0 flex-1 items-center gap-[var(--design-baseline-half)] rounded-md border border-border bg-[var(--design-editor-panel-raised-bg)] px-[var(--design-baseline-unit)] text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={"Open local preview" /* i18n-ignore */}
            title={activeScreenPreviewUrl}
          >
            <IconLink className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono">
              {activeScreenPreviewUrl}
            </span>
            <IconExternalLink className="size-3 shrink-0" />
          </a>
          {(activeLocalhostRouteIsWritable ||
            activeLocalhostRouteIsCompiledSource) &&
          canEditDesign &&
          id ? (
            activeLocalhostRouteIsCompiledSource ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-[var(--design-control-height)]"
                      disabled
                      aria-label={t("designEditor.applyToSource")}
                    >
                      <IconDeviceFloppy className="size-3" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("designEditor.applyToSourceUnavailableCompiled")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-[var(--design-control-height)]"
                    disabled={
                      applyToSourcePending || !activeLocalhostSourceWriteContent
                    }
                    aria-label={
                      applyToSourcePending
                        ? t("designEditor.writingToSource")
                        : t("designEditor.applyToSource")
                    }
                    onClick={handleApplyToSource}
                  >
                    {applyToSourcePending ? (
                      <Spinner className="size-3" />
                    ) : (
                      <IconDeviceFloppy className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {!activeLocalhostSourceWriteContent
                    ? NO_LOCALHOST_WRITE_CONTENT_MESSAGE
                    : activeLocalhostRelPath
                      ? t("designEditor.applyToSourcePath", {
                          path: activeLocalhostRelPath,
                        })
                      : t("designEditor.applyToSource")}
                </TooltipContent>
              </Tooltip>
            )
          ) : null}
        </div>
      ) : null}
      {/* Zoom sits here rather than in the inspector tab row below: sharing
          that row truncated the "Comments" tab label at normal panel widths. */}
      <div className="mt-[var(--design-baseline-half)] flex h-[var(--design-row-height)] min-w-0 flex-nowrap items-center gap-[var(--design-baseline-half)]">
        <div className="shrink-0">{renderZoomControl("inspector")}</div>
      </div>
    </div>
  );

  const renderResponsiveInteractBar = (floating: boolean) => (
    <ResponsiveInteractBar
      deviceName={interactDeviceName}
      width={interactDeviceSize.width}
      height={interactDeviceSize.height}
      onDeviceChange={handleInteractDeviceChange}
      onWidthChange={handleInteractWidthChange}
      onHeightChange={handleInteractHeightChange}
      onModeChange={(next) => {
        if (next === "edit") {
          setRuntimeLayerSnapshotRequest(Date.now() + Math.random());
        }
        handleModeChange(next);
      }}
      canAnnotate={canEditDesign}
      onClose={handleExitResponsiveInteract}
      showClose={floating}
      className={
        floating
          ? "pointer-events-auto w-full max-w-[680px] rounded-lg border shadow-xl"
          : undefined
      }
    />
  );

  const leftContentWidth =
    activeLeftPanel === "code"
      ? Math.max(leftSidebarWidth, 640)
      : Math.max(
          Math.min(leftSidebarWidth, 420),
          activeLeftPanel === "agent" ? 320 : 220,
        );
  const leftSidebarVisible = !hostOwnsChrome && !uiHidden && !minimalUi;
  const leftChromeOverlayInset = leftSidebarVisible
    ? `calc(var(--design-chrome-rail-width) + ${activeLeftPanel ? leftContentWidth : 0}px)`
    : undefined;
  const minimalInspectorHasSelection = hasMinimalInspectorSelection({
    selectedElement,
    selectedLayerIds,
    selectedScreenGeometry,
  });
  const rightSidebarVisible =
    !hostOwnsChrome &&
    !uiHidden &&
    !initialGenerationChromeLimited &&
    !responsiveInteractActive &&
    (!minimalUi || minimalInspectorHasSelection);
  const chromeInsetLeft = leftSidebarVisible
    ? DESIGN_CHROME_RAIL_WIDTH_PX + (activeLeftPanel ? leftContentWidth : 0)
    : 0;
  const chromeInsetRight = rightSidebarVisible ? rightSidebarWidth : 0;
  const routeCodeFileId =
    activeLeftPanel === "code" ? searchParams.get("fileId") : null;
  const routeCodeFilename =
    activeLeftPanel === "code" ? searchParams.get("filename") : null;
  const editPanelProps = {
    selectedElement,
    textEditingState,
    selectionHidden: activeLayerHidden,
    onToggleSelectionHidden: canEditActiveVisualScreen
      ? handleToggleHiddenForSelection
      : undefined,
    readOnly: !canEditActiveVisualScreen,
    selectedElements: selectedInspectorElements,
    selectedScreenGeometry,
    selectedScreenLayoutGrid,
    onLayoutGridChange: canEditDesign ? handleLayoutGridChange : undefined,
    canvasBackground,
    canvasBackgroundFallback: themedCanvasBackground,
    onCanvasBackgroundChange: canEditDesign
      ? handleCanvasBackgroundChange
      : undefined,
    onScreenGeometryChange: canEditDesign
      ? handleScreenGeometryChange
      : undefined,
    onScreenHeightModeChange: canEditDesign
      ? handleScreenHeightModeChange
      : undefined,
    selectedScreenSource,
    sourceLocationUnavailable: activeRuntimeSourceLocationUnavailable,
    localhostConnections: activeLocalhostConnectionResult?.connections,
    onScreenSourceChange: canEditDesign ? handleScreenSourceChange : undefined,
    onAddLocalhostScreen: canEditDesign
      ? handleOpenAddLocalhostScreen
      : undefined,
    onRemoveScreen:
      canEditDesign && files.length > 1
        ? handleRemoveSelectedScreen
        : undefined,
    screenSourcePending: updateScreenSourceMutation.isPending,
    screenBreakpointControls,
    pageStyles,
    selectedScreenElement,
    onSelectedScreenStyleChange: canEditActiveVisualScreen
      ? handleSelectedScreenStyleChange
      : undefined,
    onSelectedScreenStylesChange: canEditActiveVisualScreen
      ? handleSelectedScreenStylesChange
      : undefined,
    vectorPointSelected:
      vectorEditingState?.selectedAnchorIndex !== null &&
      vectorEditingState?.selectedAnchorIndex !== undefined,
    vectorPointRadius: (() => {
      if (!vectorEditingState) return null;
      const selectedIndex = vectorEditingState.selectedAnchorIndex;
      if (selectedIndex === null || vectorEditingState.primitiveSource) {
        return null;
      }
      const max = maxPenCornerRadius(vectorEditingState.path, selectedIndex);
      if (max === null) return null;
      return {
        value: vectorEditingState.path.nodes[selectedIndex]?.cornerRadius ?? 0,
        max,
      };
    })(),
    onVectorPointRadiusChange: canEditDesign
      ? (value: number, meta?: { phase?: "preview" | "commit" | "cancel" }) =>
          handleVectorCornerRadiusChange(
            value,
            meta?.phase === "preview" ? "preview" : "commit",
          )
      : undefined,
    selectionColorScopes,
    onSelectionColorTarget: handleSelectionColorTarget,
    canSelectSelectionColorTarget,
    onSelectionColorChange: canEditActiveVisualScreen
      ? handleSelectionColorChange
      : undefined,
    onSelectionColorPickerOpenChange: canEditActiveVisualScreen
      ? handleSelectionColorPickerOpenChange
      : undefined,
    onGroupFillStylesChange: canEditActiveVisualScreen
      ? handleGroupFillStylesChange
      : undefined,
    viewMode,
    mode,
    files: documentColorFiles,
    activeTool,
    scaleToolControls: canEditDesign ? scaleToolControls : undefined,
    onCreateScreenFromPreset: canEditDesign
      ? handleCreateScreenFromPreset
      : undefined,
    zoom,
    inspectorGridDebug: import.meta.env.DEV
      ? editorPreferences.inspectorGridDebug
      : false,
    onInspectorGridDebugChange: import.meta.env.DEV
      ? (inspectorGridDebug: boolean) =>
          setEditorPreferences({
            ...editorPreferences,
            inspectorGridDebug,
          })
      : undefined,
    activeTab: activeInspectorTab,
    onActiveTabChange: setActiveInspectorTab,
    tweaksEnabled,
    tweaks,
    tweakValues: tweakSelections,
    activeContent,
    pendingInteractionStateStyles: pendingInspectorInteractionStateStyles,
    activeFileUpdatedAt: activeFile?.updatedAt ?? null,
    getComponentExpectedFiles,
    componentDetailsReady,
    componentSwapPickerRequest,
    onComponentPropApplied: handleComponentPropApplied,
    onShaderSourceApplied: handleShaderSourceApplied,
    onFontUploaded:
      canEditActiveVisualScreen && activeCanvasSourceType === "inline"
        ? handleFontUploaded
        : undefined,
    onTweakChange: handleTweakChange,
    onRequestTweaks: handleRequestTweaks,
    onStyleChange: handleStyleChange,
    onStylesChange: handleStylesChange,
    motionKeyframeState: SHOW_DESIGN_SECONDARY_LEFT_PANELS
      ? motionKeyframeState
      : undefined,
    onToggleMotionKeyframe:
      SHOW_DESIGN_SECONDARY_LEFT_PANELS && canEditDesign
        ? handleToggleMotionKeyframe
        : undefined,
    breakpointContext,
    onExport: handleInspectorExport,
    onRenderExportPreview: handleRenderExportPreview,
    exporting: pngExporting || svgExporting,
    designId: id,
    fileId: activeFile?.id,
    boardFileId,
    componentNodeId: selectedComponentNodeId,
    componentRuntime,
    requestLocalhostWrite,
    componentInstanceHasLocalOverrides: selectedComponentHasLocalOverrides,
    onResetComponentInstanceOverrides:
      id && activeFile?.id && selectedComponentHasLocalOverrides
        ? (nodeId: string) =>
            applyLinkedComponentEdit(activeFile.id, nodeId, {
              kind: "resetOverrides",
            })
        : undefined,
    onRestoreComponent:
      canEditDesign && id && activeFile?.id
        ? (nodeId: string) =>
            applyLinkedComponentEdit(activeFile.id, nodeId, {
              kind: "restoreMain",
            })
        : undefined,
    sourceCapabilities,
    selectedElementAlreadyComponent,
    onCreateComponent:
      id &&
      selectedElement &&
      !selectedElementAlreadyComponent &&
      !selectedElementInsideComponent
        ? handleCreateComponent
        : undefined,
    defaultComponentName,
    inspectCode: inspectCodeData,
    statesPanelProps,
    reviewPanelProps: resolvedReviewPanelProps,
    reviewCommentsPanelProps,
    reviewCommentsCount: reviewUnreadCount,
    onAlignSelection: canEditDesign ? handleAlignSelection : undefined,
    alignSelectionDisabled: !alignAvailability.canAlign,
    onDisableAutoLayout: canEditDesign ? handleDisableAutoLayout : undefined,
    onApplyLayoutFlow: canEditDesign ? handleApplyLayoutFlow : undefined,
    onInteractionStateChange: handleInteractionStateChange,
    onEditCode: handleShaderEditCode,
  };

  const selectedLayerId =
    selectedLayerIdsState.length === 1
      ? (selectedLayerIdsState[0] ?? null)
      : null;
  const selectedLayerNode = selectedLayerId
    ? codeLayerOwnerByNodeId.get(selectedLayerId)?.node
    : undefined;
  const selectedPenPathNodeId =
    (selectedCodeLayerNode
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : selectedElement?.sourceId) ??
    (selectedLayerNode
      ? bridgeSourceIdForCodeLayerNode(selectedLayerNode)
      : selectedLayerId);

  return (
    <div
      data-design-editor
      className="relative flex h-full flex-col overflow-hidden bg-[var(--design-editor-canvas-bg)]"
    >
      {id ? <VisualEditWebMcp getPrompt={visualEditPromptResult} /> : null}
      {/* ── Render: Builder embed preview ── */}
      {isBuilderDesignEmbed && builderPreviewUrl && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--design-editor-canvas-bg)]">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
            <span className="flex-1 truncate text-sm font-medium text-foreground">
              {t("designEditor.designPreview")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              onClick={() => {
                window.parent.postMessage(
                  { type: "design:close" },
                  parentOriginRef.current ?? window.location.origin,
                );
              }}
            >
              <IconX className="size-4" />
            </Button>
          </div>
          <iframe
            className="min-h-0 flex-1 border-0"
            src={builderPreviewUrl}
            title={t("designEditor.designPreview")}
            allow="fullscreen"
          />
        </div>
      )}
      {/* ── Render: main canvas area ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {leftSidebarVisible ? (
          <div
            data-design-chrome-region="left-shell"
            className="absolute inset-y-0 left-0 z-[70] flex min-h-0 bg-[var(--design-editor-panel-bg)]"
          >
            <DesignWorkspaceRail
              activePanel={activeLeftPanel}
              disabledPanels={
                initialGenerationChromeLimited
                  ? INITIAL_GENERATION_DISABLED_LEFT_PANELS
                  : undefined
              }
              motionOpen={motionDockOpen}
              motionDisabled={!activeFile || initialGenerationChromeLimited}
              projectMenu={hostEmbeddedEditor ? null : projectMenu}
              onMotionToggle={() => setMotionDockOpenAnimated(!motionDockOpen)}
              onPanelChange={(panel) => {
                if (panel === null && initialGenerationChromeLimited) return;
                setActiveLeftPanel(panel);
              }}
            />
            <div
              ref={leftSidebarContentRef}
              aria-hidden={activeLeftPanel === null}
              className={cn(
                "flex min-h-0 max-w-[calc(100dvw-var(--design-chrome-rail-width))] shrink-0 flex-col overflow-hidden border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] transition-[width] duration-150 ease-out md:max-w-none",
                activeLeftPanel === null &&
                  "pointer-events-none invisible border-r-0",
              )}
              style={{ width: activeLeftPanel ? leftContentWidth : 0 }}
            >
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "file" ? "flex" : "hidden",
                )}
              >
                <div
                  data-design-chrome-region="left-header"
                  className="flex h-[var(--design-section-height)] shrink-0 items-center gap-[var(--design-baseline-half)] border-b border-border px-[var(--design-baseline-unit)]"
                >
                  {projectTitleControl}
                  {minimalUiToggle}
                </div>
                <div className="min-h-0 flex-1">
                  <LayersPanel
                    ref={layersPanelRef}
                    screens={layerPanelFiles}
                    activeScreenId={activeFileId ?? undefined}
                    screenOverviewActive={viewMode === "overview"}
                    files={
                      viewMode === "overview"
                        ? overviewLayerPanelFiles
                        : singleBlankScreenLayerPanelFiles
                    }
                    layers={
                      viewMode === "overview" ||
                      singleBlankScreenLayerPanelFiles
                        ? undefined
                        : activeLayerPanelNodes
                    }
                    selectedIds={layerPanelSelectedIds}
                    expandedIds={layerPanelExpandedIds}
                    searchQuery={layersSearchQuery}
                    onScreenSelect={handleSidebarScreenSelect}
                    onScreenOverview={handleSidebarScreenOverview}
                    onAddScreen={handleAddScreenAffordance}
                    onSearchQueryChange={setLayersSearchQuery}
                    onExpandedIdsChange={setExpandedLayerIds}
                    onLeaveLayer={handleLayerLeave}
                    boardElements={
                      viewMode === "overview" ? boardElements : undefined
                    }
                    hoveredLayerId={hoveredCodeLayerNode?.id ?? null}
                    {...layerPanelCallbacks}
                  />
                </div>
              </div>
              <div
                data-design-agent-panel
                className={cn(
                  "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "agent" ? "flex" : "hidden",
                )}
              >
                {hostEmbeddedEditor ? (
                  <div ref={attachHostChatSlot} className="min-h-0 flex-1" />
                ) : canApplyPendingVisualEditsWithAgent ? (
                  <AgentChatSurface
                    mode="panel"
                    className="min-h-0 min-w-0 flex-1 border-0 bg-transparent shadow-none"
                    chatOnly={true}
                    onCollapse={() => setActiveLeftPanel(null)}
                    storageKey={DESIGN_CHAT_STORAGE_KEY}
                    emptyStateText={t("chat.emptyState")}
                    suggestions={designAgentSuggestions}
                    dynamicSuggestions={designAgentSuggestionConfig}
                    scope={designChatScope}
                    chatHistory={designChatHistory}
                    isolateHistoryByScope={true}
                    showScopeBadge={false}
                    showHeader={true}
                    showTabBar={true}
                    browserTabId={browserTabId}
                    onComposerTextChange={handleComposerTextChange}
                    onMessageCountChange={setChatMessageCount}
                    emptyStateFooter={
                      showFirstRunStart ? (
                        <FirstRunStart
                          templates={firstRunTemplates}
                          templatesLoading={firstRunTemplatesQuery.isLoading}
                          applyingTemplateId={applyingTemplateId}
                          onPickTemplate={(templateId) => {
                            void handleFirstRunTemplate(templateId);
                          }}
                        />
                      ) : null
                    }
                    composerSlot={
                      <>
                        {detectedFigmaComposerLink ? (
                          <FigmaLinkComposerBubble
                            link={detectedFigmaComposerLink}
                            designId={id}
                          />
                        ) : null}
                      </>
                    }
                  />
                ) : isVisualEditSurface &&
                  !canApplyPendingVisualEditsWithAgent ? (
                  <div
                    data-design-public-agent-empty-state
                    className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center"
                  >
                    <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <IconClipboard className="size-5" />
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {t("designEditor.pendingVisualStyles.copyPrompt")}
                    </p>
                    <p className="mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
                      {t("designEditor.pendingVisualStyles.agentMessage")}
                    </p>
                  </div>
                ) : (
                  <ReadOnlyEditorPanel
                    title={
                      "Agent chat requires editor access" /* i18n-ignore */
                    }
                    description={
                      "Ask an owner for edit access before using the agent to change this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
              {SHOW_DESIGN_SECONDARY_LEFT_PANELS ? (
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    activeLeftPanel === "assets" ? "flex" : "hidden",
                  )}
                >
                  <div className="flex h-[var(--design-section-height)] shrink-0 items-center border-b border-border/60 px-[var(--design-baseline-unit)]">
                    <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {t("designEditor.leftRail.assets")}
                    </h3>
                  </div>
                  {canEditDesign ? (
                    <AssetLibraryPanel
                      context={designExtensionContext}
                      resolveScreenPoint={resolveAssetScreenPoint}
                    />
                  ) : (
                    <ReadOnlyEditorPanel
                      title={"Assets require editor access" /* i18n-ignore */}
                      description={
                        "Ask an owner for edit access before inserting assets into this design." /* i18n-ignore */
                      }
                    />
                  )}
                </div>
              ) : null}
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "import" ? "flex" : "hidden",
                )}
              >
                {canEditDesign ? (
                  <DesignImportPanel
                    context={designExtensionContext}
                    onImport={(result) => {
                      const count = result.unresolvedImageRefCount ?? 0;
                      if (count > 0 && result.files?.length) {
                        showPastedImagesNotice({
                          count,
                          fileIds: result.files.map((f) => f.id),
                        });
                      }
                    }}
                  />
                ) : (
                  <ReadOnlyEditorPanel
                    title={"Import requires editor access" /* i18n-ignore */}
                    description={
                      "Ask an owner for edit access before importing files into this design." /* i18n-ignore */
                    }
                  />
                )}
              </div>
              {SHOW_DESIGN_SECONDARY_LEFT_PANELS ? (
                <>
                  <div
                    className={cn(
                      "min-h-0 flex-1 flex-col overflow-hidden",
                      activeLeftPanel === "tools" ? "flex" : "hidden",
                    )}
                  >
                    {canEditDesign && !shellMode ? (
                      <DesignExtensionsPanel
                        context={designExtensionContext}
                        hideAssetLibrary
                        title={t("designEditor.leftRail.tools")}
                      />
                    ) : (
                      <ReadOnlyEditorPanel
                        title={"Tools require editor access" /* i18n-ignore */}
                        description={
                          "Ask an owner for editor access before running tools for this design." /* i18n-ignore */
                        }
                      />
                    )}
                  </div>
                  <div
                    className={cn(
                      "min-h-0 flex-1 flex-col overflow-hidden",
                      activeLeftPanel === "tokens" ? "flex" : "hidden",
                    )}
                  >
                    {id && canEditDesign && !shellMode ? (
                      <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        <TokensPanel
                          designId={id}
                          onTokensApplied={handleTokensApplied}
                        />
                      </div>
                    ) : (
                      <ReadOnlyEditorPanel
                        title={"Tokens require editor access" /* i18n-ignore */}
                        description={
                          "Ask an owner for edit access before importing, creating, or applying tokens." /* i18n-ignore */
                        }
                      />
                    )}
                  </div>
                  {SHOW_DESIGN_CODE_LEFT_PANEL ? (
                    <div
                      className={cn(
                        "min-h-0 flex-1 flex-col overflow-hidden",
                        activeLeftPanel === "code" ? "flex" : "hidden",
                      )}
                    >
                      {id && !shellMode ? (
                        <CodeWorkbenchLoader
                          designId={id}
                          activeFileId={routeCodeFileId}
                          activeFilename={routeCodeFilename}
                          selectedNodeId={selectedElementLayerId}
                          selectedSelector={selectedCanvasSelector}
                          canEdit={canEditDesign}
                          onDeleteInlineFile={
                            canEditDesign ? handleDeleteInlineFile : undefined
                          }
                          onActiveFileChange={setActiveCodeFile}
                          localhostConnections={workbenchLocalhostConnections}
                          onRequestLocalWriteConsent={
                            handleWorkbenchLocalWriteConsent
                          }
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
            {activeLeftPanel ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("layersPanel.title")}
                className="absolute right-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
                onPointerDown={(event) => startSidebarResize("left", event)}
              />
            ) : null}
          </div>
        ) : null}

        {/* The docked bar's Close used to live inside a canvas column inset
            by the left rail's width (`leftChromeOverlayInset`). A wide rail
            (the Code panel is 640px) plus a modest window can squeeze that
            column until the bar's own `overflow-hidden` clips Close before
            it clips anything else in the row — the rail sits at z-[70], so a
            squeeze this severe doesn't just crowd Close, it makes it
            unreachable. Anchoring it here instead, to the canvas area's own
            right edge rather than the bar's shrunken one, guarantees a way
            out no matter how little room the rail has left the bar. Height-
            and edge-matched to the bar (h-12, pr-3) so it reads as the same
            row rather than a second floating control. Not needed for the
            floating (minimal-UI) bar: minimal UI hides this rail entirely. */}
        {responsiveInteractActive && !minimalUi ? (
          <div className="pointer-events-none absolute right-0 top-0 z-[80] flex h-12 items-center bg-[var(--design-editor-panel-bg)] pl-1 pr-3">
            <ResponsiveInteractExitButton
              onClose={handleExitResponsiveInteract}
              className="pointer-events-auto"
            />
          </div>
        ) : null}

        {/* Interact owns the running app's surface (same reasoning as the
            Escape hotkey gate): its canvas tools and mode tabs belong to the
            infinite canvas, and ResponsiveInteractBar's Close is the way
            back. */}
        {!hostOwnsChrome &&
          !responsiveInteractActive &&
          designBottomToolbarMode === "editor" &&
          design &&
          !questionFlowActive && (
            <DesignBottomToolbar
              mode={mode}
              pinMode={pinMode}
              drawMode={drawMode}
              activeTool={activeTool}
              shapeTool={shapeTool}
              isOverview={viewMode === "overview"}
              hasActiveFile={Boolean(activeFile)}
              onMove={handleMoveTool}
              onFrame={handleFrameTool}
              frameToolDraws={frameToolDraws}
              onFrameToolDrawsChange={setFrameToolDraws}
              onShape={handleShapeTool}
              onText={handleTextTool}
              onPen={handlePenTool}
              onHand={handleHandTool}
              onDraw={handleDrawTool}
              onScale={handleScaleTool}
              onMediaFiles={handleDesignMediaFiles}
              onCommentPin={handlePinToolToggle}
              onModeChange={handleModeChange}
              shortcutsPanelOpen={keyboardShortcutsOpen}
            />
          )}

        {!hostOwnsChrome && keyboardShortcutsOpen ? (
          <KeyboardShortcutsPanel
            onClose={handleCloseKeyboardShortcuts}
            nudgeAmounts={editorPreferences.nudge}
            onNudgeAmountsChange={(nudge) =>
              setEditorPreferences({ ...editorPreferences, nudge })
            }
          />
        ) : null}

        {/* ── Render: canvas ── */}
        {questionFlowActive ? (
          <div
            className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-panel-bg)]"
            style={{ paddingLeft: leftChromeOverlayInset }}
          >
            <QuestionFlow
              questions={pendingQuestions ?? []}
              onSubmit={handleQuestionsSubmit}
              onSkip={handleQuestionsSkip}
              title={pendingQuestionsTitle}
              description={pendingQuestionsDescription}
              skipLabel={pendingQuestionsSkipLabel}
              submitLabel={pendingQuestionsSubmitLabel}
            />
          </div>
        ) : (
          <CanvasContextMenu
            ref={canvasContextMenuRef}
            selectedCount={selectedElement ? 1 : selectedScreenIds.length}
            layerCandidates={canvasLayerHitCandidates}
            onSelectLayer={handleContextMenuSelectLayer}
            hasClipboard={hasCanvasClipboard}
            hasPropsClipboard={hasPropsClipboard}
            hasAnimationClipboard={hasAnimationClipboard}
            isLocked={activeLayerLocked}
            isHidden={activeLayerHidden}
            labels={{
              selectLayer: t("designEditor.componentInstances.selectLayer"),
              goToMainComponent: t("designEditor.componentInstances.goToMain"),
              swapInstance: t("designEditor.componentInstances.swap"),
              detachInstance: t("designEditor.componentInstances.detach"),
              suggestAutoLayout: t(
                "designEditor.autoLayoutSuggestion.menuLabel",
              ),
              reprompt: t("designEditor.nodeRewrite.regenerate"),
            }}
            // U4/U8: hasCanvasClipboard only reflects copies made in THIS
            // tab/window. Peek the live system clipboard right as the menu
            // opens so a copy made elsewhere is picked up before the
            // Paste/Paste-here items render — otherwise they stay disabled
            // until the user's first same-tab copy even though a real
            // clipboard payload is already sitting in the OS clipboard.
            onOpenChange={(open) => {
              if (!open) {
                setCanvasLayerHitCandidates([]);
                menuClipboardReadIdRef.current += 1;
                menuClipboardFilesRef.current = [];
                setHasSystemClipboardImages(false);
              }
              if (open) {
                const readId = ++menuClipboardReadIdRef.current;
                menuClipboardFilesRef.current = [];
                setHasSystemClipboardImages(false);
                void readSystemClipboard().then((contents) => {
                  if (readId !== menuClipboardReadIdRef.current) return;
                  if (
                    contents?.design &&
                    contents.design.markerText !==
                      lastWrittenClipboardMarkerRef.current
                  ) {
                    adoptDesignClipboardPayload(
                      contents.design.payload,
                      contents.design.markerText,
                      contents.design.plainText,
                    );
                  }
                  menuClipboardFilesRef.current = contents?.files ?? [];
                  setHasSystemClipboardImages(Boolean(contents?.files.length));
                });
              }
            }}
            canPasteHere={
              canEditDesign &&
              (hasCanvasClipboard || hasSystemClipboardImages) &&
              Boolean(activeFile)
            }
            canSelectAll={files.length > 0}
            canZoomToFit={Boolean(activeFile)}
            canZoomToSelection={Boolean(
              selectedElement || selectedScreenIds.length > 0,
            )}
            canCopy={Boolean(
              selectedElement?.selector || selectedScreenIds.length > 0,
            )}
            canPaste={
              canEditDesign &&
              (hasCanvasClipboard || hasSystemClipboardImages) &&
              Boolean(activeFile)
            }
            canPasteOver={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canDuplicate={Boolean(
              canEditActiveVisualScreen &&
              (selectedElement || selectedScreenIds.length > 0),
            )}
            canDelete={Boolean(
              (canEditDesign &&
                (selectedElement ||
                  (selectedScreenIds.length > 0 &&
                    overviewScreens.length > 1))) ||
              (!canEditDesign && canEditSelectedLiveLayer),
            )}
            canReorder={
              (canEditDesign || canEditSingleSelectedLiveLayer) &&
              Boolean(selectedElement)
            }
            canRename={
              (canEditDesign || canEditSingleSelectedLiveLayer) &&
              Boolean(getSingleSelectedRenamableLayerId())
            }
            canToggleLocked={
              (canEditDesign || canEditSelectedLiveLayer) &&
              Boolean(activeLayerId)
            }
            canToggleHidden={
              canEditActiveVisualScreen && Boolean(activeLayerId)
            }
            canCopyProps={Boolean(selectedElement)}
            canPasteProps={
              canEditActiveVisualScreen &&
              hasPropsClipboard &&
              Boolean(selectedElement)
            }
            canCopyAnimation={
              Boolean(selectedElement) && selectedElementHasMotionTrack
            }
            canPasteAnimation={
              canEditDesign && hasAnimationClipboard && Boolean(selectedElement)
            }
            canCopyAsCode={Boolean(
              selectedElement?.selector || selectedScreenIds.length > 0,
            )}
            canCopyAsPng={Boolean(
              canEditDesign &&
              (selectedElement ||
                (viewMode === "overview" && selectedScreenIds.length === 1)),
            )}
            canCopyAsSvg={Boolean(
              canEditDesign &&
              (selectedElement ||
                (viewMode === "overview" && selectedScreenIds.length === 1)),
            )}
            canRotateClockwise={canEditDesign && Boolean(selectedElement)}
            canGroup={canGroup}
            canUngroup={canUngroup}
            canPasteToReplace={
              canEditDesign &&
              (menuClipboardFilesRef.current.length === 1 ||
                getCanvasClipboardEntries().length === 1) &&
              Boolean(selectedElement)
            }
            canFrameSelection={
              canEditDesign &&
              viewMode === "single" &&
              selectedLayerIds.filter(
                (layerId) =>
                  !layerId.startsWith("__") &&
                  !files.some((file) => file.id === layerId),
              ).length >= 1
            }
            canCreateComponent={
              canEditDesign &&
              Boolean(selectedElement) &&
              !selectedElementAlreadyComponent &&
              !selectedElementInsideComponent
            }
            canReprompt={
              canEditDesign &&
              ((Boolean(selectedElement) &&
                activeCanvasSourceType === "inline") ||
                canvasLayerHitCandidates.some((candidate) => {
                  const screen = overviewScreens.find(
                    (item) =>
                      item.id ===
                      (candidate.screenId ?? activeFile?.id ?? activeFileId),
                  );
                  return (
                    Boolean(screen) &&
                    resolveOverviewScreenSourceType(
                      screen!,
                      designSourceType,
                    ) === "inline"
                  );
                }))
            }
            isComponentInstance={
              canEditDesign && Boolean(selectedInstanceActionNodeId)
            }
            canFlipHorizontal={canEditDesign && Boolean(selectedElement)}
            canFlipVertical={canEditDesign && Boolean(selectedElement)}
            canAddAutoLayout={
              canEditDesign &&
              viewMode === "single" &&
              selectedLayerIds.filter(
                (layerId) =>
                  !layerId.startsWith("__") &&
                  !files.some((file) => file.id === layerId),
              ).length >= 1
            }
            canSuggestAutoLayout={canSuggestAutoLayout}
            isUiHidden={uiHidden}
            isCommentsHidden={commentsHidden}
            getCanvasPoint={getContextCanvasPoint}
            onPasteHere={(details) =>
              void handleContextMenuPaste(details.point ?? undefined)
            }
            onSelectAll={handleSelectAllFrames}
            onZoomToFit={handleZoomToFit}
            onZoomToSelection={() => {
              if (viewMode === "overview") {
                handleZoomToSelectionFit();
                return;
              }
              if (selectedElement) setZoom(150);
            }}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onCopy={handleCopySelection}
            onPaste={() => void handleContextMenuPaste()}
            onPasteOver={handlePasteOverSelection}
            onDuplicate={handleDuplicateSelection}
            onDelete={handleDeleteSelection}
            onBringForward={() => changeSelectedZIndex("forward")}
            onBringToFront={() => changeSelectedZIndex("front")}
            onSendBackward={() => changeSelectedZIndex("backward")}
            onSendToBack={() => changeSelectedZIndex("back")}
            onRename={() => {
              const layerId = getSingleSelectedRenamableLayerId();
              if (layerId) layersPanelRef.current?.beginRename(layerId);
            }}
            onToggleLocked={() => {
              if (activeLayerId) {
                handleToggleLayerLocked(activeLayerId, !activeLayerLocked);
              }
            }}
            onToggleHidden={() => {
              if (activeLayerId) {
                handleToggleLayerHidden(activeLayerId, !activeLayerHidden);
              }
            }}
            onGroup={canGroup ? handleGroupSelection : undefined}
            onUngroup={canUngroup ? handleUngroupSelection : undefined}
            onCopyProps={handleCopyProps}
            onPasteProps={handlePasteProps}
            onCopyAnimation={handleCopyAnimation}
            onPasteAnimation={handlePasteAnimation}
            onCopyAsCode={handleCopySelection}
            onCopyAsPng={() => void handleCopyAsPng()}
            onCopyAsSvg={() => void handleCopyAsFigmaSvg()}
            onRotateClockwise={handleRotateSelectionClockwise}
            onPasteToReplace={
              canEditDesign
                ? () => void handlePasteToReplace(menuClipboardFilesRef.current)
                : undefined
            }
            onFrameSelection={canEditDesign ? handleFrameSelection : undefined}
            onCreateComponent={
              canEditDesign ? handleCreateComponentHotkey : undefined
            }
            onReprompt={handleContextMenuReprompt}
            onRepromptLayer={handleContextMenuRepromptLayer}
            onGoToMainComponent={
              canEditDesign ? handleGoToMainComponentMenuAction : undefined
            }
            onSwapInstance={
              canEditDesign ? handleSwapInstanceMenuAction : undefined
            }
            onDetachInstance={
              canEditDesign ? handleDetachInstanceMenuAction : undefined
            }
            onFlipHorizontal={canEditDesign ? handleFlipHorizontal : undefined}
            onFlipVertical={canEditDesign ? handleFlipVertical : undefined}
            onAddAutoLayout={canEditDesign ? handleAddAutoLayout : undefined}
            onSuggestAutoLayout={
              canSuggestAutoLayout ? handleSuggestAutoLayout : undefined
            }
            onToggleUi={handleToggleUi}
            onToggleComments={handleToggleComments}
            appendedItems={
              canOfferBooleanSubtract ? (
                <ContextMenuGroup>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      {t("layersPanel.booleanOperations")}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem
                        onSelect={handleBooleanSubtractSelection}
                      >
                        {t("layersPanel.subtract")}
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                </ContextMenuGroup>
              ) : undefined
            }
          >
            {designIsEmpty &&
            (generating || pendingGenerationActive || generationIssue) ? (
              <GenerationStatusCard
                generating={generating || pendingGenerationActive}
                issue={generationIssue}
                retryablePrompt={retryablePrompt?.prompt ?? null}
                onRetry={handleRetryGeneration}
              />
            ) : viewMode === "overview" || activeFile ? (
              <div
                className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
                style={
                  responsiveInteractActive && leftChromeOverlayInset
                    ? { paddingLeft: leftChromeOverlayInset }
                    : undefined
                }
              >
                {/* Interact's device chrome sits inside the canvas column so
                    the workspace rails stay put — Interact is a different view
                    of the same editor, not a chrome-free takeover. */}
                {responsiveInteractActive && !minimalUi ? (
                  <div className="shrink-0">
                    {renderResponsiveInteractBar(false)}
                  </div>
                ) : null}
                {/* Breakpoint targeting controls live in the selected Screen
                    inspector section instead of over the canvas. */}
                <div
                  ref={canvasContainerRef}
                  data-design-canvas-container
                  className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]"
                  style={
                    {
                      isolation: "isolate",
                      willChange: "opacity",
                      ...(canvasBackground
                        ? {
                            "--design-editor-canvas-bg": canvasBackground,
                          }
                        : {}),
                    } as React.CSSProperties
                  }
                  onPointerMove={handleCanvasPointerMove}
                  onClick={handleCanvasBackgroundClick}
                >
                  {/* Transparent shield that blocks pointer events reaching the
                    iframe when a portaled Radix popover (e.g. color picker) is
                    open. The iframe has its own event context so it receives
                    pointer events even when visually covered by the popover. */}
                  {inspectorPopoverOpen && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 10,
                        pointerEvents: "auto",
                      }}
                    />
                  )}
                  {!isVisualEditSurface &&
                    (designAccessRole === "viewer" ||
                      designAccessRole === "commenter") && (
                      <ReadOnlyDesignBanner
                        pinMode={pinMode}
                        onCommentPin={
                          !hostOwnsChrome && canCommentDesign
                            ? handlePinToolToggle
                            : undefined
                        }
                      />
                    )}
                  {/* Full-app building status/controls. Renders only for
                      designs backed by a fusion app (see readFusionApp) and
                      only while the flag is on — the fusion actions the
                      banner calls are gated on the same flag, so rendering it
                      with the flag off would show controls that all error. */}
                  {fullAppBuildingEnabled && id && fusionApp && (
                    <FusionAppBanner
                      designId={id}
                      status={fusionApp.status}
                      statusMessage={fusionApp.statusMessage}
                      previewUrl={fusionApp.previewUrl}
                      editorUrl={fusionApp.editorUrl}
                      deployedUrl={fusionApp.deployedUrl}
                    />
                  )}
                  {pendingVisualEditPublicationFailed ? (
                    <div
                      data-design-visual-edit-publication-warning
                      role="status"
                      className="pointer-events-none absolute inset-x-0 top-16 z-[70] flex justify-center px-4"
                    >
                      <div className="pointer-events-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {t("designEditor.toasts.codingHandoffError")}
                      </div>
                    </div>
                  ) : null}
                  {showVisualEditApply ? (
                    <div
                      data-design-pending-visual-style-toolbar
                      className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4"
                    >
                      <div className="pointer-events-auto flex w-fit max-w-full items-center overflow-x-auto">
                        <Button
                          className={cn(
                            // guard:allow-raw-color — primary-foreground inverts to near-black in dark mode
                            "h-9 min-w-0 shrink-0 cursor-pointer bg-blue-500 px-3.5 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:ring-blue-400",
                            (!shellMode ||
                              !canApplyPendingVisualEditsWithAgent) &&
                              "rounded-r-none",
                          )}
                          aria-label={t(
                            showSharedVisualEditApply &&
                              canApplyPendingVisualEditsWithAgent
                              ? "designEditor.pendingVisualStyles.applySharedEdits"
                              : canApplyPendingVisualEditsWithAgent
                                ? "designEditor.pendingVisualStyles.applyAria"
                                : "designEditor.pendingVisualStyles.copyPrompt",
                          )}
                          disabled={
                            applyingViaHost ||
                            pendingAgentHandoffBusy ||
                            pendingStructureVerificationBusy
                          }
                          onClick={
                            canApplyPendingVisualEditsWithAgent
                              ? () =>
                                  handleApplyPendingVisualStylesWithAgent(
                                    remoteVisualEditPrompt,
                                  )
                              : () =>
                                  handleCopyPendingVisualStylePrompt(
                                    remoteVisualEditPrompt,
                                  )
                          }
                        >
                          {applyingViaHost ? (
                            <Spinner className="mr-2 h-4 w-4 shrink-0" />
                          ) : null}
                          <span className="truncate">
                            {t(
                              !canApplyPendingVisualEditsWithAgent
                                ? "designEditor.pendingVisualStyles.copyPrompt"
                                : applyingViaHost
                                  ? "designEditor.pendingVisualStyles.applying"
                                  : pendingStructureVerificationBusy
                                    ? "designEditor.pendingVisualStyles.verifying"
                                    : pendingStructureVerificationStatus ===
                                        "conflict"
                                      ? "designEditor.pendingVisualStyles.retryWithAgent"
                                      : showSharedVisualEditApply
                                        ? "designEditor.pendingVisualStyles.applySharedEdits"
                                        : "designEditor.pendingVisualStyles.applyDesignUpdates",
                            )}
                          </span>
                        </Button>
                        {/* Keep explicit copy and cancel available when no in-page agent can receive the handoff. */}
                        {shellMode &&
                        canApplyPendingVisualEditsWithAgent ? null : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                // guard:allow-raw-color — translucent divider on the branded blue Apply button
                                className="h-9 w-8 shrink-0 cursor-pointer rounded-l-none border-l border-white/20 bg-blue-500 px-0 text-white hover:bg-blue-400 focus-visible:ring-blue-400"
                                aria-label={t(
                                  "designEditor.pendingVisualStyles.previewLabel",
                                )}
                              >
                                <IconChevronDown className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="design-editor-app-menu-content w-64"
                              onEscapeKeyDown={(event) =>
                                event.stopPropagation()
                              }
                            >
                              <DropdownMenuLabel className="text-xs text-muted-foreground">
                                {t(
                                  "designEditor.pendingVisualStyles.previewLabel",
                                )}
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleCopyPendingVisualStylePrompt(
                                    remoteVisualEditPrompt,
                                  )
                                }
                              >
                                <IconClipboard className="mr-2 h-4 w-4" />
                                {t(
                                  "designEditor.pendingVisualStyles.copyPrompt",
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleCopyPendingVisualStylePrompt(
                                    remoteVisualEditPrompt,
                                    true,
                                  )
                                }
                              >
                                <IconClipboard className="mr-2 h-4 w-4" />
                                {t(
                                  "designEditor.pendingVisualStyles.copyFullPrompt",
                                )}
                              </DropdownMenuItem>
                              {showSharedVisualEditApply ? null : (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={handleAbortPendingVisualStyles}
                                >
                                  <IconX className="mr-2 h-4 w-4" />
                                  {t(
                                    "designEditor.pendingVisualStyles.abortPreview",
                                  )}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {viewMode === "overview" ||
                  (responsiveInteractActive &&
                    overviewInteractScreenId === activeFileId) ? (
                    <>
                      {/* ── Render: overview canvas ── */}
                      <MultiScreenCanvas
                        screens={overviewScreens}
                        zoom={
                          responsiveInteractActive && overviewInteractScreenId
                            ? interactZoom
                            : overviewCanvasZoom
                        }
                        onZoomChange={
                          responsiveInteractActive && overviewInteractScreenId
                            ? undefined
                            : setExplicitOverviewCanvasZoom
                        }
                        cameraCommand={cameraCommand}
                        suppressLineupRecenter={suppressLineupRecenter}
                        preserveCameraOnScreenCountChange={
                          explicitOverviewCanvasZoom !== null
                        }
                        deferLineupZoomChange={
                          hasExplicitOverviewZoomCommand &&
                          explicitOverviewCanvasZoom === null
                        }
                        chromeInsetLeft={chromeInsetLeft}
                        chromeInsetRight={chromeInsetRight}
                        visibleCanvasRectRef={visibleCanvasRectRef}
                        activeId={activeFileId}
                        selectedScreenIds={overviewSelectedScreenIds}
                        exportPreviewScreenId={exportPreviewScreenId}
                        selectedElementScreenId={selectedElementScreenId}
                        selectedPenPathNodeId={selectedPenPathNodeId}
                        hiddenScreenIds={hiddenLayerIds}
                        lockedScreenIds={lockedLayerIds}
                        fullViewScreenIds={fullViewScreenIds}
                        pendingReviewScreenIds={pendingNodeRewriteScreenIds}
                        onReviewPendingScreen={handleReviewPendingScreen}
                        interactMode={
                          mode === "interact" && !overviewInteractScreenId
                        }
                        interactScreenId={
                          responsiveInteractActive
                            ? overviewInteractScreenId
                            : null
                        }
                        focusedInteractViewport={
                          responsiveInteractActive && overviewInteractScreenId
                            ? interactDeviceSize
                            : null
                        }
                        readOnly={!canEditDesign}
                        editableScreenIds={editableLiveScreenIds}
                        activeScreenHasHoveredChild={
                          Boolean(hoveredElement) &&
                          !hoveredElementIsScreenRoot &&
                          hoveredElementScreenId === activeFileId
                        }
                        hoveredChildScreenId={hoveredChildScreenId}
                        directlyHoveredScreenId={hoveredScreenRootId}
                        previewDeviceFrame={deviceFrame}
                        activeTool={activeTool}
                        reviewResourceId={id}
                        reviewPinMode={pinMode}
                        reviewCommentsHidden={commentsHidden}
                        reviewCanPost={canCommentDesign}
                        reviewCanResolve={canEditDesign}
                        reviewTargetId={null}
                        reviewCurrentUserEmail={session?.email}
                        reviewFocusRequest={reviewFocusRequest}
                        onExitReviewPinMode={handleExitReviewCommentMode}
                        onDispatchCommentToAgent={handleDispatchCommentToAgent}
                        onSendThreadToAgent={handleSendReviewThreadToAgent}
                        reviewSendingThreadId={reviewSendingThreadId}
                        reviewDesignTitle={design?.title}
                        onActiveToolChange={handleOverviewActiveToolChange}
                        onCommentPin={
                          canCommentDesign
                            ? handleOverviewCommentPin
                            : undefined
                        }
                        selectAllRequest={overviewSelectAllRequest}
                        clearSelectionRequest={overviewClearSelectionRequest}
                        onScreenSelectionChange={
                          handleOverviewScreenSelectionChange
                        }
                        geometryById={displayedCanvasFrameGeometryById}
                        geometryOverridesById={optimisticFrameGeometryById}
                        onGeometryChange={queueFrameGeometrySave}
                        onGeometryCommit={handleGeometryCommit}
                        onBreakpointContentHeightChange={
                          handleOverviewBreakpointContentHeightChange
                        }
                        onPrimaryContentHeightChange={
                          handleOverviewPrimaryContentHeightChange
                        }
                        onScreenContentNaturalHeightChange={
                          handleOverviewScreenContentNaturalHeightChange
                        }
                        gradientEditTarget={gradientEditTarget}
                        vectorEdit={vectorEditOverlayState}
                        onCreatePrimitive={handleCreatePrimitive}
                        onPrimitiveCreated={handlePrimitiveCreated}
                        onUpdatePenPath={
                          canEditDesign ? handleUpdatePenPath : undefined
                        }
                        onPrimitiveReparent={handleOverviewPrimitiveReparent}
                        onCrossScreenElementDrop={handleCrossScreenElementDrop}
                        onDropFiles={
                          canEditDesign ? handleOverviewDropFiles : undefined
                        }
                        boardFileId={boardFileId}
                        boardCodeLayerSource={
                          boardFileId
                            ? codeLayerSourceForScreen(boardFileId)
                            : undefined
                        }
                        canvasBackground={canvasBackground}
                        boardIsActive={activeFileId === boardFileId}
                        boardFileContent={boardFileContent}
                        boardFrameGeometry={boardFrameGeometry}
                        boardRuntimeStructureInsertRequest={
                          runtimeStructureInsertRequest?.screenId ===
                          boardFileId
                            ? runtimeStructureInsertRequest
                            : null
                        }
                        boardRuntimeStructureRollbackRequest={
                          runtimeStructureRollbackRequest?.screenId ===
                          boardFileId
                            ? runtimeStructureRollbackRequest
                            : null
                        }
                        runtimeStructurePendingTransactionRef={
                          runtimeStructurePendingTransactionRef
                        }
                        onBoardRuntimeStructureInsertRejected={
                          handleRuntimeStructureInsertRejected
                        }
                        onBoardRuntimeStructureInsertApplied={
                          handleRuntimeStructureInsertApplied
                        }
                        onBoardRuntimeStructureRollbackResult={
                          handleRuntimeStructureRollbackResult
                        }
                        boardClearSelectionRequest={
                          overviewClearSelectionRequest
                        }
                        boardSelectedSelector={
                          selectedBoardCanvasSelectorCandidates[0] ?? null
                        }
                        boardSelectedSelectorCandidates={
                          selectedBoardCanvasSelectorCandidates
                        }
                        boardSelectedSourceId={selectedBoardCanvasSourceId}
                        boardHoveredSelector={
                          hoveredElementScreenId === boardFileId
                            ? hoveredCanvasSelector
                            : null
                        }
                        boardHoveredSelectorCandidates={
                          hoveredElementScreenId === boardFileId
                            ? hoveredCanvasSelectorCandidates
                            : undefined
                        }
                        boardLockedSelectors={
                          boardFileId
                            ? getLayerSelectorsForFile(
                                boardFileId,
                                lockedLayerIds,
                              )
                            : undefined
                        }
                        boardHiddenSelectors={
                          boardFileId
                            ? getLayerSelectorsForFile(
                                boardFileId,
                                hiddenLayerIds,
                              )
                            : undefined
                        }
                        onBoardDrawPrimitive={
                          canEditDesign ? handleBoardDrawPrimitive : undefined
                        }
                        boardEditMode={canEditDesign || publicVisualEdit}
                        onBoardElementSelect={
                          boardFileId ? handleBoardElementSelect : undefined
                        }
                        onBoardSelectionWorldBoundsChange={
                          boardFileId
                            ? handleBoardSelectionWorldBoundsChange
                            : undefined
                        }
                        onBoardElementMarqueeSelect={
                          boardFileId
                            ? handleBoardElementMarqueeSelect
                            : undefined
                        }
                        onBoardElementHover={
                          boardFileId ? handleBoardElementHover : undefined
                        }
                        onBoardElementClear={
                          boardFileId ? handleBoardElementClear : undefined
                        }
                        onBoardIframeHotkey={handleIframeHotkey}
                        onBoardFigmaClipboardPaste={
                          handleCanvasFigmaClipboardPaste
                        }
                        onBoardImagePaste={handleCanvasImagePaste}
                        onBoardIframeContextMenu={handleIframeContextMenu}
                        onBoardTextEditingStateChange={
                          handleBoardTextEditingStateChange
                        }
                        onBoardElementDblClickText={
                          boardFileId
                            ? handleBoardElementDblClickText
                            : undefined
                        }
                        onBoardVisualStyleChange={
                          boardFileId ? handleBoardVisualStyleChange : undefined
                        }
                        onBoardVisualStyleBatchChange={
                          boardFileId
                            ? handleBoardVisualStyleBatchChange
                            : undefined
                        }
                        onBoardVisualStructureChange={
                          boardFileId
                            ? handleBoardVisualStructureChange
                            : undefined
                        }
                        onBoardVisualDuplicateChange={
                          boardFileId
                            ? handleBoardVisualDuplicateChange
                            : undefined
                        }
                        onBoardTextContentChange={
                          boardFileId ? handleBoardTextContentChange : undefined
                        }
                        onCreateScreenFrame={handleCreateScreenFrame}
                        frameToolDraws={frameToolDraws}
                        onDeleteSelection={handleDeleteOverviewSelection}
                        onNudgeSelection={handleOverviewNudgeSelection}
                        nudgeAmounts={editorPreferences.nudge}
                        layoutGrids={layoutGrids}
                        screenRootComputedStylesById={
                          screenRootComputedStylesById
                        }
                        onSelectionChange={handleOverviewScreenSelectionChange}
                        onLayerMarqueeSelectionChange={
                          handleLayerMarqueeSelectionChange
                        }
                        selectedLayerSelectorGroupsByScreen={
                          selectedLayerSelectorGroupsByScreen
                        }
                        onPick={handleOverviewScreenPick}
                        onEdit={handleOverviewFrameAction}
                        onDuplicate={handleDuplicateScreen}
                        onAddBreakpoint={handleOverviewAddBreakpoint}
                        breakpointMutationPending={
                          addBreakpointMutation.isPending ||
                          removeBreakpointMutation.isPending ||
                          updateBreakpointMutation.isPending
                        }
                        onActiveBreakpointChange={
                          handleOverviewActiveBreakpointChange
                        }
                        onRemoveBreakpoint={
                          canEditDesign
                            ? handleOverviewRemoveBreakpoint
                            : undefined
                        }
                        onChangeBreakpointWidth={
                          canEditDesign
                            ? handleOverviewChangeBreakpointWidth
                            : undefined
                        }
                        onEditBreakpoint={handleOverviewEditBreakpoint}
                        renderScreenContent={renderScreenContent}
                        screenContentRenderKey={overviewScreenContentRenderKey}
                        screenSnapshotsById={liveScreenSnapshotsById}
                        tweakValues={cssVarValues}
                        renderBreakpointContent={renderBreakpointContent}
                      />
                      {id &&
                      shouldRenderOverviewReviewCanvas({
                        boardFileId,
                        boardFileContent,
                      }) ? (
                        <ReviewCanvasPins
                          active={pinMode}
                          hidden={commentsHidden}
                          onClose={handleExitReviewCommentMode}
                          canvasSelector="[data-multi-screen-canvas-surface]"
                          showPlacementPlane={false}
                          resourceType="design"
                          resourceId={id}
                          targetId={null}
                          pinRequest={overviewCommentPinRequest}
                          canPost={canCommentDesign}
                          canResolve={canEditDesign}
                          focusRequest={reviewFocusRequest}
                          onDispatchCommentToAgent={
                            canEditDesign
                              ? handleDispatchCommentToAgent
                              : undefined
                          }
                          onSendThreadToAgent={
                            canEditDesign
                              ? handleSendReviewThreadToAgent
                              : undefined
                          }
                          sendingThreadId={reviewSendingThreadId}
                        />
                      ) : null}
                      {/* §6.4 — the compact/full breakpoint bar itself now
                          renders as a non-overlapping chrome row ABOVE
                          canvasContainerRef (see the shared block right
                          before that div's opening tag), not here. */}
                      {/* Presence (overview): the agent's selection ring +
                        fading recent-edit highlights, resolved element-level
                        inside the frame it is editing and positioned over the
                        board. See overview presence pipeline above. */}
                      {overviewAgentOthers.length > 0 && (
                        <RemoteSelectionRings
                          others={overviewAgentOthers}
                          resolveRect={resolveOverviewSelectionRect}
                          containerRef={canvasContainerRef}
                        />
                      )}
                      {overviewRecentEditsForOverlays.length > 0 && (
                        <RecentEditHighlights
                          edits={overviewRecentEditsForOverlays}
                          resolveRect={resolveOverviewRecentEditRect}
                          containerRef={canvasContainerRef}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {/* ── Render: single-screen canvas ── */}
                      <DesignCanvas
                        screenId={activeFile.id}
                        layoutGridStep={activeScreenLayoutGridStep}
                        content={activeContent}
                        contentKey={`${activeFile.id}:${contentRenderRevision}`}
                        styleRevertRequest={
                          pendingVisualStyleRevertRequest
                            ? {
                                requestId:
                                  pendingVisualStyleRevertRequest.requestId,
                                patches:
                                  pendingVisualStyleRevertRequest.patches.filter(
                                    (patch) => patch.screenId === activeFile.id,
                                  ),
                              }
                            : null
                        }
                        pendingStylePreviewPatches={pendingVisualStyleEdits}
                        styleBaselineResetRequest={
                          pendingVisualStyleBaselineResetRequest
                        }
                        textRevertRequest={
                          pendingTextRevertRequest
                            ? {
                                requestId: pendingTextRevertRequest.requestId,
                                patches:
                                  pendingTextRevertRequest.patches.filter(
                                    (patch) => patch.screenId === activeFile.id,
                                  ),
                              }
                            : null
                        }
                        structureAckRequest={
                          pendingStructureAckRequest
                            ? {
                                requestId: pendingStructureAckRequest.requestId,
                                acks: pendingStructureAckRequest.acks.filter(
                                  (ack) => ack.screenId === activeFile.id,
                                ),
                              }
                            : null
                        }
                        runtimeStructureMoveRequest={
                          runtimeStructureMoveRequest?.screenId ===
                          activeFile.id
                            ? runtimeStructureMoveRequest
                            : null
                        }
                        runtimeStructureInsertRequest={
                          runtimeStructureInsertRequest?.screenId ===
                          activeFile.id
                            ? runtimeStructureInsertRequest
                            : null
                        }
                        runtimeStructureDeleteRequest={
                          runtimeStructureDeleteRequest?.screenId ===
                          activeFile.id
                            ? runtimeStructureDeleteRequest
                            : null
                        }
                        runtimeStructureRollbackRequest={
                          runtimeStructureRollbackRequest?.screenId ===
                          activeFile.id
                            ? runtimeStructureRollbackRequest
                            : null
                        }
                        runtimeStructureTargetTransactionId={
                          runtimeStructureDeleteRequest?.rollbackScreenId ===
                          activeFile.id
                            ? runtimeStructureDeleteRequest.transactionId
                            : null
                        }
                        runtimeLayerRenameRequest={runtimeLayerRenameForScreen(
                          activeFile.id,
                        )}
                        runtimeLayerSnapshotRequest={
                          runtimeLayerSnapshotRequest
                        }
                        onRuntimeStructureInsertRejected={
                          handleRuntimeStructureInsertRejected
                        }
                        onRuntimeStructureInsertApplied={
                          handleRuntimeStructureInsertApplied
                        }
                        onRuntimeStructureDeleteApplied={
                          handleRuntimeStructureDeleteApplied
                        }
                        onRuntimeStructureDeleteRejected={
                          handleRuntimeStructureDeleteRejected
                        }
                        onRuntimeStructureRollbackResult={
                          handleRuntimeStructureRollbackResult
                        }
                        onRuntimeLayerRenameApplied={(details) =>
                          handleRuntimeLayerRenameApplied(
                            activeFile.id,
                            details,
                          )
                        }
                        runtimeVerificationRequest={
                          runtimeStructureVerificationRequest?.screenIds.includes(
                            activeFile.id,
                          )
                            ? {
                                requestId:
                                  runtimeStructureVerificationRequest.requestId,
                              }
                            : null
                        }
                        zoom={responsiveInteractActive ? interactZoom : zoom}
                        onZoomChange={
                          responsiveInteractActive ? undefined : setZoom
                        }
                        deviceFrame={deviceFrame}
                        sourceType={activeCanvasSourceType}
                        previewUrlOverride={
                          !activeScreenSnapshotOnly &&
                          activeCanvasSourceType === "localhost"
                            ? previewUrlAtLiveRoute(
                                activeScreenPreviewUrl ?? undefined,
                                liveRoutePathsByScreenIdRef.current[
                                  activeFile.id
                                ],
                              )
                            : undefined
                        }
                        bridgeUrl={activeScreenBridgeUrl}
                        connectionId={
                          activeScreenSnapshotOnly
                            ? undefined
                            : activeOverviewScreen?.connectionId
                        }
                        previewToken={activeScreenPreviewToken}
                        liveEditCapability={
                          activeScreenSnapshotOnly
                            ? undefined
                            : activeScreenLiveEditCapability
                        }
                        liveEditRegistrationCapability={
                          activeScreenSnapshotOnly
                            ? undefined
                            : activeScreenLiveEditRegistrationCapability
                        }
                        onPreviewTokenChange={
                          activeScreenSnapshotOnly
                            ? undefined
                            : handleEffectivePreviewTokenChange
                        }
                        onLiveEditCapabilityChange={
                          activeScreenSnapshotOnly
                            ? undefined
                            : handleLiveEditCapabilityChange
                        }
                        onLiveEditRegistrationCapabilityChange={
                          activeScreenSnapshotOnly
                            ? undefined
                            : handleLiveEditRegistrationCapabilityChange
                        }
                        onRoutePathChange={
                          activeScreenSnapshotOnly
                            ? undefined
                            : handleLiveRoutePathChange
                        }
                        publicVisualEdit={
                          !activeScreenSnapshotOnly && publicVisualEdit
                        }
                        externalSnapshotHtml={
                          activeScreenSnapshotOnly
                            ? undefined
                            : activeScreenExternalSnapshotHtml
                        }
                        snapshotOnly={activeScreenSnapshotOnly}
                        blockPreviewInteraction={
                          remoteVisualEditPending && mode === "interact"
                        }
                        onExternalContentSnapshot={
                          activeScreenSnapshotOnly
                            ? undefined
                            : (snapshot) => {
                                if (!activeFile?.id) return;
                                handleScreenExternalContentSnapshot(
                                  activeFile.id,
                                  snapshot,
                                );
                              }
                        }
                        onRuntimeLayerSnapshot={
                          shouldUseRuntimeLayerProjection({
                            screen: activeOverviewScreen,
                            fallbackSourceType: designSourceType,
                            content: activeContent,
                          })
                            ? handleActiveRuntimeLayerSnapshot
                            : undefined
                        }
                        onReserveVisualEditSnapshot={
                          !activeScreenSnapshotOnly &&
                          canEditDesign &&
                          liveCollaborationEnabled &&
                          id &&
                          activeCanvasSourceType === "localhost"
                            ? reserveVisualEditSnapshot
                            : undefined
                        }
                        onRuntimeVerificationSnapshot={
                          runtimeStructureVerificationRequest?.screenIds.includes(
                            activeFile.id,
                          )
                            ? handleActiveRuntimeVerificationSnapshot
                            : undefined
                        }
                        fusionUrl={designFusionUrl}
                        previewWidthPx={
                          responsiveInteractActive
                            ? interactDeviceSize.width
                            : activeBreakpointWidthState
                        }
                        previewHeightPx={
                          responsiveInteractActive
                            ? interactDeviceSize.height
                            : undefined
                        }
                        shaderFillPreview={shaderFillPreview}
                        onComponentSourceJump={handleComponentSourceJump}
                        motionTracks={motionTracksWire}
                        motionDefaultEase={motionDefaultEase}
                        motionDurationMs={motionDurationMs}
                        gradientEditTarget={inScreenGradientEditTarget}
                        onGradientEditChange={handleInScreenGradientEditChange}
                        statePreviewTarget={statePreviewTarget}
                        editMode={activeScreenSnapshotOnly || mode === "edit"}
                        interactMode={
                          !activeScreenSnapshotOnly && mode === "interact"
                        }
                        centerInteractPreview={responsiveInteractActive}
                        readOnly={!canEditActiveVisualScreen}
                        scaleMode={activeTool === "scale"}
                        handToolActive={activeTool === "hand"}
                        spacePanActive={spacePanActive}
                        activeCreationTool={activeSingleScreenCreationTool}
                        selectedPenPathNodeId={selectedPenPathNodeId}
                        onCreatePrimitive={handleSingleScreenCreatePrimitive}
                        onUpdatePenPath={
                          canEditDesign
                            ? (nodeId, path, nextTool) => {
                                const updated = activeFile
                                  ? handleUpdatePenPath(
                                      activeFile.id,
                                      nodeId,
                                      path,
                                    )
                                  : false;
                                if (updated && nextTool) {
                                  setActiveTool(nextTool);
                                }
                                return updated;
                              }
                            : undefined
                        }
                        onDropFiles={
                          canEditDesign
                            ? handleSingleScreenDropFiles
                            : undefined
                        }
                        clearSelectionRequest={overviewClearSelectionRequest}
                        selectedSelector={selectedCanvasSelector}
                        selectedSelectorCandidates={
                          selectedCanvasSelectorCandidates
                        }
                        selectedSelectorGroups={
                          activeFile
                            ? (selectedLayerSelectorGroupsByScreen[
                                activeFile.id
                              ] ?? [])
                            : []
                        }
                        hoveredSelector={hoveredCanvasSelector}
                        hoveredSelectorCandidates={
                          hoveredCanvasSelectorCandidates
                        }
                        lockedSelectors={lockedLayerSelectors}
                        hiddenSelectors={hiddenLayerSelectors}
                        onElementSelect={handleElementSelect}
                        onElementMarqueeSelect={handleElementMarqueeSelect}
                        onElementHover={handleElementHover}
                        onEditorDragStateChange={handleEditorDragStateChange}
                        onClearSelection={() => {
                          setSelectedElement(null);
                          setHoveredElement(null);
                          setHoveredElementScreenId(null);
                          setSelectedLayerIdsState([]);
                          setOverviewClearSelectionRequest(
                            (request) => request + 1,
                          );
                        }}
                        onIframeHotkey={handleIframeHotkey}
                        onFigmaClipboardPaste={handleCanvasFigmaClipboardPaste}
                        onImagePaste={handleCanvasImagePaste}
                        onIframeContextMenu={handleIframeContextMenu}
                        onVisualStyleChange={handleVisualStyleChange}
                        onVisualStyleBatchChange={(changes) =>
                          handleKScaleStyleBatchChange(activeFile.id, changes)
                        }
                        onVisualStructureChange={handleVisualStructureChange}
                        onVisualDuplicateChange={handleVisualDuplicateChange}
                        onTextContentChange={handleTextContentChange}
                        onTextEditingStateChange={(state) =>
                          handleTextEditingStateChangeForScreen(
                            activeFile.id,
                            state,
                          )
                        }
                        onElementDblClickText={handleElementDblClickText}
                        tweakValues={cssVarValues}
                        drawMode={drawMode}
                        onExitDrawMode={() => {
                          handleExitFocusedDrawMode();
                        }}
                        drawOverlayResetSignal={focusedAnnotationResetSignal}
                        retainDrawOverlayWhenHidden
                        onAnnotationSendingChange={
                          handleFocusedAnnotationSendingChange
                        }
                        pinMode={pinMode}
                        commentPinsHidden={commentsHidden}
                        onExitPinMode={handleExitReviewCommentMode}
                        designId={id}
                        reviewCanPost={canCommentDesign}
                        reviewCanResolve={canEditDesign}
                        reviewCurrentUserEmail={session?.email}
                        reviewFocusRequest={reviewFocusRequest}
                        onDispatchCommentToAgent={
                          canEditDesign
                            ? handleDispatchCommentToAgent
                            : undefined
                        }
                        onSendThreadToAgent={
                          canEditDesign
                            ? handleSendReviewThreadToAgent
                            : undefined
                        }
                        reviewSendingThreadId={reviewSendingThreadId}
                        designTitle={design?.title}
                        commentContextId={`${id}:${activeFile.id}`}
                        commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(activeFile.filename)}`}
                        repromptDraftRequest={
                          repromptDraftRequest?.fileId === activeFile.id
                            ? repromptDraftRequest
                            : null
                        }
                        nodeRewriteCanvasTarget
                        onRepromptDraftConsumed={handleRepromptDraftConsumed}
                        onPrototypeNavigate={(screen) => {
                          if (!screen) return;
                          const norm = (s: string) =>
                            s
                              .replace(/^\.?\//, "")
                              .replace(/\.html?$/i, "")
                              .toLowerCase();
                          const target = norm(screen);
                          if (!target) return;
                          const match = files.find(
                            (f) => norm(f.filename) === target,
                          );
                          if (match) {
                            handleModeChange("interact", {
                              targetFileId: match.id,
                            });
                          }
                        }}
                      />
                      {/* §6.4 — the breakpoint bar itself now renders as a
                          non-overlapping chrome row ABOVE canvasContainerRef
                          (see the shared block right before that div's
                          opening tag), not here. */}
                      {/* Presence: remote selection rings (human peers + AI),
                          resolved into the active screen's iframe. */}
                      {others.length > 0 && (
                        <RemoteSelectionRings
                          others={othersForOverlays}
                          resolveRect={resolveSelectionRect}
                          containerRef={canvasContainerRef}
                        />
                      )}
                      {/* Presence: lingering fading highlights over regions a
                          peer or the AI just edited. */}
                      {recentEditsForOverlays.length > 0 && (
                        <RecentEditHighlights
                          edits={recentEditsForOverlays}
                          resolveRect={resolveRecentEditRect}
                          containerRef={canvasContainerRef}
                        />
                      )}
                      {/* Presence: live cursor overlay for remote participants.
                          The AI gets a synthesized cursor derived from its
                          current edit target (see othersWithAgentCursor). */}
                      {othersWithAgentCursor.length > 0 && (
                        <LiveCursorOverlay
                          others={othersWithAgentCursor}
                          containerRef={canvasContainerRef}
                        />
                      )}
                    </>
                  )}
                  {/* This overview annotation overlay is deliberately outside
                      the overview/single subtree. Entering a focused screen
                      hides it without unmounting it, so board-wide work is
                      still available when the user returns. Its reset signal
                      is separate from DesignCanvas's focused-screen batch. */}
                  <SharedDrawOverlay
                    visible={
                      viewMode === "overview" && drawMode && mode === "annotate"
                    }
                    clearSignal={overviewAnnotationResetSignal}
                    scopeKey="overview"
                    retainSurfaceWhenHidden
                    zoom={100}
                    onClose={handleExitOverviewDrawMode}
                    onSend={handleSendOverviewAnnotations}
                    sending={overviewAnnotationSending}
                  />
                </div>
              </div>
            ) : null}
          </CanvasContextMenu>
        )}

        {/* ── Render: right rail ── */}
        {rightSidebarVisible ? (
          <div
            ref={rightSidebarContentRef}
            data-design-chrome-region="right-panel"
            className={rightInspectorPanelClassName(minimalUi)}
            style={{ width: rightSidebarWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("editPanel.properties")}
              className="absolute left-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
              onPointerDown={(event) => startSidebarResize("right", event)}
            />
            {rightSidebarActions}
            {mode === "edit" ? (
              <div className="min-h-0 flex-1">
                <EditPanel {...editPanelProps} width={rightSidebarWidth} />
              </div>
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </div>
        ) : null}

        {minimalUi && !hostOwnsChrome ? (
          <div
            data-design-minimal-ui
            className="pointer-events-none absolute inset-x-0 top-0 z-[90]"
          >
            <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-start gap-3 px-3 pt-3">
              <div
                data-design-minimal-bar="left"
                className="pointer-events-auto flex h-10 min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] px-1 shadow-xl"
              >
                <AgentNativeMenuMark className="mx-1 size-5 shrink-0 text-foreground dark:text-white" />
                <div className="min-w-0 flex-1 px-1">{projectTitleControl}</div>
                {minimalUiToggle}
              </div>
              <div
                data-design-minimal-bar="interact"
                className="pointer-events-none flex min-w-0 justify-center"
              >
                {responsiveInteractActive
                  ? renderResponsiveInteractBar(true)
                  : null}
              </div>
              {!rightSidebarVisible || uiHidden ? (
                <div
                  data-design-minimal-bar="right"
                  className="pointer-events-auto min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-[var(--design-editor-panel-bg)] shadow-xl md:max-w-[680px]"
                >
                  {rightSidebarActions}
                </div>
              ) : (
                <div aria-hidden="true" style={{ width: rightSidebarWidth }} />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Render: mobile inspector sheet ── */}
      {!hostOwnsChrome &&
      !uiHidden &&
      !initialGenerationChromeLimited &&
      mode === "edit" ? (
        <Sheet
          open={
            minimalUi
              ? isMobileViewport && minimalInspectorHasSelection
              : undefined
          }
          onOpenChange={
            minimalUi
              ? (nextOpen) => {
                  if (nextOpen) return;
                  setSelectedElement(null);
                  setSelectedLayerIdsState([]);
                  setOverviewSelectedScreenIds([]);
                }
              : undefined
          }
        >
          {!minimalUi ? (
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="fixed right-3 top-14 z-[75] size-9 rounded-full shadow-lg md:hidden"
                aria-label={t("editPanel.properties")}
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </Button>
            </SheetTrigger>
          ) : null}
          <SheetContent
            side="right"
            className="w-[min(92vw,360px)] overflow-hidden p-0 md:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("editPanel.properties")}</SheetTitle>
            </SheetHeader>
            <div className="h-full min-h-0 pt-8">
              <EditPanel {...editPanelProps} width={320} />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* ── Render: dialogs ── */}
      <PendingVisualStyleWarningDialog
        open={pendingVisualStyleWarningOpen}
        pendingVisualEditCount={pendingVisualEditCount}
        onStay={handleStayOnPendingVisualStyleNavigation}
        onDiscardAndNavigate={handleDiscardPendingVisualStylesAndNavigate}
      />

      <AutoLayoutSuggestionDialog
        open={autoLayoutSuggestionPreview !== null}
        suggestion={autoLayoutSuggestionPreview?.suggestion ?? null}
        onOpenChange={(open) => {
          if (!open) setAutoLayoutSuggestionPreview(null);
        }}
        onApply={handleApplyAutoLayoutSuggestion}
      />

      <FigmaHydrationDialog
        open={figmaHydrationOpen}
        onOpenChange={setFigmaHydrationOpen}
        designId={id ?? ""}
        fileIds={figmaHydrationFileIds}
        onHydrated={() => {
          void queryClient.invalidateQueries({ queryKey: ["action"] });
        }}
      />

      {/* ── Render: motion dock ── */}
      {/* Motion dock (§6.3) — bottom timeline mounted while opening, open, or
          closing. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe; track/duration edits autosave through apply-motion-edit. */}
      {!hostOwnsChrome &&
      SHOW_DESIGN_SECONDARY_LEFT_PANELS &&
      !initialGenerationChromeLimited &&
      activeFile &&
      motionDockMounted ? (
        <MotionDock
          tracks={motionTracks}
          durationMs={motionDurationMs}
          defaultEase={motionDefaultEase}
          open={motionDockOpen}
          onOpenChange={setMotionDockOpenAnimated}
          onExitComplete={handleMotionDockExitComplete}
          onTracksChange={handleMotionTracksChange}
          onDurationChange={handleMotionDurationChange}
          canvasIframeRef={canvasIframeRef}
          autoKeyframe={motionAutoKeyframeEnabled}
          onAutoKeyframeChange={setMotionAutoKeyframeEnabled}
          playhead={motionPlayhead}
          onPlayheadChange={setMotionPlayhead}
          livePlayheadRef={motionLivePlayheadRef}
          selectedTarget={motionSelectedTarget}
          applying={motionAutosavePending}
        />
      ) : null}

      {/* ── Render: prompt popovers ── */}
      <PromptPopover
        scopeDraftsToOrg={isSignedIn}
        open={showPrompt}
        onOpenChange={handlePromptOpenChange}
        title={t("designEditor.generateDesign")}
        placeholder={t("designEditor.generatePlaceholder")}
        onSubmit={async (
          prompt: string,
          files: UploadedFile[],
          options: PromptComposerSubmitOptions,
        ) => {
          if (isBuilderDesignEmbed) {
            window.parent.postMessage(
              {
                type: "agentNative.submitChat",
                data: { message: prompt, submit: true },
              },
              parentOriginRef.current ?? window.location.origin,
            );
            handlePromptOpenChange(false);
            return;
          }
          if (!canEditDesign) return;
          if (!creativeContextLab.isSuccess) {
            const issue = t("designEditor.generationStoppedRetry");
            setGenerationIssue(issue);
            throw new Error(issue);
          }
          const designSystemId = selectedPromptDesignSystemId;
          persistPromptDesignSystem(designSystemId);
          const fileContext = formatUploadedFileContext(files);
          const images = imageAttachmentsFromUploadedFiles(files);
          const designSystemContext =
            await loadDesignSystemGenerationContext(designSystemId);
          const shouldExploreVariants =
            promptRequestsVariantExploration(prompt);
          const intake =
            shouldExploreVariants || !creativeContextEnabled
              ? null
              : await (async () => {
                  await creativeContextPersistRef.current?.catch(() => {});
                  return loadIntakeContextFromAppState(
                    readCreativeContextState,
                    creativeContextEnabled,
                  );
                })();
          const shouldSkipQuestions =
            shouldExploreVariants ||
            (intake ? allIntakeTopicsCovered(intake.coverage) : false);
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            designSystemId ? `Design system id: "${designSystemId}"` : "",
            designSystemContext,
            fileContext,
            "",
            ...(shouldExploreVariants
              ? designVariantGenerationDirectives(id, designSystemId)
              : shouldSkipQuestions
                ? [
                    ...designGenerationDirectives(id, designSystemId),
                    ...(intake?.explicitContext &&
                    intake.precedent.status === "strong"
                      ? designPrecedentDirectives(
                          intake.precedent.contextId,
                          intake.precedent.matches,
                          id,
                        )
                      : []),
                  ]
                : designIntakeQuestionDirectives(
                    id,
                    designSystemId,
                    0,
                    intake
                      ? {
                          coverage: intake.coverage,
                          contextUnavailable: intake.unavailable,
                          unavailableReason: intake.unavailableReason,
                        }
                      : undefined,
                  )),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          generationModelRef.current = {
            model: options.model,
            engine: options.engine,
            effort: options.effort,
          };
          const startedAt = Date.now();
          const { attachments: _composerAttachments, ...agentOptions } =
            options;
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            designSystemId,
            ...options,
            attempt: 1,
            startedAt,
          });
          setHasPendingGeneration(true);
          const runTabId = agentSubmit(prompt, context, {
            ...agentOptions,
            newTab: true,
            images,
          });
          setGenerationChatTabId(runTabId);
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            designSystemId,
            ...options,
            runTabId,
            attempt: 1,
            startedAt,
          });
          handlePromptOpenChange(false);
        }}
        loading={
          generating ||
          (designSystemsLoading && promptDesignSystemId === undefined)
        }
        anchorRef={promptAnchorRef}
        designSystems={designSystemOptions}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={selectedPromptDesignSystemId}
        onDesignSystemChange={setPromptDesignSystemId}
        creativeContexts={creativeContextEnabled ? creativeContextOptions : []}
        creativeContextsLoading={
          creativeContextEnabled && creativeContextsQuery.isLoading
        }
        selectedCreativeContextId={
          creativeContextEnabled
            ? (creativeContextState.state.selectedContextId ?? null)
            : undefined
        }
        onCreativeContextChange={
          creativeContextEnabled ? handleCreativeContextChange : undefined
        }
        onCreateDesignSystem={() => {
          handlePromptOpenChange(false);
          void navigate("/design-systems/setup");
        }}
      />
      <PromptPopover
        scopeDraftsToOrg={isSignedIn}
        open={showTweakPrompt && tweaksEnabled}
        onOpenChange={handleTweakPromptOpenChange}
        title={t("designEditor.tweaksPromptTitle")}
        placeholder={t("designEditor.tweaksPlaceholder")}
        onSubmit={handleTweakPromptSubmit}
        loading={false}
        anchorRef={tweakPromptAnchorRef}
      />

      {/* §6.6 — "Make this a real app" dialog.
          Three states:
          1. Idle — confirm prompt with description of what will happen.
          2. Migrating — spinner while the Builder cloud agent accepts the job.
          3. Success — branchName + url; sourceType already flipped to fusion.
          4. Not-configured — CTA to connect Builder.io.
      */}
      <MakeRealDialog
        open={makeRealDialogOpen}
        onOpenChange={setMakeRealDialogOpen}
        result={migrationResult}
        pending={migrateMutation.isPending}
        onConfirm={handleConfirmMakeReal}
      />

      {id ? (
        <HistoryPanel
          designId={id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEditDesign}
          onRestored={() => {
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design", { id }],
            });
          }}
        />
      ) : null}

      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        defaultTitle={design.title}
        defaultDescription={design.description ?? ""}
        screenCount={getOverviewScreenFileIds(files).length}
        lockedLayerCount={durableLockedLayerCount}
        saving={saveDesignAsTemplateMutation.isPending}
        onSave={async (values) => {
          try {
            await saveDesignAsTemplateMutation.mutateAsync({
              designId: id,
              ...values,
            });
            setSaveTemplateOpen(false);
            toast.success(t("designEditor.templateSaved"));
            await queryClient.invalidateQueries({
              queryKey: ["action", "list-design-templates"],
            });
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : t("designEditor.templateSaveFailed"),
            );
          }
        }}
      />

      {/* ── Render: node rewrite and localhost dialogs ── */}
      {id && activeNodeRewriteProposal ? (
        <NodeRewriteProposalPanel
          designId={id}
          fileId={activeNodeRewriteProposal.fileId}
          canvasSelector='[data-node-rewrite-canvas-target="true"]'
          proposalSnapshot={activeNodeRewriteProposal}
        />
      ) : null}

      {/* Localhost write-consent dialog: shown when the agent or editor wants to
          persist an edit to a local HTML/CSS source file and no valid grant
          exists for the active connection yet. */}
      {id && (activeLocalhostConnectionId || localhostConsentConnectionId) && (
        <LocalhostWriteConsentDialog
          open={localhostWriteConsentOpen}
          onOpenChange={(next) => {
            if (!next) {
              localhostWriteConsentPayload?.onCancel();
              setLocalhostWriteConsentPayload(null);
            }
            setLocalhostWriteConsentOpen(next);
          }}
          designId={id}
          connectionId={localhostConsentConnectionId}
          payload={localhostWriteConsentPayload}
        />
      )}
      {id ? (
        <AddLocalhostScreenDialog
          open={addLocalhostScreenOpen}
          onOpenChange={setAddLocalhostScreenOpen}
          designId={id}
          connectionId={addLocalhostScreenConnectionId}
          fallbackPaths={addLocalhostScreenFallbackPaths}
          position={addLocalhostScreenPosition}
        />
      ) : null}
    </div>
  );
}
