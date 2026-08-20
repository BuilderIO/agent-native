// ── Imports ──────────────────────────────────────────────────────────────────
import {
  generateTabId,
  AgentChatSurface,
  setAgentChatContextItem,
  removeAgentChatContextItem,
  useAgentChatContext,
} from "@agent-native/core/client/agent-chat";
import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useCollaborativeDoc,
  isReconcileLeadClient,
  dedupeCollabUsersByEmail,
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
import { openCommandMenu } from "@agent-native/core/client/navigation";
import {
  useReviewComments,
  useSendReviewThreadToAgent,
  type ReviewThread,
} from "@agent-native/core/client/review";
import { ShareButton } from "@agent-native/core/client/sharing";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import type { ReviewComment } from "@agent-native/core/review";
import {
  normalizeDocumentTitle,
  withBuilderUtmTrackingParams,
} from "@agent-native/core/shared";
import {
  CreativeContextShareTab,
  parseCreativeContexts,
  useCreativeContexts,
  useCreativeContextState,
  readCreativeContextState,
} from "@agent-native/creative-context/client";
import {
  LiveCursorOverlay,
  RemoteSelectionRings,
  RecentEditHighlights,
} from "@agent-native/toolkit/collab-ui";
import {
  computeReparentedChildPosition,
  isBoardFile,
  normalizePoisonedBoardNestedCoords,
  stripBoardSurfaceOffsetFromCoord,
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
  parseCanvasFrameGeometryById,
  type CanvasFrameGeometry,
  type CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import { getFrameGroupBounds, type FrameBounds } from "@shared/canvas-math";
import { resolveSourceCapabilities } from "@shared/capability-resolver";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
  type CodeLayerTreeNode,
  type MoveNodeEditIntent,
} from "@shared/code-layer";
import { isComponentInstance } from "@shared/component-model";
import type { A11yFinding } from "@shared/design-review";
import {
  DESIGN_CAPABILITY_NAMES,
  hasCapability,
} from "@shared/design-source-capabilities";
import { FULL_APP_BUILDING, readFusionApp } from "@shared/full-app";
import { shouldUseLiveFileContent } from "@shared/html-content";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import type { InteractionState } from "@shared/interaction-states";
import { countLockedLayersAcrossFiles } from "@shared/locked-layers";
import {
  compile as compileMotionTimeline,
  injectManagedMotionCss,
} from "@shared/motion-compiler";
import type { MotionAnimationClip, MotionEase } from "@shared/motion-timeline";
import {
  copyLayerAnimation,
  createMotionTrackFromPreset,
  MOTION_PROPERTY_PRESETS,
  pasteLayerAnimation,
  sortMotionKeyframes,
  upsertMotionKeyframeAtTime,
} from "@shared/motion-timeline";
import {
  designRepromptPendingStateKey,
  designRepromptProposalStateKey,
  isNodeRewriteProposal,
  isPendingDesignReprompt,
  type NodeRewriteProposal,
} from "@shared/node-rewrite";
import { parsePenNodes, type PenPath } from "@shared/pen-path";
import {
  breakpointUpperBoundPx,
  utilityStem,
} from "@shared/responsive-classes";
import { createElementReviewAnchor } from "@shared/review-anchor";
import { readDesignReviewSummary } from "@shared/review-summary";
import {
  isRunningAppSourceType,
  normalizeDesignSourceType,
} from "@shared/source-mode";
import { sourceContentHash } from "@shared/source-workspace";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconArrowsDown,
  IconPencil,
  IconPlus,
  IconLayoutGrid,
  IconX,
  IconPin,
  IconCode,
  IconArchive,
  IconPhoto,
  IconRefresh,
  IconChevronDown,
  IconCheck,
  IconDownload,
  IconClipboard,
  IconFileExport,
  IconFileStack,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconRocket,
  IconExternalLink,
  IconCircleCheck,
  IconTerminal2,
  IconLink,
  IconKeyboard,
  IconTemplate,
  IconAdjustmentsHorizontal,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
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
} from "@/components/design/CanvasContextMenu";
import { type CodeWorkbenchActiveFile } from "@/components/design/code-workbench/CodeWorkbench";
import { CodeWorkbenchLoader } from "@/components/design/code-workbench/CodeWorkbenchLoader";
import type { CreatePrimitiveSpec } from "@/components/design/design-canvas/creation";
import { sanitizeLocalhostSourceSnapshotHtml } from "@/components/design/design-canvas/external-preview";
import type {
  IframeContextMenuPayload,
  IframeHotkeyPayload,
  IframeImagePastePayload,
} from "@/components/design/design-canvas/iframe-events";
import type { MotionTrackWire } from "@/components/design/design-canvas/motion-types";
import { trace } from "@/components/design/design-trace";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import {
  AssetLibraryPanel,
  DesignExtensionsPanel,
  type DesignExtensionSlotContext,
} from "@/components/design/DesignExtensionsPanel";
import { DesignImportPanel } from "@/components/design/DesignImportPanel";
import { dndHostLog } from "@/components/design/dnd-debug";
import { inspectCodeDataForElement } from "@/components/design/edit-panel/inspect-code-source";
import {
  mergeRotationValue,
  parseRotationValue,
} from "@/components/design/edit-panel/transform-helpers";
import { nextTextDecorationLineValue } from "@/components/design/edit-panel/typography-helpers";
import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { DesignBottomToolbar } from "@/components/design/editor/DesignBottomToolbar";
import type { DesignCollaborator } from "@/components/design/editor/DesignCollaborators";
import { DesignCollaboratorsMenu } from "@/components/design/editor/DesignCollaborators";
import {
  DesignWorkspaceRail,
  INITIAL_GENERATION_DISABLED_LEFT_PANELS,
} from "@/components/design/editor/DesignWorkspaceRail";
import type { DesignMigrationResult } from "@/components/design/editor/MakeRealDialog";
import { MakeRealDialog } from "@/components/design/editor/MakeRealDialog";
import { PendingScreenDeletionDialog } from "@/components/design/editor/PendingScreenDeletionDialog";
import { PendingVisualStyleWarningDialog } from "@/components/design/editor/PendingVisualStyleWarningDialog";
import { ReadOnlyEditorPanel } from "@/components/design/editor/ReadOnlyEditorPanel";
import { SaveTemplateDialog } from "@/components/design/editor/SaveTemplateDialog";
import {
  EditPanel,
  isTextElement,
  type DocumentColorSourceFile,
  type InspectCodeData,
  type InspectorTab,
  type ScreenGeometrySelection,
  type StyleChangeMeta,
} from "@/components/design/EditPanel";
import { FigmaHydrationDialog } from "@/components/design/FigmaHydrationDialog";
import { FusionAppBanner } from "@/components/design/FusionAppBanner";
import {
  beginEyedropperPick,
  hasEyeDropperSupport,
  type ExportSettingsValue,
} from "@/components/design/inspector";
import {
  isShaderWriteInFlight,
  waitForShaderWriteToSettle,
} from "@/components/design/inspector/GlslShaderPanel";
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
import { getBoardSurfaceContentBounds } from "@/components/design/multi-screen/board-surface-html";
import { validateCrossScreenSourceHtmlSnapshot } from "@/components/design/multi-screen/cross-screen-drop";
import {
  getCanonicalScreenStack,
  getInitialFrameGeometry,
  getResponsiveScreenCullGeometry,
  getScreenPreviewViewport,
  reorderCanonicalScreenStack,
} from "@/components/design/multi-screen/frame-geometry";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
  getPrimaryIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import type {
  CanvasLayerMarqueeSelection,
  CanvasPrimitiveInsert,
  FrameGeometry,
  GradientEditOverlayTarget,
  MultiScreenCanvasTool,
  Point,
  VectorEditOverlayState,
} from "@/components/design/multi-screen/types";
import { isWheelCameraGestureActive } from "@/components/design/multi-screen/wheel-gesture-state";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { ReadOnlyDesignBanner } from "@/components/design/ReadOnlyDesignBanner";
import { ResponsiveInteractBar } from "@/components/design/ResponsiveInteractBar";
import { type ReviewCommentsPanelProps } from "@/components/design/ReviewCommentsPanel";
import type { ReviewPanelProps } from "@/components/design/ReviewPanel";
import { TokensPanel } from "@/components/design/TokensPanel";
import type {
  CanvasLayerHitCandidate,
  ElementInfo,
  ElementSelectionIntent,
  DeviceFrameType,
  PortableStyleSnapshot,
  RuntimeStructureInsertRequest,
  RuntimeStructureMoveRequest,
} from "@/components/design/types";
import { DEVICE_FRAME_VIEWPORTS } from "@/components/design/types";
import {
  FigmaLinkComposerBubble,
  useDetectedFigmaComposerLink,
} from "@/components/editor/FigmaLinkComposerBubble";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RepromptDraftRequest } from "@/components/visual-editor";
import {
  DrawOverlay as SharedDrawOverlay,
  type DrawAnnotation,
} from "@/components/visual-editor/DrawOverlay";
import { NodeRewriteProposal as NodeRewriteProposalPanel } from "@/components/visual-editor/NodeRewriteProposal";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useEditorPreferences } from "@/hooks/use-editor-preferences";
import {
  designEditorCommandKey,
  designSelectionStateKeysForTab,
  type DesignEditorCommand,
} from "@/hooks/use-navigation-state";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import {
  isDesignHotkeyEditableTarget,
  isShowKeyboardShortcutsHotkey,
  useDesignHotkeys,
  type DesignHotkeyAlignEdge,
  type DesignHotkeyDistributeAxis,
} from "@/hooks/useDesignHotkeys";
import {
  DESIGN_CHAT_STORAGE_KEY,
  sendDesignSourceHandoffAndConfirm,
  sendToDesignAgentChat,
  sendToDesignAgentChatAndConfirm,
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
  plainTextFromDesignHtml,
  getDesignClipboardTrustToken,
  readDesignClipboardPayloadFromDataTransfer,
  readDesignClipboardPayloadFromSystem,
  writeDesignClipboard,
} from "@/lib/design-clipboard";
import {
  extractDesignClipboardManagedStyles,
  type DesignClipboardManagedStyleSnapshot,
} from "@/lib/design-clipboard-managed-styles";
import {
  type DesignClipboardPayload,
  type DesignClipboardScreenEntry,
  getFigmaClipboardContent,
  importResultSummary,
  type ImportResult,
  serializeDesignClipboardPayload,
} from "@/lib/design-import";
import {
  acknowledgeDesignSaveOutboxEntry,
  createDesignSaveOutboxEntry,
  discardDesignSaveOutboxEntry,
  drainDesignSaveOutbox,
  journalDesignSaveOutboxEntry,
  updateFileResultPersistedContent,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import { DESIGN_UI_TOGGLE_EVENT } from "@/lib/design-ui-events";
import { isEmbedChromeRequested } from "@/lib/embed-chrome";
import { resolveFigmaPasteImportCall } from "@/lib/figma-clipboard";
import {
  canCopyFigmaSvgToClipboard,
  copyDesignAsFigmaSvg,
  exportDesignAsFigmaSvg,
  FigmaSvgCopyError,
  type LiveFigmaSvgSnapshot,
  type LiveFigmaSvgSource,
} from "@/lib/figma-svg-copy";
import { nodeRepromptSubtreeExcerpt } from "@/lib/node-reprompt";
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
  externalPreviewUrlForContent,
  fullPreviewHtml,
} from "@/pages/design-editor/preview-html";

import { actionErrorDetail } from "./design-editor/action-error";
import {
  applyAutoLayoutSuggestion,
  hasMeaningfulCssTransform,
  inferAutoLayoutSuggestion,
  isExistingFlowLayout,
  type AutoLayoutSuggestion,
} from "./design-editor/auto-layout-suggestion";
import {
  appendCanvasPrimitiveToHtml,
  blankScreenHtml,
  extractCanvasPrimitiveHtml,
  nextBlankScreenFilename,
  nextDuplicatedFilename,
  normalizedDesignFileType,
  reassignDuplicatedNodeIds,
  uniqueLayerId,
} from "./design-editor/canvas-primitive-insert";
import {
  createPrimitiveInsertFromSpec,
  parsePenPathFromSerializedD,
} from "./design-editor/canvas-primitives";
import { resolveClipboardLayerSourceHtml } from "./design-editor/clipboard-layer-source";
import {
  cloneHtmlLayerAtPosition,
  extractLayerPosition,
  getElementOuterHtml,
  insertClonedHtmlLayer,
  prepareClonedHtmlLayersForLiveInsert,
  preserveClipboardLayerName,
  setPenNodesAttributeOnElement,
  writeBackVectorEditedPenPath,
} from "./design-editor/clone-and-pen-edit";
import {
  bridgeSourceIdForCodeLayerNode,
  canonicalElementInfoForCodeLayerNode,
  canonicalizeElementInfoFromProjection,
  codeLayerNodeLooksLikeComponent,
  codeLayerNodeMatchesBridgeTarget,
  codeLayerPatchMessage,
  codeLayerSelectorAliases,
  codeLayerSelectorMatches,
  codeLayerTreeToPanelNodes,
  collectCodeLayerAncestors,
  collectCodeLayerSubtreeDataNodeIds,
  collectEffectiveCodeLayerState,
  resolveCodeLayerTargetFromBridge,
  resolveCodeLayerTargetFromElementInfo,
  type EffectiveCodeLayerState,
  elementInfoFromCodeLayerNode,
  elementInfoIsRuntimeOnly,
  ensureGoogleFontLinkInHtml,
  findCodeLayerSiblingOrder,
  findMovedCodeLayerNodeInProjection,
  isClientRenderedMountShell,
  isCodeLayerNodeRuntimeOnly,
  liveDeleteSelectorGroups,
  liveNudgeReorderHandoff,
  nudgeBaseContentForScreen,
  preferredCodeLayerSelector,
  refreshElementInfoFromContent,
  refreshSelectedLayerIdsFromContent,
  removeEmptyGeneratedGroupWrappers,
  renameFilenamePreservingExtension,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
  resolveSelectedCodeLayerNode,
  runtimeLayerStateHandoffMode,
  type SelectedLayerTarget,
  shouldDeleteThroughLiveScreen,
} from "./design-editor/code-layer-state";
import {
  resolveScreenCollabSyncTarget,
  shouldApplyRemotePreviewContent,
  shouldRebaseCollabDocFromStoredContent,
} from "./design-editor/collab-sync";
import type {
  ResponsiveEditScope,
  RetryablePrompt,
  CanvasLayerClipboardEntry,
  CodingHandoffResult,
  DesignCanvasEmbeddedFrame,
  LiveScreenSnapshot,
  PatchProofState,
  PatchProofStatus,
  PendingStructureVerificationSession,
  PendingStructureVerificationSource,
  PendingStructureVerificationStatus,
  PostAuthDesignIntent,
  RuntimeLayerSnapshot,
  SelectedCanvasLayerSnapshot,
  ShareExportFormat,
} from "./design-editor/command-types";
import { runAddAutoLayout } from "./design-editor/commands/add-auto-layout";
import { runAddScreen } from "./design-editor/commands/add-screen";
import { runAlignSelection } from "./design-editor/commands/align-selection";
import { runApplyDesignEditorCommand } from "./design-editor/commands/apply-design-editor-command";
import { runApplyFileContentUpdate } from "./design-editor/commands/apply-file-content-update";
import { runApplyLocalContentUpdate } from "./design-editor/commands/apply-local-content-update";
import { runApplyPendingVisualStylesWithAgent } from "./design-editor/commands/apply-pending-visual-styles-with-agent";
import { runApplyToSource } from "./design-editor/commands/apply-to-source";
import { runCanMoveLayer } from "./design-editor/commands/can-move-layer";
import { runChangeSelectedZIndex } from "./design-editor/commands/change-selected-z-index";
import { runCommitRelativeStyleDeltaToSelectedLayers } from "./design-editor/commands/commit-relative-style-delta-to-selected-layers";
import { runCommitStylesToSelectedLayers } from "./design-editor/commands/commit-styles-to-selected-layers";
import { runCommitVisualStyles } from "./design-editor/commands/commit-visual-styles";
import { runConfirmMakeReal } from "./design-editor/commands/confirm-make-real";
import { runCopyAsFigmaSvg } from "./design-editor/commands/copy-as-figma-svg";
import { runCopySelection } from "./design-editor/commands/copy-selection";
import { runCreatePrimitive } from "./design-editor/commands/create-primitive";
import { runCreateScreenFrame } from "./design-editor/commands/create-screen-frame";
import { runCrossScreenElementDrop } from "./design-editor/commands/cross-screen-element-drop";
import { runDeleteFiles } from "./design-editor/commands/delete-files";
import { runDeleteSelection } from "./design-editor/commands/delete-selection";
import { runDetachInstanceMenuAction } from "./design-editor/commands/detach-instance-menu-action";
import { runDistributeSelection } from "./design-editor/commands/distribute-selection";
import { runDownloadAllScreensPdf } from "./design-editor/commands/download-all-screens-pdf";
import { runDownloadPdf } from "./design-editor/commands/download-pdf";
import { runDownloadSvg } from "./design-editor/commands/download-svg";
import { runDuplicateScreen } from "./design-editor/commands/duplicate-screen";
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
import { runImportFigmaClipboardIntoDesign } from "./design-editor/commands/import-figma-clipboard-into-design";
import { runLayerMarqueeSelectionChange } from "./design-editor/commands/layer-marquee-selection-change";
import { runLayerMove } from "./design-editor/commands/layer-move";
import { runLayerMoveToScreen } from "./design-editor/commands/layer-move-to-screen";
import { runLayerRename } from "./design-editor/commands/layer-rename";
import { runLayerSelectionChange } from "./design-editor/commands/layer-selection-change";
import { runModeChange } from "./design-editor/commands/mode-change";
import { runNudgeSelection } from "./design-editor/commands/nudge-selection";
import { runOverviewPrimitiveReparent } from "./design-editor/commands/overview-primitive-reparent";
import { runPasteCopiedScreens } from "./design-editor/commands/paste-copied-screens";
import { runPasteOverSelection } from "./design-editor/commands/paste-over-selection";
import { runPasteSelection } from "./design-editor/commands/paste-selection";
import { runPasteToReplace } from "./design-editor/commands/paste-to-replace";
import { runPastedImageFiles } from "./design-editor/commands/pasted-image-files";
import { runPersistFrameGeometrySave } from "./design-editor/commands/persist-frame-geometry-save";
import { runPrimitiveCreated } from "./design-editor/commands/primitive-created";
import { runRecordPendingLiveLayerStateEdit } from "./design-editor/commands/record-pending-live-layer-state-edit";
import { runRecordPendingLiveStructureEdit } from "./design-editor/commands/record-pending-live-structure-edit";
import { runRecordPendingLiveTextEdit } from "./design-editor/commands/record-pending-live-text-edit";
import { runRecordPendingVisualStyleEdit } from "./design-editor/commands/record-pending-visual-style-edit";
import { runRedo } from "./design-editor/commands/redo";
import { runRenderPngBlob } from "./design-editor/commands/render-png-blob";
import { runSaveFileContent } from "./design-editor/commands/save-file-content";
import { runScreenElementSelect } from "./design-editor/commands/screen-element-select";
import { runScreenTextContentChange } from "./design-editor/commands/screen-text-content-change";
import { runScreenVisualDuplicateChange } from "./design-editor/commands/screen-visual-duplicate-change";
import { runScreenVisualStructureChange } from "./design-editor/commands/screen-visual-structure-change";
import { runScreenVisualStyleChange } from "./design-editor/commands/screen-visual-style-change";
import { runSendOverviewAnnotations } from "./design-editor/commands/send-overview-annotations";
import { runSendRuntimeLayerMoveSemanticHandoff } from "./design-editor/commands/send-runtime-layer-move-semantic-handoff";
import { runSendRuntimeLayerSemanticHandoff } from "./design-editor/commands/send-runtime-layer-semantic-handoff";
import { runSendRuntimeLayerStateSemanticHandoff } from "./design-editor/commands/send-runtime-layer-state-semantic-handoff";
import { runStartRetryGeneration } from "./design-editor/commands/start-retry-generation";
import { runStartSidebarResize } from "./design-editor/commands/start-sidebar-resize";
import { runStyleChange } from "./design-editor/commands/style-change";
import { runStylesChange } from "./design-editor/commands/styles-change";
import { runSuggestAutoLayout } from "./design-editor/commands/suggest-auto-layout";
import { runTextContentChange } from "./design-editor/commands/text-content-change";
import { runTidyUp } from "./design-editor/commands/tidy-up";
import { runToggleLayerHidden } from "./design-editor/commands/toggle-layer-hidden";
import { runToggleLayerLocked } from "./design-editor/commands/toggle-layer-locked";
import { runToggleMotionKeyframe } from "./design-editor/commands/toggle-motion-keyframe";
import { runTweakPromptSubmit } from "./design-editor/commands/tweak-prompt-submit";
import { runUndo } from "./design-editor/commands/undo";
import { runUngroupSelection } from "./design-editor/commands/ungroup-selection";
import { runVisualDuplicateChange } from "./design-editor/commands/visual-duplicate-change";
import { runVisualStructureChange } from "./design-editor/commands/visual-structure-change";
import { runWriteFrameGeometrySnapshot } from "./design-editor/commands/write-frame-geometry-snapshot";
import { getCreatedScreenNavigationPlan } from "./design-editor/created-screen-navigation";
import {
  designPrecedentDirectives,
  loadCreativeContextPrecedent,
} from "./design-editor/creative-context-precedent";
import {
  adaptAutoTextColorForCrossScreenNode,
  clearAutoTextColorMarkerOnExplicitColorCommit,
} from "./design-editor/cross-screen-text-color";
import {
  applyDesignDataOperations,
  buildFrameGeometryDataOperations,
  clearAcknowledgedDesignDataOperationsThroughRevision,
  compactDesignDataOperations,
  getDesignBreakpointWidths,
  getDesignCanvasBackground,
  sanitizeCanvasBackground,
  pendingDesignDataOperations,
  stagePendingDesignDataOperations,
  type DesignDataOperation,
  type PendingDesignDataOperations,
} from "./design-editor/data-operations";
import { deriveDesignBreakpoints } from "./design-editor/derive/design-breakpoints";
import { deriveOverviewScreens } from "./design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
  getDesignDataRecord,
  isDesignData,
  nextLocalhostScreenPosition,
  parseDesignDataJson,
  staleGeometryFrameIds,
  viewportChangedFrameIds,
} from "./design-editor/design-data-geometry-utils";
import { isRadixOverlayOpen } from "./design-editor/dom-guards";
import { escapeHtmlAttributeValue } from "./design-editor/dom-utils";
import { useTweaks } from "./design-editor/domains/use-tweaks";
import {
  AUTO_RETRY_DELAY_MS,
  BOARD_SURFACE_SIZE,
  DESIGN_EDITOR_DEBUG_LOGS,
  DESIGN_SELECTION_ZOOM_SAVE_DELAY_MS,
  EMPTY_TEXT_CLEANUP_RETRY_MS,
  HOST_CHAT_SLOT_MESSAGE,
  LOCALHOST_COMPILED_SOURCE_EXTENSIONS,
  LOCALHOST_WRITE_EXTENSIONS,
  MAX_GENERATION_ATTEMPTS,
  MIN_FRAME_SIZE_PX,
  MOTION_AUTOSAVE_DELAY_MS,
  MOTION_DOCK_EXIT_FALLBACK_MS,
  MOTION_DOCK_EXIT_SETTLE_MS,
  MOTION_DOCK_TRANSITION_MS,
  NO_LOCALHOST_CONNECTION_MESSAGE,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
  NO_LOCALHOST_WRITE_PATH_MESSAGE,
  OVERVIEW_ZOOM_THRESHOLD,
  PENDING_STRUCTURE_RUNTIME_POLL_MS,
  PENDING_STRUCTURE_RUNTIME_TIMEOUT_MS,
  PENDING_STRUCTURE_SOURCE_POLL_MS,
  PENDING_STRUCTURE_VERIFICATION_TIMEOUT_MS,
  STORED_RUN_LIVENESS_GRACE_MS,
  TWEAK_CONTROLS_EDIT_ACCESS_MESSAGE,
} from "./design-editor/editor-constants";
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
  shouldAdoptExternalReconcileContent,
  shouldCheckpointAgentContent,
  TAB_ID,
} from "./design-editor/editor-session";
import {
  applyRelativeDeltaToStyleValue,
  type FileContentSaveRequest,
  flushFileContentSavesOnBackground,
  flushPendingFileContentSavesOnCleanup,
  getDesignEditorShareUrl,
  getDesignEditorStateUrlSearch,
  getFreshActiveFileContent,
  getFreshScreenContent,
  getLayerMoveIterationOrder,
  getLayerMoveSourceContent,
  getLocalhostRouteSourceFile,
  getPersistedContentHostSyncOptions,
  isStandaloneHttpUrl,
  previewContentReplaceNeedsRenderFallback,
  removeUndoRedoOrderKind,
  resolveLocalhostSourceWriteContent,
  resolveOptimisticTextDecorationLine,
  resolveServerFiles,
  shouldClearLatestUnloadSave,
  shouldReplacePreviewAfterVisualStyleCommit,
  shouldRetirePendingLocalFileContent,
  shouldSendKeepalive,
  shouldSkipVisualStyleCommitForPreview,
  type OptimisticTextDecorationLineEntry,
  type PreviewContentReplaceResult,
  type UndoRedoOrderKind,
} from "./design-editor/editor-state";
import { runAdoptDbFileContent } from "./design-editor/effects/adopt-db-file-content";
import { runMirrorSelectionToAgentChat } from "./design-editor/effects/mirror-selection-to-agent-chat";
import { runMotionAutosave } from "./design-editor/effects/motion-autosave";
import { runObserveCollabText } from "./design-editor/effects/observe-collab-text";
import { runPublishAgentSelectionContext } from "./design-editor/effects/publish-agent-selection-context";
import { runResumePendingGeneration } from "./design-editor/effects/resume-pending-generation";
import { runSeedCollabContent } from "./design-editor/effects/seed-collab-content";
import {
  buildStaticForeignObjectSvg,
  createMultiPageRasterPdf,
  createSinglePageRasterPdf,
  getExportCompositeBounds,
  PDF_MIN_PRINT_RASTER_SCALE,
  type RasterPdfPage,
  resolveRasterExportScale,
  stripNonStaticXmlAttributes,
  waitForExportReady,
} from "./design-editor/export-capture";
import {
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
  designVariantGenerationDirectives,
  formatTweakDefinitionsContext,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
  loadDesignSystemGenerationContext,
  promptRequestsVariantExploration,
} from "./design-editor/generation-prompt-directives";
import {
  geometrySnapshotsEqual,
  sanitizeCanvasFrameGeometryForPersist,
} from "./design-editor/geometry-persistence";
import {
  applyGeometryHistoryDiff,
  type ContentHistoryChange,
  type ContentHistoryEntry,
  type FileCreationHistoryEntry,
  type FileDeletionHistoryEntry,
  filterFileDeletionHistoryEntry,
  finalizeTextCreationHistory,
  findLastContentHistoryChangeIndex,
  contentHistoryScopeForViewMode,
  getAvailableContentHistoryChanges,
  getContentHistoryChanges,
  type GeometryHistoryEntry,
  type GeometryHistorySelection,
  type PendingTextCreationHistory,
  MAX_DESIGN_UNDO_STACK,
  mergeLocalContentHistoryFallback,
  pruneFileCreationHistoryStack,
  pruneGeometryHistoryEntryForDeletedFiles,
  remapFileDeletionHistoryEntryIds,
  removeRecentUndoRedoOrderKinds,
} from "./design-editor/history";
import {
  getAbsolutePositioningForNodeInHtml,
  getBodyInlineStyles,
  isAbsoluteCodeLayerNode,
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
  setCodeLayerAttributeInHtml,
  setFlowPositioningOverrideForNodeInHtml,
  warnIfPoisonedBoardCoordsNormalized,
} from "./design-editor/html-layer-positioning";
import { createLatestWriteQueue } from "./design-editor/latest-write-queue";
import {
  hasScopedLayerState,
  layerStateIdsForScreen,
  scopedLayerStateId,
} from "./design-editor/layer-state-scope";
import {
  type AlignableRect,
  computeAlignedPositions,
  computeDistributedPositions,
  computeOverlapReflowGeometry,
  computeTidyPositions,
  inferAutoLayoutFromChildren,
  mergeAuthoredAndLiveRect,
  type ReflowCandidate,
} from "./design-editor/layout-operations";
import { prepareLiveScreenLayerDrop } from "./design-editor/live-screen-layer-drop";
import { measureFreeformGeometry } from "./design-editor/measure-child-rects";
import {
  applyMotionAutoKeyframesForStyles,
  computedMotionStyleValue,
  hydrateMotionDockTracks,
  MOTION_KEYFRAME_TIME_EPSILON,
  type MotionTimelineQueryResult,
  motionTimelineFingerprint,
} from "./design-editor/motion-state";
import {
  resolveElementNudgeIntent,
  resolveNudgeIntent,
} from "./design-editor/nudge-intent";
import {
  collectOverviewAnnotationViewportMap,
  formatOverviewAnnotationMessage,
} from "./design-editor/overview-annotation-context";
import {
  clampOverviewDisplayZoom,
  clampZoom,
  computeIframeLocalCanvasPoint,
  findScreenFrameAtCanvasPoint,
  getAllScreenFrameEntries,
  getDefaultOverviewCanvasZoom,
  getNextZoomStepDown,
  getNextZoomStepUp,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewZoomScale,
  getScreenFrameOriginCanvas,
  resolveOverviewZoomBasisScreenId,
  resolveScreenEntryZoom,
  resolveZoomUpdate,
  readOverviewZoomPercentFromTransform,
  resolveScreenDropPoint,
  shouldDeferOverviewZoomCommand,
  shouldPopToOverviewOnZoomChange,
  shouldResetExplicitOverviewZoomOnBasisChange,
} from "./design-editor/overview-camera";
import { resolvePastePlacementForSelection } from "./design-editor/paste-placement";
import {
  applyInteractionStateStyleCommit,
  applyScopedVisualStyleEdit,
  buildPendingVisualStyleRevertPatches,
  deriveStatePreviewTarget,
  formatPendingVisualStylePrompt,
  getPendingVisualEditCount,
  mergePendingLiveNonStyleEdits,
  mergePendingVisualStyleEdits,
  originalStylesForPendingVisualEdit,
  type PendingLiveLayerStateEdit,
  pendingLiveStructureEditsMatch,
  pendingLiveLayerStateUndoRevertValue,
  projectRelativeSourcePath,
  reactSourceAnchorForPendingEdit,
  reactSourceAnchorUnavailableReason,
  type PendingLiveNonStyleEdit,
  type PendingLiveNonStyleUndoEntry,
  type PendingLiveStructureEdit,
  type PendingLiveStructureUndoEntry,
  type PendingLiveTextEdit,
  pendingLiveTextUndoRevertValue,
  pendingStructureEditSourcePaths,
  pendingStructureRedoCommand,
  type PendingVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  type PendingVisualStyleUndoEntry,
  pendingVisualStyleUndoRevertStyles,
  resolveOverviewScreenSourceType,
  shouldPreferRuntimeLayerProjection,
  shouldUseRuntimeLayerProjection,
  resolveVisualStyleCommitContent,
  shouldBlockPendingVisualStyleNavigation,
  shouldRedoPendingLiveNonStyleBeforeStyle,
  shouldShowPendingVisualStyleApply,
} from "./design-editor/pending-edits";
import { usePendingLiveEditUnloadGuard } from "./design-editor/pending-live-edit-unload-guard";
import { verifyPendingStructuresRuntime } from "./design-editor/pending-structure-verification";
import { usePerformanceBufferGuard } from "./design-editor/performance-buffer-guard";
import {
  blurActiveDesignEditableTarget,
  cropCanvasToRect,
  PngCaptureError,
  removeEditorChromeOverlays,
  renderExportDocumentCanvas,
  resolveExportCropRect,
  sanitizeSerializedXmlForSvg,
  type PngCaptureScope,
} from "./design-editor/png-export-render";
import { applyPortableStyleSnapshotToHtml } from "./design-editor/portable-style";
import {
  buildReactSemanticHandoff,
  buildRuntimeReactLayerStateHandoff,
  buildRuntimeReactStructureMoveHandoff,
  resolveRuntimeStructureMoveExecutionMode,
} from "./design-editor/react-semantic-handoff";
import {
  computeInteractZoomToFit,
  DEFAULT_INTERACT_DEVICE_PRESET,
  findInteractDevicePreset,
  INTERACT_CUSTOM_DEVICE_NAME,
  resolveInteractDeviceForScreen,
} from "./design-editor/responsive-interact";
import {
  classifyDesignSaveFailure,
  designSaveErrorMessage,
} from "./design-editor/save-failure";
import {
  enableInlineScreenAutoLayout,
  getRuntimeScreenAutoLayoutSubjectIds,
} from "./design-editor/screen-auto-layout";
import {
  applyInlineStylesToHtml,
  DEFAULT_STATES_PANEL_BREAKPOINTS,
  designEditorCommandFromSearchParams,
  designStatePreviewHtml,
  findDesignFileByScreenTarget,
  type DesignStatePreviewRow,
} from "./design-editor/screen-command-utils";
import {
  buildActiveFileNodeIdSet,
  computeOverviewScreenPickSelectionIds,
  dedupeStringIds,
  getOverviewEnterTarget,
  getOverviewScreenIdsFromLayerSelection,
  getOverviewScreenContentKey,
  getOverviewScreenRuntimeReplacementKey,
  getSelectedScreenGeometryForInspector,
  getSelectedScreenIdsForEditorState,
  getSidebarCodeLayerSelectionState,
  hasSelectableCodeLayerParent,
  isScreenRootElementInfo,
  overviewSelectionTargetsElement,
  pendingEditTargetsSelectedElement,
  resolveAvailableActiveFileId,
  resolveEscapePopSelectionAction,
  sameStringIds,
  shouldClearBridgeSelectionOnEmptyMarquee,
  shouldClearSelectionForReviewThreadTarget,
  shouldEscapeToOverview,
  shouldIgnoreOverviewLayerCreationEcho,
  shouldLimitEditorChromeUntilContentReady,
  shouldMirrorSelectedElementToAgentChat,
  shouldIncludeScreenRenameContentOverride,
  shouldUseOverviewRuntimeReplacement,
} from "./design-editor/selection-state";
import {
  isTextEditSessionOutcome,
  postShaderFillPreviewClearToPreviewIframes,
  removeElementFromHtml,
  scheduleBeginTextEditForScreen,
  updateElementContentInHtml,
} from "./design-editor/text-edit-utils";
import {
  getDesignToolActivationState,
  getDesignBottomToolbarMode,
  getSingleScreenCreationTool,
  isSingleScreenAnnotationTool,
  normalizeDesignLeftPanel,
  normalizeDesignMode,
  normalizeDesignTool,
  resolveModeChangeView,
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

/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */
/* i18n-ignore */

// ── Route wrapper — remounts editor state per design id ──────────────────────
/**
 * React Router reuses the same route component when only `:id` changes. Key
 * the stateful editor by design id so pending refs, collaboration docs, tools,
 * selections, and per-screen caches from one design can never leak into the
 * next design during client-side navigation.
 */
export default function DesignEditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <DesignEditor key={id ?? "missing-design"} />;
}

function DesignEditor() {
  // ── Session, route params, design identity ─────────────────────────────────
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { session, isLoading: sessionLoading } = useSession();
  const isSignedIn = Boolean(session?.email);
  const sessionResolved = !sessionLoading;
  const designSaveActorScope = session?.userId ?? "anonymous";
  const navigate = useNavigate();
  const location = useLocation();
  // Long overview sessions (pan/zoom/select/undo across many screens) build
  // up a very large native `performance.measure` buffer from React/Radix dev
  // instrumentation (see performance-buffer-guard.ts) — bound it so a long
  // session's JS heap doesn't grow from that alone.
  usePerformanceBufferGuard();
  const initialEditorUrlRef = useRef<{
    designId: string | undefined;
    searchParams: URLSearchParams;
  } | null>(null);
  if (
    !initialEditorUrlRef.current ||
    initialEditorUrlRef.current.designId !== id
  ) {
    initialEditorUrlRef.current = {
      designId: id,
      searchParams: new URLSearchParams(location.search),
    };
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
  /**
   * Shell mode: the host drives the whole canvas over `design:init` and nothing
   * is persisted, so there is no design row to read and no session to hold.
   */
  const shellMode = id === SHELL_DESIGN_ID;
  // The shell route is host-embedded by definition and carries no embed session,
  // so every `embedded` behaviour below would otherwise read as a standalone
  // Design page and put our own chrome and agent inside Builder's.
  const embedded = shellMode || isEmbedAuthActive();
  // The shell keeps our rails and hands the host only the chat, so it must not
  // depend on `embedChrome` surviving in the URL Builder builds.
  const hostOwnsChrome = embedded && !shellMode && !isEmbedChromeRequested();
  // Framed by a host that supplies the chat but not the canvas chrome: our
  // rails stay, our agent surface does not.
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
    // A hidden panel measures 0x0. That is "not on screen", so the host hides
    // its chat instead of pinning it to a degenerate box.
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
  // A callback ref, not an effect: the slot unmounts with the whole sidebar,
  // and switching panels only changes its box, which the observer already sees.
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

  // ── Tool, mode, zoom, camera, and view state ───────────────────────────────
  // Editor state
  const [mode, setMode] = useState<EditorMode>("edit");
  const [activeTool, setActiveTool] = useState<DesignTool>("move");
  // The frame tool draws a top-level SCREEN or a plain FRAME container. Made
  // explicit because deciding it from where the drag started is unguessable.
  const [frameToolDraws, setFrameToolDraws] = useState<"screen" | "frame">(
    "frame",
  );
  // The persisted pin round-trips through the server, but content measurement
  // fires as soon as the iframe loads. Without a synchronous local pin the
  // frame grows to the device floor and snaps back once metadata lands.
  const locallyPinnedHeightIdsRef = useRef<Set<string>>(new Set());
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [screenZoom, setScreenZoom] = useState(FOCUSED_SCREEN_ZOOM);
  // MultiScreenCanvas owns overview pan, so every external reveal/fit request
  // (including a screen that was just created) travels through this bounded
  // camera command rather than remounting the canvas or imperatively reaching
  // into its DOM. Keeping the command state with the rest of the editor view
  // state also lets creation handlers issue the reveal in the same React
  // commit that selects the optimistic file, avoiding a one-frame flash at the
  // old camera position.
  const [cameraCommand, setCameraCommand] = useState<{
    fitBounds: FrameBounds;
    nonce: number;
    paddingScreenPx?: number;
  } | null>(null);
  const cameraCommandNonceRef = useRef(0);
  // Per-screen zoom memory for single-screen mode: remembers each screen's
  // last zoom level (keyed by file id) so re-entering a screen restores where
  // the user left off instead of always resetting to FOCUSED_SCREEN_ZOOM. A
  // ref (not state) since this is a passive cache read by enterSingleScreen,
  // not something that should trigger a render on its own.
  const screenZoomByIdRef = useRef<Map<string, number>>(new Map());
  const [explicitOverviewCanvasZoom, setExplicitOverviewCanvasZoom] = useState<
    number | null
  >(null);
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrameType>("none");
  // Responsive Interact device box. Kept separate from `zoom` (the canvas
  // camera) because this scales a literal device viewport, not the canvas.
  const [interactDeviceName, setInteractDeviceName] = useState(
    DEFAULT_INTERACT_DEVICE_PRESET.name,
  );
  const [interactDeviceSize, setInteractDeviceSize] = useState({
    width: DEFAULT_INTERACT_DEVICE_PRESET.width,
    height: DEFAULT_INTERACT_DEVICE_PRESET.height,
  });
  const [interactZoom, setInteractZoom] = useState(100);
  const [viewMode, setViewMode] = useState<"single" | "overview">("overview");
  const viewModeRef = useRef<"single" | "overview">("overview");
  // Trusted parent origin captured from the first validated inbound message.
  // Used to restrict outgoing postMessage calls that carry user data so they
  // are never broadcast to an arbitrary embedding page.
  const parentOriginRef = useRef<string | null>(null);
  // ── Selection and pending live-edit state ──────────────────────────────────
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  // The host's chat is the only chat here, so a canvas selection has to reach
  // its composer to be usable as context.
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
  // Committed selection for synchronous reads in the echo-loop guard. Synced
  // during render (not an effect) so it has no lag on any setSelectedElement path.
  const selectedElementRef = useRef(selectedElement);
  selectedElementRef.current = selectedElement;
  // Vector-edit mode (P5 integration): active while the user is editing a
  // committed pen path's anchors/handles on the overview canvas. `path` is
  // the LIVE working copy (path-local coordinates, matching pen-path.ts);
  // `originCanvas` is recomputed from the owning screen's current frame
  // geometry on every render (see vectorEditOverlayState below) rather than
  // stored here, so dragging/resizing the screen frame while editing doesn't
  // leave the overlay pinned to a stale position. null when not editing.
  const [vectorEditingState, setVectorEditingState] = useState<{
    screenId: string;
    nodeId: string;
    path: PenPath;
  } | null>(null);
  const [pendingVisualStyleEdits, setPendingVisualStyleEdits] = useState<
    PendingVisualStyleEdit[]
  >([]);
  const [pendingLiveNonStyleEdits, setPendingLiveNonStyleEdits] = useState<
    PendingLiveNonStyleEdit[]
  >([]);
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
      }>;
    } | null>(null);
  const [pendingStructureAckRequest, setPendingStructureAckRequest] = useState<{
    requestId: number;
    acks: Array<{ screenId: string; requestId: string; applied: boolean }>;
  } | null>(null);
  const [runtimeStructureMoveRequest, setRuntimeStructureMoveRequest] =
    useState<(RuntimeStructureMoveRequest & { screenId: string }) | null>(null);
  const runtimeStructureMoveRevisionRef = useRef(0);
  const [runtimeStructureInsertRequest, setRuntimeStructureInsertRequest] =
    useState<(RuntimeStructureInsertRequest & { screenId: string }) | null>(
      null,
    );
  const runtimeStructureInsertRevisionRef = useRef(0);
  const [
    runtimeStructureVerificationRequest,
    setRuntimeStructureVerificationRequest,
  ] = useState<{ requestId: number; screenIds: string[] } | null>(null);
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
  const localhostConnectionRootPathByIdRef = useRef<Map<string, string>>(
    new Map(),
  );
  const pendingVisualStyleUndoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
  const pendingVisualStyleRedoStackRef = useRef<PendingVisualStyleUndoEntry[]>(
    [],
  );
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
  const cancelPendingStructureVerification = useCallback(
    (nextStatus: PendingStructureVerificationStatus = "idle") => {
      const session = pendingStructureVerificationSessionRef.current;
      if (!session && nextStatus !== "idle") return;
      if (session) session.cancelled = true;
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
      if (session) session.cancelled = true;
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
        }));
      const structureAcks = edits
        .filter(
          (edit): edit is PendingLiveStructureEdit =>
            edit.kind === "structure" && Boolean(edit.requestId),
        )
        .map((edit) => ({
          screenId: edit.screenId,
          requestId: edit.requestId!,
          applied: false,
        }));
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
    },
    [],
  );
  // A handoff the host only prefilled. Its edits stay pending until a host turn
  // settles, which is the one signal that the prompt was actually run.
  // "awaiting-start" until the host reports generating: a turn that was already
  // running when Apply was clicked would otherwise settle and be read as ours.
  const stagedSourceHandoffRef = useRef<"idle" | "awaiting-start" | "running">(
    "idle",
  );
  const stagedHandoffStartTimerRef = useRef<number | undefined>(undefined);
  const [applyingViaHost, setApplyingViaHost] = useState(false);
  const clearPendingLiveEditState = useCallback(() => {
    stagedSourceHandoffRef.current = "idle";
    setApplyingViaHost(false);
    if (stagedHandoffStartTimerRef.current !== undefined) {
      window.clearTimeout(stagedHandoffStartTimerRef.current);
      stagedHandoffStartTimerRef.current = undefined;
    }
    cancelPendingStructureVerification();
    pendingVisualStyleUndoStackRef.current = [];
    pendingVisualStyleRedoStackRef.current = [];
    pendingLiveNonStyleUndoStackRef.current = [];
    pendingLiveNonStyleRedoStackRef.current = [];
    pendingStructureRedoReplayRef.current = undefined;
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    pendingVisualStyleEditsRef.current = [];
    pendingLiveNonStyleEditsRef.current = [];
    setPendingVisualStyleEdits([]);
    setPendingLiveNonStyleEdits([]);
  }, [cancelPendingStructureVerification]);
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
  // ── Text editing, hover, sidebar, and layers-panel state ───────────────────
  const [textEditingState, setTextEditingState] = useState<{
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }>({ active: false });
  // T23: overview mode renders many DesignCanvas iframes simultaneously (one
  // per screen, plus the board), and ALL of them share the single global
  // textEditingState above. Each iframe posts its own text-editing-state
  // messages independently, so a stale/out-of-order active:false from a
  // BACKGROUND screen (e.g. its own edit session ending slightly late) could
  // clobber the currently-active screen's active:true state, breaking style
  // panel range-routing (handleStyleChange/handleStylesChange key off
  // textEditingState.active) for the screen the user is actually editing.
  // Track which screen id last reported active:true and ignore an
  // active:false that doesn't come from that same screen.
  const activeTextEditingScreenIdRef = useRef<string | null>(null);
  const handleTextEditingStateChangeForScreen = useCallback(
    (
      screenId: string,
      state: { active: boolean; selector?: string; hasRange?: boolean },
    ) => {
      if (state.active) {
        activeTextEditingScreenIdRef.current = screenId;
        setTextEditingState(state);
        return;
      }
      if (activeTextEditingScreenIdRef.current === screenId) {
        activeTextEditingScreenIdRef.current = null;
        setTextEditingState(state);
      }
      // Else: an active:false from a screen that isn't the one we last saw
      // active:true from — stale/out-of-order, ignore it.
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
  // Screen that owns the committed selection. node ids/selectors are only
  // unique within a screen, so the echo guard uses this to reject stale
  // intent-less echoes arriving from a different screen. Render-synced.
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;
  const [contentRenderRevision, setContentRenderRevision] = useState(0);
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<InspectorTab>("design");
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{
    nonce: number;
    anchor: unknown;
    targetId?: string;
  } | null>(null);
  const reviewFocusNonceRef = useRef(0);
  const [activeLeftPanel, setActiveLeftPanel] =
    useState<DesignLeftPanel>("file");
  const [activeCodeFile, setActiveCodeFile] =
    useState<CodeWorkbenchActiveFile | null>(null);
  const initialSearchCommandAppliedForIdRef = useRef<string | null>(null);
  const initialUrlSelectionHydratedForIdRef = useRef<string | null>(null);
  // Figma's 56px workspace rail (plus its 1px divider) and 280px Layers/Pages
  // pane place the content divider at x=337. Keep that total while honoring
  // resizable 220–420px content range.
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(240);
  // Figma's Minimize UI action hides the left rail, right inspector panel,
  // and bottom toolbar chrome so the canvas fills the viewport. No prior
  // panel-visibility state existed to hook into (grepped for
  // leftPanelCollapsed/rightPanelCollapsed/showLeftPanel/etc. — none found),
  // so this is a new single boolean gating those three chrome containers'
  // rendering.
  const [uiHidden, setUiHidden] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const keyboardShortcutsReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressProjectMenuReturnFocusRef = useRef(false);
  // PF13: refs to the resizable sidebar containers so a splitter drag can
  // update width imperatively (no React re-render per pointermove) and only
  // commit the final width to state once, on pointerup.
  const leftSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement | null>(null);
  const [layersSearchQuery, setLayersSearchQuery] = useState("");
  const [expandedLayerIds, setExpandedLayerIds] = useState<string[]>([]);
  const [selectedLayerIdsState, setSelectedLayerIdsState] = useState<string[]>(
    [],
  );
  const selectedLayerTargetsRef = useRef<SelectedLayerTarget[]>([]);
  const effectiveCodeLayerStateRef = useRef<EffectiveCodeLayerState>({
    lockedIds: new Set(),
    hiddenIds: new Set(),
  });
  // L4: codeLayerOwnerByNodeId itself is computed later (it depends on
  // codeLayerModelsByFile), but changeSelectedZIndex is defined earlier in
  // this component and needs to look up the selected node's owning file/tree
  // at call time (always after the component has fully rendered at least
  // once). Mirrors the effectiveCodeLayerStateRef pattern just above.
  const codeLayerOwnerByNodeIdRef = useRef<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >(new Map());
  // ── Overview selection, layer lock/hide, clipboard state ───────────────────
  const [overviewSelectedScreenIds, setOverviewSelectedScreenIds] = useState<
    string[]
  >([]);
  const [createdOverviewLayerSelection, setCreatedOverviewLayerSelection] =
    useState<{ screenId: string; layerId: string } | null>(null);
  const pendingOverviewScreenSelectionRef = useRef<string | null>(null);
  const pendingOverviewLayerSelectionRef = useRef<string | null>(null);
  const lastOverviewSelectedScreenIdsRef = useRef<string[]>([]);
  // PF10: last marquee-selection signature, so a mousemove tick that hits the
  // exact same set of elements as the previous tick can bail before doing any
  // projection/canonicalization work.
  const lastMarqueeSelectionSignatureRef = useRef<string | null>(null);
  // Whether anything is currently selected, tracked centrally so the empty
  // marquee/click clear path can decide whether a deselect is actually needed
  // regardless of HOW the current selection was made (iframe click, layers
  // panel, agent, undo/redo, keyboard, etc.). Kept in sync via the effect below.
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
  // Tracks the nodeId of the most recently created TEXT primitive across one
  // handleCreatePrimitive → handlePrimitiveCreated round-trip. Cleared after
  // use. Lets handlePrimitiveCreated trigger begin-text-edit without needing
  // the primitive kind in its signature.
  const pendingTextEditNodeIdRef = useRef<string | null>(null);
  // Overview text creation stays one atomic history transaction from the
  // empty inserted node through the final contenteditable commit. The exact
  // before/created snapshots are freshness guards: any intervening peer/user
  // edit makes finalization fail closed instead of rewriting unrelated undo.
  const pendingTextCreationHistoryRef =
    useRef<PendingTextCreationHistory | null>(null);
  // T6: tracks the screen/node of a newly-created TEXT primitive whose
  // begin-text-edit retry loop (scheduleBeginTextEditForScreen) is still
  // in flight, plus that loop's cancel function. Used so:
  //  (a) the retry loop can be cancelled immediately once the bridge reports
  //      the edit session ended (Escape/blur), instead of continuing to
  //      force-reopen it for the rest of the ~4.2s window, and
  //  (b) once the loop settles (whether via an observed "active"/"done"
  //      status, an early cancel, or exhausting every retry), an empty node
  //      that never got real content typed into it gets removed instead of
  //      persisting as an invisible empty layer.
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
    const focusAgentComposer = () => {
      requestAnimationFrame(() => {
        const panel = document.querySelector("[data-design-agent-panel]");
        const prosemirror = panel?.querySelector(
          ".ProseMirror",
        ) as HTMLElement | null;
        if (prosemirror) {
          prosemirror.focus();
          return;
        }
        const textarea = panel?.querySelector("textarea") as HTMLElement | null;
        textarea?.focus();
      });
    };
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
      applyLayerStatePreview(
        patch.screenId,
        patch.layerId,
        patch.state,
        patch.enabled,
      );
    });
  }, [applyLayerStatePreview, pendingLayerStateReplayRequest]);
  const [overviewSelectAllRequest, setOverviewSelectAllRequest] = useState(0);
  const [overviewClearSelectionRequest, setOverviewClearSelectionRequest] =
    useState(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const [hasPropsClipboard, setHasPropsClipboard] = useState(false);
  // Item 2d: CanvasContextMenu's "Copy animation" / "Paste animation" —
  // a small same-tab clipboard ref, mirroring copiedStylePropsRef's pattern.
  // No system-clipboard round-trip (unlike node copy/paste): a
  // MotionAnimationClip isn't something a user would ever paste from
  // outside the app, so a ref + boolean-for-render is enough.
  const copiedLayerAnimationRef = useRef<MotionAnimationClip | null>(null);
  const [hasAnimationClipboard, setHasAnimationClipboard] = useState(false);
  const copiedLayerEntriesRef = useRef<CanvasLayerClipboardEntry[]>([]);
  const copiedLayerHtmlRef = useRef<string | null>(null);
  // Screen-level clipboard (U6): a whole-screen copy stores a snapshot here
  // instead of a layer entry, so paste can create a new screen file.
  const copiedScreenEntriesRef = useRef<DesignClipboardPayload["screens"]>([]);
  // Last internal HTML marker and user-facing plain text this tab wrote to the
  // system clipboard. Keeping both lets Design preserve lossless cross-tab
  // paste without mistaking a newer external copy for stale in-memory layers.
  const lastWrittenClipboardMarkerRef = useRef<string | null>(null);
  const lastWrittenClipboardPlainTextRef = useRef<string | null>(null);
  // Synchronous per-file content lineage for repeated paste/undo cycles. A
  // save acknowledgement may clear the generic pending-local map before the
  // React query/collab mirrors have rendered its content, leaving a brief
  // stale-base gap. Keep this mirror current for both local applications and
  // authoritative host-sync snapshots; the latter replaces, rather than
  // clears, the known content so there is never an undefined gap.
  const latestClipboardMutationContentRef = useRef<
    Map<string, ClipboardContentLineage>
  >(new Map());
  const clipboardPasteUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const clipboardPasteRedoStackRef = useRef<ContentHistoryChange[]>([]);
  // Cascade offset for repeated keyboard pastes so successive clones don't stack
  // pixel-perfectly on top of each other. Reset on each fresh copy/cut.
  const pasteCascadeRef = useRef(0);
  // U7: absolutely-positioned duplicates (Cmd+D) land exactly in place (zero
  // offset) rather than cascading, matching Figma. If the user then drags the
  // duplicated selection, the move delta is recorded here (rootNodeIds + dx/dy)
  // so the *next* Cmd+D on that same selection repeats the same delta instead
  // of landing on top of it again.
  const lastDuplicateTransformRef = useRef<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const copiedStylePropsRef = useRef<Record<string, string> | null>(null);
  const hasSelectedElement = Boolean(selectedElement);

  // ── Motion dock state (§6.3) ────────────────────────────────────────────────
  // The MotionDock is mounted below the canvas and shown when motionDockOpen.
  // Tracks and durationMs are local state; edits autosave via applyMotionEdit.
  const [motionDockOpen, setMotionDockOpen] = useState(false);
  const [motionDockMounted, setMotionDockMounted] = useState(false);
  const motionDockUnmountTimerRef = useRef<number | null>(null);
  const motionDockOpenAnimationFrameRef = useRef<number | null>(null);
  const [motionTimelineId, setMotionTimelineId] = useState<string | null>(null);
  const [motionTracks, setMotionTracks] = useState<MotionDockTrack[]>([]);
  // Default duration for a brand-new timeline (no saved motion_timeline row
  // yet). 2000ms gives a more typical starting canvas than 1000ms once a
  // track/keyframe is first added; explicit user duration changes
  // (handleMotionDurationChange) and hydration from a saved timeline
  // (activeMotionTimeline.durationMs) always take precedence over this.
  const [motionDurationMs, setMotionDurationMs] = useState(2000);
  // Timeline-level default easing, hydrated from the motion_timeline row and
  // round-tripped through autosave so a save never clobbers it back to "ease".
  const [motionDefaultEase, setMotionDefaultEase] = useState<string>("ease");
  const [motionPlayhead, setMotionPlayhead] = useState(0);
  // Live playhead mirror written by MotionDock on every rAF tick / scrub frame
  // (motionPlayhead state only updates at commit points to avoid 60fps
  // re-renders). Auto-keyframe reads this so an inspector edit made mid-
  // playback keys at the ACTUAL current playhead, not the last committed time.
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
  // Fires the currently-scheduled debounced motion autosave immediately.
  // Set alongside the debounce timer; invoked on file switch so edits in the
  // debounce window are persisted instead of dropped.
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
  // ── Shader fill preview state ──────────────────────────────────────────────
  const [shaderFillPreview, setShaderFillPreview] = useState<{
    selector?: string;
    nodeId?: string;
    css: string;
  } | null>(null);
  const clearShaderFillPreview = useCallback(() => {
    setShaderFillPreview(null);
    postShaderFillPreviewClearToPreviewIframes();
  }, []);

  // ── Breakpoint preview state (§6.4) ─────────────────────────────────────────
  // Active breakpoint width for the current design (pixels). Controls which
  // side-by-side frame is focused. undefined = no frame selected (overview mode).
  const [activeBreakpointWidthState, setActiveBreakpointWidthState] = useState<
    number | undefined
  >(undefined);
  const [responsiveEditScope, setResponsiveEditScope] =
    useState<ResponsiveEditScope>("cascade-smaller");
  const responsiveEditScopeRef = useRef<ResponsiveEditScope>("cascade-smaller");
  // BP-DEEP item 5 — latest-ref mirror of activeBreakpointWidthState so
  // click-to-target handlers (handleOverviewScreenPick, the global Escape
  // handler) can read the CURRENT value without listing it as a useCallback
  // dep — those handlers are passed down as MultiScreenCanvas/DesignCanvas
  // props and would otherwise be recreated (defeating the memo comparisons
  // documented on ScreenProps/screensPropsAreEqual) every time the user
  // switches breakpoints, i.e. on nearly every click-to-target gesture.
  const activeBreakpointWidthStateRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    activeBreakpointWidthStateRef.current = activeBreakpointWidthState;
  }, [activeBreakpointWidthState]);
  // Item 9 — dedupe marker for the agent→UI `design-active-breakpoint:<id>`
  // consumption effect below: the `breakpointId` (or the literal "auto") this
  // tab most recently applied, whether it got there via the poll-driven
  // effect OR via this tab's OWN setActiveBreakpointMutation write (every
  // local breakpoint-bar handler seeds this ref immediately, before the
  // mutation even resolves). Without this, the UI's own write would bump
  // targeted app-state counter, the effect would read back the exact value this tab
  // just wrote, and needlessly re-run every local state setter on every local
  // breakpoint chip click — this ref short-circuits that echo. Mirrors the
  // "ignoreSource" convention `useDbSync({ ignoreSource: getBrowserTabId() })`
  // applies at the framework level (see app/root.tsx), scoped to this one key
  // instead of a whole browser tab, since this key legitimately needs to
  // accept OTHER tabs'/the agent's writes, just not echo its own.
  const lastAppliedActiveBreakpointIdRef = useRef<string | null>(null);

  // ── Interaction-state forced preview (phase 2) ───────────────────────────────
  // Mirrors EditPanel's own InteractionStatePanel selection (Default/Hover/…)
  // so DesignEditor can force the canvas preview — see
  // `shared/interaction-states.ts`'s "Forced-preview mechanism" doc comment
  // and the `state-preview` bridge message it drives. `null` = Default (no
  // forced preview). EditPanel owns the UI/selector state itself and only
  // notifies via `onInteractionStateChange`; this mirror is what lets
  // handleStyleChange/handleStylesChange (below) and the state-preview
  // derivation route based on the CURRENT active state without EditPanel
  // needing to pass it back on every style commit.
  const [activeInteractionStateState, setActiveInteractionStateState] =
    useState<InteractionState | null>(null);

  // ── Design state selection (§6.4 / §8) ───────────────────────────────────────
  // null = Default (live) view; a string id = one of the design_state rows.
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [reviewFileId, setReviewFileId] = useState<string | null>(null);
  const [reviewFindings, setReviewFindings] = useState<A11yFinding[]>([]);
  const [reviewAuditLoading, setReviewAuditLoading] = useState(false);
  const [reviewAuditedAt, setReviewAuditedAt] = useState<string | null>(null);
  const [reviewAuditError, setReviewAuditError] = useState<string | null>(null);

  // Two ways in: the legacy `design_host=builder` preview, and the shell route,
  // which carries no such param. Builder waits on `appReady` before sending the
  // preview URL, so gating on the param alone left the shell permanently
  // unsynced.
  const builderHostProtocolActive = isBuilderDesignEmbed || hostEmbeddedEditor;
  useEffect(() => {
    if (!builderHostProtocolActive) return;
    // Announce ready to Builder. The trusted origin is not yet known at this
    // point so we use "*" — this message carries no user data.
    window.parent.postMessage({ type: "agentNative.appReady" }, "*");

    function handleDesignHostMessage(event: MessageEvent) {
      // The host is the embedder, so anything else — a sibling frame, a popup —
      // is not it, even from an allowed origin.
      if (event.source !== window.parent) return;
      // Only accept messages from builder.io origins
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
        // Capture the trusted parent origin on the first validated message so
        // outgoing postMessage calls that carry user data can restrict the
        // target instead of broadcasting to "*".
        if (!parentOriginRef.current) {
          parentOriginRef.current = origin;
        }
        rememberBuilderHostOrigin(origin);
        const { previewUrl, routes, context } = data.data ?? {};
        // The origin arrives from the parent now rather than a signed claim, so
        // it is only trusted if it looks like a Builder preview host.
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
          // The host resends `design:init` on unrelated changes. Replacing this
          // state with an equivalent object rebuilds the design, which the canvas
          // reads as a new document and remounts every frame mid-session.
          setShellInput((current) => {
            if (
              current &&
              JSON.stringify(current) === JSON.stringify(nextShellInput)
            ) {
              return current;
            }
            // Edits describe elements in the previous branch's running app, so
            // handing them to the new branch's agent would apply them to the
            // wrong source.
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
        // Fires once per turn, not per file write: the agent edits source while
        // generating, so the container has rebuilt by the time it settles.
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
            // Released on failure too, or the only control left in the shell
            // stays disabled with nothing to retry with.
            setApplyingViaHost(false);
            // The reload discarded the inline overrides either way, so keeping
            // the edits only helps when the run failed and Apply can retry.
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

  // PF13: the splitter previously called setWidth (React state) on every raw
  // pointermove, re-rendering the whole DesignEditor tree (including the
  // canvas) per pixel dragged. Now the drag updates the target container's
  // style.width imperatively via a ref — no re-render — and only commits the
  // final width to state once, on pointerup/pointercancel. The left panel's
  // `transition-[width]` class is temporarily suspended during the drag (it
  // otherwise fights the imperative per-frame width with its own easing) and
  // restored afterward so panel-open/close still animates normally.
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
  // Undo/redo state driven by Y.UndoManager
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const contentUndoStackRef = useRef<ContentHistoryEntry[]>([]);
  const contentRedoStackRef = useRef<ContentHistoryEntry[]>([]);
  // Figma-parity undo/redo selection restore for the overview CONTENT history
  // (contentUndoStackRef/contentRedoStackRef above): a parallel stack, index-
  // aligned 1:1 with its matching content stack, holding the selection
  // snapshot to restore for that entry. Kept as a SEPARATE array (rather than
  // widening ContentHistoryEntry itself) because that union type is
  // constructed inline at ~10 call sites across this file — recordContentHistoryEntry
  // is the one shared funnel all of them already go through, so it can push
  // here without every call site needing to pass a selection snapshot itself.
  // Every push/pop/splice/slice against contentUndoStackRef/contentRedoStackRef
  // has a mirrored operation here so the two stacks never drift out of index
  // alignment.
  const contentUndoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const contentRedoSelectionStackRef = useRef<
    (GeometryHistorySelection | undefined)[]
  >([]);
  const localContentUndoStackRef = useRef<ContentHistoryChange[]>([]);
  const localContentRedoStackRef = useRef<ContentHistoryChange[]>([]);
  const activeFileIdForUndoRef = useRef<string | null>(null);
  const suppressContentHistoryRef = useRef(false);
  const geometryUndoStackRef = useRef<GeometryHistoryEntry[]>([]);
  const geometryRedoStackRef = useRef<GeometryHistoryEntry[]>([]);
  // Figma-parity undo/redo selection restore (see GeometryHistorySelection):
  // synchronous mirrors of the selection state, kept current every render
  // (like activeFileIdForUndoRef just above) so a commit/undo/redo handler
  // can read "what's selected right now" without needing selection state in
  // its own dependency array. selectedLayerIdsStateRef mirrors
  // selectedLayerIdsState (single-screen DOM/code layers, or overview
  // in-frame layers); overviewSelectedScreenIdsRef mirrors
  // overviewSelectedScreenIds (top-level screen/frame selection).
  const selectedLayerIdsStateRef = useRef<string[]>([]);
  const overviewSelectedScreenIdsRef = useRef<string[]>([]);
  // U12: screen create/duplicate history — undo soft-deletes the created
  // file (reusing performDeleteFiles), redo recreates it with the same
  // filename/content/fileType via createFileMutation.
  const fileCreationUndoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const fileCreationRedoStackRef = useRef<FileCreationHistoryEntry[]>([]);
  const fileDeletionUndoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  const fileDeletionRedoStackRef = useRef<FileDeletionHistoryEntry[]>([]);
  // File deletion undo/redo recreates or removes SQL rows asynchronously.
  // Disable every history command while one of those mutations is in flight
  // so a rapid second Cmd+Z cannot race a create against the pending delete.
  const fileHistoryMutationPendingRef = useRef(false);
  const historyOrderRef = useRef<UndoRedoOrderKind[]>([]);
  const redoOrderRef = useRef<UndoRedoOrderKind[]>([]);
  const clearRedoStacks = useCallback(() => {
    contentRedoStackRef.current = [];
    contentRedoSelectionStackRef.current = [];
    localContentRedoStackRef.current = [];
    geometryRedoStackRef.current = [];
    fileCreationRedoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    pendingVisualStyleRedoStackRef.current = [];
    pendingLiveNonStyleRedoStackRef.current = [];
    pendingStructureRedoReplayRef.current = undefined;
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    redoOrderRef.current = [];
    undoManagerRef.current?.clear(false, true);
  }, []);
  // Figma-parity undo/redo selection restore: snapshots "what's selected
  // right now" from the ref mirrors above (always current — see their doc
  // comment) into a plain GeometryHistorySelection. Reads refs only, so this
  // never needs to be a useCallback — every call returns a fresh, independent
  // snapshot safe to stash on a history entry.
  const captureCurrentSelection = (): GeometryHistorySelection => ({
    overviewSelectedScreenIds: [...overviewSelectedScreenIdsRef.current],
    selectedLayerIds: [...selectedLayerIdsStateRef.current],
    activeFileId: activeFileIdForUndoRef.current,
  });
  // Restores a previously captured selection snapshot via the existing
  // setters — DesignEditor owns all of this selection state, so no canvas
  // component needs to change for the restore to reflect on screen (the
  // overview canvas/layers panel/inspector all read these same states).
  // Guarded by canUseOverviewHistory the same way geometry/content undo
  // already is: single-screen mode's selection is a different concept
  // (selectedLayerIdsState scoped to the one open screen) that this history
  // doesn't track across mode switches, so restoring is scoped to overview.
  const restoreSelectionSnapshot = useCallback(
    (selection: GeometryHistorySelection | undefined) => {
      if (!selection) return;
      if (viewModeRef.current !== "overview") return;
      setOverviewSelectedScreenIds(selection.overviewSelectedScreenIds);
      setSelectedLayerIdsState(selection.selectedLayerIds);
      if (selection.activeFileId) {
        setActiveFileId(selection.activeFileId);
      }
    },
    [],
  );
  const syncUndoRedoState = useCallback(() => {
    if (fileHistoryMutationPendingRef.current) {
      setCanUndo(false);
      setCanRedo(false);
      return;
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
      pendingVisualStyleEditsRef.current.length > 0 ||
        pendingLiveNonStyleUndoStackRef.current.length > 0 ||
        Boolean(undoManager?.canUndo()) ||
        hasLocalUndo ||
        clipboardPasteUndoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentUndoStackRef.current.length > 0 ||
            geometryUndoStackRef.current.length > 0 ||
            fileCreationUndoStackRef.current.length > 0 ||
            fileDeletionUndoStackRef.current.length > 0)),
    );
    setCanRedo(
      pendingVisualStyleRedoStackRef.current.length > 0 ||
        pendingLiveNonStyleRedoStackRef.current.length > 0 ||
        Boolean(undoManager?.canRedo()) ||
        hasLocalRedo ||
        clipboardPasteRedoStackRef.current.length > 0 ||
        (canUseOverviewHistory &&
          (contentRedoStackRef.current.length > 0 ||
            geometryRedoStackRef.current.length > 0 ||
            fileCreationRedoStackRef.current.length > 0 ||
            fileDeletionRedoStackRef.current.length > 0)),
    );
  }, []);
  useEffect(() => {
    pendingVisualStyleEditsRef.current = pendingVisualStyleEdits;
    syncUndoRedoState();
  }, [pendingVisualStyleEdits, syncUndoRedoState]);
  useEffect(() => {
    pendingLiveNonStyleEditsRef.current = pendingLiveNonStyleEdits;
    syncUndoRedoState();
  }, [pendingLiveNonStyleEdits, syncUndoRedoState]);
  const recordContentHistoryEntry = useCallback(
    (entry: ContentHistoryEntry) => {
      const changes = getContentHistoryChanges(entry).filter(
        (change) => change.before !== change.after,
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
      // Figma-parity undo/redo selection restore: index-aligned with the push
      // just above — see contentUndoSelectionStackRef's doc comment.
      contentUndoSelectionStackRef.current = [
        ...contentUndoSelectionStackRef.current.slice(
          -(MAX_DESIGN_UNDO_STACK - 1),
        ),
        captureCurrentSelection(),
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
  // ── Local content history (undo/redo checkpoints) ──────────────────────────
  const recordLocalContentHistoryEntry = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      localContentUndoStackRef.current = [
        ...localContentUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        change,
      ];
      clearRedoStacks();
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  // Passive mirror of a Yjs-tracked single-mode edit into the local fallback
  // stack (see U3): the Yjs UndoManager is destroyed on every view-mode
  // switch/zoom, losing its whole undo stack with no trace. handleUndo only
  // consults this fallback once the Yjs stack has nothing left, so recording
  // it here never causes a double-undo of the same edit. Consecutive edits to
  // the same file within the same "session" (no intervening undo/redo) are
  // coalesced into one entry so the fallback's granularity roughly matches
  // Yjs's own captureTimeout-merged steps instead of one entry per keystroke.
  const recordLocalContentHistoryChangeFallback = useCallback(
    (change: ContentHistoryChange) => {
      localContentUndoStackRef.current = mergeLocalContentHistoryFallback(
        localContentUndoStackRef.current,
        change,
      );
    },
    [],
  );
  const finalizePendingTextCreation = useCallback(
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
        return false;
      }
      const result = finalizeTextCreationHistory(
        contentUndoStackRef.current,
        pending,
        finalContent,
      );
      pendingTextCreationHistoryRef.current = null;
      if (result.status === "stale") return false;
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
      return true;
    },
    [syncUndoRedoState],
  );
  const recordExternalContentHistoryCheckpoint = useCallback(
    (change: ContentHistoryChange) => {
      if (change.before === change.after) return;
      // Overview owns a shared chronological history across every screen.
      // Putting an agent replacement only in the single-screen fallback makes
      // it invisible to Cmd+Z while the user remains on the all-screens canvas
      // (the state in which the reported replacement happened).
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
    fileDeletionUndoStackRef.current = [];
    fileDeletionRedoStackRef.current = [];
    fileHistoryMutationPendingRef.current = false;
    clipboardPasteUndoStackRef.current = [];
    clipboardPasteRedoStackRef.current = [];
    latestClipboardMutationContentRef.current.clear();
    historyOrderRef.current = [];
    redoOrderRef.current = [];
  }, []);
  // U12: record a screen create/duplicate as an undoable entry. Always pushed
  // to the undo stack (screen creation is only meaningful in overview mode's
  // shared chronological history) and clears the redo stack like any other
  // new action.
  const recordFileCreationHistoryEntry = useCallback(
    (entry: FileCreationHistoryEntry) => {
      fileCreationUndoStackRef.current = [
        ...fileCreationUndoStackRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        entry,
      ];
      clearRedoStacks();
      historyOrderRef.current = [
        ...historyOrderRef.current.slice(-(MAX_DESIGN_UNDO_STACK - 1)),
        "file-created",
      ];
      syncUndoRedoState();
    },
    [clearRedoStacks, syncUndoRedoState],
  );
  // ── Save refs: selection, frame geometry, tweaks, annotations ──────────────
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
  // Item 11 (URL sync): debounce timer for the URL-state write effect below,
  // so continuous zoom/drag ticks coalesce into one history.replaceState
  // instead of one per tick. See that effect's doc comment.
  const urlSyncTimerRef = useRef<number | null>(null);
  // U9: last handleGeometryCommit timestamp, used to detect a rapid burst of
  // commits (keyboard nudge auto-repeat) so they coalesce into one undo entry
  // and one debounced server write instead of one of each per tick.
  const lastGeometryCommitAtRef = useRef(0);
  // Localhost write-consent dialog state. When the agent wants to write a local
  // file and no valid grant exists for the active connection, we show the dialog
  // with a pending payload; the user clicks "Allow writes" to mint a grant.
  const [localhostWriteConsentOpen, setLocalhostWriteConsentOpen] =
    useState(false);
  const [localhostWriteConsentPayload, setLocalhostWriteConsentPayload] =
    useState<LocalhostWriteConsentPayload | null>(null);
  // Active localhost connection id for the consent dialog.
  const [localhostConsentConnectionId, setLocalhostConsentConnectionId] =
    useState<string>("");
  // Tracks whether an "Apply to source" write is in progress.
  const [applyToSourcePending, setApplyToSourcePending] = useState(false);
  // Shared visual-editor annotate overlays. drawMode owns the send toolbar,
  // while pinMode temporarily routes canvas clicks to comment pins that queue
  // into the same agent submission.
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [repromptDraftRequest, setRepromptDraftRequest] =
    useState<RepromptDraftRequest | null>(null);
  // Overview and focused canvases retain separate annotation batches. Each
  // counter is bumped only for a deliberate close or a confirmed send; they
  // must not share a signal, or closing a focused-screen batch would also
  // erase preserved overview-board work while that overlay is hidden.
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
  // ── Prompt, export, and Figma hydration state ──────────────────────────────
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const [pngExporting, setPngExporting] = useState(false);
  const [svgExporting, setSvgExporting] = useState(false);
  const [figmaSvgExporting, setFigmaSvgExporting] = useState(false);
  const pngExportingRef = useRef(false);
  const figmaSvgExportingRef = useRef(false);
  const figmaPasteImportingRef = useRef(false);
  const [figmaHydrationOpen, setFigmaHydrationOpen] = useState(false);
  const [figmaHydrationFileIds, setFigmaHydrationFileIds] = useState<string[]>(
    [],
  );
  const [figmaHydrationImageCount, setFigmaHydrationImageCount] = useState(0);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "overview" || overviewSelectedScreenIds.length === 0) {
      return;
    }
    lastOverviewSelectedScreenIdsRef.current = [...overviewSelectedScreenIds];
  }, [overviewSelectedScreenIds, viewMode]);
  // ── Generation lifecycle ───────────────────────────────────────────────────
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
        // Check ownership independently for every mirror. Another editor tab
        // can update the global fallback after this tab wrote its scoped key;
        // using only the scoped owner as permission to clear both keys would
        // erase that newer tab's context during our unmount.
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
  // When generation stalls we keep the original prompt + files around so the
  // user can retry with one click instead of re-typing. Cleared as soon as the
  // user kicks off a new run (retry or fresh prompt).
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
  /**
   * Model this design's generation started with. The pending-generation blob
   * holds the same values, but five paths clear it — three while the intake
   * questions are still on screen — so the continuation cannot rely on it.
   */
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
    // Capture the original prompt before clearing so the user can retry without
    // re-typing it. The full pending payload (model/engine/effort) is preserved
    // so the retry runs with identical settings.
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
        runTabId,
        attempt: pending?.attempt ?? 1,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      trackAgentGeneration(runTabId);
    },
    [clearGenerationCompleteTimer, id, trackAgentGeneration],
  );

  // Question flow — full-canvas overlays driven by the agent. Ref first, blob
  // as the reload fallback (the ref is gone then, the blob may survive).
  const getQuestionFlowModelSelection = useCallback(
    () =>
      generationModelRef.current ??
      readPendingGeneration(id, { allowUntimestamped: true }),
    [id],
  );
  // The intake turn carries the prompt, screenshots, and design system, but is
  // forced to stop after asking questions. The continuation is what actually
  // generates, so it has to carry them again or the design is built blind.
  const getQuestionFlowGenerationBrief = useCallback(() => {
    const pending = readPendingGeneration(id, { allowUntimestamped: true });
    if (!pending) return null;
    const files = pending.files ?? [];
    return {
      prompt: pending.prompt,
      designSystemId: pending.designSystemId,
      images: imageAttachmentsFromUploadedFiles(files),
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

  // ── Identity, review comments, pending local file contents ─────────────────
  // Current user info for collaborative presence. The avatar (if the user has
  // uploaded one) is plumbed through so peers see the user's face on cursors,
  // selection rings, edit highlights, and the presence bar.
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

  // Data fetching
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
    hasPendingGeneration &&
    !!readPendingGeneration(id) &&
    !pendingQuestionsVisible;

  const { data: designResult, isLoading: designLoading } = useActionQuery<
    DesignData | string
  >(
    "get-design",
    { id: id! },
    {
      enabled: !shellMode,
      refetchInterval: pendingGenerationActive || generating ? 1000 : false,
    },
  );

  /** Rebuilt from the host payload; there is no row behind it to fetch. */
  const shellDesign = useMemo(
    () => (shellInput ? buildShellDesign(shellInput).design : null),
    [shellInput],
  );

  const design = shellMode
    ? shellDesign
    : isDesignData(designResult)
      ? designResult
      : null;
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
  const canEditDesign = canShareDesign || designAccessRole === "editor";
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
      includeResolved: false,
      limit: 500,
    },
    { enabled: Boolean(id) && !shellMode },
  );
  const reviewComments = reviewResult.data?.comments ?? [];
  const reviewOpenThreadIds = useMemo(
    () =>
      new Set(
        reviewComments
          .filter(
            (comment) =>
              comment.status === "open" && comment.parentCommentId === null,
          )
          .map((comment) => comment.threadId),
      ),
    [reviewComments],
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
  const reviewOpenCount =
    persistedReviewSummary?.openCount ?? reviewOpenThreadIds.size;
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
  const pendingLocalFileContentsRef = useRef<
    Map<
      string,
      { content: string; startedAt: number; baseUpdatedAt?: string | null }
    >
  >(new Map());
  const [
    pendingLocalFileContentsRevision,
    setPendingLocalFileContentsRevision,
  ] = useState(0);

  const markPendingLocalFileContent = useCallback(
    (fileId: string, content: string, baseUpdatedAt?: string | null) => {
      const current = pendingLocalFileContentsRef.current.get(fileId);
      if (current?.content === content) {
        if (
          baseUpdatedAt !== undefined &&
          current.baseUpdatedAt === undefined
        ) {
          pendingLocalFileContentsRef.current.set(fileId, {
            ...current,
            baseUpdatedAt,
          });
          setPendingLocalFileContentsRevision((revision) => revision + 1);
        }
        return;
      }
      pendingLocalFileContentsRef.current.set(fileId, {
        content,
        startedAt: Date.now(),
        baseUpdatedAt,
      });
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

  useEffect(() => {
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

  // ── Action mutations ───────────────────────────────────────────────────────
  const updateFileMutation = useActionMutation("update-file");
  const renameScreenMutation = useActionMutation("rename-screen");
  const createFileMutation = useActionMutation("create-file");
  const createFileAsync = createFileMutation.mutateAsync;
  const deleteFileMutation = useActionMutation("delete-file");
  const updateDesignMutation = useActionMutation("update-design");
  const updateDesignAsync = updateDesignMutation.mutateAsync;
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
  // U-motion-empty: apply-motion-edit's schema rejects a 0-track payload (a
  // track array must have >= 1 entry), so deleting the last track/keyframe
  // cannot go through the normal autosave path. remove-motion-timeline is the
  // dedicated inverse — it deletes the motion_timeline row AND strips the
  // managed <style data-agent-native-motion> block from the HTML so a reload
  // doesn't resurrect the just-deleted animation.
  const removeMotionTimelineMutation = useActionMutation(
    "remove-motion-timeline",
  );
  const removeMotionTimeline = removeMotionTimelineMutation.mutate;
  const motionAutosavePending = applyMotionEditMutation.isPending;
  // §6.4 breakpoint mutations — wired to MultiScreenCanvas + BreakpointBar
  const addBreakpointMutation = useActionMutation("add-breakpoint");
  const removeBreakpointMutation = useActionMutation("remove-breakpoint");
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

  // §6.1 — promote a selection into a reusable component instance.
  const createComponentMutation = useActionMutation("create-component");
  // §6.1 — jump to a component instance's source (selects the root + navigates).
  const openComponentSourceMutation = useActionMutation(
    "open-component-source",
  );
  // Figma's "Go to main component" — resolves/navigates to the earliest known
  // instance of the selected component (see go-to-main-component.ts's design
  // note: this codebase has no separate component-definition markup).
  const goToMainComponentMutation = useActionMutation("go-to-main-component");
  // Figma's "Detach instance" (⌥⌘B) — strips the component-instance linkage
  // from the selected node, leaving its current markup as plain elements.
  const detachComponentInstanceMutation = useActionMutation(
    "detach-component-instance",
  );
  const [componentSwapPickerRequest, setComponentSwapPickerRequest] =
    useState(0);

  // Board file migration — lazy, idempotent, triggers on design open when
  // designs.data.boardFileId is absent.
  const migrateBoardObjectsMutation = useActionMutation(
    "migrate-board-objects-to-file",
  );

  // §6.6 — "Make it real" migration flow (migrate-inline-design-to-app).
  // The mutation stays unconditional; the dialog gates on isSignedIn.
  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // Dialog open/close state for the "Make this a real app" flow.
  const [makeRealDialogOpen, setMakeRealDialogOpen] = useState(false);
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

  // Result payload returned by migrate-inline-design-to-app on success.
  // `null` = not yet migrated; populated once the Builder agent accepts the job.
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
  // ── File-content save queue (outbox) ───────────────────────────────────────
  const pendingFileSavesRef = useRef<Record<string, FileContentSaveRequest>>(
    {},
  );
  const fileSaveChainsRef = useRef<Record<string, Promise<void>>>({});
  /**
   * Cross-pipeline write-race fix, server-discipline layer: the last content
   * this client knows the SERVER has for each file — set after every
   * successful update-file save and whenever a server-acknowledged content
   * sync arrives (apply-source-edit's onApplied host-sync passes updatedAt).
   * `saveFileContent` sends its hash as update-file's expectedVersionHash on
   * every save when a hash is known (both syncCollab true AND false), so a
   * residual stale write either fails loud (syncCollab true — the server
   * would otherwise char-diff a stale full document into the collab text)
   * or is silently skipped server-side without stamping stale content over a
   * live collab doc (syncCollab false — see update-file's skippedStaleMirror
   * contract). When no hash is known yet, it's omitted as before and the
   * write proceeds unguarded.
   */
  const lastAckedFileContentHashRef = useRef<Record<string, string>>({});
  const fileSaveOperationRevisionRef = useRef<Record<string, number>>({});
  const latestFileSaveForUnloadRef = useRef<
    Record<string, FileContentSaveRequest>
  >({});
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
        // IndexedDB can be unavailable in private/embedded contexts. The
        // network mutation still runs below, so this is not a disconnect and
        // must not show “save when reconnected” on every edit.
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
      if (result.saved.length > 0 || result.rebased.length > 0) {
        // rebased = a 409 the server moved past; refetch so the editor rebases
        // onto current content. No toast: the file wasn't lost, unlike dropped.
        queryClient.invalidateQueries({
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
    queryClient,
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

  const createFileContentSaveRequest = useCallback(
    (
      fileId: string,
      content: string,
      syncCollab: boolean,
    ): FileContentSaveRequest => {
      const operationRevision =
        (fileSaveOperationRevisionRef.current[fileId] ?? 0) + 1;
      fileSaveOperationRevisionRef.current[fileId] = operationRevision;
      return {
        id: fileId,
        content,
        syncCollab,
        operationSource: designSaveOperationSourceRef.current,
        operationRevision,
        ...(lastAckedFileContentHashRef.current[fileId]
          ? { expectedVersionHash: lastAckedFileContentHashRef.current[fileId] }
          : {}),
      };
    },
    [],
  );

  const createFileSaveOutboxEntry = useCallback(
    (
      pending: FileContentSaveRequest,
      expectedVersionHash = pending.expectedVersionHash,
    ) => {
      // The shell has no design row, so a queued save would retry forever.
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
          ...(expectedVersionHash ? { expectedVersionHash } : {}),
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
      delete pendingFileSavesRef.current[fileId];
      delete latestFileSaveForUnloadRef.current[fileId];
      const entry = queued ? createFileSaveOutboxEntry(queued) : null;
      if (entry) {
        void discardDesignSaveOutboxEntry(entry).catch(() => {});
      }
    },
    [createFileSaveOutboxEntry, warnChangesWillRetry],
  );

  const saveFileContent = useCallback(
    (pending: FileContentSaveRequest) =>
      runSaveFileContent(
        {
          acknowledgeOutboxEntry,
          canEditDesignRef,
          createFileSaveOutboxEntry,
          fileSaveChainsRef,
          journalOutboxEntry,
          lastAckedFileContentHashRef,
          latestFileSaveForUnloadRef,
          markPendingLocalFileContent,
          queryClient,
          setPatchProof,
          t,
          updateFileMutation,
          warnChangesWillRetry,
        },
        pending,
      ),
    [
      acknowledgeOutboxEntry,
      createFileSaveOutboxEntry,
      journalOutboxEntry,
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
      options: { syncCollab?: boolean; immediate?: boolean } = {},
    ) => {
      if (!canEditDesignRef.current) return;
      // Allocate the revision when the edit ENTERS the queue, not when its
      // debounce fires. A pagehide keepalive and the ordinary chained save
      // therefore carry the same idempotency key, while any newer queued edit
      // is guaranteed to have a higher revision even if requests arrive at
      // the server out of order.
      const pending = createFileContentSaveRequest(
        fileId,
        content,
        options.syncCollab ?? true,
      );
      markPendingLocalFileContent(fileId, content);
      latestFileSaveForUnloadRef.current[fileId] = pending;
      const outboxEntry = createFileSaveOutboxEntry(pending);
      if (outboxEntry) void journalOutboxEntry(outboxEntry);
      if (options.immediate) {
        const timer = fileSaveTimersRef.current[fileId];
        if (timer) {
          window.clearTimeout(timer);
          delete fileSaveTimersRef.current[fileId];
        }
        delete pendingFileSavesRef.current[fileId];
        saveFileContent(pending);
        return;
      }
      pendingFileSavesRef.current[fileId] = pending;
      const timer = fileSaveTimersRef.current[fileId];
      if (timer) {
        window.clearTimeout(timer);
      }
      fileSaveTimersRef.current[fileId] = window.setTimeout(() => {
        const pending = pendingFileSavesRef.current[fileId];
        delete pendingFileSavesRef.current[fileId];
        delete fileSaveTimersRef.current[fileId];
        if (!pending) return;
        saveFileContent(pending);
      }, 400);
    },
    [
      createFileContentSaveRequest,
      createFileSaveOutboxEntry,
      journalOutboxEntry,
      markPendingLocalFileContent,
      saveFileContent,
    ],
  );

  const flushPendingFileContentSavesForBackground = useCallback(() => {
    if (!canEditDesignRef.current) return;
    flushFileContentSavesOnBackground(
      pendingFileSavesRef.current,
      latestFileSaveForUnloadRef.current,
      Object.values(fileSaveTimersRef.current),
      saveFileContent,
      window.clearTimeout,
    );
    fileSaveTimersRef.current = {};
    pendingFileSavesRef.current = {};
  }, [saveFileContent]);

  const sendFileContentSaveKeepalive = useCallback(
    (pending: FileContentSaveRequest) => {
      // A live collab document already owns the current text. Without an
      // acknowledged hash, a full-document mirror write could overwrite a
      // peer, so preserve the existing stale-write guard.
      const collabLive = pending.syncCollab === false;
      const hashKnown = pending.expectedVersionHash !== undefined;
      if (!shouldSendKeepalive(hashKnown, collabLive)) return;
      const entry = createFileSaveOutboxEntry(pending);
      if (!entry) return;
      void journalOutboxEntry(entry);
      const attempt = tryCallActionKeepalive(
        "update-file",
        entry.payload as any,
      );
      if (!attempt.accepted) return;
      void attempt.completion
        .then((result: unknown) => {
          if (!updateFileResultPersistedContent(result, pending.content)) {
            return;
          }
          return acknowledgeOutboxEntry(entry);
        })
        // Pagehide/navigation can intentionally abort this request. The
        // journaled operation remains available for replay, and there is no
        // useful visible surface for a toast while the page is leaving.
        .catch(() => {});
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
      // Component cleanup is also used for normal client-side navigation.
      // Drain each debounce slot into the existing per-file promise chain so
      // route changes cannot drop the last edit. A real document unload has
      // already fired pagehide above; its keepalive uses the same operation
      // source/revision and is therefore safely idempotent with this save.
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

  // ── Tweaks: definitions, selections, CSS vars, and the save queue ──────────
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
  // ── Share URL, prompt popovers, title editing ──────────────────────────────
  const editorShareUrl = useMemo(() => {
    if (!id || typeof window === "undefined") return undefined;
    return getDesignEditorShareUrl(id, window.location.origin, appBasePath());
  }, [id]);
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems(isSignedIn);
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
        navigate(`/design/${result.id}${nextSearch}`, { replace: true });
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

  const creativeContextsQuery = useCreativeContexts();
  const creativeContextState = useCreativeContextState();
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
  const resolvePromptDesignSystemId = useCallback(
    () =>
      design?.designSystemId ??
      defaultSystem?.id ??
      designSystems[0]?.id ??
      null,
    [defaultSystem?.id, design?.designSystemId, designSystems],
  );

  const selectedPromptDesignSystemId =
    promptDesignSystemId === undefined
      ? resolvePromptDesignSystemId()
      : promptDesignSystemId;

  const handlePromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(resolvePromptDesignSystemId());
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [canEditDesign, resolvePromptDesignSystemId],
  );

  const handleTweakPromptOpenChange = useCallback(
    (open: boolean) => {
      if (open && !canEditDesign) return;
      setShowTweakPrompt(open);
      if (!open) {
        tweakPromptAnchorRef.current = null;
      }
    },
    [canEditDesign],
  );

  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      if (!canEditDesign) return;
      tweakPromptAnchorRef.current = anchor;
      setActiveInspectorTab("tweaks");
      setShowTweakPrompt(true);
    },
    [canEditDesign],
  );

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null) => {
      if (!id || !canEditDesign || design?.designSystemId === designSystemId) {
        return;
      }
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, designSystemId };
      });
      updateDesignMutation.mutate({ id, designSystemId } as any, {
        onError: () => {
          queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
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
    const nextTitle = `${normalizeDocumentTitle(
      design.title,
      "Untitled design",
    )} — Design`;
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
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
        queryClient.invalidateQueries({ queryKey: ["action", "list-designs"] });
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

  // H3: shared keydown handler for both title-rename <Input> instances
  // (toolbar + inspector header). Guards against IME composition so an
  // Enter that confirms a composed character (e.g. Japanese/Chinese input)
  // doesn't also commit the rename — only a "real" Enter keystroke should.
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
  // ── Design data: files, snapshots, derived geometry ────────────────────────
  const pendingLocalFileContentsSnapshot = useMemo(
    () => new Map(pendingLocalFileContentsRef.current),
    [pendingLocalFileContentsRevision],
  );
  const files = useMemo(() => {
    if (pendingLocalFileContentsSnapshot.size === 0) return serverFiles;
    return serverFiles.map((file) => {
      const pending = pendingLocalFileContentsSnapshot.get(file.id);
      return pending ? { ...file, content: pending.content } : file;
    });
  }, [pendingLocalFileContentsSnapshot, serverFiles]);
  const [pendingNodeRewriteProposals, setPendingNodeRewriteProposals] =
    useState<NodeRewriteProposal[]>([]);
  const proposalFileIds = useMemo(() => files.map((file) => file.id), [files]);
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
  // Document-wide color palette source for EditPanel's Fill section — every
  // file's id/content in the current design, not just the active one. Kept
  // as its own memo (rather than passing `files` directly) so EditPanel
  // (memo'd) only re-renders for this prop when file id/content actually
  // changes, not on every unrelated `files` identity change upstream.
  const documentColorFiles = useMemo<DocumentColorSourceFile[]>(
    () => files.map((file) => ({ id: file.id, content: file.content })),
    [files],
  );
  const [liveScreenSnapshotsById, setLiveScreenSnapshotsById] = useState<
    Record<string, LiveScreenSnapshot>
  >({});
  const [runtimeLayerSnapshotsById, setRuntimeLayerSnapshotsById] = useState<
    Record<string, RuntimeLayerSnapshot>
  >({});
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
  }, [serverFiles]);
  const designDataJson = useMemo(
    () => parseDesignDataJson(design?.data),
    [design?.data],
  );
  // Keep a ref in sync so debounced timer callbacks can read the freshest
  // designDataJson without closing over a stale snapshot from render time.
  const designDataJsonRef = useRef(designDataJson);
  useEffect(() => {
    designDataJsonRef.current = designDataJson;
  }, [designDataJson]);
  const canvasFrameGeometryById = useMemo(
    () => getCanvasFrameGeometry(designDataJson),
    [designDataJson],
  );
  // Freshest live geometry for the geometry-undo freshness guard. Read from a
  // ref (not a render-time closure) so undo/redo compare against the geometry a
  // concurrent peer/agent may have just written, not the value captured when
  // handleUndo's callback was memoized.
  const liveFrameGeometryRef = useRef(canvasFrameGeometryById);
  useEffect(() => {
    liveFrameGeometryRef.current = canvasFrameGeometryById;
  }, [canvasFrameGeometryById]);

  // ── Board file ─────────────────────────────────────────────────────────────
  // The board is a reserved design_file (filename "__board__.html") whose id is
  // stored in designs.data.boardFileId.  On design open, if boardFileId is absent,
  // we trigger migrate-board-objects-to-file (lazy + idempotent) which creates
  // the board file and migrates any legacy boardObjects.
  const boardFileId = useMemo(() => {
    const raw = (designDataJson as Record<string, unknown>).boardFileId;
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }, [designDataJson]);

  // Trigger migration on design open when boardFileId is absent.
  const migrateBoardTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    // Nothing to migrate for a design that only exists in memory.
    if (!id || !canEditDesign || shellMode) return;
    if (boardFileId) return; // already migrated
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

  const overviewScreens = useMemo(() => {
    return deriveOverviewScreens({
      designDataJson,
      files,
      activeBreakpointWidthState,
      breakpointFramesHidden,
      locallyPinnedHeightIds: locallyPinnedHeightIdsRef.current,
    });
  }, [
    designDataJson,
    files,
    activeBreakpointWidthState,
    boardFileId,
    breakpointFramesHidden,
  ]);

  // The board file's current HTML content — sourced from the files array (which
  // includes pending local writes).  undefined when boardFileId is not yet set.
  const boardFileContent = useMemo(() => {
    if (!boardFileId) return undefined;
    const boardFile = files.find((file) => file.id === boardFileId);
    return typeof boardFile?.content === "string" ? boardFile.content : "";
  }, [boardFileId, files]);

  // Camera/layout operations need the bounds of what the user can actually
  // see on the board, not the 131,072px logical iframe used for hit testing.
  // An empty board intentionally contributes no bounds.
  const boardContentBounds = useMemo(
    () => getBoardSurfaceContentBounds(boardFileContent),
    [boardFileContent],
  );

  // Self-heal persisted board content whose NESTED children carry left/top
  // values poisoned by the board-surface offset (near-65536-multiple values
  // written by the historic nest-on-drop coordinate bugs — see
  // normalizePoisonedBoardNestedCoords in shared/board-file.ts). Those
  // children render tens of thousands of px outside their parent (visually
  // vanished) and the corruption round-trips reload, so repair the content
  // on load/adopt and persist the fix through the normal save path. The
  // helper is idempotent (normalized output is never re-flagged), so this
  // effect settles after one write; it also catches poison arriving later
  // from a peer still running pre-fix code.
  useEffect(() => {
    if (!boardFileId || !boardFileContent || !canEditDesign) return;
    const normalized = normalizePoisonedBoardNestedCoords(boardFileContent);
    if (!normalized.changed) return;
    warnIfPoisonedBoardCoordsNormalized(boardFileId, normalized);
    queueFileContentSave(boardFileId, normalized.html);
  }, [boardFileContent, boardFileId, canEditDesign, queueFileContentSave]);

  // Logical canvas-space bounding box of the board iframe. The board is an
  // invisible editing layer behind screen frames, not a finite artboard, so keep
  // it at the canvas-safe maximum instead of clipping it to the screen union.
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

  // ── Frame-geometry persistence ─────────────────────────────────────────────
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
            await updateDesignAsync(outboxEntry.payload as any);
            pendingFrameGeometryOperationsForUnloadRef.current =
              clearAcknowledgedDesignDataOperationsThroughRevision(
                pendingFrameGeometryOperationsForUnloadRef.current,
                revision,
              );
            await acknowledgeOutboxEntry(outboxEntry);
          } catch {
            queryClient.invalidateQueries({
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
      updateDesignAsync,
      warnChangesWillRetry,
    ],
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
      pendingFrameGeometrySaveRef.current = {
        geometryById: cloneCanvasFrameGeometry(geometryById),
        previousGeometry: cloneCanvasFrameGeometry(
          getCanvasFrameGeometry(designDataJsonRef.current),
        ),
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
          pendingFrameGeometrySaveRef,
          queryClient,
        },
        geometryById,
        options,
      ),
    [boardFileId, enqueueFrameGeometryDataSave, id, queryClient],
  );

  const handleGeometryCommit = useCallback(
    (
      before: CanvasFrameGeometryById,
      after: CanvasFrameGeometryById,
      options?: { source?: "pointer" | "keyboard" },
    ) =>
      runGeometryCommit(
        {
          boardFileId,
          captureCurrentSelection,
          clearRedoStacks,
          designDataJsonRef,
          geometryUndoStackRef,
          historyOrderRef,
          id,
          lastGeometryCommitAtRef,
          locallyPinnedHeightIdsRef,
          queryClient,
          queueFrameGeometrySave,
          syncUndoRedoState,
          writeFrameGeometrySnapshot,
        },
        before,
        after,
        options,
      ),
    [
      boardFileId,
      clearRedoStacks,
      id,
      queryClient,
      queueFrameGeometrySave,
      syncUndoRedoState,
      writeFrameGeometrySnapshot,
    ],
  );

  // §6.6 — "Make this a real app" handler.
  // Opens the dialog; actual migration fires when the user confirms.
  const handleOpenMakeReal = useCallback(() => {
    setMigrationResult(null);
    setMakeRealDialogOpen(true);
  }, []);

  // Fires when the user clicks "Start migration" in the dialog.
  // Calls migrate-inline-design-to-app, then on success flips sourceType to
  // "fusion" in the design data blob so gated panels light up.
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
    if (!id || files.length === 0) return;
    const pending = readPendingGeneration(id);
    if (pending?.templateId) return;
    clearGenerationCompleteTimer();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [clearGenerationCompleteTimer, id, files.length]);

  useEffect(
    () =>
      runResumePendingGeneration({
        agentSubmit,
        clearGenerationCompleteTimer,
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
      agentSubmit,
      markGenerationStale,
      trackAgentGeneration,
      clearGenerationCompleteTimer,
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
      // Do not consume the normal pending entry: pagehide can place the page
      // in bfcache. The keepalive protects a real unload, while a restored
      // page still gets the ordinary mutation/settlement path.
      persistFrameGeometrySave(pending, true);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      // Preserve the final drag/resize snapshot across client-side route or
      // design changes instead of cancelling the debounce on unmount.
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
      flushPendingFileContentSavesForBackground();
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

    window.addEventListener("agent-native:app-background", handleBackground);
    window.addEventListener("agent-native:app-foreground", handleForeground);
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

  // Set active file to the primary screen when data loads, and recover when
  // the active screen is deleted remotely/by the agent. Leaving a stale id in
  // state attaches Yjs presence and viewport state to a file that no longer
  // exists even though the rendered `activeFile` has fallen back visually.
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
  // Kept current every render (mirrors activeFileIdForUndoRef just above) so
  // handleGeometryCommit/recordContentHistoryEntry/recordLocalContentHistoryEntry
  // can snapshot "what's selected right now" for undo/redo restore without
  // needing selection state in their own useCallback dependency arrays.
  selectedLayerIdsStateRef.current = selectedLayerIdsState;
  overviewSelectedScreenIdsRef.current = overviewSelectedScreenIds;

  // ── Breakpoints ────────────────────────────────────────────────────────────
  // §6.4 — The design's breakpoint definitions (id/label/width), parsed once
  // from designs.data.breakpointSet for the breakpoint bar and edit-scope
  // routing. Stable empty array when the design has no breakpoints yet.
  const designBreakpoints = useMemo(
    () => deriveDesignBreakpoints(designDataJson),
    [designDataJson],
  );

  // §6.4 — BreakpointBar chip handlers (single-screen bar + overview compact
  // bar). Chip clicks switch the editing viewport width AND persist the edit
  // scope through set-active-breakpoint so the agent and UI stay in sync.
  // Declared here (rather than alongside the other BreakpointBar handlers
  // further down) so handleEscapeHotkey (BP-DEEP item 5, defined earlier in
  // this component) and handleOverviewScreenPick can both reference it
  // without a temporal-dead-zone ReferenceError — this is the ONLY
  // breakpoint handler any other callback needs to close over; the
  // add/remove-breakpoint ones stay where they were, next to the JSX that
  // uses them.
  const handleBreakpointBarSelect = useCallback(
    (widthPx: number | undefined) => {
      // Selection and bridge events from a breakpoint iframe can be followed
      // by a style commit in the same browser task. Mirror synchronously so
      // that commit cannot observe the previous frame's scope while React is
      // still scheduling the state update.
      activeBreakpointWidthStateRef.current = widthPx;
      setActiveBreakpointWidthState(widthPx);
      if (!id) return;
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      const breakpointId = widthPx !== undefined && bp ? bp.id : "auto";
      // Item 9 — seed the dedupe ref BEFORE the mutation resolves so the
      // app-state poll tick this write eventually triggers is a no-op echo,
      // not a redundant re-apply of a value we already set locally.
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [id, designBreakpoints, persistActiveBreakpoint],
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

  // §6.4 — The active screen's primary-frame width (the BASE editing
  // context). Overrides written at a narrower active breakpoint apply below
  // the next-wider frame; the base frame is the widest candidate.
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

  // §6.4 Framer cascade — the upper viewport bound (px) that edits made at
  // the ACTIVE breakpoint should be scoped below, or null when the active
  // frame is the widest context (base editing). See breakpointUpperBoundPx.
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

  // ── Overview screens, zoom basis, URL-driven commands ──────────────────────
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
  const activeScreenBridgeUrl = activeOverviewScreen?.bridgeUrl;
  const activeScreenPreviewToken =
    "previewToken" in (activeOverviewScreen ?? {}) &&
    typeof activeOverviewScreen?.previewToken === "string"
      ? activeOverviewScreen.previewToken
      : undefined;
  const activeScreenExternalSnapshotHtml = activeFile?.id
    ? liveScreenSnapshotsById[activeFile.id]?.html
    : undefined;
  // Board-zoom-corruption fix: the zoom SCALE basis is resolved separately
  // from `activeOverviewScreenId` (which keeps its historical semantics for
  // source/bridge wiring above) so the board file — or any non-screen active
  // file — can never become the basis and flip the scale onto its 320/1280
  // double-fallback while explicitOverviewCanvasZoom stays pinned. See
  // resolveOverviewZoomBasisScreenId's doc comment.
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
    ? canvasFrameGeometryById[overviewZoomBasisScreenId]?.width
    : undefined;
  const overviewZoomScale = getOverviewZoomScale({
    frameWidth: activeOverviewFrameWidth,
    sourceWidth: activeOverviewSourceWidth,
  });
  const overviewZoomScaleRef = useRef(overviewZoomScale);

  useEffect(() => {
    overviewZoomScaleRef.current = overviewZoomScale;
  }, [overviewZoomScale]);

  // Defensive invalidation: if a basis-identity change would turn the pinned
  // explicit canvas zoom into an out-of-range displayed zoom, drop the pin so
  // the derivation re-anchors instead of surfacing a garbage percentage. A
  // normal screen-to-screen basis change (sane label shift, camera untouched)
  // never trips this — see shouldResetExplicitOverviewZoomOnBasisChange.
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
  // Fix-wave: resolve the target view from `viewMode` React state directly,
  // not `viewModeRef.current`. The ref is a useEffect-synced mirror (see the
  // `viewModeRef.current = viewMode` effect above) — useEffect runs AFTER
  // commit, so any zoom trigger that can fire synchronously in the same tick
  // as (or a tick before the next paint after) a view-mode change risked
  // reading a one-render-stale ref value and routing the zoom write to the
  // WRONG view's zoom state entirely (this was the "Zoom to 50%" → overview
  // bug). `setZoom` is a plain useCallback depending on `viewMode`, so it's
  // always recreated with the current value the instant `viewMode` changes —
  // there is no window where a caller can observe a stale target view.
  // viewModeRef itself is left in place for the many *other* consumers deep
  // in canvas/gesture handlers that read it off the render path (e.g. native
  // event listeners) where a state dependency isn't practical; those are
  // audited separately and each pairs a synchronous ref write with its
  // setViewMode call.
  const setZoom = useCallback(
    (update: SetStateAction<number>) => {
      setZoomForView(viewMode, update);
    },
    [setZoomForView, viewMode],
  );

  // Record the active screen's zoom into the per-screen memory map on every
  // change made through setZoom/setZoomForView while in single-screen mode
  // (pinch/scroll zoom, zoom-in/out controls, the zoom field, etc. all funnel
  // through setScreenZoom, which is what `screenZoom` reflects here) — so
  // enterSingleScreen can restore it later. Effect-based rather than wrapping
  // every setScreenZoom call site: it uniformly captures every path that
  // changes screenZoom while a screen is focused, current or future.
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
          setPinMode,
          setScreenZoom,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          setZoomForView,
          viewModeRef,
        },
        command,
      ),
    [
      canEditDesign,
      canvasFrameGeometryById,
      files,
      id,
      overviewScreens,
      setZoomForView,
    ],
  );

  // Direct links are read-only navigation too: viewers must be able to restore
  // the requested screen, view, and zoom even though tool activation remains
  // guarded inside applyDesignEditorCommand.
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

  // ── Screen creation ────────────────────────────────────────────────────────
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
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
          return old;
        }
        const optimisticFile: DesignFile = {
          id: args.fileId,
          filename: args.filename,
          fileType: args.fileType,
          content: args.content,
          createdAt:
            typeof args.result?.createdAt === "string"
              ? args.result.createdAt
              : now,
          updatedAt:
            typeof args.result?.updatedAt === "string"
              ? args.result.updatedAt
              : now,
        };
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
    (screenId: string, geometry: FrameGeometry) => {
      const plan = getCreatedScreenNavigationPlan({ screenId, geometry });
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
      cameraCommandNonceRef.current += 1;
      setCameraCommand({
        ...plan.camera,
        nonce: cameraCommandNonceRef.current,
      });
    },
    [clearPendingOverviewLayerSelectionTimer],
  );

  const handleDuplicateScreen = useCallback(
    (
      screenId: string,
      request?: {
        canvasPosition?: { x: number; y: number };
      },
    ) =>
      runDuplicateScreen(
        {
          canEditDesign,
          createFileAsync,
          designDataJsonRef,
          files,
          focusCreatedScreen,
          id,
          liveFrameGeometryRef,
          optimisticallyInsertCreatedFile,
          overviewScreens,
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
        canEditDesign,
        canvasFrameGeometryById,
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
      }),
    [
      canEditDesign,
      canvasFrameGeometryById,
      createFileMutation,
      files,
      focusCreatedScreen,
      id,
      optimisticallyInsertCreatedFile,
      overviewScreens.length,
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
          canvasFrameGeometryById,
          createFileMutation,
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
      canvasFrameGeometryById,
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

  // Figma's Frame tool (F/A) size-preset list in EditPanel: clicking a preset
  // creates a new screen at exactly that width/height. Reuses
  // handleCreateScreenFrame's create+select+revert-tool machinery — only the
  // geometry differs (a preset-sized frame placed just past the current
  // content's bounds, rather than a drag-drawn rectangle). MultiScreenCanvas
  // owns overview pan/scroll internally (no onPanChange prop is exposed), so
  // there's no real "visible viewport center in world space" available here;
  // placing the new frame adjacent to the existing content bounds (the same
  // fallback the initial per-screen grid placement uses) is the closest
  // honest approximation without plumbing a new pan-reporting API out of
  // MultiScreenCanvas.
  const handleCreateScreenFromPreset = useCallback(
    (preset: { name: string; width: number; height: number }) => {
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById,
        boardContentBounds,
        boardFileId,
      });
      const bounds = getFrameGroupBounds(frames);
      // 56px matches the overview grid's own screen-to-screen gap
      // (MultiScreenCanvas's SCREEN_GAP) so a preset frame reads as part of
      // the same layout rhythm instead of a mismatched offset.
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
      canvasFrameGeometryById,
      handleCreateScreenFrame,
      overviewScreens,
    ],
  );

  // Collaborative editing for the active file
  const { ydoc, awareness, isSynced, activeUsers, agentActive } =
    useCollaborativeDoc({
      docId:
        isSignedIn && canEditDesign && viewMode === "single"
          ? activeFileId
          : null,
      requestSource: TAB_ID,
      user: currentUser,
    });

  // ── Overview presence (Task 1) ──────────────────────────────────────────────
  //
  // In single-screen mode the collab doc above already drives selection rings +
  // recent-edit highlights over the one active iframe. Overview (MultiScreenCanvas)
  // has no single active collab doc, so we open a SEPARATE, presence-only
  // subscription here. Design decisions:
  //
  //  • Subscription model: a SINGLE subscription for the most-relevant file —
  //    `activeFileId` (which in overview defaults to the selected/first screen
  //    and is advanced to the worked file by the agent's view-screen / navigate
  //    actions). We deliberately do NOT open one subscription per visible frame:
  //    an overview board can hold many screens, and N polling docs would be
  //    wasteful. Actions publish agent presence to the FILE id (see
  //    edit-design.ts / apply-visual-edit.ts → agentEnterDocument(file.id)), so
  //    this one doc surfaces the agent's `selection` + `recentEdits` for the file
  //    it is editing.
  //  • Only mounts in overview so we never run two live docs for the same file.
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

  // ── Collaboration sync (Yjs) ───────────────────────────────────────────────
  // Track collab-sourced content for the active file.
  // When Y.Doc is synced and has content, use it as the source of truth
  // instead of the DB-fetched content so live remote edits appear instantly.
  const [collabContent, setCollabContent] = useState<string | null>(null);
  const [collabContentFileId, setCollabContentFileId] = useState<string | null>(
    null,
  );
  const previousDesignIdForHistoryRef = useRef<string | null>(null);
  const prevActiveFileIdRef = useRef<string | null>(null);
  // `updatedAt` of the DB content this preview currently reflects. A poll that
  // returns an older-or-equal value is a stale snapshot and is ignored; a newer
  // one is a genuine external edit (agent / peer-via-SQL) and is reconciled in.
  // Mirrors the content template's VisualEditor `lastAppliedUpdatedAt` gate.
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  // The last content this client itself wrote into the Y.Doc (inline-style
  // edits) — so the reconcile/observe doesn't treat our own echo as external.
  const lastLocalContentRef = useRef<string | null>(null);
  const latestActiveContentRef = useRef<string | null>(null);
  // Freshest known DB `updatedAt` for the active file, kept in a ref so the
  // Yjs observe handler can advance the reconcile watermark without re-subscribing.
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

  // Whether this client applies authoritative external snapshots into the
  // shared Y.Doc. Exactly one client (the lead) does, so an agent/peer edit
  // that arrives via the get-design refetch isn't diffed into the CRDT by every
  // open client and duplicated. Re-elected on awareness / visibility changes.
  const [isLeadClient, setIsLeadClient] = useState(true);
  useEffect(() => {
    if (!awareness || !ydoc) {
      setIsLeadClient(true);
      return;
    }
    const update = () =>
      setIsLeadClient(isReconcileLeadClient(awareness, ydoc.clientID));
    update();
    awareness.on("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      awareness.off("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [awareness, ydoc]);

  useEffect(() => {
    if (previousDesignIdForHistoryRef.current === id) return;
    previousDesignIdForHistoryRef.current = id ?? null;
    clearLocalUndoRedoStacks();
    syncUndoRedoState();
  }, [clearLocalUndoRedoStacks, id, syncUndoRedoState]);

  // Reset per-file reconcile state when switching files.
  // Keep undo/redo content + geometry stacks intact: overview mode needs one
  // chronological history across all screens, board edits, and frame geometry.
  useEffect(() => {
    if (viewMode === "overview") {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
      return;
    }
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      setCollabContentFileId(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      latestActiveContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery, viewMode]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);

  // Seed collab content from Y.Doc once synced
  useEffect(
    () =>
      runSeedCollabContent({
        activeFile,
        activeFileId,
        collabContentFileIdRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
        lastLocalContentRef,
        latestActiveContentRef,
        pendingLocalFileContentsRef,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        undoManagerRef,
        ydoc,
      }),
    [
      ydoc,
      isSynced,
      activeFileId,
      activeFile?.content,
      activeFile?.fileType,
      activeFile?.updatedAt,
      pendingLocalFileContentsRevision,
    ],
  );

  // Keep the freshest DB `updatedAt` in a ref the observe handler can read.
  useEffect(() => {
    documentFileUpdatedAtRef.current = activeFile?.updatedAt ?? null;
    documentFileContentRef.current = activeFile?.content ?? null;
  }, [activeFile?.content, activeFile?.updatedAt]);

  useEffect(() => {
    collabContentRef.current = collabContent;
    collabContentFileIdRef.current = collabContentFileId;
  }, [collabContent, collabContentFileId]);

  // Observe Y.Text changes for live updates from remote editors (peers + the
  // agent's in-process applyText). This is the instant peer-to-peer path.
  useEffect(
    () =>
      runObserveCollabText({
        activeFileId,
        agentActive,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isSynced,
        lastAppliedFileUpdatedAtRef,
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
      activeFileId,
      agentActive,
      isSynced,
      recordExternalContentHistoryCheckpoint,
      ydoc,
    ],
  );

  // Create / recreate the UndoManager whenever the active file's ydoc changes.
  // Tracks only LOCAL_EDIT_ORIGIN so remote peers' and agent edits are never
  // undone by this user's Cmd+Z. captureTimeout=800ms coalesces rapid slider
  // drags into a single undo step.
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
    um.on("stack-item-added", handleStackItemAdded);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", syncState);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.off("stack-item-added", handleStackItemAdded);
      um.off("stack-item-updated", syncState);
      um.off("stack-item-popped", syncState);
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

  // Reconcile authoritative external DB content (agent edit / peer-via-SQL) into
  // the live preview. This is the robustness fallback the Yjs observe path can't
  // guarantee on its own: a collab poll can be missed or paused (e.g. the tab
  // was backgrounded, or refetchInterval is off for a normal agent edit), but
  // get-design still refetches via the action-change invalidate. Driven by
  // `updatedAt`: only content genuinely newer than what the preview reflects is
  // adopted, so a lagging poll can never revert live edits. The lead client also
  // writes it into the Y.Doc so peers receive it and it persists.
  useEffect(
    () =>
      runAdoptDbFileContent({
        activeFile,
        agentActive,
        clearStaleAgentCollabRecovery,
        collabContent,
        collabContentFileId,
        collabContentFileIdRef,
        collabContentRef,
        documentFileContentRef,
        documentFileUpdatedAtRef,
        isLeadClient,
        isSynced,
        lastAckedFileContentHashRef,
        lastAppliedFileUpdatedAtRef,
        lastLocalContentRef,
        latestActiveContentRef,
        recordExternalContentHistoryCheckpoint,
        replacePreviewContent,
        setCollabContent,
        setCollabContentFileId,
        setContentRenderRevision,
        staleAgentCollabRecoveryTimerRef,
        undoManagerRef,
        ydoc,
      }),
    [
      activeFile,
      agentActive,
      clearStaleAgentCollabRecovery,
      collabContent,
      collabContentFileId,
      isSynced,
      isLeadClient,
      recordExternalContentHistoryCheckpoint,
      ydoc,
    ],
  );

  // Set awareness local state to include which file the user is viewing
  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

  // ── Presence, canvas refs, overlay rect resolution ─────────────────────────
  // Presence kit — others + setPresence for cursor/selection broadcasting.
  const { others, setPresence } = usePresence(
    awareness,
    ydoc?.clientID ?? null,
  );

  // Canvas container ref for cursor overlay coordinate mapping.
  const canvasContextMenuRef = useRef<CanvasContextMenuHandle | null>(null);
  const [canvasLayerHitCandidates, setCanvasLayerHitCandidates] = useState<
    CanvasLayerHitCandidate[]
  >([]);
  // L12: imperative handle so Cmd+R and the canvas context-menu Rename item
  // can start the layers panel's real inline rename editor on the selected
  // layer (see beginRename in LayersPanel.tsx).
  const layersPanelRef = useRef<LayersPanelHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const activeEditorDragRef = useRef(false);

  // Live handle to the active DesignCanvas preview iframe. DesignCanvas owns the
  // <iframe> internally (tagged data-design-preview-iframe) and does not forward
  // its ref, so we resolve the element lazily from the DOM at read time. The
  // MotionDock reads `.current` only when scrubbing, so this always returns the
  // currently-mounted iframe even after content swaps recreate the element.
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

  const handleEditorDragStateChange = useCallback((active: boolean) => {
    activeEditorDragRef.current = active;
  }, []);

  const cancelActiveEditorDrag = useCallback(() => {
    if (!activeEditorDragRef.current) return false;
    activeEditorDragRef.current = false;
    if (typeof document === "undefined") return true;
    document
      .querySelectorAll<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
      .forEach((iframe) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag" },
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

  // PF5: rAF-coalesce cursor presence broadcasts. Pointer moves can fire far
  // more often than a frame (high-polling-rate mice, trackpads), and each
  // setPresence call was triggering a fresh awareness broadcast + local
  // subscriber re-render (see packages/core presence.ts PF1). Latest-wins:
  // only the most recent pointer position within a frame is sent.
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
      }
    };
  }, []);

  // Broadcast pointer position (normalized to canvas container) and
  // selected element selector so peers can see where the user is working.
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

  // Clicking the empty grey canvas background (the area around the framed
  // preview) deselects the current element in single-screen mode. Overview
  // mode has its own marquee-based empty-click deselect in MultiScreenCanvas,
  // so we only act here when NOT in overview.
  const handleCanvasBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Overview mode has its own marquee-based empty-click deselect in
      // MultiScreenCanvas; only handle single-screen here.
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
      // Mirror the marquee/Escape clear path: the selection highlight for an
      // in-screen element is drawn inside the iframe by the bridge, so clearing
      // only host state leaves that highlight visible. Bump the bridge
      // clear-selection signal too (the single-screen canvas reads this via
      // clearSelectionRequest={overviewClearSelectionRequest}).
      setOverviewClearSelectionRequest((request) => request + 1);
    },
    [],
  );

  // Block canvas pointer events while any Radix popover is open over the editor.
  // Portaled Radix popovers render into document.body and visually overlap the
  // canvas iframe, but the iframe has its own event context so it still receives
  // pointer events that pass through the popover layer. This shield prevents
  // unintended drag/style edits triggered by clicks intended for the inspector.
  //
  // Stuck-shield fix (two independent causes, both fixed here):
  //
  // 1. Detection staleness: Radix's Portal container for a given trigger is
  //    created ONCE and reused across opens — only its CONTENTS (and its own
  //    data-state attribute) change on subsequent opens/closes, the wrapper
  //    node itself is not removed from document.body. Selecting a
  //    DropdownMenuItem (as opposed to Escape, which does tear the wrapper
  //    out of the DOM) closes the menu via that reused-wrapper path, so a
  //    body-only, subtree:false observer never fires again after the FIRST
  //    popover interaction. Fixed by watching the whole subtree and
  //    data-state attribute changes, so a close-via-reused-wrapper is
  //    detected exactly like a close-via-removal.
  //
  // 2. False-positive source: `[data-radix-popper-content-wrapper]` is not
  //    specific to menus/popovers — Radix's Tooltip primitive uses the same
  //    Popper machinery and stamps the identical wrapper attribute (see
  //    TooltipContent in packages/toolkit/src/ui/tooltip.tsx, which adds
  //    `data-agent-native-tooltip="true"` on its own Content node
  //    specifically so callers like this one can tell tooltips apart from
  //    real menus/popovers). The zoom control's trigger button is wrapped in
  //    both a Tooltip AND a DropdownMenu (renderZoomControl): closing the
  //    dropdown by selecting an item can leave the hover-triggered tooltip's
  //    own portal open (or briefly re-open on the same tick), which this
  //    selector cannot distinguish from a real open menu — so the shield
  //    stayed up for as long as the mouse lingered over the trigger.
  //    Fixed by excluding wrappers whose only open content is a tooltip.
  //
  // The open/closed decision itself is the shared isRadixOverlayOpen
  // predicate (finding 7) — updateIframePointerEvents below uses the exact
  // same predicate so the two shields can't drift apart again.
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

  // Broadcast selected element selector via presence so peers can render a ring.
  useEffect(() => {
    setPresence({ selection: selectedElement?.selector ?? null });
  }, [selectedElement?.selector, setPresence]);

  // PF7: rAF-throttle viewport presence broadcasts. `zoom` can change on
  // every wheel/pinch tick during a live zoom gesture (see PF2 in
  // use-pinch-zoom.ts), so without coalescing this effect fired a
  // setPresence call per tick. Latest-wins, same pattern as the cursor
  // broadcast above (PF5).
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

  // ── Remote selection rings + lingering edit highlights on the canvas ────────
  //
  // The agent (and human peers) publish selection descriptors + recentEdits into
  // awareness. Both are resolved by locating the target element INSIDE the active
  // screen's iframe, then transforming the iframe-local rect into parent-viewport
  // coordinates. The iframe sits inside a `transform: scale(zoom)` wrapper, so its
  // on-screen size differs from its internal layout size; we derive the scale from
  // `boundingRect.width / iframe.clientWidth` (robust to any wrapper transform)
  // instead of reading the zoom value directly. Cross-origin/unmounted iframes
  // return null (the ring/highlight is silently skipped).

  // Map an iframe-local DOMRect (element or Range) to the parent viewport.
  const mapIframeRectToViewport = useCallback(
    (iframe: HTMLIFrameElement, rect: DOMRect): DOMRect | null => {
      const frameRect = iframe.getBoundingClientRect();
      if (frameRect.width === 0 || frameRect.height === 0) return null;
      // Effective on-screen scale of the iframe's internal coordinate system.
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

  // Resolve a CSS selector to a viewport rect inside a specific iframe. The
  // iframe is the coordinate anchor, so the same logic serves both the
  // single-screen preview iframe and each overview frame iframe (see the
  // overview resolvers below, which pass the frame the agent is editing).
  const resolveSelectorRectInIframe = useCallback(
    (iframe: HTMLIFrameElement | null, selector: string): DOMRect | null => {
      if (!iframe) return null;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
        // coercion-ok: cross-origin iframe access is an expected absent-geometry result.
      } catch {
        return null; // cross-origin — cannot inspect
      }
      if (!doc) return null;
      let el: Element | null = null;
      try {
        el = doc.querySelector(selector);
        // coercion-ok: an invalid selector has no inspectable geometry.
      } catch {
        return null; // invalid selector
      }
      if (!el) return null;
      return mapIframeRectToViewport(iframe, el.getBoundingClientRect());
    },
    [mapIframeRectToViewport],
  );

  // Resolve a text quote to a viewport rect by walking a specific iframe body.
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

  // Resolve a CSS selector to a viewport rect inside the active screen iframe.
  const resolveSelectorRect = useCallback(
    (selector: string): DOMRect | null =>
      resolveSelectorRectInIframe(canvasIframeRef.current, selector),
    [canvasIframeRef, resolveSelectorRectInIframe],
  );

  // Resolve a text quote to a viewport rect by walking the iframe body's text.
  const resolveTextQuoteRect = useCallback(
    (quote: string): DOMRect | null =>
      resolveTextQuoteRectInIframe(canvasIframeRef.current, quote),
    [canvasIframeRef, resolveTextQuoteRectInIframe],
  );

  // resolveRect for RemoteSelectionRings — descriptor is a CSS selector string.
  const resolveSelectionRect = useCallback(
    (descriptor: string): DOMRect | null => resolveSelectorRect(descriptor),
    [resolveSelectorRect],
  );

  // resolveRect for RecentEditHighlights — dispatch on descriptor kind.
  const resolveRecentEditRect = useCallback(
    (edit: AttributedRecentEdit): DOMRect | null => {
      const d = edit.descriptor;
      if (d.kind === "selector" && typeof d.selector === "string") {
        return resolveSelectorRect(d.selector);
      }
      if (d.kind === "text" && typeof d.quote === "string") {
        return resolveTextQuoteRect(d.quote);
      }
      // "paths" and whole-"doc" descriptors have no canvas region here.
      return null;
    },
    [resolveSelectorRect, resolveTextQuoteRect],
  );

  const recentEdits = useRecentEdits(others);

  // Re-key the presence array on zoom so the overlays recompute their rects when
  // the canvas zooms (the container itself doesn't resize, so the overlays'
  // ResizeObserver wouldn't otherwise fire). Cheap: a new array reference only.
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

  // ── Synthesized AI cursor (Task 3) ──────────────────────────────────────────
  //
  // The agent publishes a selection/recentEdit but no cursor. Derive a moving
  // cursor for it from whatever region currently resolves, normalized against
  // the canvas container the same way human cursors are (see
  // handleCanvasPointerMove) so LiveCursorOverlay places it correctly. The 120ms
  // CSS transition in the overlay animates it smoothly between edit targets.
  const othersWithAgentCursor = useMemo<OtherPresence[]>(() => {
    const container = canvasContainerRef.current;
    if (!container) return othersForOverlays;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) {
      return othersForOverlays;
    }
    return othersForOverlays.map((other) => {
      // Only synthesize when the agent has no real cursor of its own.
      if (!other.isAgent || other.presence.cursor) return other;
      // Prefer the agent's active selection; fall back to its latest recentEdit.
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
      // Normalize the rect's center to container fractions (matches human cursors).
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

  // ── Overview presence overlays (Task 1) ─────────────────────────────────────
  //
  // Element-level rings + recent-edit highlights over the overview board. The
  // agent's descriptors are published on the overview presence doc above and
  // resolved INSIDE the frame the agent is editing. Because we resolve against
  // the frame iframe's `getBoundingClientRect()` (via mapIframeRectToViewport),
  // the board pan/zoom transform is already baked into the returned viewport
  // coords — RemoteSelectionRings / RecentEditHighlights convert those to
  // container-relative against the same `canvasContainerRef`, so we do NOT
  // duplicate MultiScreenCanvas's transform math.
  const { others: overviewOthers } = usePresence(
    overviewAwareness,
    overviewYdoc?.clientID ?? null,
  );

  // Find the overview frame iframe for a given file id. Frames tag their iframe
  // with `data-screen-iframe-id` = screen id (or `<id>::bp-<width>` for an
  // active breakpoint), so match the exact id or the breakpoint-prefixed form.
  const getOverviewFrameIframe = useCallback(
    (fileId: string | null): HTMLIFrameElement | null => {
      if (!fileId) return null;
      const container = canvasContainerRef.current;
      if (!container) return null;
      const escaped =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(fileId) : fileId;
      return (
        container.querySelector<HTMLIFrameElement>(
          `iframe[data-screen-iframe-id="${escaped}"]`,
        ) ??
        container.querySelector<HTMLIFrameElement>(
          `iframe[data-screen-iframe-id^="${escaped}::bp-"]`,
        ) ??
        null
      );
    },
    [canvasContainerRef],
  );

  // Overview resolvers: the agent's presence rides on `overviewPresenceFileId`,
  // so resolve every descriptor inside that file's frame iframe.
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
      // "paths" and whole-"doc" descriptors have no single canvas region.
      return null;
    },
    [
      getOverviewFrameIframe,
      overviewPresenceFileId,
      resolveSelectorRectInIframe,
      resolveTextQuoteRectInIframe,
    ],
  );

  // Show only the agent's presence in overview (human peers edit inside their
  // own focused screen; the board treatment is about surfacing agent work). Re-
  // key on the overview zoom so rings recompute when the board zooms — the
  // container itself doesn't resize, so the overlays' ResizeObserver wouldn't
  // otherwise fire (same trick as the single-screen `othersForOverlays`).
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

  // ── Follow collaborator, screen content, runtime snapshots ─────────────────
  // Follow mode — clicking an avatar in the toolbar follows that participant.
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
        // Already following — stop.
        setFollowingEmail(null);
        stopFollowing();
      } else {
        setFollowingEmail(email);
      }
    },
    [followingEmail, stopFollowing],
  );

  const designCollaborators = useMemo<DesignCollaborator[]>(() => {
    const currentEmail = currentUser?.email.trim().toLowerCase() ?? null;
    const humans = dedupeCollabUsersByEmail([
      ...(currentUser ? [currentUser] : []),
      ...activeUsers,
    ]).filter((user) => user.email.trim().toLowerCase() !== "agent@system");
    const otherHumans = humans.filter(
      (user) => user.email.trim().toLowerCase() !== currentEmail,
    );
    const collaborators = otherHumans.map((user) => ({ user }));

    if (!currentUser) return collaborators;

    return [
      {
        user: currentUser,
        image: session?.image,
        isCurrent: true,
      },
      ...collaborators,
    ];
  }, [activeUsers, currentUser, session?.image]);

  // Resolve the content to render: prefer collab content only after the
  // per-file reconcile state has reset for the current active file. Otherwise a
  // file switch can render one frame with the previous file's Yjs text.
  // Always resolve to a string — a non-string source (e.g. a collab value that
  // is not yet a plain string, or a not-yet-loaded file) must never reach the
  // many `content.trim()` / projection callers below, which would crash render.
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
  const activeContent =
    typeof activeContentSource === "string" ? activeContentSource : "";
  const initialGenerationChromeLimited =
    shouldLimitEditorChromeUntilContentReady({
      fileCount: files.length,
      generating,
      hasActiveCanvasContent: Boolean(activeFile && activeContent.trim()),
      pendingGenerationActive,
    });
  useLayoutEffect(() => {
    latestActiveContentRef.current = activeContent;
  }, [activeContent]);
  useEffect(() => {
    if (!initialGenerationChromeLimited || activeLeftPanel === "agent") return;
    setActiveLeftPanel("agent");
  }, [activeLeftPanel, initialGenerationChromeLimited]);
  const fileContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.id, typeof file.content === "string" ? file.content : "");
    }
    return map;
  }, [files]);
  const getScreenContent = useCallback(
    (screenId: string) =>
      getFreshScreenContent({
        screenId,
        activeFileId: activeFile?.id,
        freshActiveContentFileId: activeFile?.id,
        freshActiveContent: activeContent,
        fileContentById,
        // Same-tick freshness for NON-ACTIVE screens (see the param's doc on
        // getFreshScreenContent): applyFileContentUpdate writes this ref
        // synchronously via markPendingLocalFileContent, while the
        // files-derived map above only refreshes on the next render. Without
        // it, the second message of a bridge drop sequence (auto-layout
        // conversion style → structure move) rebased off stale content and
        // clobbered the first message's edit.
        pendingContent:
          pendingLocalFileContentsRef.current.get(screenId)?.content ?? null,
      }),
    [activeContent, activeFile?.id, fileContentById],
  );
  const durableLockedLayerCount = useMemo(
    () =>
      countLockedLayersAcrossFiles(
        files.map((file) => ({ content: getScreenContent(file.id) })),
      ),
    [files, getScreenContent],
  );
  const getProjectionContentForScreen = useCallback(
    (screenId: string) =>
      liveScreenSnapshotsById[screenId]?.html ?? getScreenContent(screenId),
    [getScreenContent, liveScreenSnapshotsById],
  );

  // PF6: per-screen embeddedFrame cache. Previously renderScreenContent built
  // a fresh embeddedFrame object literal on every call, which happens once
  // per rendered screen on every MultiScreenCanvas render (including drag/
  // resize gestures on frames that aren't the one being resized). Cache by
  // screen id + rounded dimensions so unrelated screens/renders reuse the
  // same object identity and DesignCanvas's own memoization can bail.
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
  // Per-screen stable identity for DesignCanvas's onRuntimeLayerSnapshot prop
  // (mirrors the embeddedFrameCacheRef pattern above). The overview map below
  // previously passed a fresh `(snapshot) => handleScreenRuntimeLayerSnapshot(
  // screen.id, snapshot)` arrow on every render for every rendered screen;
  // since handleScreenRuntimeLayerSnapshot itself never changes identity
  // (empty deps), a bound function per screenId can be created once and
  // reused forever. DesignCanvas lists onRuntimeLayerSnapshot as a dependency
  // of its window "message" listener effect, so an unstable per-render
  // identity here was tearing down and re-adding that listener on every
  // MultiScreenCanvas render.
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
      // U20: URL-backed/localhost ("live snapshot") screen edits never went
      // through applyFileContentUpdate/applyLocalContentUpdate (the 3 call
      // sites all write here directly), so no undo/redo entry was ever
      // recorded for them. Record the same shape of ContentHistoryChange
      // used everywhere else; handleUndo/handleRedo route replay for this
      // fileId back through this same function (see the matching check in
      // both) instead of the regular DesignFile.content path.
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
      return true;
    },
    [
      liveScreenSnapshotsById,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      t,
    ],
  );
  // ── Pending live-edit recorders ────────────────────────────────────────────
  const recordPendingVisualStyleEdit = useCallback(
    (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: {
        originalStyles?: Record<string, string>;
        interactionState?: InteractionState;
      },
    ) =>
      runRecordPendingVisualStyleEdit(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthState,
          activeFile,
          canEditDesign,
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
          responsiveEditScopeRef,
          runtimeLayerSnapshotsById,
          selectedElement,
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
      },
    ) =>
      runRecordPendingLiveTextEdit(
        {
          activeFile,
          canEditDesign,
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
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        layerId,
        state,
        enabled,
        originalEnabled,
      ),
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
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
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        /** Markup this change introduced; the subject does not exist in the
         * screen's source yet, so it must be added rather than relocated. */
        insertedHtml?: string;
        /** The inserted markup replaced this subject as one live gesture. */
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
        /** This change DELETED the subject; it has no anchor. */
        removed?: true;
      },
    ) =>
      runRecordPendingLiveStructureEdit(
        {
          canEditDesign,
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
          runtimeLayerSnapshotsById,
          setPendingLiveNonStyleEdits,
        },
        screenId,
        selector,
        anchorSelector,
        placement,
        elementInfo,
        details,
      ),
    [
      canEditDesign,
      cancelPendingStructureVerification,
      files,
      overviewScreens,
      runtimeLayerSnapshotsById,
    ],
  );
  const activeProjectionContent =
    activeFile?.id !== undefined
      ? getProjectionContentForScreen(activeFile.id)
      : activeContent;
  // ── Code-layer projection and selection ────────────────────────────────────
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );
  const activeCodeLayerProjection = useMemo(
    () => buildCodeLayerProjection(activeProjectionContent),
    [activeProjectionContent],
  );
  /**
   * The active screen's live-DOM projection, or null when the screen carries
   * its own source. Mirrors the eligibility rule `codeLayerModelsByFile` uses
   * to decide which tree the Layers panel renders, so selection resolution and
   * the panel agree on one set of node ids.
   */
  const activeRuntimeCodeLayerProjection = useMemo(() => {
    const fileId = activeFile?.id;
    if (!fileId) return null;
    const snapshot = runtimeLayerSnapshotsById[fileId];
    if (!snapshot) return null;
    // Derived locally rather than from `designSourceType`/`overviewScreenById`,
    // which are declared further down this component and would be in the
    // temporal dead zone here.
    const eligible = shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === fileId),
      fallbackSourceType:
        normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
        normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
        "inline",
      // Eligibility follows the persisted route URL, not the projection
      // content, which may already be a live snapshot.
      content: files.find((file) => file.id === fileId)?.content ?? "",
    });
    if (!eligible) return null;
    const projection = buildCodeLayerProjection(snapshot.html);
    return projection.nodes.length > 0 ? projection : null;
  }, [
    activeFile?.id,
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
    // Flush any pending debounced motion autosave for the PREVIOUS file so
    // edits made inside the debounce window aren't silently dropped on
    // screen/file switch. The flush closure captured the previous file's id
    // and content, so it saves to the right file.
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
  // Shared node-id resolution for the current selection's motion tracks —
  // used by "Copy animation" (item 2d), motionKeyframeState (item 11), and
  // the keyframe-diamond toggle (item 12) so all three agree on the same
  // (targetNodeId, tracks) pairing.
  const selectedMotionTargetNodeId =
    selectedCodeLayerNode?.dataAttributes[
      "data-agent-native-node-id"
    ]?.trim() ??
    selectedElement?.sourceId ??
    null;
  // Item 2d: "Copy animation" is only sensible (Figma-parity) when the
  // current selection already animates something — an untracked node has
  // nothing for copyLayerAnimation to snapshot.
  const selectedElementHasMotionTrack = useMemo(() => {
    if (!selectedMotionTargetNodeId) return false;
    return motionTracks.some(
      (track) => track.targetNodeId === selectedMotionTargetNodeId,
    );
  }, [motionTracks, selectedMotionTargetNodeId]);
  // Item 11 — EditPanel's motionKeyframeState prop: hasTimeline is true once
  // the active screen has ANY motion tracks (Figma shows the diamond rail
  // for every keyframeable field as soon as the layer joins a timeline, not
  // just for properties it already animates); keyframedProperties lists just
  // the CSS property names of tracks targeting THIS node (drives each
  // diamond's outline-vs-filled state). motionTracks is already scoped to
  // activeFile.id (reset/rehydrated per file — see the file-switch effect
  // above), so no extra per-screen filtering is needed here.
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
    if (selectedCodeLayerNode) {
      return codeLayerSelectorAliases(selectedCodeLayerNode);
    }
    return selectedElement?.selector ? [selectedElement.selector] : [];
  }, [selectedCodeLayerNode, selectedElement?.selector]);
  const selectedCanvasSelector = selectedCanvasSelectorCandidates[0] ?? null;

  const handleDesignStateSelect = useCallback(
    (stateId: string | null, row?: DesignStatePreviewRow) => {
      // Same hazard as replacePreviewContent's guard, on the one host push
      // that bypasses it: restoring "no state" posts `activeContent`, which on
      // a localhost screen is the route URL. Refuse the whole interaction —
      // entering a state preview here has no way back out.
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
  const designSourceType = useMemo(
    () =>
      normalizeDesignSourceType(designDataJson.sourceType as unknown) ??
      normalizeDesignSourceType(designDataJson.sourceMode as unknown) ??
      "inline",
    [designDataJson.sourceMode, designDataJson.sourceType],
  );
  const activeCanvasSourceType = resolveOverviewScreenSourceType(
    activeOverviewScreen,
    designSourceType,
  );
  // P4: arms DesignCanvas's single-screen click-to-place overlay only while
  // focused on a single screen with an active creation tool selected —
  // `null` in every other case leaves the overlay unmounted (see
  // getSingleScreenCreationTool's doc comment for the full tool mapping).
  const activeSingleScreenCreationTool = getSingleScreenCreationTool({
    activeTool,
    viewMode,
    hasActiveFile: Boolean(activeFile),
  });
  const sourceCapabilities = useMemo(() => {
    const caps = resolveSourceCapabilities(designSourceType);
    return DESIGN_CAPABILITY_NAMES.filter((name) => hasCapability(caps, name));
  }, [designSourceType]);

  // Full-app-building linkage (see shared/full-app.ts). Non-null only for
  // designs created via the "Full app" creation mode — drives FusionAppBanner
  // and the fusion preview URL fallback below. Flag-independent on read: once
  // a design has this data (created while the flag was on), the banner and
  // canvas wiring keep working even if the flag is later flipped off, so
  // existing full-app designs never regress.
  const fusionApp = useMemo(
    () => readFusionApp(designDataJson),
    [designDataJson],
  );
  useEffect(() => {
    if (fusionApp?.source !== "builder-host") return;
    setBuilderHostConfirmed(true);
  }, [fusionApp?.source]);

  const fullAppBuildingEnabled = useFeatureFlag(FULL_APP_BUILDING.key);

  // Builder-hosted preview URL for fusion-source designs. Prefers the flat
  // `fusionUrl` written by the "Make it real" migration; falls back to the
  // full-app-building `fusionApp.previewUrl` linkage so container dev-server
  // screens render the same way once the container reports a preview URL.
  // Threaded into DesignCanvas so the fusion preview renders (and so the
  // bridge trust check can validate the frame's origin against it).
  const designFusionUrl = useMemo(() => {
    const raw = (designDataJson as { fusionUrl?: unknown }).fusionUrl;
    if (typeof raw === "string" && raw) return raw;
    return fusionApp?.previewUrl;
  }, [designDataJson, fusionApp]);

  // §6.1 — open a component instance's source. open-component-source selects the
  // component root in the editor and emits a navigate app-state; for real-app
  // (localhost / fusion) sources it also resolves the external file location.
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

  // Stable identity for the single-screen-mode DesignCanvas's
  // onRuntimeLayerSnapshot prop, mirroring getRuntimeLayerSnapshotCallback
  // above for the overview per-screen map. That inline call site previously
  // built a fresh `(snapshot) => { if (!activeFile?.id) return;
  // handleScreenRuntimeLayerSnapshot(activeFile.id, snapshot); }` arrow on
  // every render; since DesignCanvas lists onRuntimeLayerSnapshot as a
  // dependency of its window "message" listener effect, that unstable
  // identity was tearing down and re-adding the listener on every render
  // while in single-screen mode. Scoped to activeFile?.id (rather than a
  // per-screenId cache) since single-screen mode only ever has one active
  // screen at a time.
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

  // The selected node id, when it already is a recognised component instance —
  // unlocks the contextual Component section at the top of the Design tab.
  const selectedComponentNodeId = useMemo(() => {
    if (!selectedCodeLayerNode) return undefined;
    return isComponentInstance(selectedCodeLayerNode)
      ? bridgeSourceIdForCodeLayerNode(selectedCodeLayerNode)
      : undefined;
  }, [selectedCodeLayerNode]);
  const selectedElementAlreadyComponent = useMemo(() => {
    if (!selectedElement) return false;
    if (selectedElement.componentName?.trim()) return true;
    return codeLayerNodeLooksLikeComponent(selectedCodeLayerNode);
  }, [selectedCodeLayerNode, selectedElement]);

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

  // A friendly default name for the create-component dialog, derived from the
  // selected element's layer name / tag.
  const defaultComponentName = useMemo(() => {
    if (selectedCodeLayerNode?.layerName)
      return selectedCodeLayerNode.layerName;
    if (selectedElement?.tagName) {
      const tag = selectedElement.tagName;
      return tag.charAt(0).toUpperCase() + tag.slice(1);
    }
    return "Component";
  }, [selectedCodeLayerNode?.layerName, selectedElement?.tagName]);

  // Outer HTML of the selection — backs the inline/Alpine "Inspect code" view.
  const selectedElementOuterHtml = useMemo(() => {
    if (!selectedElement?.selector) return null;
    return getElementOuterHtml(activeContent, selectedElement.selector);
  }, [activeContent, selectedElement?.selector]);

  // ── Motion tracks and keyframes ────────────────────────────────────────────
  // §6.3 — the motion-dock target: the selected element's literal
  // `data-agent-native-node-id` (the value the motion compiler + preview bridge
  // match on, NOT the hashed projection id) plus a friendly label. Single-screen
  // mode auto-stamps every selectable node with this attribute (see the
  // ensureCodeLayerNodeIdsInHtml effect), so a selection reliably resolves to a
  // stable node id here. `null` when nothing animatable is selected — the dock
  // then disables its "Add track" affordance.
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

  // U14: drop any motion track whose targetNodeId was just deleted from the
  // DOM and, when a track was actually pruned, mark motion dirty so the
  // autosave/remove-motion-timeline path persists the cleanup (otherwise the
  // stale managed CSS + timeline row reappear on reload). Reads fresh state
  // through the functional updater so a stale `motionTracks` closure can't
  // resurrect a track; the dirty mark inside the updater is idempotent (a
  // StrictMode double-invoke only re-bumps the deduped autosave revision).
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

  // Serialisable subset of the dock's tracks for the DesignCanvas motion-preview
  // bridge. Strips the UI-only `label` field. Only populated while the dock is
  // open so a closed dock never leaves preview overrides on the canvas; an empty
  // array makes DesignCanvas send `motion-preview-clear`. Scrubbing previews
  // these tracks live in the iframe; autosave only runs for track/duration edits.
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

      // Prefer the LIVE playhead (updated by MotionDock on every rAF/scrub
      // frame) so an edit made mid-playback keys at the true current position;
      // fall back to the committed motionPlayhead when no live value exists
      // (e.g. the dock hasn't reported one yet).
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

  // Item 12 — EditPanel's keyframe-diamond toggle. `cssProperty` is always
  // one of MOTION_PROPERTY_PRESETS's identifiers (see MotionKeyframeCssProperty
  // in inspector/MotionKeyframeDiamond.tsx). Two cases, matching Figma:
  //   - No track yet for (node, property): create one via
  //     createMotionTrackFromPreset (seeded from the preset's from/to pair),
  //     then upsert a keyframe AT the current playhead sampling the
  //     element's live computed value — so the new track both compiles
  //     (valid t=0/t=1 pair) and immediately reflects what's on screen.
  //   - Track exists: toggle a keyframe at the playhead — remove it if one
  //     already sits there (within MOTION_KEYFRAME_TIME_EPSILON), else add
  //     one sampling the current value (matches applyMotionAutoKeyframe's
  //     upsert semantics for the "add" half).
  // One state update (one history step via markMotionTracksDirty), same as
  // every other track mutation in this file.
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
    // Inline/Alpine: the design HTML is the source — show the element's HTML.
    // Localhost React selections also carry bridge provenance. A relative path
    // is displayed as reported but does not become an editor deep link; only a
    // runtime-reported absolute path is eligible for that action.
    return inspectCodeDataForElement(selectedElement, selectedElementOuterHtml);
  }, [selectedElement, selectedElementOuterHtml]);

  const handleCreateComponent = useCallback(
    (name: string) => {
      if (!id || !selectedElement) return;
      const nodeId = selectedElementLayerId ?? undefined;
      const selector = selectedCanvasSelector ?? selectedElement.selector;
      createComponentMutation.mutate(
        {
          designId: id,
          nodeId,
          selector,
          name,
          fileId: activeFileId ?? undefined,
        } as any,
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            toast.success(t("designEditor.toasts.componentCreated"));
          },
          onError: () => {
            toast.error(t("designEditor.toasts.componentCreateFailed"));
          },
        },
      );

      // Follow-up: ask the Design agent to extract props and replace repeated
      // instances with this component. The deterministic annotate above is the
      // core; this is an enhancement that runs in the agent chat.
      sendToDesignAgentChat({
        message: `Extract props for the "${name}" component and replace repeated instances on this design with it.`,
        context: [
          `Design id: "${id}".`,
          selectedElement.selector
            ? `Component root selector: ${selectedElement.selector}.`
            : "",
          nodeId ? `Component root node id: ${nodeId}.` : "",
          `The element was just annotated with data-agent-native-component="${name}".`,
          "Call view-screen first, then use get-code-layer-projection to find repeated instances, and apply-visual-edit / apply-component-prop-edit to converge them on this component with data-agent-native-prop-* props.",
        ]
          .filter(Boolean)
          .join("\n"),
        submit: true,
        openSidebar: true,
      });
    },
    [
      id,
      selectedElement,
      selectedElementLayerId,
      selectedCanvasSelector,
      activeFileId,
      createComponentMutation,
      queryClient,
      t,
    ],
  );

  // H2: Cmd+Alt+K — Figma's "create component" hotkey. Unlike the inspector's
  // create-component button (which opens a naming dialog via EditPanel's
  // internal createComponentOpen state), the hotkey creates immediately using
  // the same friendly default name shown in that dialog, mirroring Figma's
  // no-prompt keyboard flow. No-ops without a selection or when the selection
  // is already a component (same gating as the inspector's onCreateComponent
  // prop below).
  const handleCreateComponentHotkey = useCallback(() => {
    if (
      !canEditDesign ||
      !id ||
      !selectedElement ||
      selectedElementAlreadyComponent
    ) {
      return;
    }
    handleCreateComponent(defaultComponentName);
  }, [
    canEditDesign,
    id,
    selectedElement,
    selectedElementAlreadyComponent,
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
    if (isScreenRootElementInfo(hoveredElement)) return [];
    if (hoveredCodeLayerNode) {
      return codeLayerSelectorAliases(hoveredCodeLayerNode);
    }
    return hoveredElement?.selector ? [hoveredElement.selector] : [];
  }, [hoveredCodeLayerNode, hoveredElement]);
  const hoveredCanvasSelector = hoveredCanvasSelectorCandidates[0] ?? null;
  const hoveredElementIsScreenRoot = isScreenRootElementInfo(hoveredElement);
  const hoveredScreenRootId = hoveredElementIsScreenRoot
    ? hoveredElementScreenId
    : null;
  const hoveredChildScreenId = hoveredElementIsScreenRoot
    ? null
    : hoveredElementScreenId;
  // ── Projection caches and content-update appliers ──────────────────────────
  // PF9: cache non-active-screen projections by content identity. Hover
  // (handleScreenElementHover) calls this on every pointermove over a
  // non-active screen's iframe; without caching that's a full HTML parse
  // per move. Keyed by screenId -> {contentRef, projection} so an unchanged
  // content string (same reference — content strings are only replaced, not
  // mutated, elsewhere in this file) reuses the prior projection.
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
        // Seed the same cache while this file is active. When selection moves
        // to another screen, the old active screen can then become non-active
        // without paying for a fresh full HTML projection on that click.
        cache.set(screenId, {
          contentRef: content,
          projection: activeCodeLayerProjection,
        });
        return activeCodeLayerProjection;
      }
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const projection = buildCodeLayerProjection(content);
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [
      activeCodeLayerProjection,
      activeFile?.id,
      fileContentById,
      getProjectionContentForScreen,
    ],
  );
  const getRuntimeCodeLayerProjection = useCallback(
    (screenId: string, content: string): CodeLayerProjection => {
      const cache = runtimeProjectionCacheRef.current;
      const cached = cache.get(screenId);
      if (cached && cached.contentRef === content) return cached.projection;
      const projection = buildCodeLayerProjection(content);
      cache.set(screenId, { contentRef: content, projection });
      return projection;
    },
    [],
  );

  const replacePreviewContent = useCallback(
    (
      nextContent: string,
      selector?: string | null,
      options: { forceFullDocument?: boolean } = {},
    ): PreviewContentReplaceResult => {
      // A localhost screen's `design_files.content` IS its route URL, so any
      // caller that treats stored/collab content as a document (the collab
      // seed, the SQL reconcile passes, undo/redo replay) can hand this
      // callback the bare URL. The bridge would parse it as a document and
      // replace the running app with the text "http://localhost:8210/" — a
      // wrong-but-plausible state with no error anywhere. Skip it here, the one
      // point every host push funnels through. This is deliberately distinct
      // from an unavailable bridge: rebuilding a live screen from its route
      // marker cannot help and can strand bridge registration after reload.
      if (isStandaloneHttpUrl(nextContent)) {
        return "skipped-live-route";
      }
      const replaceContent = (window as any).__designCanvasReplaceContent;
      if (typeof replaceContent !== "function") return "unavailable";
      return replaceContent(
        nextContent,
        selector ?? selectedCanvasSelector,
        selectedCanvasSelectorCandidates,
        {
          forceFullDocument: options.forceFullDocument === true,
        },
      )
        ? "applied"
        : "unavailable";
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates, selectedElement],
  );

  // BUG-UNDO-LIVE-SNAPSHOT: undo/redo replay for a live-snapshot
  // (localhost/fusion) screen only ever called updateLiveScreenSnapshotContent,
  // which just swaps liveScreenSnapshotsById — that state has no independent
  // renderer for a LIVE iframe (src points at the running app; it is never
  // re-rendered from `content`), so the visible DOM silently kept whatever the
  // last direct style/structure edit left it at while the model quietly
  // reverted underneath. Mirrors applyLocalContentUpdate's
  // forcePreviewFullDocument handling (the "holistic flash pipeline") a few
  // lines up: push the reverted/reapplied HTML into the live iframe via the
  // same whole-document bridge patch, falling back to a full contentRenderRevision
  // reload only when the live patch can't run. Only meaningful for the
  // currently active screen — replacePreviewContent always targets whichever
  // DesignCanvas has registerRuntimeBridge set, which tracks activeFile.
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
          // Candidates default to the CURRENT selection's aliases, which are
          // only the right fallbacks when `selector` describes that same
          // element. A caller deleting a different node must pass its own.
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
        baseContentHash: sourceContentHash(args.baseContent),
        nextContent: args.nextContent,
        nextContentHash: sourceContentHash(args.nextContent),
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

  const applyLocalContentUpdate = useCallback(
    (
      nextContent: string,
      options: {
        refreshPreview?: boolean;
        skipPreview?: boolean;
        forcePreviewFullDocument?: boolean;
        immediateSave?: boolean;
        persist?: boolean;
        recordHistory?: boolean;
        historyBeforeContent?: string;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
      } = {},
    ) =>
      runApplyLocalContentUpdate(
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
          lastAckedFileContentHashRef,
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
        options,
      ),
    [
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
        persist?: boolean;
        recordHistory?: boolean;
        updatedAt?: string;
        clipboardMutation?: ClipboardContentMutationPublication;
      } = {},
    ) =>
      runApplyFileContentUpdate(
        {
          acknowledgeAuthoritativeClipboardMutation,
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          canEditDesignRef,
          cancelQueuedFileContentSave,
          clearPendingLocalFileContent,
          createFileContentSaveRequest,
          files,
          getScreenContent,
          id,
          lastAckedFileContentHashRef,
          markPendingLocalFileContent,
          overviewIsSynced,
          overviewPresenceFileId,
          overviewYdoc,
          queryClient,
          recordContentHistoryEntry,
          saveFileContent,
          suppressContentHistoryRef,
          t,
        },
        fileId,
        nextContent,
        options,
      ),
    [
      activeFile?.id,
      acknowledgeAuthoritativeClipboardMutation,
      applyLocalContentUpdate,
      cancelQueuedFileContentSave,
      clearPendingLocalFileContent,
      createFileContentSaveRequest,
      files,
      getScreenContent,
      id,
      markPendingLocalFileContent,
      overviewIsSynced,
      overviewPresenceFileId,
      overviewYdoc,
      queryClient,
      recordContentHistoryEntry,
      saveFileContent,
      t,
    ],
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

  // ── Component instances and review feedback routing ────────────────────────
  const handleComponentPropApplied = useCallback(
    // Also the GLSL shader picker's onApplied host-sync (glslShaderContext in
    // EditPanel.tsx reuses this contract for apply/remove/knob commits). Must
    // stay on the in-place replace route — see
    // getPersistedContentHostSyncOptions' doc comment (shader-apply white
    // flash regression).
    (fileId: string, nextContent: string, updatedAt?: string) => {
      applyFileContentUpdate(
        fileId,
        nextContent,
        getPersistedContentHostSyncOptions({
          fileId,
          activeFileId: activeFile?.id ?? null,
          updatedAt,
        }),
      );
    },
    [activeFile?.id, applyFileContentUpdate],
  );

  // Instance-only operations (Figma's Go to main component / Swap instance /
  // Detach instance), reachable from the canvas context menu and — for
  // detach — the Cmd+Alt+B hotkey. The searchable Swap instance picker itself
  // lives in the Component inspector section (component-section.tsx, which
  // already wires its own detach/swap/go-to-main mutations and calls
  // onComponentPropApplied on success). Go-to-main and detach call their
  // actions here; Swap opens that canonical picker directly so both entry
  // points share one catalog and mutation path.
  const handleGoToMainComponentMenuAction = useCallback(() => {
    if (!id || !selectedComponentNodeId) return;
    goToMainComponentMutation.mutate(
      {
        designId: id,
        nodeId: selectedComponentNodeId,
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
  }, [activeFileId, goToMainComponentMutation, id, selectedComponentNodeId, t]);

  const handleDetachInstanceMenuAction = useCallback(
    () =>
      runDetachInstanceMenuAction({
        activeContent,
        activeFile,
        activeFileId,
        detachComponentInstanceMutation,
        handleComponentPropApplied,
        id,
        selectedComponentNodeId,
        t,
      }),
    [
      activeFileId,
      activeContent,
      activeFile?.updatedAt,
      detachComponentInstanceMutation,
      handleComponentPropApplied,
      id,
      selectedComponentNodeId,
      t,
    ],
  );

  // Open the inspector's canonical searchable picker directly. Keeping one
  // picker avoids two catalogs drifting while still matching Figma's
  // immediate context-menu behavior (the click opens choices; it doesn't
  // merely tell the user where to look).
  const handleSwapInstanceMenuAction = useCallback(() => {
    if (!id || !selectedComponentNodeId) return;
    setUiHidden(false);
    setMode("edit");
    setActiveInspectorTab("design");
    setComponentSwapPickerRequest((request) => request + 1);
  }, [id, selectedComponentNodeId]);

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
        // apply-a11y-fix persisted the patched content server-side before
        // returning it, so adopting it here is a persisted-content host sync:
        // route through the bridge's in-place replace instead of the
        // refreshPreview srcdoc rebuild (white flash) — see
        // getPersistedContentHostSyncOptions' doc comment. The fix result
        // carries no updatedAt stamp, so none is passed (an invented one
        // would corrupt the acked-hash base for guarded update-file saves).
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
    if (!id || !activeFile) return undefined;
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
    handleReviewFindingClick,
    handleReviewFixApplied,
    handleRunDesignAudit,
    id,
    reviewAuditError,
    reviewAuditLoading,
    reviewAuditedAt,
    reviewFileId,
    reviewFindings,
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
        })
      ) {
        setSelectedElement(null);
        setSelectedLayerIdsState([]);
        setHoveredElement(null);
        setHoveredElementScreenId(null);
        setOverviewClearSelectionRequest((request) => request + 1);
      }
      if (targetId) {
        // Review is editing context on the infinite canvas. Selecting a thread
        // reveals its screen there; it must not revive the removed focused
        // non-Interact view.
        viewModeRef.current = "overview";
        setViewMode("overview");
        setActiveFileId(targetId);
        setOverviewSelectedScreenIds([targetId]);
        setSelectedLayerIdsState([targetId]);
        setMode("edit");
      }
      setActiveInspectorTab("comments");
      reviewFocusNonceRef.current += 1;
      setReviewFocusRequest({
        nonce: reviewFocusNonceRef.current,
        anchor: thread.root.anchor,
        targetId: targetId ?? undefined,
      });
    },
    [activeFile?.id],
  );

  const selectedReviewLayerContext = useMemo(() => {
    if (!activeFile?.id || !selectedElement) return null;

    const selectedScreen = overviewScreens.find(
      (screen) => screen.id === activeFile.id,
    );
    const frameGeometry = canvasFrameGeometryById[activeFile.id];
    const nodeId =
      selectedCodeLayerNode?.dataAttributes[
        "data-agent-native-node-id"
      ]?.trim() ||
      selectedElement.sourceId?.trim() ||
      selectedCodeLayerNode?.id.trim() ||
      null;
    const anchor = createElementReviewAnchor({
      nodeId,
      selector: selectedElement.selector,
      rect: selectedElement.boundingRect,
      viewportWidth:
        activeBreakpointWidthState ??
        frameGeometry?.width ??
        selectedScreen?.width ??
        activeScreenBaseWidthPx,
      viewportHeight: frameGeometry?.height ?? selectedScreen?.height,
    });
    if (!anchor) return null;

    const layerName =
      selectedCodeLayerNode?.layerName.trim() ||
      selectedElement.componentName?.trim() ||
      selectedElement.id?.trim() ||
      selectedElement.tagName.toLowerCase();
    return {
      anchor,
      label: layerName,
      metadata: {
        layerName,
        tagName: selectedElement.tagName.toLowerCase(),
      },
    };
  }, [
    activeBreakpointWidthState,
    activeFile?.id,
    activeScreenBaseWidthPx,
    canvasFrameGeometryById,
    overviewScreens,
    selectedCodeLayerNode,
    selectedElement,
  ]);

  const reviewCommentsPanelProps = useMemo<
    ReviewCommentsPanelProps | undefined
  >(
    () =>
      id
        ? {
            designId: id,
            activeFileId: activeFile?.id,
            commentAnchor: selectedReviewLayerContext?.anchor,
            commentMetadata: selectedReviewLayerContext?.metadata,
            commentContextLabel: selectedReviewLayerContext
              ? t("review.commentingOn", {
                  name: selectedReviewLayerContext.label,
                })
              : undefined,
            canComment: canCommentDesign,
            canResolve: canEditDesign,
            canDeleteComment: (comment) =>
              canEditDesign ||
              ("canDelete" in comment && comment.canDelete === true) ||
              comment.authorEmail === session?.email,
            signInHref: signInToCommentHref,
            canDispatchToAgent: canEditDesign,
            sendingThreadId: reviewSendingThreadId,
            onDispatchCommentToAgent: canEditDesign
              ? handleDispatchCommentToAgent
              : undefined,
            onSendThreadToAgent: canEditDesign
              ? handleSendReviewThreadToAgent
              : undefined,
            onSelectThread: handleReviewThreadSelect,
          }
        : undefined,
    [
      activeFile?.id,
      handleReviewThreadSelect,
      handleDispatchCommentToAgent,
      handleSendReviewThreadToAgent,
      id,
      isSignedIn,
      canEditDesign,
      canCommentDesign,
      reviewSendingThreadId,
      selectedReviewLayerContext,
      session?.email,
      signInToCommentHref,
      t,
    ],
  );

  // ── Primitive creation and vector (pen) editing ────────────────────────────
  const handleCreatePrimitive = useCallback(
    (screenId: string, primitive: CanvasPrimitiveInsert) =>
      runCreatePrimitive(
        {
          activeContent,
          activeFile,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          collabContentFileIdRef,
          collabContentRef,
          createFileContentSaveRequest,
          files,
          id,
          isSynced,
          markPendingLocalFileContent,
          pendingLocalFileContentsRef,
          pendingTextCreationHistoryRef,
          pendingTextEditNodeIdRef,
          queryClient,
          recordContentHistoryEntry,
          runtimeStructureInsertRevisionRef,
          saveFileContent,
          setRuntimeStructureInsertRequest,
          t,
          viewModeRef,
          ydoc,
        },
        screenId,
        primitive,
      ),
    [
      activeContent,
      activeFile?.id,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      createFileContentSaveRequest,
      files,
      id,
      isSynced,
      markPendingLocalFileContent,
      queryClient,
      recordContentHistoryEntry,
      saveFileContent,
      t,
      ydoc,
    ],
  );

  // T6: once a begin-text-edit retry loop for a newly-created text node
  // settles (observed active/done, cancelled early via Escape/blur, or
  // exhausted every retry), remove the node if it never received any real
  // text content. The bridge only posts a text-content-change update when
  // content actually CHANGES, so a node the user never typed into (or
  // Escaped out of immediately) would otherwise persist forever as an
  // invisible empty layer with nothing to select or clean it up.
  /**
   * Drops a text node the user never typed into. Returns why it did or did not
   * act: "node-absent" and "content-unavailable" are races worth one retry
   * (the insert may not have reached `getScreenContent` yet), while
   * "kept-has-content" and "removed" are settled answers. Reporting these
   * separately is the point — every one of them used to be a bare `return`,
   * so an empty text box that survived because its screen content had not
   * propagated was indistinguishable from one deliberately kept, and the box
   * stayed on the canvas invisibly forever.
   */
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
      const projection = buildCodeLayerProjection(content);
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
      const finalizedCreation = finalizePendingTextCreation(
        screenId,
        [nodeId, node.id, node.dataAttributes["data-agent-native-node-id"]],
        nextContent,
      );
      applyFileContentUpdate(screenId, nextContent, {
        refreshPreview: false,
        recordHistory: !finalizedCreation,
      });
      setSelectedLayerIdsState((current) =>
        current.filter((id) => id !== node.id),
      );
      setSelectedElement((current) =>
        current?.sourceId === nodeId || current?.id === nodeId ? null : current,
      );
      return "removed";
    },
    [applyFileContentUpdate, finalizePendingTextCreation, getScreenContent],
  );

  /** Cleanup for an untouched text node, retried once past the insert→content
   *  propagation gap. Without the retry an empty box created while its screen
   *  content was still settling stayed on the canvas as an invisible node. */
  const removeEmptyTextNodeWithRetry = useCallback(
    (screenId: string | null, nodeId: string) => {
      const outcome = removeEmptyTextNodeIfUntouched(screenId, nodeId);
      if (outcome !== "node-absent" && outcome !== "content-unavailable") {
        return;
      }
      window.setTimeout(() => {
        const retried = removeEmptyTextNodeIfUntouched(screenId, nodeId);
        if (retried === "node-absent" || retried === "content-unavailable") {
          console.warn(
            `[design] could not resolve empty text node ${screenId}/${nodeId} to clean up (${retried})`,
          );
        }
      }, EMPTY_TEXT_CLEANUP_RETRY_MS);
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
          boardFileId,
          clearPendingOverviewLayerSelectionTimer,
          pendingEmptyTextEditRef,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          pendingTextEditNodeIdRef,
          removeEmptyTextNodeWithRetry,
          setActiveFileId,
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
      boardFileId,
      clearPendingOverviewLayerSelectionTimer,
      removeEmptyTextNodeWithRetry,
    ],
  );

  // T6: stop the begin-text-edit retry loop as soon as the bridge reports the
  // editing session ended (Escape, blur, or a real commit) instead of
  // continuing to force-reopen it for the rest of the retry window. This is
  // a coarse "any text-editing session just ended" signal (matched against
  // whichever node is currently pending, not a specific selector), which is
  // fine in practice since only one text primitive is normally mid-creation
  // at a time; scheduleBeginTextEditForScreen's onExhausted callback still
  // double-checks pending.nodeId before acting.
  useEffect(() => {
    if (textEditingState.active) return;
    pendingEmptyTextEditRef.current?.cancel();
  }, [textEditingState.active]);

  /**
   * Called by MultiScreenCanvas when a draft primitive is committed in empty
   * canvas space (outside all screen frames).  Appends the primitive to the
   * board file content via the shared handleCreatePrimitive path so the bridge
   * engine handles persistence identically to in-screen elements.
   */
  const handleBoardDrawPrimitive = useCallback(
    (primitive: CanvasPrimitiveInsert) => {
      if (!boardFileId || !canEditDesign) return false;
      const result = handleCreatePrimitive(boardFileId, primitive);
      if (!result) return false;
      const nodeId = typeof result === "string" ? result : primitive.nodeId;
      if (nodeId) {
        handlePrimitiveCreated(boardFileId, nodeId);
      }

      return result;
    },
    [boardFileId, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  /**
   * P4: DesignCanvas's single-screen click-to-place creation overlay
   * (`activeCreationTool`/`onCreatePrimitive` below) commits through this
   * same `handleCreatePrimitive`/`handlePrimitiveCreated` pair overview
   * drawing already uses — `createPrimitiveInsertFromSpec` just translates
   * the overlay's screen-content-space spec into the shared
   * `CanvasPrimitiveInsert` shape first. Pen commits keep Pen active, matching
   * overview/Figma, unless the overlay is flushing a path because the user
   * already selected a different tool.
   */
  const handleSingleScreenCreatePrimitive = useCallback(
    (spec: CreatePrimitiveSpec) => {
      if (!activeFile || !canEditDesign) return;
      const nodeId = uniqueLayerId(spec.tool === "pen" ? "path" : spec.tool);
      const primitive = createPrimitiveInsertFromSpec(spec, nodeId);
      if (!primitive) return;
      const result = handleCreatePrimitive(activeFile.id, primitive);
      if (!result) return;
      const resultNodeId = typeof result === "string" ? result : nodeId;
      handlePrimitiveCreated(activeFile.id, resultNodeId, {
        nextTool: spec.tool === "pen" ? "pen" : undefined,
        preserveActiveTool: spec.preserveActiveTool,
      });
    },
    [activeFile, canEditDesign, handleCreatePrimitive, handlePrimitiveCreated],
  );

  /**
   * P5/vector-edit: commits the working PenPath from MultiScreenCanvas's
   * `vectorEdit` overlay back onto its owning screen. `"preview"` phases
   * (live anchor/handle drag) only update `vectorEditingState.path` — the
   * overlay renders straight off that in-memory path, so nothing needs to
   * touch the iframe/content until the gesture actually settles. `"commit"`
   * phases (mirroring the same preview/commit gesture-signal convention as
   * ScrubInput/DesignColorPicker's onChangeComplete) additionally write the
   * new `d` + data-an-pen-nodes back into the owning screen's HTML through
   * the existing applyFileContentUpdate persistence path, so a single mouse
   * drag becomes exactly one saved edit (and one undo/history entry) rather
   * than one per intermediate frame.
   */
  const handleVectorEditChange = useCallback(
    (nextPath: PenPath, phase: "preview" | "commit") => {
      setVectorEditingState((current) => {
        if (!current) return current;
        if (phase === "commit") {
          const baseContent = getScreenContent(current.screenId);
          if (baseContent) {
            const nextContent = writeBackVectorEditedPenPath(
              baseContent,
              current.nodeId,
              nextPath,
            );
            if (nextContent !== baseContent) {
              applyFileContentUpdate(current.screenId, nextContent, {
                skipPreview: current.screenId !== activeFile?.id,
              });
            }
          }
        }
        return { ...current, path: nextPath };
      });
    },
    [activeFile?.id, applyFileContentUpdate, getScreenContent],
  );

  const handleVectorEditExit = useCallback(() => {
    setVectorEditingState(null);
  }, []);

  /**
   * P5/vector-edit: the VectorEditOverlayState prop threaded to
   * MultiScreenCanvas. `originCanvas` is recomputed on every render from the
   * owning screen's CURRENT frame geometry (see getScreenFrameOriginCanvas)
   * rather than cached in vectorEditingState, so dragging/resizing the
   * screen frame mid-edit can't leave the overlay pinned to a stale
   * position. `null` whenever not editing or the origin can't be resolved
   * (e.g. the owning screen was deleted mid-edit) — MultiScreenCanvas
   * doesn't render the overlay in that case.
   */
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
      originCanvas,
      onChange: handleVectorEditChange,
      onExit: handleVectorEditExit,
    };
  }, [
    boardFileId,
    canvasFrameGeometryById,
    handleVectorEditChange,
    handleVectorEditExit,
    overviewScreens,
    vectorEditingState,
  ]);

  // ── Canvas tool handlers ───────────────────────────────────────────────────
  const handleOverviewScreenSelectionChange = useCallback(
    (ids: string[]) => {
      const pendingId = pendingOverviewScreenSelectionRef.current;
      const fileIds = new Set(
        files.filter((file) => file.id !== boardFileId).map((file) => file.id),
      );
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
    // Toolbar dual-active fix: every other tool-switch handler
    // (handleFrameTool/handleShapeTool/handleTextTool/handlePenTool) wraps
    // its setActiveTool call in flushSync so the toolbar's active/pressed
    // classes commit synchronously with the click. This one didn't, so a
    // rapid V-after-Rectangle press could paint the new tool "pressed" while
    // React hadn't yet flushed the re-render that clears the previous tool's
    // "active" class, leaving both visually active until an unrelated
    // re-render (e.g. the next click) caught it up.
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
      // Figma parity (F): while a single screen is focused, arm the
      // single-screen click-to-place overlay so the frame tool draws a
      // nested container <div> in THIS screen instead of yanking the user
      // out to overview (same pattern as handleTextTool/handleShapeTool).
      // From overview (or with no focused screen), stay in overview where a
      // frame gesture on empty canvas creates a screen.
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

  // T14/P4: text/shape/pen tools used to always force a jump to overview —
  // that's still correct when the user is already IN overview (or has no
  // screen focused yet), but when a single screen is already focused these
  // tools should arm single-screen click-to-place instead of yanking the
  // user out to overview to draw. Overview mode itself is left completely
  // alone below (same flushSync/setViewMode("overview") as before).
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

  // H1: Figma muscle-memory shape-tool shortcuts (L = line, Shift+L = arrow,
  // O = ellipse), wired through the same handleShapeTool used by the shape
  // toolbar dropdown (see the shapeOptions onSelect callbacks above).
  const handleLineTool = useCallback(() => {
    handleShapeTool("line");
  }, [handleShapeTool]);

  const handleArrowTool = useCallback(() => {
    handleShapeTool("arrow");
  }, [handleShapeTool]);

  const handleEllipseTool = useCallback(() => {
    handleShapeTool("ellipse");
  }, [handleShapeTool]);

  // PF8: hoisted MultiScreenCanvas onActiveToolChange — was an inline arrow
  // created fresh every render.
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

  // Figma parity (H): the hand tool used to unconditionally force a jump to
  // overview, same bug handleFrameTool/handleTextTool/handleShapeTool/
  // handlePenTool already fix — arming the hand tool while a single screen is
  // focused should just arm single-screen panning there, not yank the user
  // out to overview. Overview mode itself is left completely alone below.
  const handleHandTool = useCallback(() => {
    if (!canEditDesign) return;
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
  }, [activeFile, canEditDesign]);

  // Figma parity: holding Space arms a TEMPORARY hand tool (grab cursor, drag
  // pans) — stash the current tool and setActiveTool("hand"); releasing
  // restores the stashed tool exactly. Deliberately does NOT route through
  // handleHandTool: that handler resets drawMode/pinMode and can force a jump
  // to overview, none of which Figma's space-hold does (space-panning must
  // work while drawing/annotating/pin-commenting too, and must never yank a
  // focused single screen out to overview) — this effect only swaps
  // activeTool. `spacePanActive` is ALSO threaded to DesignCanvas as its own
  // prop (distinct from `handToolActive`) so single-screen mode's pan
  // gesture wiring doesn't have to infer "space-armed" from activeTool alone.
  const [spacePanActive, setSpacePanActive] = useState(false);
  const spacePanStashedToolRef = useRef<DesignTool | null>(null);
  useEffect(() => {
    if (embedded || (pendingQuestions && pendingQuestions.length > 0)) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!canEditDesignRef.current) return;
      if (isDesignHotkeyEditableTarget(event.target)) return;
      if (spacePanStashedToolRef.current !== null) return;
      event.preventDefault();
      spacePanStashedToolRef.current = activeToolRef.current;
      setSpacePanActive(true);
      setActiveTool("hand");
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || event.code !== "Space") return;
      const stashedTool = spacePanStashedToolRef.current;
      if (stashedTool === null) return;
      spacePanStashedToolRef.current = null;
      setSpacePanActive(false);
      // Guard against tool changes mid-hold: only restore the stashed tool
      // if the tool is still "hand" (i.e. nothing else re-armed a different
      // tool while space was held) — otherwise leave whatever the user
      // explicitly picked mid-hold alone.
      setActiveTool((current) => (current === "hand" ? stashedTool : current));
      event.preventDefault();
    };

    // Also release the temporary hand tool if the window loses focus mid-hold
    // (e.g. Cmd+Tab away) so it never gets stuck armed with no matching keyup.
    const handleWindowBlur = () => {
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
  }, [embedded, pendingQuestions]);

  // PICK-RACE: a native (non-React-state) ref tracking whether Shift is
  // currently physically held, same pattern as spacePanStashedToolRef above.
  // handleOverviewScreenPick (below) reads this to tell a shift-click
  // multi-select toggle apart from a plain single-screen pick — see its
  // usage for the full race this closes.
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

  const handleDrawTool = useCallback(() => {
    if (!activeFile || !canEditDesign) return;
    // Annotation is a viewport-level overlay in overview, so it deliberately
    // stays on the all-screens board. Switching to single view here used to
    // unmount every overview iframe and produced a blank/flashy target.
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
    // Deliberate discard (X button or a confirmed Send) — see
    // overviewAnnotationResetSignal's docblock. Entering a focused screen can
    // hide this overlay, but must not clear its separate board-wide batch.
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

  // ── Tweaks, composer mirroring, asset insert ───────────────────────────────

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
      canEditDesign,
      design,
      handleTweakPromptOpenChange,
      id,
      tweakSelections,
      tweaks,
    ],
  );

  // Expose selection state for agent context
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
      selectedStateId,
      isSignedIn,
    ],
  );

  // R69: once the composer sends this selection as context, the chip must
  // stay cleared — not silently reappear. The composer's own clear-on-send
  // (AssistantChat's addToQueue) only clears its local + published context
  // state; it can't know to stop this effect from re-asserting the SAME
  // selection, which re-fires on every get-design poll during the resulting
  // agent run (selectedCodeLayerNode gets a new reference as the file
  // content changes) even though selectedElement itself never changed. Track
  // the identity of the selection we most recently published; if the shared
  // context store no longer has our key for that same identity (i.e. a send
  // cleared it) we must not republish until the user actually selects
  // something else. Selecting a new element (or re-selecting after
  // deselecting) always clears sentSelectionIdRef via the identity check
  // below, so the attachment reattaches normally for the next edit.
  //
  // IMPORTANT: this effect must NOT depend on the live `items` array from
  // useAgentChatContext(). setAgentChatContextItem always publishes a brand
  // new array reference (even for byte-identical content), so an effect that
  // both reads that array in its deps AND unconditionally calls
  // setAgentChatContextItem would re-fire itself every commit — an infinite
  // render loop (caught live: "Maximum update depth exceeded" in overview
  // mode). Instead, only the narrow "was our key removed" check reads the
  // store, via a ref updated by a SEPARATE effect below whose only job is
  // bookkeeping (it never calls setAgentChatContextItem itself, so it cannot
  // feed back into this one).
  const mirroredSelectionIdRef = useRef<string | null>(null);
  const sentSelectionIdRef = useRef<string | null>(null);
  const composerContextHasOurKeyRef = useRef(true);
  useEffect(
    () =>
      runMirrorSelectionToAgentChat({
        activeFile,
        activeProjectionContent,
        composerContextHasOurKeyRef,
        design,
        id,
        isSignedIn,
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

  // Bookkeeping only — mirrors "does the shared composer context still carry
  // our key" into a ref for the effect above to read. This is intentionally
  // NOT a dependency of that effect (see its comment): this effect only ever
  // writes a ref, never calls setAgentChatContextItem or any other state
  // setter, so it can run on every store change without feeding back into a
  // re-render loop.
  const composerContextItemsForBookkeeping =
    useAgentChatContext(isSignedIn).items;
  useEffect(() => {
    const key = "design:selected-element";
    composerContextHasOurKeyRef.current =
      composerContextItemsForBookkeeping.some((item) => item.key === key);
  }, [composerContextItemsForBookkeeping]);

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
        // In-place replace, never a forced srcdoc rebuild — a rebuild is a
        // real iframe reload (white flash) of the screen the user is looking
        // at right as the "applied" toast fires. See
        // getPersistedContentHostSyncOptions' doc comment.
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

  // ── Element select, hover, and context menu ────────────────────────────────
  const handleScreenElementSelect = useCallback(
    (
      screenId: string,
      info: ElementInfo,
      intent?: ElementSelectionIntent,
      options: {
        persistPendingNodeId?: boolean;
        breakpointWidthPx?: number;
      } = {},
    ) =>
      runScreenElementSelect(
        {
          activeBreakpointWidthStateRef,
          applyFileContentUpdate,
          clearPendingOverviewLayerSelectionTimer,
          focusDesignInspectorForSelection,
          getCodeLayerProjectionForScreen,
          getScreenContent,
          handleBreakpointBarSelect,
          id,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
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
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
      getScreenContent,
      handleBreakpointBarSelect,
      id,
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
      if (viewModeRef.current === "overview") {
        setOverviewSelectedScreenIds([]);
        if (breakpointWidthPx !== undefined) {
          handleBreakpointBarSelect(breakpointWidthPx);
        } else if (activeBreakpointWidthStateRef.current !== undefined) {
          handleBreakpointBarSelect(undefined);
        }
      }
      setActiveTool("move");
      setMode("edit");
    },
    [clearPendingOverviewLayerSelectionTimer, handleBreakpointBarSelect],
  );

  const handleElementSelect = useCallback(
    (info: ElementInfo, intent?: ElementSelectionIntent) => {
      const screenId = activeFile?.id ?? activeFileId;
      if (screenId) {
        // Same echo-loop guard as handleIframeElementSelect: the focused
        // single-screen canvas routes through here too.
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

  // Iframe→host selection boundary with an echo-loop guard. The bridge echoes
  // mirrored selections back with no `intent` (user gestures always carry one);
  // on rapid clicks these race and the selection "dances". Drop an intent-less
  // echo that differs from the committed selection or comes from another screen;
  // matching echoes still pass so the inspector payload populates.
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
      if (
        !intent &&
        (isSupersededSelectionEcho(info, selectedElementRef.current) ||
          (activeFileIdRef.current !== null &&
            screenId !== activeFileIdRef.current))
      ) {
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
        ? canonicalizeElementInfoFromProjection(projection, info)
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
      // PERF9-WHEEL: while a MultiScreenCanvas wheel/pinch camera gesture is
      // in flight, hover updates are dropped entirely. The gesture start
      // mutes the canvas content layers, which fires a hover-clear (and any
      // later boundary crossing while the world moves under the cursor fires
      // more) — each one a hoveredElement setState and therefore a full-tree
      // render exactly while the pan needs the main thread. Hover state
      // stays stale for the gesture (same contract as a space-drag pan) and
      // recomputes from the next real pointer event after settle.
      if (isWheelCameraGestureActive()) return;
      const projection = getCodeLayerProjectionForScreen(screenId);
      const nextHovered = info
        ? projection
          ? canonicalizeElementInfoFromProjection(projection, info)
          : info
        : null;
      // PF9: equality-bail. Hover fires on every pointermove over an iframe;
      // only the identity of the hovered element matters for anything this
      // file reads downstream (the hover ring's selector), not its transient
      // boundingRect, so re-hovering the same element shouldn't trigger a
      // state update / re-render.
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

  // Space-pan release forwarded from the preview iframe (bridge's
  // "design-hotkey-up" message — see editor-chrome.bridge.ts). The bridge's
  // keydown forwarding above reaches the space-pan effect's window keydown
  // listener as a synthetic event via handleIframeHotkey, but that helper only
  // ever synthesizes "keydown"; releasing Space needs the matching "keyup" so
  // the temporary hand tool armed by holding Space over the iframe actually
  // lets go when the key is released there. Only listens for the one message
  // type this bridges (Space release); anything else forwarded through the
  // ordinary design-hotkey/onIframeHotkey path is unaffected.
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
        // The Select layer submenu is selection-only. In particular, choosing
        // a local React runtime host must never stamp wrapper source or make
        // any structural/source mutation merely because it was behind another
        // layer at the pointer location.
        persistPendingNodeId: false,
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
    (screenId: string, info: ElementInfo) => {
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
    openRepromptComposer(screenId, selectedElement);
  }, [activeFile?.id, activeFileId, openRepromptComposer, selectedElement]);

  const handleContextMenuRepromptLayer = useCallback(
    (candidate: CanvasLayerHitCandidate) => {
      const screenId = candidate.screenId ?? activeFile?.id ?? activeFileId;
      if (!screenId) return;
      openRepromptComposer(screenId, candidate.info);
    },
    [activeFile?.id, activeFileId, openRepromptComposer],
  );

  // ── Style commit ───────────────────────────────────────────────────────────
  const commitVisualStyles = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      options: {
        runtimeApplied?: boolean;
        elementInfo?: ElementInfo;
        /** Pre-gesture values, for the pending-edit revert stack. */
        originalStyles?: Record<string, string>;
      } = {},
    ) =>
      runCommitVisualStyles(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeCanvasSourceType,
          activeCodeLayerProjection,
          activeContent,
          activeFile,
          activeProjectionContent,
          canEditDesign,
          commitVisualStyles,
          isSynced,
          lastDuplicateTransformRef,
          lastLocalContentRef,
          latestActiveContentRef,
          liveScreenSnapshotsById,
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
        options,
      ),
    [
      activeContent,
      activeFile,
      activeBreakpointWidthState,
      activeBreakpointUpperBoundPx,
      activeCanvasSourceType,
      activeCodeLayerProjection,
      activeProjectionContent,
      canEditDesign,
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
    ],
  );

  const commitStylesToSelectedLayers = useCallback(
    (styles: Record<string, string>) =>
      runCommitStylesToSelectedLayers(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          effectiveCodeLayerStateRef,
          getScreenContent,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          setSelectedElement,
        },
        styles,
      ),
    [
      activeBreakpointUpperBoundPx,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
    ],
  );

  // Mixed-value arrow-step parity (item 7): when a multi-selection's property
  // shows "Mixed" (each node holds a different value) and the user arrow-steps
  // it, Figma nudges every node by the SAME relative delta from ITS OWN
  // current value — not by stamping one shared absolute value onto all of
  // them (which is what commitStylesToSelectedLayers above does, and is
  // correct for the ordinary same-value case). This variant reads each
  // target's own current value from its elementInfo.computedStyles
  // (populated by selectedLayerTargets — see the SelectedLayerTarget memo),
  // applies the unit-aware delta (applyRelativeDeltaToStyleValue), and writes
  // that per-node absolute value instead of a shared one.
  //
  // Mirrors commitStylesToSelectedLayers's file-grouping/projection-patch
  // structure exactly; the only difference is resolving `value` per-target
  // instead of once for the whole call.
  const commitRelativeStyleDeltaToSelectedLayers = useCallback(
    (property: string, delta: number) =>
      runCommitRelativeStyleDeltaToSelectedLayers(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeContent,
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          effectiveCodeLayerStateRef,
          getScreenContent,
          lastLocalContentRef,
          latestActiveContentRef,
          responsiveEditScopeRef,
          selectedLayerTargetsRef,
          setSelectedElement,
        },
        property,
        delta,
      ),
    [
      activeBreakpointUpperBoundPx,
      activeContent,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
    ],
  );

  const getFreshActiveContent = useCallback(
    () =>
      getFreshActiveFileContent({
        activeContent,
        latestContent: latestActiveContentRef.current,
        lastLocalContent: lastLocalContentRef.current,
      }),
    [activeContent],
  );

  // Item 14 — `meta.breakpointReset` contract (see StyleChangeMeta's doc
  // comment): clear property's override AT maxWidthPx instead of writing a
  // new value. Resolves which persistence layer holds the override (a
  // max-width-scoped Tailwind class vs a managed `@media` declaration — see
  // getBreakpointOverrideState) and clears just that one, one history step.
  // Returns true when it handled the commit (caller must return without
  // falling through to the normal write path); false when there was nothing
  // to clear (e.g. a stale reset click after the override already changed).
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
          : applyVisualEdit(baseContent, {
              kind: "responsive-class",
              target: { nodeId },
              prefix: "base",
              maxWidthPx,
              operation: "remove",
              stem: utilityStem(override.value),
            }).content;
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
      designBreakpoints,
      getFreshActiveContent,
      selectedElement,
    ],
  );

  // Interaction-states phase 2 — see StyleChangeMeta's `interactionState` doc
  // comment on EditPanel.tsx for the full contract. Routes a style commit
  // made while a non-default interaction state is active (EditPanel's
  // InteractionStatePanel) through the managed
  // `<style data-agent-native-states>` block instead of the element's normal
  // inline style / class: `upsertStateStyles` writes the real
  // `[data-agent-native-node-id="X"]:hover { … }` rule, then
  // `duplicateStatePreviewRules` regenerates the twin
  // `[data-an-state-preview="hover"]` rule the forced-preview mechanism reads
  // (see shared/interaction-states.ts's module doc). Both steps are folded
  // into the content string passed to ONE `applyFileContentUpdate` call so
  // the whole commit is a single history/undo step, exactly like any other
  // single style commit. Only meaningful for a single-element, source-backed
  // selection (a stable `sourceId`) — returns false (caller falls through to
  // the normal path) otherwise, same gating EditPanel itself already applies
  // before attaching `meta.interactionState` in the first place.
  const previewInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>) => {
      if (!selectedElement) return;
      const sendPreview = (window as any)
        .__designCanvasSendInteractionStatePreviewStyle;
      if (typeof sendPreview !== "function") return;
      sendPreview({
        selector: selectedCanvasSelector ?? selectedElement.selector ?? "",
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement.sourceId ?? "",
        state,
        styles,
      });
    },
    [selectedCanvasSelector, selectedCanvasSelectorCandidates, selectedElement],
  );

  const commitInteractionStateStyles = useCallback(
    (state: InteractionState, styles: Record<string, string>): boolean => {
      if (!canEditDesign || !activeFile?.id || !selectedElement?.sourceId) {
        return false;
      }
      const entries = Object.entries(styles).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) return false;
      const nodeId = selectedElement.sourceId;
      if (isRunningAppSourceType(activeCanvasSourceType)) {
        recordPendingVisualStyleEdit(
          activeFile.id,
          selectedCanvasSelector ?? selectedElement.selector ?? "",
          Object.fromEntries(entries),
          selectedElement,
          { interactionState: state },
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
      // Any pointer-drag/color-picker preview ticks used a temporary CSSOM
      // override in the live iframe. The persisted managed rule now owns the
      // value, so remove only the properties committed by this gesture.
      previewInteractionStateStyles(
        state,
        Object.fromEntries(entries.map(([property]) => [property, ""])),
      );
      return true;
    },
    [
      activeCanvasSourceType,
      activeBreakpointUpperBoundPx,
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getFreshActiveContent,
      previewInteractionStateStyles,
      recordPendingVisualStyleEdit,
      selectedCanvasSelector,
      selectedElement?.sourceId,
      selectedElement?.selector,
    ],
  );

  const handleStyleChange = useCallback(
    (property: string, value: string, meta?: StyleChangeMeta) =>
      runStyleChange(
        {
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers,
          commitStylesToSelectedLayers,
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedLayerTargetsRef,
          textEditingState,
        },
        property,
        value,
        meta,
      ),
    [
      commitInteractionStateStyles,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedElement?.selector,
      selectedElement?.sourceId,
      selectedCanvasSelectorCandidates,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  // H2: Figma's plain digit 1-9/0 opacity shortcut. useDesignHotkeys computes
  // the 10-90/100 percentage; this converts to the 0-1 CSS opacity string and
  // routes through the same handleStyleChange path the opacity slider uses
  // (EditPanel.tsx onChange={(v) => onStyleChange("opacity", String(v / 100))}),
  // so it gets the same text-range / multi-layer routing for free. Only wired
  // when a layer is selected (see the useDesignHotkeys onOpacityChange prop
  // below), matching Figma's "only affects the current selection" behavior.
  const handleOpacityHotkey = useCallback(
    (opacity: number) => {
      if (!canEditDesign || !selectedElement) return;
      handleStyleChange("opacity", String(opacity / 100));
    },
    [canEditDesign, selectedElement, handleStyleChange],
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

  // Typography hotkeys — Figma's Cmd+U (toggle underline) and Cmd+Shift+X
  // (toggle strikethrough). Mirror handleOpacityHotkey's guard/commit shape
  // and toggleTextDecorationLine's read/write split in
  // edit-panel/typography-properties.tsx: reads the clean computed longhand
  // `textDecorationLine`, commits through the shorthand "textDecoration"
  // property name (see nextTextDecorationLineValue's doc comment).
  const handleToggleUnderlineHotkey = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
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
    canEditDesign,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleToggleStrikethroughHotkey = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
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
    canEditDesign,
    selectedElement,
    handleStyleChange,
    readOptimisticTextDecorationLine,
  ]);

  const handleStylesChange = useCallback(
    (styles: Record<string, string>, meta?: StyleChangeMeta) =>
      runStylesChange(
        {
          commitInteractionStateStyles,
          commitRelativeStyleDeltaToSelectedLayers,
          commitStylesToSelectedLayers,
          commitVisualStyles,
          handleClearBreakpointOverride,
          previewInteractionStateStyles,
          selectedCanvasSelectorCandidates,
          selectedElement,
          selectedLayerTargetsRef,
          textEditingState,
        },
        styles,
        meta,
      ),
    [
      commitInteractionStateStyles,
      previewInteractionStateStyles,
      commitRelativeStyleDeltaToSelectedLayers,
      commitStylesToSelectedLayers,
      commitVisualStyles,
      handleClearBreakpointOverride,
      selectedElement,
      selectedCanvasSelectorCandidates,
      selectedElement?.selector,
      selectedElement?.sourceId,
      textEditingState.active,
      textEditingState.hasRange,
      textEditingState.selector,
    ],
  );

  // Item 13 — EditPanel's breakpointContext prop (Framer-style responsive
  // override indicators). `undefined` when there's no configured breakpoint
  // set or no resolvable base width — EditPanel treats that as "feature off"
  // and renders exactly as before. Memoized on activeContent's identity (a
  // stable per-render string, not a fresh ref read) since EditPanel forwards
  // this straight into per-field override lookups on every render.
  const breakpointContext = useMemo(() => {
    if (designBreakpoints.length === 0 || activeScreenBaseWidthPx == null) {
      return undefined;
    }
    return {
      breakpointWidths: designBreakpoints.map((bp) => bp.widthPx),
      baseWidthPx: activeScreenBaseWidthPx,
      activeWidthPx: activeBreakpointWidthState ?? null,
      html: activeContent,
    };
  }, [
    activeBreakpointWidthState,
    activeContent,
    activeScreenBaseWidthPx,
    designBreakpoints,
  ]);

  const handleVisualStyleChange = useCallback(
    (
      selector: string,
      styles: Record<string, string>,
      elementInfo?: ElementInfo,
      metadata?: { originalStyles?: Record<string, string> },
    ) => {
      if (!activeFile?.id) return;
      // The gesture already moved the live DOM, so this never needs the
      // runtime push. Which screens queue a pending edit instead of writing
      // source is commitVisualStyles' single decision — inline/fusion screens
      // are SQL-backed and persist immediately (breakpoint-aware, one history
      // step); localhost screens queue for the Apply pass.
      commitVisualStyles(selector, styles, {
        runtimeApplied: true,
        elementInfo,
        originalStyles: metadata?.originalStyles,
      });
    },
    [activeFile?.id, commitVisualStyles],
  );

  // ── Visual structure and text-content handlers ─────────────────────────────
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
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        /** Markup this change introduced; the subject does not exist in the
         * screen's source yet, so it must be added rather than relocated. */
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
      },
    ) =>
      runVisualStructureChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLocalContentUpdate,
          canEditDesign,
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
      applyLocalContentUpdate,
      canEditDesign,
      getFreshActiveContent,
      recordPendingLiveStructureEdit,
      t,
    ],
  );

  const handleVisualDuplicateChange = useCallback(
    (
      selector: string,
      cloneHtml: string,
      elementInfo?: ElementInfo,
      details?: {
        sourceId?: string;
        anchorSelector?: string;
        anchorSourceId?: string;
        placement?: "before" | "after" | "inside";
      },
    ) =>
      runVisualDuplicateChange(
        {
          activeFile,
          applyLocalContentUpdate,
          canEditDesign,
          getFreshActiveContent,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        selector,
        cloneHtml,
        elementInfo,
        details,
      ),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      getFreshActiveContent,
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
      },
    ) =>
      runTextContentChange(
        {
          activeCanvasSourceType,
          activeFile,
          applyLocalContentUpdate,
          canEditDesign,
          finalizePendingTextCreation,
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
      applyLocalContentUpdate,
      canEditDesign,
      finalizePendingTextCreation,
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
      metadata?: { originalStyles?: Record<string, string> },
    ) =>
      runScreenVisualStyleChange(
        {
          activeBreakpointUpperBoundPx,
          activeBreakpointWidthStateRef,
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
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
      designSourceType,
      getScreenContent,
      handleVisualStyleChange,
      overviewScreens,
      recordPendingVisualStyleEdit,
    ],
  );

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
        dropMode?: "flow-insert" | "absolute-container";
        forceFlowPositionOverride?: boolean;
        sourceRect?: { x: number; y: number; width: number; height: number };
        anchorRect?: { x: number; y: number; width: number; height: number };
        /** Markup this change introduced; the subject does not exist in the
         * screen's source yet, so it must be added rather than relocated. */
        insertedHtml?: string;
        replaced?: true;
        replacementSelector?: string;
        replacementSourceId?: string;
      },
    ) =>
      runScreenVisualStructureChange(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
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
      designSourceType,
      getScreenContent,
      handleVisualStructureChange,
      overviewScreens,
      recordPendingLiveStructureEdit,
      t,
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
        anchorSelector?: string;
        anchorSourceId?: string;
        placement?: "before" | "after" | "inside";
      },
    ) =>
      runScreenVisualDuplicateChange(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          getScreenContent,
          handleVisualDuplicateChange,
          t,
        },
        screenId,
        selector,
        cloneHtml,
        elementInfo,
        details,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      getScreenContent,
      handleVisualDuplicateChange,
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
      },
    ) =>
      runScreenTextContentChange(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          designSourceType,
          finalizePendingTextCreation,
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
      canEditDesign,
      designSourceType,
      finalizePendingTextCreation,
      getScreenContent,
      handleTextContentChange,
      liveScreenSnapshotsById,
      overviewScreens,
      recordPendingLiveTextEdit,
      t,
      updateLiveScreenSnapshotContent,
    ],
  );

  // ── Clipboard copy and paste ───────────────────────────────────────────────
  const getSelectedLayerSnapshots = useCallback(
    () =>
      runGetSelectedLayerSnapshots({
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
      }),
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

  // Whole-screen clipboard entries (U6). Only meaningful when there are no
  // layer-level entries — a layer copy always takes precedence on paste.
  const getCanvasScreenClipboardEntries = useCallback(() => {
    return copiedScreenEntriesRef.current ?? [];
  }, []);

  // U14: paste/duplicate re-stamp data-agent-native-node-id on the clone but
  // previously never remapped motion tracks, so a duplicated/pasted animated
  // layer silently lost its animation (the compiled CSS still targeted the
  // OLD node id). Clones any track whose targetNodeId is in nodeIdMap onto
  // the new id. Only meaningful when targetFileId's timeline is the one
  // currently loaded into motionTracks state (tracks aren't kept per-file).
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

  // Adopts a marker payload found in the live rich clipboard into this tab's
  // in-memory clipboard refs (see U4).
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

  // Reads the rich system clipboard when available. The internal marker lives
  // in text/html so text/plain remains useful when pasting into Slack, docs,
  // code editors, and other non-Design destinations.
  const refreshClipboardFromSystemClipboard = useCallback(async () => {
    const result = await readDesignClipboardPayloadFromSystem();
    if (
      !result ||
      result.markerText === lastWrittenClipboardMarkerRef.current
    ) {
      return;
    }
    adoptDesignClipboardPayload(
      result.payload,
      result.markerText,
      result.plainText,
    );
  }, [adoptDesignClipboardPayload]);

  const selectInsertedLayers = useCallback(
    (screenId: string, content: string, rootNodeIds: string[]) => {
      const projection = buildCodeLayerProjection(content);
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
    [boardFileId, clearPendingOverviewLayerSelectionTimer],
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

  // Pastes copied whole-screen snapshots (U6) as new screen files, offset
  // from their original canvas position so they don't stack exactly on top
  // of the source screen. Mirrors handleDuplicateScreen's create-file +
  // queueFrameGeometrySave pattern.
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
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      getCanvasClipboardEntries,
      getCanvasScreenClipboardEntries,
      getFreshActiveContent,
      getScreenContent,
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

  const importFigmaClipboardIntoDesign = useCallback(
    async (content: string) =>
      runImportFigmaClipboardIntoDesign(
        {
          canEditDesign,
          figmaPasteImportingRef,
          id,
          navigate,
          queryClient,
          setFigmaHydrationFileIds,
          setFigmaHydrationImageCount,
          setFigmaHydrationOpen,
          t,
        },
        content,
      ),
    [canEditDesign, id, navigate, queryClient, t],
  );

  const handleCanvasFigmaClipboardPaste = useCallback(
    ({ content }: { content: string }) => {
      void importFigmaClipboardIntoDesign(content);
    },
    [importFigmaClipboardIntoDesign],
  );

  // Reads a File as a data URL, wrapped as a Promise so multi-file paste can
  // await each read in turn instead of racing several FileReader.onload
  // callbacks against the same base-content snapshot (see U8's original
  // single-file version for the non-Promise baseline this replaced).
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

  // U8: OS image paste (screenshot copied to clipboard, image copied from the
  // Finder/Files app, etc.) previously did nothing — clipboardData.items only
  // carries a text/html/plain payload for our own layer/screen copies, so
  // getFigmaClipboardContent and the marker parse both miss and the paste
  // event fell through with no handler. Uploads each pasted image through the
  // framework image upload action and inserts the hosted URL as a new <img>
  // layer, avoiding base64 data URLs in persisted design HTML.
  //
  // Multi-file paste: pasting several image files (e.g. multi-select in the
  // Finder, copy-all from a folder) previously only inserted the FIRST one —
  // handleEditorPaste's `.find()` dropped the rest silently. Every file here
  // is inserted in turn, cascading with the same pasteCascadeRef stagger a
  // repeated single-image paste already uses, so a multi-file paste reads as
  // N distinct, slightly-offset layers instead of one.
  //
  // Overview screen targeting: previously an overview paste always landed on
  // the shared board file regardless of what was selected/where the paste
  // anchor was. Now the anchor point (the single selected screen's center, or
  // best-effort viewport-center when nothing/multiple things are selected —
  // same fallback the old center computation used) is hit-tested against real
  // screen frame geometries (findScreenFrameAtCanvasPoint); a hit inserts INTO
  // that screen at screen-LOCAL coordinates (canvas point minus the frame's
  // own x/y origin, mirroring the coordinate transform
  // appendCanvasPrimitiveToHtml/cloneHtmlLayerAtPosition callers rely on —
  // every screen file's own HTML is authored in screen-content-local space,
  // not shared canvas space). No hit falls back to the board file exactly as
  // before.
  const handlePastedImageFiles = useCallback(
    (files: File[]) =>
      runPastedImageFiles(
        {
          activeFile,
          applyFileContentUpdate,
          applyLocalContentUpdate,
          boardFileId,
          canEditDesign,
          canvasContainerRef,
          canvasFrameGeometryById,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          selectInsertedLayers,
          t,
          uploadImageFileForHtml,
          viewModeRef,
          zoom,
        },
        files,
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      boardFileId,
      canEditDesign,
      canvasFrameGeometryById,
      getFreshActiveContent,
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      selectInsertedLayers,
      t,
      uploadImageFileForHtml,
      zoom,
    ],
  );

  const handleCanvasImagePaste = useCallback(
    ({ files }: IframeImagePastePayload) => {
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
      handlePastedImageFiles(fileObjects);
    },
    [canEditDesign, handlePastedImageFiles],
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
          canvasFrameGeometryById,
          getFreshActiveContent,
          getScreenContent,
          overviewScreens,
          overviewSelectedScreenIds,
          pasteCascadeRef,
          selectInsertedLayers,
          t,
          uploadImageFileForHtml,
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
      getScreenContent,
      overviewScreens,
      overviewSelectedScreenIds,
      selectInsertedLayers,
      t,
      uploadImageFileForHtml,
      viewModeRef,
      zoom,
    ],
  );

  // MultiScreenCanvas (overview mode): canvasPoint is shared-board/canvas
  // space; frameId (when present) is the screen under the drop point, so the
  // point is converted to that screen's local coordinates the same way the
  // overview paste path already does (canvasPoint minus the frame's own
  // origin). No frameId means the board itself is the target.
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

  // DesignCanvas (single-screen mode): screenContentPoint is already in the
  // active screen's own local content space, so it inserts directly at that
  // point — no frame-origin conversion needed.
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
          handlePastedImageFiles,
          hasCanvasClipboard,
          importFigmaClipboardIntoDesign,
          lastWrittenClipboardMarkerRef,
          lastWrittenClipboardPlainTextRef,
        },
        event,
      ),
    [
      adoptDesignClipboardPayload,
      canEditDesign,
      handlePasteSelection,
      handlePastedImageFiles,
      hasCanvasClipboard,
      importFigmaClipboardIntoDesign,
    ],
  );

  useEffect(() => {
    if (embedded || (pendingQuestions && pendingQuestions.length > 0)) return;
    document.addEventListener("paste", handleEditorPaste, true);
    return () => {
      document.removeEventListener("paste", handleEditorPaste, true);
    };
  }, [embedded, handleEditorPaste, pendingQuestions]);

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
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      getCanvasClipboardEntries,
      getFreshActiveContent,
      handlePasteSelection,
      selectInsertedLayers,
      selectedElement,
    ],
  );

  // Figma's Shift+Cmd+R — "Paste to replace": the current selection's node
  // is swapped out for the clipboard's node in place, as a single history
  // step. Distinct from handlePasteOverSelection (Cmd+Shift+V), which pastes
  // ALONGSIDE the selection as new offset layers and never removes anything.
  // Scoped to the common single-target/single-source case (exactly one
  // selected node, exactly one internal-clipboard entry) — a multi-selection
  // or multi-node clipboard replace has no unambiguous 1:1 pairing, so this
  // no-ops rather than guessing.
  const handlePasteToReplace = useCallback(
    () =>
      runPasteToReplace({
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
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
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
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        files,
        getFreshActiveContent,
        getScreenContent,
        getSelectedLayerSnapshots,
        handleDuplicateScreen,
        lastDuplicateTransformRef,
        overviewSelectedScreenIds,
        remapMotionTracksForClone,
        selectedCanvasSelector,
        selectedElement,
        selectedLayerIdsState,
        setOverviewSelectedScreenIds,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
        undoManagerRef,
        viewModeRef,
      }),
    [
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      getScreenContent,
      getSelectedLayerSnapshots,
      handleDuplicateScreen,
      overviewSelectedScreenIds,
      remapMotionTracksForClone,
      selectedCanvasSelector,
      selectedElement,
      t,
    ],
  );

  // ── Delete, group, frame, and semantic handoff ─────────────────────────────
  const handleDeleteSelection = useCallback(
    () =>
      runDeleteSelection({
        activeBreakpointUpperBoundPx,
        activeBreakpointWidthStateRef,
        activeCanvasSourceType,
        activeFile,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
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
      activeBreakpointUpperBoundPx,
      activeCanvasSourceType,
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canEditDesign,
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

  // Wrap the current multi-layer selection into a new group container.
  const handleGroupSelection = useCallback(
    () =>
      runGroupSelection({
        activeFile,
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
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  // Figma's Cmd+Alt+G — "Frame selection": wrap the selection in a frame
  // container, distinct from plain Group (Cmd+G). Reuses the same wrapNodes
  // substrate handleGroupSelection uses (so multi-parent/stale-id validation
  // stays identical), but: (1) allows a SINGLE selected layer (Figma frames
  // one element too, unlike group which needs 2+), and (2) re-tags the
  // resulting wrapper as a frame afterwards — data-an-primitive="frame",
  // layer name "Frame", no default styling beyond what wrapNodes itself
  // already applies (geometry rebasing for absolutely-positioned children) —
  // via the same setCodeLayerAttributeInHtml used for lock/hide attrs, rather
  // than teaching the shared code-layer.ts wrapNodes intent a variant flag.
  const handleFrameSelection = useCallback(
    () =>
      runFrameSelection({
        activeFile,
        applyLocalContentUpdate,
        canEditDesign,
        files,
        getFreshActiveContent,
        selectedLayerIdsState,
        setSelectedElement,
        setSelectedLayerIdsState,
        t,
      }),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      selectedLayerIdsState,
      t,
    ],
  );

  // ── Layout geometry: align, distribute, tidy, auto-layout ──────────────────
  // Selection alignment (item 3) + distribute/tidy (item 4) + Shift+A add
  // auto layout (item 5) share the same in-screen-layer building block: read
  // each selected DOM node's authored geometry straight from its inline
  // style (this codebase's code-layer substrate is static-HTML analysis, not
  // a live rendered DOM). When a node's inline style omits left/top/width/
  // height (e.g. a flex child, or anything positioned by class/transform
  // rather than inline style), the authored-style read alone resolves to a
  // degenerate 0,0,0,0 box — every rect looks "already aligned" and the
  // whole operation silently no-ops. rectLiveFallbackForNode below recovers
  // real geometry from the rendered single-screen preview iframe (same-origin
  // for inline designs) for exactly that case.
  const rectLiveFallbackForNode = useCallback(
    (
      nodeId: string,
    ): { x: number; y: number; width: number; height: number } | null => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      const el = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`,
      );
      if (!el) return null;
      const elRect = el.getBoundingClientRect();
      // Use the immediate parent element (the containing block for the align
      // math's purposes — matches how a subsequent left/top commit is read
      // back by the same parent-relative authored-style convention) rather
      // than offsetParent, since offsetParent skips non-positioned ancestors
      // and would disagree with how children of a plain (static) parent are
      // authored here.
      const parentRect = el.parentElement?.getBoundingClientRect();
      return {
        x: elRect.x - (parentRect?.x ?? 0),
        y: elRect.y - (parentRect?.y ?? 0),
        width: elRect.width,
        height: elRect.height,
      };
    },
    [],
  );

  const liveComputedLayoutForNode = useCallback((nodeId: string) => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    const element = doc.querySelector<HTMLElement>(
      `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`,
    );
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
  }, []);

  const rectFromCodeLayerNode = useCallback(
    (node: CodeLayerNode): AlignableRect => {
      const authoredX = Number.parseFloat(node.style.left ?? "");
      const authoredY = Number.parseFloat(node.style.top ?? "");
      const authoredWidth = Number.parseFloat(node.style.width ?? "");
      const authoredHeight = Number.parseFloat(node.style.height ?? "");
      const live =
        Number.isFinite(authoredX) &&
        Number.isFinite(authoredY) &&
        Number.isFinite(authoredWidth) &&
        Number.isFinite(authoredHeight)
          ? null
          : rectLiveFallbackForNode(node.id);
      return mergeAuthoredAndLiveRect({
        id: node.id,
        authored: {
          x: authoredX,
          y: authoredY,
          width: authoredWidth,
          height: authoredHeight,
        },
        live,
      });
    },
    [rectLiveFallbackForNode],
  );

  // Resolves the in-screen DOM-node ids currently selected in the ACTIVE
  // file, filtered the same way handleGroupSelection/handleFrameSelection
  // already do (excludes screen/file rows and stale cross-file ids).
  const getActiveFileSelectedNodeIds = useCallback(
    (content: string): string[] => {
      const fileIds = new Set(files.map((file) => file.id));
      const activeNodeIdSet = buildActiveFileNodeIdSet(
        buildCodeLayerProjection(content),
      );
      return selectedLayerIdsState.filter(
        (layerId) =>
          !layerId.startsWith("__") &&
          !fileIds.has(layerId) &&
          activeNodeIdSet.has(layerId),
      );
    },
    [files, selectedLayerIdsState],
  );

  // Applies a Map of nodeId -> {x, y} as one batched left/top style commit:
  // repeated applyVisualEdit calls threaded through a single accumulating
  // `content` string, persisted with exactly one applyLocalContentUpdate call
  // so the whole batch is one undo step (mirrors handleGroupSelection's
  // chaining pattern for wrapNodes above).
  const commitNodePositions = useCallback(
    (
      baseContent: string,
      positions: ReadonlyMap<string, { x: number; y: number }>,
    ): boolean => {
      if (positions.size === 0) return false;
      let content = baseContent;
      let appliedAny = false;
      for (const [nodeId, position] of positions) {
        // Nodes recovered via rectFromCodeLayerNode's live-DOM fallback (no
        // authored left/top/width/height) are typically still position:static
        // — writing left/top alone would have no visual effect. Ensure the
        // node is positioned first, same as the bridge's ensurePositionable
        // does for drag-commits, so the align actually moves it.
        const projection = buildCodeLayerProjection(content);
        const node = projection.nodes.find((n) => n.id === nodeId);
        if (node && !isAbsoluteCodeLayerNode(node)) {
          const positionPatch = applyVisualEdit(content, {
            kind: "style",
            target: { nodeId },
            property: "position",
            value: "absolute",
          });
          if (positionPatch.result.status === "applied") {
            content = positionPatch.content;
          }
        }
        const leftPatch = applyVisualEdit(content, {
          kind: "style",
          target: { nodeId },
          property: "left",
          value: `${position.x}px`,
        });
        if (leftPatch.result.status !== "applied") continue;
        content = leftPatch.content;
        const topPatch = applyVisualEdit(content, {
          kind: "style",
          target: { nodeId },
          property: "top",
          value: `${position.y}px`,
        });
        if (topPatch.result.status !== "applied") continue;
        content = topPatch.content;
        appliedAny = true;
      }
      if (!appliedAny) return false;
      applyLocalContentUpdate(content, { forcePreviewFullDocument: true });
      return true;
    },
    [applyLocalContentUpdate],
  );

  // Figma parity: turning auto layout off must leave a freeform container.
  // display:block alone re-stacks the children and they stop being draggable.
  const handleDisableAutoLayout = useCallback(
    (nodeId: string) => {
      if (!canEditDesign) return;
      const baseContent = getFreshActiveContent();
      if (!baseContent) {
        trace("structure", "freeform-abandoned", {
          reason: "no active content",
          nodeId,
        });
        return;
      }
      const geometry = measureFreeformGeometry(nodeId);
      const patch = applyVisualEdit(baseContent, {
        kind: "autoLayout",
        targetId: nodeId,
        enabled: false,
        childRects: geometry.children,
        ...(geometry.container ? { containerRect: geometry.container } : {}),
      });
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
    [applyLocalContentUpdate, canEditDesign, getFreshActiveContent],
  );

  // Item 3: Figma's Alignment row — moves the selection itself. Wired to
  // EditPanel's onAlignSelection prop (its 6 alignment buttons) and to
  // useDesignHotkeys' Alt+A/D/W/S/H/V bindings.
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
      overviewScreens,
      overviewSelectedScreenIds,
      selectedLayerIdsState,
      rectFromCodeLayerNode,
    ],
  );

  // Item 4: Figma's Ctrl+Alt+H/V — distribute the selection evenly along an
  // axis. Overview screens are first-class; in-screen layers reuse the same
  // batched-commit machinery as alignment above.
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

  /**
   * On-canvas footprint of a screen including the breakpoint frames drawn to
   * its right, so packing/tidy reserves the space they actually occupy.
   * Breakpoint frames render inside the screen's own container and never appear
   * in `canvasFrames`, so packing against the base geometry alone dropped every
   * new breakpoint on top of the next screen.
   *
   * Widths are exact (`widthPx * primaryScale`); the height falls back to the
   * renderer's own pre-measurement aspect projection, since measured breakpoint
   * iframe heights live inside MultiScreenCanvas.
   */
  const getScreenGroupFootprint = useCallback(
    (
      screenId: string,
      geometry: CanvasFrameGeometry,
      /** Widths to assume instead of the screen's current ones — used right
       *  after an add-breakpoint mutation, before the query round-trips. */
      breakpointWidthsOverride?: readonly number[],
    ): { x: number; y: number; width: number; height: number } => {
      const x = geometry.x ?? 0;
      const y = geometry.y ?? 0;
      const width = geometry.width ?? 0;
      const height = geometry.height ?? 0;
      const screen = overviewScreens.find((item) => item.id === screenId);
      if (!screen) return { x, y, width, height };
      // Culling's own geometry, so packing cannot disagree with it. The AABB
      // matters: a rotated group reaches past its unrotated box, and the
      // collision test below is axis-aligned.
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
      );
    },
    [overviewScreens],
  );

  /**
   * Re-packs the whole board when breakpoint frames have grown a screen's
   * footprint into its neighbour. Adding a breakpoint widens every screen at
   * once, and nothing previously moved, so the new frames rendered straight over
   * the next screen. Runs only on an actual collision (so a deliberately
   * arranged, non-overlapping board is left alone), and commits through
   * handleGeometryCommit, which makes it one undo step.
   */
  const reflowOverviewScreensForBreakpoints = useCallback(
    (breakpointWidths: readonly number[]) => {
      if (!canEditDesignRef.current) return;
      const before = getCanvasFrameGeometry(designDataJsonRef.current);
      const candidates: ReflowCandidate[] = overviewScreens.map(
        (screen, index) => {
          // Screens laid out by getInitialFrameGeometry have no canvasFrames
          // entry yet; carry the resolved geometry so the write-back below can
          // create one instead of dropping their computed move.
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

  // Item 4: Figma's Ctrl+Alt+T — Tidy up: arrange the selection into a
  // compact grid with uniform gaps (see computeTidyPositions' doc comment for
  // the exact packing heuristic chosen).
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
    const projection = buildCodeLayerProjection(sourceContent);
    const selectedIds = getActiveFileSelectedNodeIds(sourceContent);
    if (selectedIds.length !== 1) return false;
    const container = projection.nodes.find(
      (node) => node.id === selectedIds[0],
    );
    const computedLayout = container
      ? liveComputedLayoutForNode(container.id)
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
    );
    if (result.status !== "applied") {
      toast.error(t("designEditor.autoLayoutSuggestion.stale"));
      setAutoLayoutSuggestionPreview(null);
      return;
    }
    // One persistence call = one content-history entry, even though the pure
    // proposal compiler performed ordering + layout + sizing internally.
    applyLocalContentUpdate(result.content, {
      forcePreviewFullDocument: true,
    });
    setAutoLayoutSuggestionPreview(null);
  }, [
    applyLocalContentUpdate,
    autoLayoutSuggestionPreview,
    getFreshActiveContent,
    runtimeLayerSnapshotsById,
    sendRuntimeLayerSemanticHandoff,
    t,
  ]);

  // Item 5: Figma's Shift+A — Add auto layout.
  //  (a) single selected in-screen ELEMENT that is a container: convert it
  //      to display:flex with inferred direction/gap/padding, committed as
  //      one style patch (AutoLayoutMatrix then lights up automatically).
  //  (b) multi-selection of in-screen sibling layers: wrap them in a new flex
  //      container via the same wrapNodes substrate handleGroupSelection/
  //      handleFrameSelection use, passing autoLayout: true so the wrapper is
  //      created with display:flex/gap in the same call.
  //  (c) exactly one selected overview SCREEN: convert the authored body (or
  //      one fragment root) for inline HTML/Alpine. Local React screens route
  //      compiler-provenanced roots through the semantic coding-agent handoff;
  //      multiple screens remain unsupported because screens cannot safely be
  //      nested without a first-class screen-container model.
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

  // ── UI toggles, ungroup, reparent, cut, screen deletion ────────────────────
  // Figma's Minimize UI action. Fully wired: uiHidden gates the
  // left rail, right inspector panel, and bottom toolbar chrome containers
  // declared above.
  const handleToggleUi = useCallback(() => {
    setUiHidden((current) => !current);
  }, []);

  useEffect(() => {
    window.addEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
    return () =>
      window.removeEventListener(DESIGN_UI_TOGGLE_EVENT, handleToggleUi);
  }, [handleToggleUi]);

  // Figma's Shift+C — Show/Hide comments. The state is passed through every
  // mounted DesignCanvas so both focused and overview comment pins disappear
  // without unmounting/recreating their preview iframe.
  const [commentsHidden, setCommentsHidden] = useState(false);
  const handleToggleComments = useCallback(() => {
    setCommentsHidden((current) => !current);
  }, []);

  // Unwrap the currently selected single-container layer.
  // L16: loop over every selected container (not just the first) so a
  // multi-select ungroup releases all of them in one action, and select the
  // union of released children afterwards (read back from the post-unwrap
  // projection) instead of clearing the selection entirely — mirrors what
  // Figma does: ungrouping leaves the former children selected so the user
  // can immediately keep working with them.
  const handleUngroupSelection = useCallback(
    () =>
      runUngroupSelection({
        activeFile,
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
      applyLocalContentUpdate,
      canEditDesign,
      files,
      getFreshActiveContent,
      selectedLayerIdsState,
      sendRuntimeLayerSemanticHandoff,
      t,
    ],
  );

  /**
   * Handle a primitive being drag-dropped onto another primitive in the
   * MultiScreenCanvas overview (CONTRACT: onPrimitiveReparent prop).
   *
   * Same-screen: applies a moveNode intent then, for an "inside" (absolute
   * container) drop, rebases the moved node's absolute coordinates relative
   * to the target rectangle. For a "before"/"after" auto-layout flow-insert,
   * skips the absolute rebase and strips positioning instead so the node
   * becomes a real flow child at the resolved sibling index — mirroring
   * handleCrossScreenElementDrop's targetDropMode branch below. Cross-screen
   * uses moveNodeBetweenDocuments and persists both files.
   */
  const handleOverviewPrimitiveReparent = useCallback(
    (arg0: {
      sourceNodeId: string;
      sourceScreenId: string;
      targetNodeId: string;
      targetScreenId: string;
      placement?: "before" | "after" | "inside";
    }) =>
      runOverviewPrimitiveReparent(
        {
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          getScreenContent,
          recordContentHistoryEntry,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
        },
        arg0,
      ),
    [
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      getScreenContent,
      recordContentHistoryEntry,
      t,
    ],
  );

  /**
   * Cross-screen element drag-drop handler (CONTRACT: onCrossScreenElementDrop
   * prop on MultiScreenCanvas).
   *
   * The bridge in the source screen's iframe posts phase:"end" with the
   * selector / sourceNodeId of the dragged element.  MultiScreenCanvas maps
   * the board point to a target screen, optionally runs a hit-test in the
   * target iframe to resolve an anchorNodeId and placement, then calls this
   * handler.  We resolve both screens' content, identify the node by its
   * data-agent-native-node-id (falling back to a projection lookup by selector
   * when only the selector is available), call moveNodeBetweenDocuments with
   * the anchor from the hit-test (or top-level "inside" fallback), persist
   * both files, switch the active screen to the target, and select the moved
   * node — keeping viewMode "overview" throughout.
   */
  const handleCrossScreenElementDrop = useCallback(
    (arg0: {
      sourceSelector: string;
      sourceNodeId?: string;
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
      sourceHtmlSnapshot?: string;
      styleSnapshot?: PortableStyleSnapshot;
    }) =>
      runCrossScreenElementDrop(
        {
          applyFileContentUpdate,
          boardFileId,
          canEditDesign,
          clearPendingOverviewLayerSelectionTimer,
          codeLayerOwnerByNodeIdRef,
          designSourceType,
          getScreenContent,
          id,
          overviewScreens,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          recordContentHistoryEntry,
          runtimeStructureInsertRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          setActiveFileId,
          setCreatedOverviewLayerSelection,
          setOverviewSelectedScreenIds,
          setRuntimeStructureInsertRequest,
          setSelectedElement,
          setSelectedLayerIdsState,
          t,
          viewModeRef,
        },
        arg0,
      ),
    [
      applyFileContentUpdate,
      boardFileId,
      canEditDesign,
      clearPendingOverviewLayerSelectionTimer,
      getScreenContent,
      id,
      recordContentHistoryEntry,
      sendRuntimeLayerMoveSemanticHandoff,
      designSourceType,
      overviewScreens,
      t,
    ],
  );

  const handleRuntimeStructureInsertRejected = useCallback(
    (reason: string) => {
      // Never swallow this: a rejected insert leaves nothing on screen and
      // nothing in the pending list, so a silent return is indistinguishable
      // from the drop never having happened.
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn("[design] runtime structure insert rejected", { reason });
      }
      toast.error(t("designEditor.toasts.layerMoveFailed"), { duration: 4000 });
    },
    [t],
  );

  const handleCutSelection = useCallback(async () => {
    // Copy first (populates the internal clipboard ref even if the async
    // navigator.clipboard write is blocked — handleCopySelection swallows that
    // error and still returns true) then remove the element so a subsequent
    // paste can re-insert it. U15: if copy captured NOTHING at all (returns
    // false), abort the delete — otherwise the element would be gone with no
    // way to paste it back.
    const copied = await handleCopySelection();
    if (!copied) return;
    handleDeleteSelection();
  }, [handleCopySelection, handleDeleteSelection]);

  const [pendingScreenDeletion, setPendingScreenDeletion] = useState<{
    files: DesignFile[];
  } | null>(null);

  const performDeleteFiles = useCallback(
    (
      filesToDelete: DesignFile[],
      options?: {
        // U12 fix: undoFileCreation pushes the just-undone create onto the
        // file-creation REDO stack, then calls this function to soft-delete
        // the same file it just pushed for. Without this flag the filename-
        // keyed prune below (which exists to drop a redo entry when its file
        // is hard-deleted directly, NOT via undo) would immediately remove
        // the entry undoFileCreation just pushed, leaving redo permanently
        // empty after every screen-create/duplicate undo.
        skipFileCreationRedoPrune?: boolean;
        // A user-confirmed screen deletion is a normal editor operation, not
        // an irreversible special case. Capture the complete rows + frame
        // geometry and add one grouped undo entry after every delete succeeds.
        recordDeletionHistory?: boolean;
        onMutationSettled?: (
          deletedFiles: DesignFile[],
          failedFiles: DesignFile[],
        ) => void;
      },
    ) =>
      runDeleteFiles(
        {
          activeFile,
          canvasFrameGeometryById,
          clearRedoStacks,
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
          files,
          geometryRedoStackRef,
          geometryUndoStackRef,
          historyOrderRef,
          id,
          latestClipboardMutationContentRef,
          localContentRedoStackRef,
          localContentUndoStackRef,
          queryClient,
          redoOrderRef,
          setActiveFileId,
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
      deleteFileMutation,
      queryClient,
      syncUndoRedoState,
      t,
      writeFrameGeometrySnapshot,
    ],
  );

  // MultiScreenCanvas consumes arrow keys in the capture phase while a frame
  // is selected, and an in-screen element selection keeps its screen there.
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

  // Gate screen deletion behind confirmation, then record the deleted rows as
  // one grouped history entry so Cmd+Z can recreate every selected screen.
  // Always returns false to MultiScreenCanvas so it never performs its own
  // synchronous local frame-geometry delete ahead of the confirmation.
  const handleDeleteOverviewSelection = useCallback(
    (selectedIds: string[]) => {
      if (!canEditDesign) return false;
      // BUG-DELETE-OVERVIEW-COLLISION: MultiScreenCanvas consumes Delete in
      // the capture phase whenever a frame is selected, and an in-screen
      // element selection keeps its screen there — so deleting one node in a
      // screen offered to delete the whole screen and the editor's own
      // onDelete hotkey never ran. Route to the element delete instead; the
      // screen-delete confirmation is only for a real frame selection.
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
      if (!selectedIds.length || files.length <= 1) return false;

      const selectedIdSet = new Set(selectedIds);
      const selectedFiles = files.filter((file) => selectedIdSet.has(file.id));
      if (!selectedFiles.length) return false;

      const maxDeleteCount =
        selectedFiles.length >= files.length
          ? Math.max(0, files.length - 1)
          : selectedFiles.length;
      const filesToDelete = selectedFiles.slice(0, maxDeleteCount);
      if (!filesToDelete.length) return false;

      setPendingScreenDeletion({ files: filesToDelete });
      return false;
    },
    [
      canEditDesign,
      files,
      handleDeleteSelection,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  const handleCancelScreenDeletion = useCallback(() => {
    setPendingScreenDeletion(null);
  }, []);

  const handleConfirmScreenDeletion = useCallback(() => {
    const pending = pendingScreenDeletion;
    setPendingScreenDeletion(null);
    if (pending) {
      performDeleteFiles(pending.files, { recordDeletionHistory: true });
    }
  }, [pendingScreenDeletion, performDeleteFiles]);

  // ── Props/animation clipboard, transforms, nudge ───────────────────────────
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
    if (!canEditDesign) return;
    if (!selectedElement?.selector || !copiedStylePropsRef.current) return;
    const styles = Object.fromEntries(
      Object.entries(copiedStylePropsRef.current).filter(([, value]) =>
        Boolean(value),
      ),
    );
    handleStylesChange(styles);
  }, [canEditDesign, handleStylesChange, selectedElement]);

  // Item 2d — "Copy animation" (Figma-parity, Copy/Paste-as submenu): snapshot
  // the selected node's motion tracks as a clip, detached from its node id
  // (copyLayerAnimation), so "Paste animation" can stamp it onto a different
  // selection.
  const handleCopyAnimation = useCallback(() => {
    if (!selectedMotionTargetNodeId) return;
    const clip = copyLayerAnimation(motionTracks, selectedMotionTargetNodeId);
    if (!clip) return;
    copiedLayerAnimationRef.current = clip;
    setHasAnimationClipboard(true);
  }, [motionTracks, selectedMotionTargetNodeId]);

  // Item 2d — "Paste animation": stamp the copied clip onto the current
  // selection (replacing any tracks it already has for the clip's
  // properties), then persist through the same motion-tracks-dirty autosave
  // path as every other track mutation.
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

  // Figma's Shift+H / Shift+V — flip the selection horizontally/vertically.
  // Mirrors EditPanel's own flip buttons exactly (rotation section): toggle
  // the CSS `scale` property (a value distinct from `transform`, so it
  // composes independently of any existing rotation) between 1/-1 on the
  // relevant axis via the same "sx sy" string format, through the standard
  // single-property style-commit path so it lands in one undo step.
  const parseSelectionScaleValue = useCallback(
    (value: string | undefined): [number, number] => {
      const trimmed = (value ?? "").trim();
      // Empty/"none" both mean "no scale applied" (1, 1) — must be checked
      // before splitting, since "".split(/\s+/) yields [""] and Number("")
      // is 0 (finite), which would silently read as a zero scale below.
      if (!trimmed || trimmed === "none") return [1, 1];
      const parts = trimmed
        .split(/\s+/)
        .filter((token) => token !== "")
        .map(Number);
      const sx = Number.isFinite(parts[0]) ? parts[0]! : 1;
      // CSS `scale` single-value semantics: one value scales both axes, so a
      // genuinely single-token value (e.g. "2") falls back to sy = sx, not 1.
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

  // Figma's Shift+X — swap fill and stroke. Matches Figma even when one side
  // is empty: an element with a fill and no stroke ends up with a stroke and
  // no fill (not a no-op). Both properties are committed together via
  // handleStylesChange so the swap is a single undo step.
  const handleSwapFillStroke = useCallback(() => {
    if (!canEditDesign || !selectedElement) return;
    const currentFill = selectedElement.computedStyles.backgroundColor ?? "";
    const currentStroke = selectedElement.computedStyles.borderColor ?? "";
    handleStylesChange({
      backgroundColor: currentStroke || "transparent",
      borderColor: currentFill || "transparent",
    });
  }, [canEditDesign, handleStylesChange, selectedElement]);

  // Figma's Ctrl+C — eyedropper: sample a color from anywhere on screen and
  // apply it to the current selection's fill (shape/frame) or text color
  // (text node), via the standard style-commit path. A one-shot action, not
  // a tool — see useDesignHotkeys' onEyedropper doc comment. No-ops with a
  // subtle toast when the selection is missing or the browser doesn't
  // support the EyeDropper API (Firefox/Safari as of this writing).
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

  // L4: bring/send forward/backward/front/back. Previously this only ever
  // wrote a z-index style (and promoted static->relative), which visually
  // painted the element above/below IN-FLOW siblings that never got a
  // z-index of their own (z-index only competes within the same stacking
  // context, so "send to back" at z-index:0 could still paint above a
  // same-level sibling that had no z-index at all) and never touched the
  // panel/DOM order — so the layers panel never reflected the new stacking.
  // Reimplemented as real DOM reorders among siblings via moveNode edits,
  // consistent with the panel/paint contract: last DOM child = topmost row
  // in the panel = topmost painted. Falls back to the old z-index-only
  // behavior only when the element isn't resolvable as a reorderable code
  // layer (e.g. no sibling info available).
  const changeSelectedZIndex = useCallback(
    (mode: "forward" | "front" | "backward" | "back") =>
      runChangeSelectedZIndex(
        {
          activeFile,
          applyLocalContentUpdate,
          canEditDesign,
          codeLayerOwnerByNodeIdRef,
          commitVisualStyles,
          getFreshActiveContent,
          selectedElement,
          selectedLayerIdsState,
          setSelectedElement,
        },
        mode,
      ),
    [
      activeFile,
      applyLocalContentUpdate,
      canEditDesign,
      commitVisualStyles,
      getFreshActiveContent,
      selectedElement,
      selectedLayerIdsState,
    ],
  );

  // Hide the in-iframe selection outline during keyboard nudges so it doesn't
  // chase the element, restoring it once the burst settles. The re-armed
  // settle timer is the authoritative restore (~800ms, matching the nudge
  // coalesce window); an arrow keyup restores sooner when the host has focus.
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
          applyLocalContentUpdate,
          boardFileId,
          boardFrameGeometry,
          canEditDesign,
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
      applyLocalContentUpdate,
      boardFileId,
      boardFrameGeometry,
      canEditDesign,
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

  // ── Undo and redo ──────────────────────────────────────────────────────────
  // Handle undo: pop from UndoManager, then queue SQL persist.
  // The Y.Text observer already calls setCollabContent when the doc changes,
  // but undo/redo transactions use the UndoManager as origin so we must also
  // advance lastLocalContentRef and trigger the debounced save here.
  const handleUndo = useCallback(
    () =>
      runUndo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        clipboardPasteRedoStackRef,
        clipboardPasteUndoStackRef,
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
        files,
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent,
        getScreenContent,
        historyOrderRef,
        id,
        isSynced,
        lastLocalContentRef,
        latestClipboardMutationContentRef,
        liveFrameGeometryRef,
        liveScreenSnapshotsById,
        localContentRedoStackRef,
        localContentUndoStackRef,
        markPendingLocalFileContent,
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
      applyLocalContentUpdate,
      canEditDesign,
      createFileMutation,
      deleteFileMutation,
      files,
      getFreshActiveContent,
      getScreenContent,
      id,
      isSynced,
      liveScreenSnapshotsById,
      markPendingLocalFileContent,
      performDeleteFiles,
      publishAuthoritativeClipboardMutation,
      queryClient,
      queueFileContentSave,
      replacePreviewContent,
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

  const handleRedo = useCallback(
    () =>
      runRedo({
        activeEditorDragRef,
        activeFile,
        applyFileContentUpdate,
        applyLocalContentUpdate,
        canEditDesign,
        clipboardPasteRedoStackRef,
        clipboardPasteUndoStackRef,
        contentRedoSelectionStackRef,
        contentRedoStackRef,
        contentUndoSelectionStackRef,
        contentUndoStackRef,
        createFileMutation,
        deleteRuntimeElement,
        designDataJsonRef,
        fileCreationRedoStackRef,
        fileCreationUndoStackRef,
        fileDeletionRedoStackRef,
        fileDeletionUndoStackRef,
        fileHistoryMutationPendingRef,
        files,
        focusCreatedScreen,
        geometryRedoStackRef,
        geometryUndoStackRef,
        getFreshActiveContent,
        getScreenContent,
        historyOrderRef,
        id,
        isSynced,
        lastLocalContentRef,
        latestClipboardMutationContentRef,
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
        pendingVisualStyleEditsRef,
        pendingVisualStyleRedoStackRef,
        pendingVisualStyleUndoStackRef,
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
        setContentRenderRevision,
        setHoveredElement,
        setPendingLayerStateReplayRequest,
        setPendingLiveNonStyleEdits,
        setPendingTextRevertRequest,
        setPendingVisualStyleEdits,
        setPendingVisualStyleRevertRequest,
        setRuntimeStructureInsertRequest,
        setRuntimeStructureMoveRequest,
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
      applyLocalContentUpdate,
      canEditDesign,
      createFileMutation,
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
      restoreSelectionSnapshot,
      syncLiveScreenSnapshotPreview,
      syncUndoRedoState,
      t,
      updateLiveScreenSnapshotContent,
      writeFrameGeometrySnapshot,
      t,
    ],
  );

  // ── Zoom, view transitions, and mode changes ───────────────────────────────
  const handleZoomIn = useCallback(() => {
    trace("tool", "zoom-in", {});
    setZoom((z) => getNextZoomStepUp(z));
  }, [setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => getNextZoomStepDown(z));
  }, [setZoom]);

  // Figma's Shift+1/Shift+2: fit ALL content (or just the selection) into the
  // current canvas viewport. MultiScreenCanvas now owns the actual fit
  // camera move via its `cameraCommand` prop — it computes zoom+pan itself
  // (via the shared getCameraForBounds, against its own live viewport size)
  // and applies it through the same imperative-transform + debounced-commit
  // path wheel/pinch zoom uses, so there's no extra render storm and no need
  // for this component to know the real pan offset. This just resolves the
  // world-space bounds to fit and bumps a nonce; passing the same nonce
  // twice, or null bounds, is a no-op on the receiving end.
  const handleZoomToFit = useCallback(() => {
    viewModeRef.current = "overview";
    setViewMode("overview");
    setActiveTool("move");
    const frames = getAllScreenFrameEntries({
      overviewScreens,
      canvasFrameGeometryById,
      boardContentBounds,
      boardFileId,
    });
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
    canvasFrameGeometryById,
    overviewScreens,
  ]);

  const handleZoomToSelectionFit = useCallback(() => {
    const allFrames = getAllScreenFrameEntries({
      overviewScreens,
      canvasFrameGeometryById,
      boardContentBounds,
      boardFileId,
    });
    const selectedIds = new Set(overviewSelectedScreenIds);
    // No screen-level selection (e.g. only a layer selected within one
    // screen, with no screen-frame selection): fall back to fitting all
    // content. A true per-selected-layer canvas bounds fit would be a closer
    // match to Figma here, but codeLayerOwnerByNodeId (needed to resolve the
    // owning screen) is a useMemo declared later in this component than this
    // callback can reference from its dependency array — see the report for
    // this gap.
    const selectedFrames =
      selectedIds.size > 0
        ? allFrames.filter((frame) => selectedIds.has(frame.id))
        : allFrames;
    const bounds = getFrameGroupBounds(selectedFrames);
    if (!bounds) {
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
    canvasFrameGeometryById,
    overviewScreens,
    overviewSelectedScreenIds,
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
      // Some engines throw synchronously; fall back to an immediate update.
      update();
      return;
    }
    // A second transition started before the previous one settles aborts the
    // first, rejecting these promises with InvalidStateError. Swallow them so
    // rapid interactions (selection, mode switches) don't spam the console with
    // unhandled rejections.
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

  // `nextMode` is a mode the user explicitly picked on the way out of a
  // focused screen (see handleModeChange); without it the mode is derived.
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
        // The infinite canvas IS the editing view, so Interact never survives
        // the trip back to overview — that pairing was the old third state.
        // Annotate is a tool overlay on the same canvas, not a view, so it
        // stays.
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
  const enterSingleScreenInteract = useCallback(
    (fileId?: string | null) => enterSingleScreen(fileId),
    [enterSingleScreen],
  );

  // Interact presents the screen in a responsive device box with its own
  // chrome bar inside the center canvas. The rails stay mounted, while
  // embedded hosts keep their own chrome and are left alone.
  const responsiveInteractActive =
    mode === "interact" && viewMode === "single" && !!activeFile && !embedded;
  const handleInteractDeviceChange = useCallback((name: string) => {
    setInteractDeviceName(name);
    const preset = findInteractDevicePreset(name);
    if (preset) {
      setInteractDeviceSize({ width: preset.width, height: preset.height });
    }
  }, []);
  // Typing a dimension is what makes a size "custom" — the preset it no longer
  // matches would otherwise keep claiming the device dropdown.
  const handleInteractWidthChange = useCallback((width: number) => {
    setInteractDeviceSize((size) => ({ ...size, width }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);
  const handleInteractHeightChange = useCallback((height: number) => {
    setInteractDeviceSize((size) => ({ ...size, height }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);

  // BP-DEEP v2 item 2 — edge-triggered zoom-out-to-overview. See
  // shouldPopToOverviewOnZoomOut's doc comment: the pop must only fire when
  // the user crosses the threshold from above while already in single view,
  // never on the zoom value restored by entering single view (that
  // level-triggered version was the "Interact flashes then bounces back to
  // overview" bug). The ref holds the last zoom observed in settled
  // single-view state and resets to null whenever single view isn't active,
  // so the first observation after entry can never pop.
  const lastSettledSingleZoomRef = useRef<number | null>(null);
  // Fix-wave: an explicit destination zoom (a "Zoom to 50/100/200%" preset or
  // a typed zoom-% commit) is a deliberate "go to exactly this zoom" action,
  // not a continuous zoom-out gesture — it must never trigger the Figma-style
  // pop-to-overview heuristic above, even when it crosses
  // OVERVIEW_ZOOM_THRESHOLD from above (e.g. 100% -> "Zoom to 50%"). Only
  // stepped zoom-out (handleZoomOut / scroll / pinch, all of which change
  // `zoom` without touching this ref) should ever pop. Set immediately before
  // the zoom write and consumed (reset) the next time this effect runs, so it
  // only ever suppresses the one update it was set for.
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
          t,
          viewModeRef,
        },
        next,
        options,
      ),
    [
      activeFile,
      canEditDesign,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      clearPendingLiveEditState,
      enterOverviewFromZoom,
      enterSingleScreen,
      requestPendingLiveNonStyleRevert,
      requestPendingVisualStyleRevert,
      t,
      files,
    ],
  );
  const handleOverviewFrameAction = useCallback(
    (screenId: string) => {
      if (mode === "interact") {
        enterSingleScreenInteract(screenId);
        return;
      }
      handleModeChange("interact", { targetFileId: screenId });
    },
    [enterSingleScreenInteract, handleModeChange, mode],
  );
  // Closing the responsive view returns to the infinite canvas. Dropping to
  // Edit while still in single view was the forbidden third state: a focused
  // screen with no device chrome and no canvas around it.
  const handleExitResponsiveInteract = useCallback(
    () => enterOverviewFromZoom(),
    [enterOverviewFromZoom],
  );
  // Fit against the actual center canvas, not window.innerWidth: both rails
  // remain mounted in Interact, so window-level math can place a wide device
  // partly behind them. ResizeObserver also refits after either rail moves.
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
      // The toggle swaps between the only two views there are: the infinite
      // canvas (editing) and the responsive interactive view.
      enterSingleScreen(activeFileId);
      return;
    }
    enterOverviewFromZoom();
  }, [activeFileId, enterOverviewFromZoom, enterSingleScreen]);

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
      // Only two views exist: the infinite canvas (editing) and the responsive
      // interactive view. Picking a screen from the Screens list means "go look
      // at this running screen", so it lands in the responsive view — except
      // for a host-embedded editor, where switching screens must not silently
      // drop the user out of editing.
      enterSingleScreen(screenId, hostEmbeddedEditor ? { mode } : undefined);
    },
    [
      clearPendingOverviewLayerSelectionTimer,
      enterSingleScreen,
      hostEmbeddedEditor,
      mode,
      overviewSelectedScreenIds,
    ],
  );

  // ── Review rewrite, pin tool, shortcuts dialog ─────────────────────────────
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
        canvasFrameGeometryById,
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
      canvasFrameGeometryById,
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
    setDrawMode(false);
    setActiveTool("move");
    setMode("edit");
  }, []);

  const handlePinToolToggle = useCallback(() => {
    if (!activeFile || !canCommentDesign) return;
    if (pinMode) {
      handleExitReviewCommentMode();
      return;
    }
    setCommentsHidden(false);
    // Comment pins are an editing overlay on the infinite canvas, not a third
    // focused view. If invoked from Interact, leave it before arming the pin.
    if (viewMode !== "overview") {
      enterOverviewFromZoom("annotate");
    }
    setActiveTool("comment");
    setMode("annotate");
    setPinMode(true);
    setDrawMode(false);
  }, [
    activeFile,
    canCommentDesign,
    enterOverviewFromZoom,
    handleExitReviewCommentMode,
    pinMode,
    viewMode,
  ]);

  const handleShowKeyboardShortcutsFromMenu = useCallback(() => {
    keyboardShortcutsReturnFocusRef.current = projectMenuTriggerRef.current;
    suppressProjectMenuReturnFocusRef.current = true;
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
    setUiHidden(false);
    setKeyboardShortcutsOpen(true);
  }, [handleCloseKeyboardShortcuts, keyboardShortcutsOpen]);

  // Capture phase, and deliberately outside the useDesignHotkeys gate below.
  // Two reasons, each of which broke this chord on its own: a bubble-phase
  // listener runs after the agent composer has already inserted "/" and opened
  // its slash menu, and that gate switches off during responsive-interact and
  // agent question flows — it disables editing shortcuts, and shortcut help
  // is not an editing shortcut.
  useEffect(() => {
    if (embedded) return;
    const handleHelpHotkey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!isShowKeyboardShortcutsHotkey(event)) return;
      // preventDefault also keeps the bubble-phase useDesignHotkeys listener
      // from toggling a second time on the same keystroke.
      event.preventDefault();
      event.stopPropagation();
      // Swallowed above but not acted on: holding the chord auto-repeats
      // keydown, and toggling per repeat would flap the panel open/closed.
      // One physical press is one toggle.
      if (event.repeat) return;
      handleToggleKeyboardShortcuts();
    };
    window.addEventListener("keydown", handleHelpHotkey, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleHelpHotkey, {
        capture: true,
      });
  }, [embedded, handleToggleKeyboardShortcuts]);

  // ── Editor hotkeys ─────────────────────────────────────────────────────────
  const handleEscapeHotkey = useCallback(
    () =>
      runEscapeHotkey({
        activeBreakpointWidthStateRef,
        activeTool,
        cancelActiveEditorDrag,
        codeLayerOwnerByNodeIdRef,
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
        selectedLayerIdsState,
        setActiveFileId,
        setActiveTool,
        setDrawMode,
        setExpandedLayerIds,
        setHoveredElement,
        setMode,
        setOverviewClearSelectionRequest,
        setOverviewSelectedScreenIds,
        setPinMode,
        setSelectedElement,
        setSelectedLayerIdsState,
        viewMode,
      }),
    [
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
      selectedElement,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  // T22: Enter with a selected TEXT layer in single mode begins inline
  // editing on it (Figma: Enter drills into the selected layer), reusing the
  // same begin-text-edit machinery a newly-created text primitive uses
  // (scheduleBeginTextEditForScreen).
  // Text-tag elements (TEXT_LAYER_TAGS in shared/code-layer.ts) and T-tool
  // primitive text (a plain div marked data-an-primitive="text") both
  // qualify — replicated here as a small inline check since those
  // classification internals aren't exported; CodeLayerNode.tag/
  // dataAttributes are public fields on the type.
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
  /**
   * P5/vector-edit entry point. Only reachable while `viewMode === "overview"`
   * — MultiScreenCanvas's `vectorEdit` overlay (the only place this state is
   * rendered) doesn't exist in single-screen mode, so entering vector edit
   * from a single-screen selection is deliberately deferred rather than
   * silently doing something broken; see FINAL REPORT for the exact
   * deferral. Returns true when vector edit mode was entered (caller should
   * not also drill into the screen), false otherwise (not a pen path, or its
   * origin couldn't be resolved).
   */
  const enterVectorEditForSelection = useCallback(
    (owner: { fileId: string; node: CodeLayerNode }): boolean => {
      const penNodesAttr = owner.node.dataAttributes["data-an-pen-nodes"];
      if (!penNodesAttr) return false;
      const path = parsePenNodes(penNodesAttr);
      if (!path) return false;
      const originCanvas = getScreenFrameOriginCanvas({
        screenId: owner.fileId,
        overviewScreens,
        canvasFrameGeometryById,
        boardFileId,
      });
      if (!originCanvas) return false;
      const nodeId =
        owner.node.dataAttributes["data-agent-native-node-id"] ?? owner.node.id;
      setVectorEditingState({ screenId: owner.fileId, nodeId, path });
      return true;
    },
    [boardFileId, canvasFrameGeometryById, overviewScreens],
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
      selectCodeLayerNodesForHotkey,
      selectedLayerIdsState,
      viewMode,
    ],
  );

  // Fix: while any Radix popover/dropdown from the inspector panel is open, the
  // design preview iframe underneath must not receive pointer events — otherwise
  // clicks inside the picker pass through to the canvas and corrupt element fills.
  useEffect(() => {
    const getPreviewIframe = () =>
      document.querySelector(
        // i18n-ignore: DOM selector helper.
        "iframe[data-design-preview-iframe]",
      ) as HTMLIFrameElement | null;

    const updateIframePointerEvents = () => {
      const iframe = getPreviewIframe();
      if (!iframe) return;
      // Same tooltip-vs-menu ambiguity as the inspectorPopoverOpen shield
      // above (see its doc comment) — and, as of finding 7, the exact same
      // isRadixOverlayOpen predicate, so the two shields can't diverge
      // again. (Previously this path hand-duplicated a slightly different,
      // buggier version that never checked a closed wrapper's own
      // data-state, which could leave this iframe's pointer-events stuck at
      // "none" after closing the zoom menu via item-select.)
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
      // Restore pointer events on unmount in case a popover was left open.
      const iframe = getPreviewIframe();
      if (iframe) iframe.style.pointerEvents = "";
    };
  }, []);

  // Current Figma — N/Shift+N cycles frames in LAYERS-PANEL order, not raw
  // `files` order. `files` also includes the board file and non-html support
  // files (e.g. CSS), neither of which is a visible screen a user could tab
  // onto in Figma; `overviewScreens` is the same html+non-board, panel-order
  // list the layers panel and overview canvas already render from (see
  // layerPanelFiles/overviewLayerPanelFiles and overviewScreens above).
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
      // Figma always recenters the viewport on the newly-selected frame.
      // DesignEditor doesn't track MultiScreenCanvas's live pan/zoom
      // (see handleZoomToFit's comment), so there's no cheap "already in
      // view" check available here; always follow, with generous padding so
      // the freshly-selected frame doesn't hug the viewport edge.
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById,
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
    [activeFile, canvasFrameGeometryById, overviewScreens],
  );

  // Current Figma — Tab/Shift+Tab traverse siblings within the selected
  // layer's parent. Frame navigation has its own N/Shift+N bindings above;
  // keeping these paths separate prevents Tab from unexpectedly leaving the
  // layer hierarchy and jumping to another screen.
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

  // Current Figma — Backslash selects the parent layer. A top-level code
  // layer has no code-layer parent (its parent is the screen itself), so this
  // deliberately no-ops there rather than forcing an unexpected view-mode
  // transition just to approximate screen selection.
  const handleSelectParentLayer = useCallback(() => {
    const selectedId = selectedLayerIdsState[selectedLayerIdsState.length - 1];
    if (!selectedId) return;
    const owner = codeLayerOwnerByNodeIdRef.current.get(selectedId);
    if (!owner?.node.parentId) return;
    const parentOwner = codeLayerOwnerByNodeIdRef.current.get(
      owner.node.parentId,
    );
    if (!parentOwner || parentOwner.fileId !== owner.fileId) return;
    // BUG-ESCAPE-SHELL (same mechanism as handleEscapeHotkey's pop walk): the
    // flat ownership map still resolves a top-level layer's parentId to the
    // collapsed <html>/<body> shell node, which the layers panel never shows
    // as selectable. Without this guard, Shift+Enter/"\\" on a top-level
    // layer would select <body> instead of no-op'ing like the comment above
    // already documents.
    if (!hasSelectableCodeLayerParent({ parentNode: parentOwner.node })) {
      return;
    }
    selectCodeLayerNodesForHotkey(
      parentOwner.fileId,
      [parentOwner.node],
      collectCodeLayerAncestors(parentOwner.tree, parentOwner.node.id),
    );
  }, [selectCodeLayerNodesForHotkey, selectedLayerIdsState]);

  // L23: Cmd+A in single mode selects all top-level layers of the active
  // screen instead of yanking the user into the screen overview and
  // selecting every screen — that's surprising when the user is focused on
  // editing one screen's layers. Overview-mode Cmd+A keeps its previous
  // "select all screens" behavior.
  const handleSelectAllFrames = useCallback(() => {
    if (!overviewScreens.length) return;
    if (viewModeRef.current === "single" && activeFile) {
      const projection = buildCodeLayerProjection(getFreshActiveContent());
      const tree = buildCodeLayerTree(projection);
      const topLevelIds = tree.map((node) => node.id);
      if (topLevelIds.length > 0) {
        setSelectedLayerIdsState(topLevelIds);
        const lastId = topLevelIds[topLevelIds.length - 1];
        const lastNode = projection.nodes.find((n) => n.id === lastId);
        if (lastNode) {
          setSelectedElement(elementInfoFromCodeLayerNode(lastNode));
        }
      }
      return;
    }
    setDrawMode(false);
    setPinMode(false);
    setMode("edit");
    setActiveTool("move");
    viewModeRef.current = "overview";
    setViewMode("overview");
    setOverviewSelectedScreenIds(overviewScreens.map((screen) => screen.id));
    setOverviewSelectAllRequest((request) => request + 1);
  }, [activeFile, getFreshActiveContent, overviewScreens]);

  // L12: shared by Cmd+R and the canvas context-menu Rename item — the single
  // currently-selected layer id eligible for the layers-panel inline rename,
  // or null when zero or more-than-one layers are selected (screen/file rows
  // are excluded; renaming those is a separate flow). `__`-prefixed and file
  // ids are filtered the same way handleSelectAllFrames/other selection
  // helpers already do.
  const getSingleSelectedRenamableLayerId = useCallback((): string | null => {
    const fileIds = new Set(files.map((file) => file.id));
    const selectedRenamableLayerIds = selectedLayerIdsState.filter(
      (layerId) => !layerId.startsWith("__") && !fileIds.has(layerId),
    );
    return selectedRenamableLayerIds.length === 1
      ? selectedRenamableLayerIds[0]!
      : null;
  }, [files, selectedLayerIdsState]);

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
    setUiHidden(false);
    setActiveLeftPanel("file");
  }, []);

  const handleShowAssetsPanel = useCallback(() => {
    setUiHidden(false);
    setActiveLeftPanel("assets");
  }, []);

  const handleFindLayers = useCallback(() => {
    handleShowLayersPanel();
    // The panel is unmounted while Show/Hide UI is active. Wait for React to
    // reveal it before asking the existing search control to open and focus.
    window.requestAnimationFrame(() => layersPanelRef.current?.focusSearch());
  }, [handleShowLayersPanel]);

  useDesignHotkeys({
    enabled:
      !hostOwnsChrome &&
      !responsiveInteractActive &&
      !(pendingQuestions && pendingQuestions.length > 0),
    shouldHandleEvent: shouldHandleEditorHotkey,
    onMoveTool: canEditDesign ? handleMoveTool : undefined,
    // F always means Frame; without forcing the mode it would reuse whichever
    // sub-tool the dropdown last selected.
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
    onHandTool: canEditDesign ? handleHandTool : undefined,
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
    // Not gated on hasCanvasClipboard: this tab may not have copied anything
    // itself yet, but the system clipboard can still carry a marker payload
    // from a copy made in another tab/window (see U4). handlePasteSelection
    // checks the live clipboard first and no-ops safely if there is nothing
    // to paste from either source.
    onPaste: canEditDesign ? () => void handlePasteSelection() : undefined,
    onCut: canEditDesign ? handleCutSelection : undefined,
    onPasteOver: canEditDesign ? handlePasteOverSelection : undefined,
    onPasteToReplace: canEditDesign ? handlePasteToReplace : undefined,
    onCopyProps: canEditDesign ? handleCopyProps : undefined,
    onPasteProps: canEditDesign ? handlePasteProps : undefined,
    onDuplicate: canEditDesign ? handleDuplicateSelection : undefined,
    // Routes screen-vs-element itself; selecting a screen in the layers panel
    // never reaches MultiScreenCanvas' capture-phase Delete.
    onDelete: canEditDesign
      ? () => {
          handleDeleteOverviewSelection(selectedLayerIdsState);
        }
      : undefined,
    // L12: Cmd+R (and the context-menu Rename item, both routed through
    // useDesignHotkeys' onRename) previously always renamed the DESIGN
    // TITLE, even while a layer was selected — surprising when the user's
    // focus is clearly on a specific layer. Route to the layer's real inline
    // rename editor (LayersPanel ref's beginRename) when exactly one
    // selectable (non-file-row) layer is selected; only fall back to
    // renaming the design title when nothing (or more than one layer) is
    // selected.
    onRename: () => {
      if (!canEditDesign) return;
      const layerId = getSingleSelectedRenamableLayerId();
      if (layerId) {
        layersPanelRef.current?.beginRename(layerId);
        return;
      }
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
    // handleToggleHiddenForSelection/handleToggleLockedForSelection are
    // declared later in this component (they depend on
    // handleToggleLayerLocked/handleToggleLayerHidden, which in turn depend
    // on codeLayerOwnerByNodeId — all defined below this hook call). A direct
    // ternary reference here would be a temporal-dead-zone error since it
    // reads the binding during THIS render; wrapping in an arrow function
    // defers the lookup until the hotkey actually fires, by which point the
    // component has finished rendering and the binding is assigned — same
    // trick as onRename below, which already does this for a
    // later-in-file-order handler.
    onToggleHidden: canEditDesign
      ? () => handleToggleHiddenForSelection()
      : undefined,
    onToggleLocked: canEditDesign
      ? () => handleToggleLockedForSelection()
      : undefined,
    onSelectAll: handleSelectAllFrames,
    onUndo: canEditDesign ? handleUndo : undefined,
    onRedo: canEditDesign ? handleRedo : undefined,
    onBringForward: canEditDesign
      ? () => changeSelectedZIndex("forward")
      : undefined,
    onBringToFront: canEditDesign
      ? () => changeSelectedZIndex("front")
      : undefined,
    onSendBackward: canEditDesign
      ? () => changeSelectedZIndex("backward")
      : undefined,
    onSendToBack: canEditDesign
      ? () => changeSelectedZIndex("back")
      : undefined,
    // Interact owns the running app's keyboard behavior. The editor shell must
    // not consume Escape or use it to change view/selection underneath it.
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
    // Current Figma: Cmd+0 returns to 100%.
    onZoomReset: () => setZoom(100),
    onZoomToFit: handleZoomToFit,
    onZoomToSelection: () => {
      if (viewMode === "overview") {
        handleZoomToSelectionFit();
        return;
      }
      // Single-screen mode: the selection is a DOM element inside the
      // iframe, not a canvas-frame — true bounds-fit would need iframe-
      // internal scroll math that's out of scope here, so keep the existing
      // fixed zoom-in behavior for that surface.
      if (selectedElement) setZoom(150);
    },
    // H2: Cmd+Alt+K — create component from the current selection.
    onCreateComponent: canEditDesign ? handleCreateComponentHotkey : undefined,
    // Cmd+Alt+B — Detach instance. Only wired while the selection actually is
    // a component instance, matching onOpacityChange's "absent handler is a
    // no-op" convention just below.
    onDetachInstance:
      canEditDesign && selectedComponentNodeId
        ? handleDetachInstanceMenuAction
        : undefined,
    // H2: plain digit 1-9/0 — set selection opacity. Only supplied while a
    // layer is selected so unselected digit presses fall through untouched
    // (useDesignHotkeys treats an absent handler as "not handled").
    onOpacityChange:
      canEditDesign && selectedElement
        ? ({ opacity }) => handleOpacityHotkey(opacity)
        : undefined,
    // Cmd+U / Cmd+Shift+X — toggle underline/strikethrough. Only wired while
    // a layer is selected, matching onOpacityChange's "absent handler is a
    // no-op" convention.
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
    // Show/Hide UI and Show/Hide comments are view-only chrome toggles, not
    // editing actions, so they work regardless of canEditDesign.
    onToggleUi: handleToggleUi,
    onToggleComments: handleToggleComments,
    onShowKeyboardShortcuts: handleToggleKeyboardShortcuts,
  });

  // ── Generation retry, coding handoff, navigation guard ─────────────────────
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
        audience: hostEmbeddedEditor ? "coding-agent" : "design-agent",
        screenRoutes: screenRoutesById,
      }),
    [
      activeFile?.filename,
      activeFile?.id,
      activeOverviewScreen?.connectionId,
      design?.title,
      hostEmbeddedEditor,
      id,
      pendingLiveNonStyleEdits,
      pendingVisualStyleEdits,
      screenRoutesById,
    ],
  );
  const handleApplyPendingVisualStylesWithAgent = useCallback(
    async () =>
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
        pendingStructureVerificationStatus,
        pendingVisualStyleEdits,
        pendingVisualStylePrompt,
        setActiveLeftPanel,
        setApplyingViaHost,
        setPendingAgentHandoffBusy,
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
  const handleCopyPendingVisualStylePrompt = useCallback(async () => {
    if (
      pendingVisualStyleEdits.length === 0 &&
      pendingLiveNonStyleEdits.length === 0
    ) {
      return;
    }
    try {
      if (!(await writeClipboardText(pendingVisualStylePrompt))) {
        toast.error(t("designEditor.toasts.clipboardBlocked"));
        return;
      }
      toast.success(t("designEditor.pendingVisualStyles.copiedToast"));
    } catch {
      toast.error(t("designEditor.toasts.clipboardBlocked"));
    }
  }, [
    pendingLiveNonStyleEdits.length,
    pendingVisualStyleEdits.length,
    pendingVisualStylePrompt,
    t,
  ]);

  // ── Export: HTML, ZIP, PNG, PDF, SVG, Figma ────────────────────────────────
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
      .map(elementInfoFromCodeLayerNode);
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

      // In overview, Copy as PNG targets the one selected screen instead of
      // whichever iframe happens to be first in DOM order. The download action
      // still targets the active screen through canvasIframeRef.
      if (scope !== "document" && viewMode === "overview") {
        const screenId =
          selectedScreenIds.length === 1 ? selectedScreenIds[0] : null;
        iframe = screenId
          ? document.querySelector<HTMLIFrameElement>(
              `iframe[data-design-preview-iframe][data-screen-iframe-id="${CSS.escape(screenId)}"]`,
            )
          : null;
        if (scope === "screens") cropSelection = null;
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
      pngSelectedElements,
      selectedElement,
      selectedScreenIds,
      viewMode,
    ],
  );

  /** Shared renderer for download and clipboard paths. Keeping capture, clone
   * sanitization, overlay stripping, scale, and crop in one function prevents
   * Copy as PNG from drifting visually from the existing PNG export. */
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
          canvasFrameGeometryById,
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
      canvasFrameGeometryById,
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
    ) => {
      if (pngExportingRef.current) return;
      pngExportingRef.current = true;
      setPngExporting(true);
      try {
        const blob = await renderPngBlob({
          scope: "document",
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

  /** One PDF page per overview screen, each rasterized at its own authored
   * width/height (see createMultiPageRasterPdf) instead of the single active
   * artboard handleDownloadPdf captures. Mirrors handleDownloadPdf's busy-state
   * guard and error handling — showRasterCaptureError's messaging is about the
   * underlying raster capture step, which this shares with the single-page
   * path, not the PDF assembly step. */
  const handleDownloadAllScreensPdf = useCallback(
    async () =>
      runDownloadAllScreensPdf({
        activeCanvasSourceType,
        canEditDesign,
        canvasFrameGeometryById,
        fallbackExportName,
        overviewScreens,
        pngExportingRef,
        setPngExporting,
        showRasterCaptureError,
        t,
        triggerBlobDownload,
      }),
    [
      activeCanvasSourceType,
      canEditDesign,
      canvasFrameGeometryById,
      fallbackExportName,
      overviewScreens,
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
      // Do not await this before clipboard.write: ClipboardItem accepts the
      // pending Blob representation, preserving the initiating user gesture.
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
        ? canvasFrameGeometryById[targetFileId]
        : undefined;
      return {
        document: doc,
        title: design?.title ?? activeFile?.filename ?? null,
        // Selected-layer SVGs size themselves to their live bounding box.
        // Whole-screen exports prefer stored screen geometry over the iframe's
        // transient viewport so responsive/local-edit downloads keep the exact
        // authored frame dimensions.
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
      canvasFrameGeometryById,
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
      const geometry = canvasFrameGeometryById[targetFileId];
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
      canvasFrameGeometryById,
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
    async (settings?: Partial<ExportSettingsValue>) =>
      runDownloadSvg(
        {
          design,
          fallbackExportName,
          selectedElement,
          setSvgExporting,
          t,
          triggerBlobDownload,
        },
        settings,
      ),
    [
      design?.title,
      fallbackExportName,
      selectedElement,
      t,
      triggerBlobDownload,
    ],
  );

  /** Thumbnail for the inspector's export preview. Deliberately the same
   *  renderer the export itself uses, at scale 1 since it paints into a ~7rem
   *  box. Rejections propagate so the preview can show a failure. */
  const handleRenderExportPreview = useCallback(
    () => renderPngBlob({ scope: "element", settings: { scale: 1 } }),
    [renderPngBlob],
  );

  const handleInspectorExport = useCallback(
    async (settingsList: ExportSettingsValue[]) => {
      for (const settings of settingsList) {
        if (settings.format === "svg") {
          await handleDownloadSvg(settings);
        } else if (settings.format === "pdf") {
          await handleDownloadPdf(settings);
        } else if (settings.format === "jpg" || settings.format === "webp") {
          await handleDownloadPng(settings, settings.format);
        } else {
          await handleDownloadPng(settings);
        }
      }
    },
    [handleDownloadPdf, handleDownloadPng, handleDownloadSvg],
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
  const designShareTabLabelClassName =
    "inline-flex items-center justify-center gap-1.5";
  const designSharePopoverClassName =
    "z-[100010] !w-[min(620px,calc(100vw-32px))] !p-3 " +
    "[&_[role=tablist]]:!inline-flex [&_[role=tablist]]:!w-fit [&_[role=tablist]]:!self-start [&_[role=tablist]]:justify-start [&_[role=tablist]]:gap-1 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border [&_[role=tablist]]:border-[var(--design-editor-panel-divider-color)] [&_[role=tablist]]:bg-[var(--design-editor-panel-raised-bg)] [&_[role=tablist]]:p-1 " +
    "[&_[role=tab]]:!h-8 [&_[role=tab]]:!flex-none [&_[role=tab]]:rounded-md [&_[role=tab]]:px-3 [&_[role=tab]]:!text-[12px] [&_[role=tab]]:font-semibold [&_[role=tab]]:shadow-none [&_[role=tab]]:ring-0 " +
    "[&_[role=tab]:hover]:bg-white/70 dark:[&_[role=tab]:hover]:bg-[var(--design-editor-control-bg)] [&_[role=tab]:hover]:text-foreground " +
    "[&_[role=tab][aria-selected=true]]:bg-white dark:[&_[role=tab][aria-selected=true]]:bg-[var(--design-editor-control-bg)] [&_[role=tab][aria-selected=true]]:text-foreground [&_[role=tab][aria-selected=true]]:shadow-sm [&_[role=tab][aria-selected=true]]:ring-1 [&_[role=tab][aria-selected=true]]:ring-[var(--design-editor-control-border)]";
  const designShareTabs = {
    shareLabel: (
      <span className={designShareTabLabelClassName}>
        <IconLink className="size-3.5" />
        {"Share link" /* i18n-ignore share tab label */}
      </span>
    ),
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: (
          <span className={designShareTabLabelClassName}>
            <IconFileExport className="size-3.5" />
            {t("designEditor.export")}
          </span>
        ),
        content: shareExportTab,
      },
      {
        value: "send",
        label: (
          <span className={designShareTabLabelClassName}>
            <IconTerminal2 className="size-3.5" />
            {"Send to agent" /* i18n-ignore share tab label */}
          </span>
        ),
        content: shareSendToTab,
      },
      {
        value: "context",
        label: <span className={designShareTabLabelClassName}>Context</span>,
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
    ],
  };

  useEffect(() => {
    if (viewMode === "overview" && !motionDockOpen) return;
    if (!activeFile || !activeContent.trim()) return;
    const stamped = ensureCodeLayerNodeIdsInHtml(activeContent, {
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
  // ── Code-layer models and effective layer state ────────────────────────────
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
    runtimeOnly: boolean;
    tree: CodeLayerTreeNode[];
    nodeById: Map<string, CodeLayerNode>;
  };
  const codeLayerModelCacheRef = useRef<Map<string, CodeLayerFileModel>>(
    new Map(),
  );
  const codeLayerModelsArrayRef = useRef<CodeLayerFileModel[]>([]);
  const codeLayerModelsByFile = useMemo(() => {
    const cache = codeLayerModelCacheRef.current;
    const liveFileIds = new Set(files.map((file) => file.id));
    const models = files.map((file): CodeLayerFileModel => {
      const sourceProjection =
        getCodeLayerProjectionForScreen(file.id) ??
        buildCodeLayerProjection(getProjectionContentForScreen(file.id));
      const runtimeSnapshot = runtimeLayerSnapshotsById[file.id];
      const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
        screen: overviewScreenById.get(file.id),
        fallbackSourceType: designSourceType,
        // Eligibility follows the persisted route URL, not `content`: the
        // active projection content may already be an SSR HTML snapshot.
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
      const cached = cache.get(file.id);
      if (
        cached &&
        cached.projection === projection &&
        cached.sourceProjection === sourceProjection &&
        cached.runtimeOnly === useRuntimeProjection
      ) {
        return cached;
      }
      const tree = useRuntimeProjection
        ? buildCodeLayerTree(projection)
        : file.id === activeFile?.id
          ? activeCodeLayerTree
          : buildCodeLayerTree(projection);
      const model: CodeLayerFileModel = {
        fileId: file.id,
        projection,
        sourceProjection,
        runtimeOnly: useRuntimeProjection,
        tree,
        nodeById: new Map(projection.nodes.map((node) => [node.id, node])),
      };
      cache.set(file.id, model);
      return model;
    });
    for (const fileId of cache.keys()) {
      if (!liveFileIds.has(fileId)) cache.delete(fileId);
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
    designSourceType,
    files,
    getCodeLayerProjectionForScreen,
    getProjectionContentForScreen,
    getRuntimeCodeLayerProjection,
    overviewScreenById,
    runtimeLayerSnapshotsById,
  ]);
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
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >();
    codeLayerModelsByFile.forEach((model) => {
      // BUG-LAYER-STATE-RUNTIME-ONLY: model.runtimeOnly only says the Layers
      // panel is DISPLAYING the runtime-derived tree for this screen — it
      // says nothing about whether any given NODE actually lacks a
      // resolvable source counterpart. See isCodeLayerNodeRuntimeOnly's doc
      // comment for why every lock/hide/group/reparent call site downstream
      // needs the narrower per-node signal instead.
      const sourceNodeIdAttrs = new Set(
        model.sourceProjection.nodes
          .map((node) => node.dataAttributes["data-agent-native-node-id"])
          .filter((value): value is string => Boolean(value)),
      );
      model.projection.nodes.forEach((node) => {
        owners.set(node.id, {
          fileId: model.fileId,
          node,
          tree: model.tree,
          runtimeOnly: isCodeLayerNodeRuntimeOnly({
            fileIsRuntimeProjected: model.runtimeOnly,
            nodeIdAttr: node.dataAttributes["data-agent-native-node-id"],
            sourceNodeIdAttrs,
          }),
        });
      });
    });
    return owners;
  }, [codeLayerModelsByFile]);
  codeLayerOwnerByNodeIdRef.current = codeLayerOwnerByNodeId;
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
        // The optimistic override exists only until the connected source/HMR
        // snapshot confirms the durable JSX metadata. Once source and preview
        // agree, drop this axis so subsequent source edits remain authoritative.
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
  // PF8: getLayerSelectorsForFile is called once per rendered screen (both
  // in the hoisted renderScreenContent above and for the board-file props
  // below), and previously allocated a brand-new array every call even when
  // nothing relevant changed. Cache by fileId + a cheap signature of the
  // resolved selectors so unchanged calls return the same array identity,
  // letting DesignCanvas's own prop-diffing (or a future memo) bail.
  const layerSelectorsCacheRef = useRef<
    Map<
      string,
      { modelRef: unknown; layerIdsRef: Set<string>; value: string[] }
    >
  >(new Map());
  const getLayerSelectorsForFile = useCallback(
    (fileId: string, layerIds: Set<string>) => {
      const model = codeLayerModelByFileId.get(fileId);
      const cache = layerSelectorsCacheRef.current;
      const cached = cache.get(fileId);
      if (
        cached &&
        cached.modelRef === model &&
        cached.layerIdsRef === layerIds
      ) {
        return cached.value;
      }
      const fileLayerIds = layerStateIdsForScreen(layerIds, fileId);
      const selectors = Array.from(fileLayerIds)
        .flatMap((layerId) =>
          codeLayerSelectorAliases(model?.nodeById.get(layerId)),
        )
        .filter(Boolean);
      if (fileLayerIds.has(fileId)) selectors.push("body");
      const value = Array.from(new Set(selectors));
      cache.set(fileId, { modelRef: model, layerIdsRef: layerIds, value });
      return value;
    },
    [codeLayerModelByFileId],
  );
  const visualScreenFileIds = useMemo(
    () => new Set(overviewScreens.map((screen) => screen.id)),
    [overviewScreens],
  );
  // One bottom-to-top screen stack owns both canvas paint order (`geometry.z`)
  // and the Layers file rows. LayersPanel reverses each sibling group for its
  // topmost-first display, so feed it this canonical bottom-to-top sequence.
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

  // ── Layer panel model and selection sync ───────────────────────────────────
  // Board objects shown as top-level peer rows in the layers panel, right
  // alongside the screen frames. Derived from the same code-layer model that
  // feeds codeLayerOwnerByNodeId so a layer-row click resolves to the board
  // file (sets it active + selects the element). buildCodeLayerProjection was
  // the wrong source here: it produced different node ids that the owner map
  // could not route, and returned no roots for the migrated board fragments.
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
    if (selectedElementLayerId && !filtered.includes(selectedElementLayerId)) {
      if (filtered.length > 1) return [...filtered, selectedElementLayerId];
      return [selectedElementLayerId];
    }
    return filtered;
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
  const selectedUrlSelectionId = useMemo(
    () =>
      selectedElementLayerId ??
      [...selectedLayerIds]
        .reverse()
        .find((layerId) => codeLayerOwnerByNodeId.has(layerId)) ??
      null,
    [codeLayerOwnerByNodeId, selectedElementLayerId, selectedLayerIds],
  );

  // Item 4 (deferred) — GlslShaderPanel's "Edit code" affordance
  // (EditPanelProps.onEditCode → glslShaderContext.onEditCode). Opens the
  // left Code panel focused on the active screen's file, reusing the SAME
  // workbench navigation state the `navigate --leftPanel code --fileId <id>`
  // action command drives: setting `activeLeftPanel` makes the panel visible
  // immediately, and writing the URL's `panel`/`fileId` search params (via
  // getDesignEditorStateUrlSearch, the same builder the URL-sync effect near
  // `activeCodeFile` uses) seeds CodeWorkbench's initial-focus props
  // (`activeFileId`/`activeFilename`, read from `routeCodeFileId`/
  // `routeCodeFilename` — see those consts) so it opens the right file on
  // first mount instead of falling back to whatever tab was last open.
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
      navigate(
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
    if (
      selectedUrlSelectionId &&
      selectedUrlSelectionId !== initialRouteSelectionId
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const owner = codeLayerOwnerByNodeId.get(initialRouteSelectionId);
    if (!owner) return;
    // Interact owns the running app and must not hydrate a host-editor
    // selection that switches the shell back to Edit on the focused screen.
    if (viewModeRef.current === "single") {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }
    const selectionBlocked =
      effectiveCodeLayerState.lockedIds.has(owner.fileId) ||
      effectiveCodeLayerState.hiddenIds.has(owner.fileId) ||
      effectiveCodeLayerState.lockedIds.has(initialRouteSelectionId) ||
      effectiveCodeLayerState.hiddenIds.has(initialRouteSelectionId);
    if (
      activeFileId === owner.fileId &&
      selectedLayerIds.includes(initialRouteSelectionId) &&
      (selectionBlocked || selectedElementLayerId === initialRouteSelectionId)
    ) {
      initialUrlSelectionHydratedForIdRef.current = id;
      return;
    }

    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    setCreatedOverviewLayerSelection(null);
    setActiveFileId(owner.fileId);
    setSelectedLayerIdsState([initialRouteSelectionId]);
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
  ]);

  useEffect(() => {
    if (!id || files.length === 0) return;
    if (
      initialRouteScreenTarget &&
      !findDesignFileByScreenTarget(files, initialRouteScreenTarget) &&
      !activeFileId
    ) {
      return;
    }
    const preserveInitialRouteSelection = Boolean(
      initialRouteSelectionId &&
      initialUrlSelectionHydratedForIdRef.current !== id &&
      initialRouteSelectionId !== selectedUrlSelectionId &&
      codeLayerOwnerByNodeId.size === 0,
    );
    const nextSearch = getDesignEditorStateUrlSearch({
      currentSearch: location.search,
      viewMode,
      screenId: activeFile?.id ?? activeFileId,
      leftPanel: activeLeftPanel,
      codeFileId: activeLeftPanel === "code" ? activeCodeFile?.fileId : null,
      codeFilename: activeLeftPanel === "code" ? activeCodeFile?.path : null,
      selectionId:
        selectedUrlSelectionId ??
        (preserveInitialRouteSelection ? initialRouteSelectionId : null),
      zoom,
      tool: activeTool,
      mode,
    });
    if (nextSearch === location.search) return;
    // Item 11 (URL sync): `zoom` is a dependency here, and zoom changes
    // continuously (every wheel/pinch tick, not just on gesture-end) — every
    // tick previously called `navigate(..., {replace:true})` synchronously,
    // spamming history.replaceState and re-rendering every `useLocation()`
    // consumer (this whole page, since DesignCanvas below isn't memoized)
    // once per tick. Coalesce rapid-fire ticks into a single navigate call
    // per short window instead of one per state change; the URL is a
    // shareable-link mirror of UI state, not a live gesture-preview surface,
    // so a small trailing delay is invisible to the user but eliminates the
    // churn during continuous zoom/drag.
    if (urlSyncTimerRef.current !== null) {
      window.clearTimeout(urlSyncTimerRef.current);
    }
    urlSyncTimerRef.current = window.setTimeout(() => {
      urlSyncTimerRef.current = null;
      navigate(
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
    initialRouteScreenTarget,
    initialRouteSelectionId,
    selectedUrlSelectionId,
    mode,
    viewMode,
    zoom,
  ]);

  const selectedLayerTargets = useMemo<SelectedLayerTarget[]>(
    () =>
      selectedLayerIds
        .map((layerId) => {
          const owner = codeLayerOwnerByNodeId.get(layerId);
          if (!owner) return null;
          const selectedMatches =
            selectedElement &&
            codeLayerNodeMatchesBridgeTarget(
              owner.node,
              selectedElement.selector,
              selectedElement.sourceId ?? selectedElement.id,
            );
          return {
            layerId,
            fileId: owner.fileId,
            node: owner.node,
            tree: owner.tree,
            elementInfo: selectedMatches
              ? canonicalElementInfoForCodeLayerNode(
                  selectedElement,
                  owner.node,
                )
              : elementInfoFromCodeLayerNode(owner.node),
          };
        })
        .filter((target): target is SelectedLayerTarget => Boolean(target)),
    [codeLayerOwnerByNodeId, selectedElement, selectedLayerIds],
  );

  useLayoutEffect(() => {
    selectedLayerTargetsRef.current = selectedLayerTargets;
  }, [selectedLayerTargets]);

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
      // Inspector geometry is selection-driven, never active-file-driven.
      // `selectedScreenIds` deliberately falls back to activeFile for agent
      // context/navigation, but feeding that fallback into the inspector made
      // a cleared selection immediately reappear as the active screen. That
      // broke Figma's Escape semantics and made Page properties unreachable.
      selectedScreenIds:
        viewMode === "overview" ? overviewSelectedScreenIds : [],
      overviewScreens,
      canvasFrameGeometryById,
    });
  }, [
    canvasFrameGeometryById,
    overviewSelectedScreenIds,
    overviewScreens,
    selectedInspectorElements.length,
    viewMode,
  ]);

  /** Applies a typed or preset frame size/position from the inspector. Routed
   *  through handleGeometryCommit so it lands in the same undo entry, viewport
   *  metadata sync, and persist guard that a pointer resize uses. */
  /** Design-level canvas background (the surround, not a screen's body). */
  // ── Canvas background, screen geometry, states panel ───────────────────────
  const persistedCanvasBackground = useMemo(
    () => getDesignCanvasBackground(designDataJson),
    [designDataJson],
  );
  /** Live value while the colour picker is being dragged. Persisting every
   *  preview tick round-trips through the query cache and back into the
   *  controlled picker, which makes its handle jump mid-drag. */
  const [canvasBackgroundDraft, setCanvasBackgroundDraft] = useState<
    string | null
  >(null);
  const canvasBackground = canvasBackgroundDraft ?? persistedCanvasBackground;
  const handleCanvasBackgroundChange = useCallback(
    (value: string, meta?: { phase?: "preview" | "commit" }) => {
      if (!id || !canEditDesignRef.current) return;
      if (meta?.phase === "preview") {
        // Paint the canvas live, but do not touch persisted state yet.
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
      // Same fallback getSelectedScreenGeometryForInspector displays, or a
      // screen with no canvasFrames entry gets fields whose edits do nothing.
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
            ? { width: Math.max(MIN_FRAME_SIZE_PX, next.width) }
            : {}),
          ...(next.height !== undefined
            ? { height: Math.max(MIN_FRAME_SIZE_PX, next.height) }
            : {}),
        },
      };
      handleGeometryCommit(before, after);
    },
    [canvasFrameGeometryById, handleGeometryCommit, overviewScreens],
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
    setSelectedElement(elementInfoFromCodeLayerNode(owner.node));
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
    // Only clear selection when the element (or its file) becomes LOCKED.
    // Hidden layers keep their selection so the layer panel still shows it,
    // and unlocking a layer must not accidentally deselect it.
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
    if (builderPreviewUrl) return builderPreviewUrl;
    const screen = overviewScreens.find((item) => item.id === activeFile?.id);
    return (
      screen?.url ||
      screen?.previewUrl ||
      externalPreviewUrlForContent(activeContent)
    );
  }, [activeContent, activeFile?.id, builderPreviewUrl, overviewScreens]);

  // §6.4 / §8 — Breakpoints list for the StatesPanel, derived from
  // designs.data.breakpointSet. Returns a stable empty array when none are set.
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

  // Active breakpoint id for the StatesPanel — "auto" when no frame is focused.
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

  // PF8: hoisted EditPanel callback props. These were previously inline
  // arrows created fresh on every DesignEditor render, which defeats any
  // memoization EditPanel does internally on its own prop identities.

  const handleStatesPanelBreakpointSelect = useCallback(
    (breakpointId: string) => {
      // "auto" = clear the active breakpoint (overview).
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
    // Delegate to the MultiScreenCanvas affordance by navigating to overview
    // where the "+" button lives.
    if (viewMode !== "overview") {
      // Keep the eager ref in lockstep with the state write — every other
      // view switch in this file pairs these (see enterSingleScreen /
      // enterOverviewFromZoom); leaving the ref stale here opens the same
      // stale-viewModeRef window behind the zoom-preset-in-single-view bug.
      viewModeRef.current = "overview";
      setViewMode("overview");
    }
  }, [viewMode]);

  const statesPanelProps = useMemo(() => {
    if (!id) return undefined;
    return {
      // §6.4 / §8 — active state and breakpoint wired into the StatesPanel
      // so selection is agent-visible.
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

  // ── Preview, publish waitlist, gradient, interaction states ────────────────
  const handleOpenDesignPreview = useCallback(() => {
    if (activeScreenPreviewUrl) {
      window.open(activeScreenPreviewUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const content = activeContent.trim();
    if (!content) return;

    const blobUrl = URL.createObjectURL(
      new Blob([fullPreviewHtml(activeContent)], { type: "text/html" }),
    );
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }, [activeContent, activeScreenPreviewUrl]);

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
  // PF8: MultiScreenCanvas prop — a fresh array here every render would defeat
  // React.memo(MultiScreenCanvas) even when the id itself is unchanged.
  const fullViewScreenIds = useMemo(
    () =>
      selectedElementFullViewScreenId ? [selectedElementFullViewScreenId] : [],
    [selectedElementFullViewScreenId],
  );

  /**
   * On-canvas gradient-edit handles (Figma parity) for a whole selected
   * SCREEN FRAME's own background fill — the "page defaults" case in
   * EditPanel (no DOM child selected, so EditPanel shows `pageStyles` and
   * `handleStyleChange` defaults its selector to "body").
   *
   * Scope note / known gap: this only covers a single selected overview
   * screen frame. It does NOT cover BOARD/DRAFT primitive fills — draft
   * primitive selection (`selectedDraftIds`) is internal state inside
   * MultiScreenCanvas and is not exposed as a prop, so DesignEditor has no
   * id to key a draft's gradientEditTarget on. It also doesn't gate on
   * "the fill color-picker popover is specifically open" — EditPanel/
   * DesignColorPicker expose no popover-open or live-paint-type signal
   * (StyleChangeMeta is just `{ phase }`, and the file-level
   * `inspectorPopoverOpen` flag fires for ANY Radix popover in the editor,
   * not specifically the color picker's gradient tab — using it here would
   * make gradient handles spuriously appear while e.g. the export or
   * alignment popovers are open). Instead this derives directly from the
   * frame's OWN resolved background-image value: whenever the single
   * selected screen's background is a linear-gradient, handles show;
   * whenever it isn't (solid color, image, none), they don't. See the
   * `gradientEditTarget` doc on MultiScreenCanvas and `GradientEditSessionTarget`
   * in inspector/GradientEditor.tsx for the fuller contract this partially
   * implements, and the follow-up note where this prop is passed below for
   * the exact EditPanel/DesignColorPicker changes needed to close the gap.
   */
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

  // Item 8 — in-screen gradient-edit handles: extends the derivation above
  // to a real DOM element SELECTED INSIDE a screen (not a board/draft
  // primitive or the screen-frame's own background, which the
  // gradientEditTarget/pageStyles case above already covers — the screen
  // ROOT element is excluded here via isScreenRootElementInfo the same way
  // handleScreenElementSelect already treats it as the "page defaults"
  // case). MultiScreenCanvas has no chrome for a node inside iframe
  // content, so instead of an overlay target this resolves the owning
  // screen id + node id and is forwarded into that screen's DesignCanvas
  // as a `gradientEditTarget` PROP (see DesignCanvas's gradient-edit-target/
  // gradient-edit-clear postMessage sync effect) so the editor-chrome
  // bridge itself draws the handles over the in-iframe element.
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
  const inScreenGradientEditCssValue =
    inScreenGradientEditNodeId &&
    selectedElement?.computedStyles.backgroundImage
      ?.trim()
      .startsWith("linear-gradient(")
      ? selectedElement.computedStyles.backgroundImage
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
  // Preview/commit phases map onto the same gesture-coalescing conventions
  // handleStyleChange already applies for drag-style edits (PF12 — preview
  // ticks skip the expensive commit path via meta.phase; the same fallback
  // "commit" default matches how bare handleStyleChange calls with no meta
  // are already treated as an immediate commit elsewhere in this file).
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
  // Interaction-state forced preview (phase 2) — same screen/node resolution
  // as inScreenGradientEditScreenId/NodeId above (the selected element's
  // owning screen, whether in single-screen or overview mode), but gated on
  // `activeInteractionStateState` (EditPanel's InteractionStatePanel
  // selection) instead of a gradient fill. `null` whenever there's no
  // non-default state active OR no single-element selection with a stable
  // node id — EditPanel itself only shows the selector for a single
  // selection, so a multi-selection/no-selection here just means "nothing to
  // preview", not an error. Extracted as a standalone pure function
  // (deriveStatePreviewTarget) so the derivation the postMessage pipeline
  // depends on is directly unit-testable end-to-end without rendering the
  // whole editor — see DesignEditor.interactionStates.test.ts.
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
  // EditPanel resets its own interaction-state selector back to Default (and
  // calls this with `null`) whenever the SELECTION changes — see EditPanel's
  // matching effect keyed on `selectedElementKey`. Storing the mirror here is
  // enough to clear `statePreviewTarget` above on both a state change AND a
  // selection change, without DesignEditor needing its own separate
  // selection-change effect.
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

  // Detect if the active screen is a localhost/local source so we can show a banner.
  const activeScreenIsLocalSource =
    Boolean(activeFile) && activeOverviewScreen?.sourceType === "localhost";
  const activeScreenRouteSourceFile = activeScreenIsLocalSource
    ? getLocalhostRouteSourceFile({
        sourceFile: activeOverviewScreen?.sourceFile,
        source: activeOverviewScreen?.source,
      })
    : undefined;
  // Connection id for the active localhost screen — needed to mint write grants.
  const activeLocalhostConnectionId = activeScreenIsLocalSource
    ? ((activeOverviewScreen as { connectionId?: string } | undefined)
        ?.connectionId ?? "")
    : "";

  // Fetch the connected roots used by every localhost screen. Besides the
  // consent dialog, this lets React debug provenance such as /@fs/ absolute
  // paths be reduced to safe project-relative source anchors before the
  // semantic coding-agent handoff. The ref is read by gesture callbacks above
  // without making root-path hydration part of their render identity.
  const { data: activeLocalhostConnectionResult } = useActionQuery<{
    connections?: Array<{ id: string; rootPath?: string | null }>;
  }>(
    "list-localhost-connections",
    {},
    {
      enabled: overviewScreens.some(
        (screen) => screen.sourceType === "localhost" && screen.connectionId,
      ),
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

  /**
   * Request consent to write a local file for the active localhost screen.
   * If no valid grant exists, opens the consent dialog; once granted the
   * caller should proceed to call write-local-file via the action surface.
   *
   * Only works when the active screen is localhost-backed and the current user
   * has editor access. For non-localhost screens use the normal Ask-AI path.
   *
   * The files parameter is for display in the consent dialog only; the actual
   * write must be performed by the caller via the write-local-file action.
   */
  // ── Localhost write and apply-to-source ────────────────────────────────────
  const requestLocalhostWrite = useCallback(
    (opts: {
      files: string[];
      onGranted: LocalhostWriteConsentPayload["onGranted"];
      onCancel?: () => void;
    }) => {
      if (!id || !canEditDesign) return;
      // VE7: surface why the write can't proceed instead of silently no-oping
      // when the active screen has no resolvable localhost connection.
      if (!activeLocalhostConnectionId) {
        toast.error(NO_LOCALHOST_CONNECTION_MESSAGE);
        return;
      }

      // Prefer the connection's actual stored rootPath (a real folder path)
      // for display in the consent dialog. Fall back to the resolved source
      // file path, and only fall back to the raw connection id — which is an
      // opaque UUID, not a folder — if neither is available.
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
  // requestLocalhostWrite is consumed via the component instance or by
  // connected inspector components; not all render paths call it directly.
  void requestLocalhostWrite;

  // Localhost workspace roots for the code workbench: one per distinct
  // connection referenced by this design's localhost-backed screens.
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

  // "Add screen" for a localhost-sourced design offers a route picker instead
  // of a blank artboard — see AddLocalhostScreenDialog.
  const [addLocalhostScreenOpen, setAddLocalhostScreenOpen] = useState(false);
  const addLocalhostScreenConnectionId =
    activeLocalhostConnectionId ||
    workbenchLocalhostConnections[0]?.connectionId;
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

  // Consent round trip for code-workbench saves to local files: opens the
  // shared write-consent dialog and retries the save once granted.
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

  /**
   * Derive a relative file path from the active localhost screen.
   * Prefers `sourceFile` (the build-output relative path recorded at connect
   * time) over the URL pathname so the path maps to the actual file on disk.
   * Returns undefined when no usable path can be determined.
   */
  const activeLocalhostRelPath = useMemo<string | undefined>(() => {
    if (!activeScreenIsLocalSource) return undefined;
    // Prefer the explicit sourceFile (e.g. "src/index.html").
    const sf = activeScreenRouteSourceFile;
    if (sf?.trim()) return sf.trim();
    // Fall back to URL pathname (e.g. "/page.html" → "page.html").
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
  /** True when the active localhost screen maps to an HTML/CSS file we can write. */
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
  /**
   * True when the active localhost screen resolves to a compiled framework
   * route (.jsx/.tsx) — a real local source file exists, but we can't yet
   * write back to it (no build-time source mapping for a raw text write).
   * Used to show "Apply to source" as a disabled affordance with a tooltip
   * instead of hiding it outright, so users understand why it's unavailable.
   */
  const activeLocalhostRouteIsCompiledSource =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_COMPILED_SOURCE_EXTENSIONS.has(activeLocalhostWriteExtension);

  /**
   * Strip editor-only node-id attributes from HTML source so they are not
   * written back to the user's local file.
   *
   * Kept attributes (intentional user content):
   *   - data-agent-native-layer-name  (human-readable display name)
   *   - data-screen="…"               (prototype navigation)
   *   - any other data-* not listed below
   *
   * Stripped attributes (editor plumbing only):
   *   - data-agent-native-node-id     (stable selection id stamped by the editor)
   *   - data-code-layer-id            (alternative layer id for localhost components)
   */
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
      // Serialise back.  Use outerHTML of <html> to preserve doctype-less
      // fragments; for full documents prefer innerHTML wrapping.
      const doctype = doc.doctype
        ? new XMLSerializer().serializeToString(doc.doctype) + "\n"
        : "";
      const htmlEl = doc.documentElement;
      return doctype + htmlEl.outerHTML;
    } catch {
      // If DOMParser fails (e.g. malformed HTML) fall back to the raw content.
      return html;
    }
  }

  /**
   * "Apply to source" — write the current editor content back to the local
   * file via the bridge. Opens the consent dialog if no grant exists yet, then
   * calls write-local-file with a clean version of the editor content (editor-
   * only attribute stamps stripped).
   *
   * Only operates on HTML/CSS routes (gated by activeLocalhostRouteIsWritable).
   * For non-HTML routes (React/JSX/TS), keep routing to the agent chat instead.
   */
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

  // canGroup: 2+ DOM-node layers selected in the active screen (not file rows).
  const fileIdSet = new Set(files.map((f) => f.id));
  const selectedDomLayerIds = selectedLayerIds.filter(
    (id) => !id.startsWith("__") && !fileIdSet.has(id),
  );
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
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 2 &&
    selectedLayersUseCompatibleSourceBackend;
  // canUngroup: one or more DOM-node layers selected (L16: handleUngroupSelection
  // loops all selected containers), and EVERY selected layer must be a
  // container with at least one element child. L3: code-layer's applyUnwrap
  // now rejects leaf nodes (nothing to "release" as children — see the
  // unsupported-status branch in shared/code-layer.ts applyUnwrap), so the
  // menu item must be disabled when any selected leaf can't be ungrouped,
  // instead of enabling Ungroup for any selection and surfacing a failure
  // toast when it's clicked.
  const canUngroup =
    canEditDesign &&
    viewMode === "single" &&
    Boolean(activeFile) &&
    selectedDomLayerIds.length >= 1 &&
    selectedLayersUseCompatibleSourceBackend &&
    selectedDomLayerIds.every((id) => {
      const node = codeLayerOwnerByNodeId.get(id)?.node;
      return Boolean(node) && node!.children.length > 0;
    });

  // ── Layer move, rename, lock, and hide ─────────────────────────────────────
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
          lockedLayerIds,
          visualScreenFileIds,
        },
        intent,
      ),
    [
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      lockedLayerIds,
      visualScreenFileIds,
    ],
  );

  // L19: dropping a layer directly onto a file/screen row (which has no
  // code-layer owner — it isn't a DOM node) appends it at the end of that
  // screen's <body> instead of being silently rejected. Self-contained
  // handler kept separate from the main anchor-based handleLayerMove body
  // below (which is built entirely around resolving a code-layer anchor
  // node) to avoid threading a "no anchor" mode through that large function.
  const handleLayerMoveToScreen = useCallback(
    (intent: LayersPanelMoveIntent, targetFileId: string) =>
      runLayerMoveToScreen(
        {
          activeFile,
          applyFileContentUpdate,
          boardFileId,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
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
      activeFile?.id,
      applyFileContentUpdate,
      boardFileId,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      t,
    ],
  );

  const handleLayerMove = useCallback(
    (intent: LayersPanelMoveIntent) =>
      runLayerMove(
        {
          activeFile,
          applyFileContentUpdate,
          canEditDesign,
          canMoveLayer,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          getFreshActiveContent,
          handleLayerMoveToScreen,
          handleScreenLayerMove,
          recordContentHistoryEntry,
          recordLocalContentHistoryEntry,
          runtimeStructureMoveRevisionRef,
          sendRuntimeLayerMoveSemanticHandoff,
          setExpandedLayerIds,
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
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
      canMoveLayer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      getFreshActiveContent,
      handleLayerMoveToScreen,
      handleScreenLayerMove,
      recordContentHistoryEntry,
      recordLocalContentHistoryEntry,
      sendRuntimeLayerMoveSemanticHandoff,
      t,
      visualScreenFileIds,
    ],
  );

  const handleLayerHover = useCallback(
    (layerId: string) => {
      const owner = codeLayerOwnerByNodeId.get(layerId);
      if (!owner) return;
      // Match handleLayerSelectionChange: hover from the LayersPanel must
      // follow the hovered layer's owning screen even when it isn't the
      // active screen (overview mode shows layers from every screen), not
      // just silently no-op like the previous same-file-only guard did.
      setHoveredElement(elementInfoFromCodeLayerNode(owner.node));
      setHoveredElementScreenId(owner.fileId);
    },
    [codeLayerOwnerByNodeId],
  );

  const handleLayerLeave = useCallback((_layerId: string) => {
    setHoveredElement(null);
    setHoveredElementScreenId(null);
  }, []);

  const handleLayerSelectionChange = useCallback(
    (
      ids: string[],
      _intent: {
        additive: boolean;
        currentSelectedIds?: string[];
        id: string;
        range: boolean;
      },
    ) =>
      runLayerSelectionChange(
        {
          activeFile,
          clearPendingOverviewLayerSelectionTimer,
          codeLayerOwnerByNodeId,
          effectiveCodeLayerState,
          files,
          focusDesignInspectorForSelection,
          overviewSelectedScreenIds,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
          setActiveFileId,
          setActiveTool,
          setCreatedOverviewLayerSelection,
          setMode,
          setOverviewSelectedScreenIds,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          viewModeRef,
        },
        ids,
        _intent,
      ),
    [
      activeFile?.id,
      clearPendingOverviewLayerSelectionTimer,
      codeLayerOwnerByNodeId,
      effectiveCodeLayerState,
      files,
      focusDesignInspectorForSelection,
      overviewSelectedScreenIds,
    ],
  );

  const handleLayerMarqueeSelectionChange = useCallback(
    (
      selection: CanvasLayerMarqueeSelection[],
      intent: ElementSelectionIntent,
    ) =>
      runLayerMarqueeSelectionChange(
        {
          clearPendingOverviewLayerSelectionTimer,
          focusDesignInspectorForSelection,
          getCodeLayerProjectionForScreen,
          hasActiveSelectionRef,
          lastMarqueeSelectionSignatureRef,
          pendingOverviewLayerSelectionRef,
          pendingOverviewScreenSelectionRef,
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
      ),
    [
      clearPendingOverviewLayerSelectionTimer,
      focusDesignInspectorForSelection,
      getCodeLayerProjectionForScreen,
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
          additive: Boolean(
            intent?.additive ||
            intent?.range ||
            intent?.shiftKey ||
            intent?.metaKey ||
            intent?.ctrlKey,
          ),
          range: Boolean(intent?.range || intent?.shiftKey),
          source: "marquee",
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
    (layerId: string, name: string) =>
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
      ),
    [
      activeFile?.id,
      applyFileContentUpdate,
      canEditDesign,
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

  // Figma's Cmd+Shift+H / Cmd+Shift+L: toggle hide/lock for the CURRENT
  // selection — every selected layer/screen (selectedLayerIds already unifies
  // overview screen selection and single-screen layer selection into one
  // list), not just the single "active" one the context menu's toggle
  // buttons show a label for. The new state mirrors what that active item is
  // about to become (matches the context-menu label: Hide vs. Show / Lock vs.
  // Unlock) so a mixed selection converges to one consistent state per press.
  const handleToggleHiddenForSelection = useCallback(() => {
    if (!canEditDesign) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextHidden = !activeLayerHidden;
    targets.forEach((layerId) => handleToggleLayerHidden(layerId, nextHidden));
  }, [
    activeLayerHidden,
    canEditDesign,
    handleToggleLayerHidden,
    selectedLayerIds,
  ]);

  const handleToggleLockedForSelection = useCallback(() => {
    if (!canEditDesign) return;
    const targets = selectedLayerIds.length > 0 ? selectedLayerIds : [];
    if (targets.length === 0) return;
    const nextLocked = !activeLayerLocked;
    targets.forEach((layerId) => handleToggleLayerLocked(layerId, nextLocked));
  }, [
    activeLayerLocked,
    canEditDesign,
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
      // In single-screen mode the iframe is inside a scale(zoom/100) wrapper
      // that also centers the content. Using the iframe's own
      // getBoundingClientRect() already incorporates centering/pan because the
      // rect is measured in screen space after the CSS transform. Dividing by
      // the zoom factor converts from post-scale screen-pixels back to the
      // document coordinate space written into left/top by cloneHtmlLayerAtPosition.
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
      // Overview mode: fall back to container-relative coords (overview uses its
      // own coordinate mapping for paste; this value is a best-effort fallback).
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
    // A typed zoom % is an explicit destination, not a zoom-out gesture — see
    // suppressOverviewPopForExplicitZoomRef's doc comment.
    suppressOverviewPopForExplicitZoomRef.current = true;
    setZoom(clampZoom(next));
    setOpenZoomControl(null);
  }, [setZoom, zoomInputValue, zoomLabel]);

  // ── Design tokens ──────────────────────────────────────────────────────────
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

  // PF6: hoisted so MultiScreenCanvas's internal per-screen content memo
  // (keyed in part on this callback's identity) doesn't recompute every
  // screen's DesignCanvas on every unrelated DesignEditor render. Previously
  // this was an inline arrow passed straight to the renderScreenContent prop,
  // so it got a brand-new identity every render no matter what changed.
  type OverviewScreenRenderer = NonNullable<
    React.ComponentProps<typeof MultiScreenCanvas>["renderScreenContent"]
  >;
  type OverviewBreakpointRenderer = NonNullable<
    React.ComponentProps<typeof MultiScreenCanvas>["renderBreakpointContent"]
  >;
  type OverviewScreenRendererArgs = Parameters<OverviewScreenRenderer>;
  type OverviewBreakpointRendererArgs = Parameters<OverviewBreakpointRenderer>;
  // ── Render callbacks — route-refresh boundary ──────────────────────────────
  const renderEditableScreenContent = useCallback(
    (
      screen: OverviewScreenRendererArgs[0],
      metadata: OverviewScreenRendererArgs[1],
      geometry: OverviewScreenRendererArgs[2],
      breakpointFrame?: OverviewBreakpointRendererArgs[2],
    ) => {
      const breakpointWidthPx = breakpointFrame?.widthPx;
      const screenIsActive =
        screen.id === activeFile?.id &&
        (breakpointWidthPx === undefined
          ? activeBreakpointWidthState === undefined
          : activeBreakpointWidthState === breakpointWidthPx);
      const screenContent = getScreenContent(screen.id);
      const screenSourceType =
        normalizeDesignSourceType(screen.sourceType) ??
        metadata.source ??
        designSourceType;
      const screenBridgeUrl = screen.bridgeUrl;
      const screenPreviewToken =
        "previewToken" in screen && typeof screen.previewToken === "string"
          ? screen.previewToken
          : undefined;
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
          onRuntimeStructureInsertRejected={
            handleRuntimeStructureInsertRejected
          }
          runtimeVerificationRequest={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? {
                  requestId: runtimeStructureVerificationRequest.requestId,
                }
              : null
          }
          screenId={screen.id}
          previewFrameId={
            breakpointWidthPx === undefined
              ? undefined
              : getBreakpointIframeId(screen.id, breakpointWidthPx)
          }
          zoom={100}
          deviceFrame="none"
          sourceType={screenSourceType}
          bridgeUrl={screenBridgeUrl}
          connectionId={screen.connectionId}
          nativePreviewActive={screenIsActive}
          previewToken={screenPreviewToken}
          externalSnapshotHtml={screenSnapshot}
          onExternalContentSnapshot={(snapshot) =>
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
          onRuntimeVerificationSnapshot={
            runtimeStructureVerificationRequest?.screenIds.includes(screen.id)
              ? getRuntimeVerificationSnapshotCallback(screen.id)
              : undefined
          }
          fusionUrl={designFusionUrl}
          onComponentSourceJump={handleComponentSourceJump}
          motionTracks={screenIsActive ? motionTracksWire : []}
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
          editorChromeScaleX={overviewCanvasZoom / 100}
          editorChromeScaleY={overviewCanvasZoom / 100}
          editMode={mode === "edit"}
          interactMode={mode === "interact"}
          readOnly={!canEditDesign}
          scaleMode={screenIsActive && activeTool === "scale"}
          handToolActive={activeTool === "hand"}
          spacePanActive={spacePanActive}
          clearSelectionRequest={overviewClearSelectionRequest}
          registerRuntimeBridge={screenIsActive}
          selectedSelector={screenIsActive ? selectedCanvasSelector : null}
          selectedSelectorCandidates={
            screenIsActive ? selectedCanvasSelectorCandidates : []
          }
          selectedSelectorGroups={
            selectedLayerSelectorGroupsByScreen[screen.id] ?? []
          }
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
              : []
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
          onIframeContextMenu={handleIframeContextMenu}
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
          onVisualStructureChange={(
            selector,
            anchorSelector,
            placement,
            info,
            details,
          ) => {
            activateResponsiveScope();
            // Return the result so the bridge gets a real applied/false/pending
            // ack; without it a rejected drop could never roll back (undefined
            // !== false read as applied).
            return handleScreenVisualStructureChange(
              screen.id,
              selector,
              anchorSelector,
              placement,
              info,
              details,
            );
          }}
          onVisualDuplicateChange={(selector, cloneHtml, info, details) => {
            activateResponsiveScope();
            handleScreenVisualDuplicateChange(
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
          pinMode={false}
          commentPinsHidden
          designId={id}
          designTitle={design?.title}
          commentContextId={`${id}:${screen.id}`}
          commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(screen.filename)}`}
          repromptDraftRequest={
            repromptDraftRequest?.fileId === screen.id
              ? repromptDraftRequest
              : null
          }
          nodeRewriteCanvasTarget={
            screenIsActive && breakpointWidthPx === undefined
          }
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
      handleRuntimeStructureInsertRejected,
      runtimeStructureVerificationRequest,
      contentRenderRevision,
      handleScreenExternalContentSnapshot,
      getRuntimeLayerSnapshotCallback,
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
      canEditDesign,
      activeTool,
      spacePanActive,
      overviewClearSelectionRequest,
      selectedCanvasSelector,
      selectedCanvasSelectorCandidates,
      selectedLayerSelectorGroupsByScreen,
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
      repromptDraftRequest,
      handleRepromptDraftConsumed,
      t,
    ],
  );
  const renderScreenContent = useCallback<OverviewScreenRenderer>(
    (screen, metadata, geometry) =>
      renderEditableScreenContent(screen, metadata, geometry),
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
      ),
    [renderEditableScreenContent],
  );

  // ── Board element handlers ─────────────────────────────────────────────────
  // PF8: the board <DesignCanvas> callbacks below curry `boardFileId` into the
  // shared `handleScreen*` handlers. Previously these were inline arrows
  // built fresh on every MultiScreenCanvas render, which defeated
  // React.memo(MultiScreenCanvas) even when nothing else changed. Hoisting
  // them to useCallback keyed on boardFileId (already a stable useMemo
  // string) keeps identity stable across unrelated re-renders and only
  // changes when the board file itself changes.
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
    (selector, styles, info) => {
      if (!boardFileId) return;
      handleScreenVisualStyleChange(boardFileId, selector, styles, info);
    },
    [boardFileId, handleScreenVisualStyleChange],
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
      setSelectedLayerIdsState((current) =>
        computeOverviewScreenPickSelectionIds({
          pickedId,
          shiftKeyHeld: shiftKeyHeldRef.current,
          currentSelectedLayerIds: current,
        }),
      );
      setActiveFileId(pickedId);
      setActiveTool("move");
      setMode("edit");
      if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
    },
    [clearPendingOverviewLayerSelectionTimer, handleBreakpointBarSelect],
  );
  /** The one add-breakpoint path; every entry point must route through it,
   *  since the mutation is design-wide and widens every screen's row. Widths are
   *  derived on resolve and unioned with what is persisted — capturing them at
   *  call time makes concurrent adds under-measure the group. */
  // ── Breakpoint bar handlers and review feedback apply ──────────────────────
  const addDesignBreakpoint = useCallback(
    (widthPx: number, label?: string) => {
      if (!id) return;
      const resolvedLabel = label ?? breakpointLabelForWidth(widthPx);
      void addBreakpointMutation
        .mutateAsync({ designId: id, label: resolvedLabel, widthPx })
        .then(() => {
          const persisted = getDesignBreakpointWidths(
            designDataJsonRef.current,
          );
          reflowOverviewScreensForBreakpoints([
            ...new Set([...persisted, widthPx]),
          ]);
        });
    },
    [addBreakpointMutation, id, reflowOverviewScreensForBreakpoints],
  );
  const handleBreakpointBarAdd = useCallback(
    (widthPx: number, label: string) => addDesignBreakpoint(widthPx, label),
    [addDesignBreakpoint],
  );
  const handleBreakpointBarRemove = useCallback(
    (breakpointId: string) => {
      if (!id) return;
      const removed = designBreakpoints.find((b) => b.id === breakpointId);
      if (removed && removed.widthPx === activeBreakpointWidthState) {
        // Removing the active breakpoint resets the edit scope to base.
        setActiveBreakpointWidthState(undefined);
        // Item 9 — see handleBreakpointBarSelect's matching comment.
        lastAppliedActiveBreakpointIdRef.current = "auto";
        persistActiveBreakpoint("auto", responsiveEditScopeRef.current);
      }
      void removeBreakpointMutation.mutateAsync({ designId: id, breakpointId });
    },
    [
      id,
      designBreakpoints,
      activeBreakpointWidthState,
      removeBreakpointMutation,
      persistActiveBreakpoint,
    ],
  );
  // BP-DEEP v2 item 6 — "Change width" in the per-breakpoint "…" menu.
  // There is no update-breakpoint action, so a width change is expressed
  // through the existing action surface as add + (re-target) + remove
  // (breakpoint ids are width-derived definitions, not referenced by scoped
  // overrides — those are plain max-width media rules in the document, keyed
  // by px value).
  //
  // Order matters: ADD the new width first, re-target the active edit scope
  // to it if the changed breakpoint was active, and only THEN remove the old
  // breakpoint. This is deliberately the reverse of remove-then-add. Under
  // the old remove-first order, if the changed breakpoint was the active
  // edit target and the add failed (or was merely slow), edits stayed scoped
  // to an orphaned width — a @media bound that no longer existed as a
  // breakpoint, with no frame rendering it. Adding first means a failed add
  // aborts before anything is removed: the old breakpoint stays fully intact
  // (in the set and, if it was active, still targeted), so there is no
  // window where the edit scope points at a width with no backing
  // breakpoint. `add-breakpoint` silently ignores duplicate widths and
  // assigns the new breakpoint its own id, so there's no transient
  // duplicate-width conflict with the old breakpoint still present.
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
      const wasActive =
        activeBreakpointWidthStateRef.current === existing.widthPx;
      const label = breakpointLabelForWidth(widthPx);
      void (async () => {
        try {
          await addBreakpointMutation.mutateAsync({
            designId: id,
            label,
            widthPx,
          });
        } catch {
          // Add failed: abort before touching the old breakpoint. The old
          // width stays in the set and, if it was the active edit target,
          // stays targeted — no orphaned scope.
          return;
        }
        if (wasActive) handleBreakpointBarSelect(widthPx);
        try {
          await removeBreakpointMutation.mutateAsync({
            designId: id,
            breakpointId,
          });
        } catch {
          // The new width is already added (and, if applicable, already the
          // active target); the old breakpoint lingering in the set on a
          // failed remove is a harmless extra frame, not an orphaned scope.
          // Server state stays the source of truth; the design query refetch
          // reconciles it.
        }
      })();
    },
    [
      id,
      designBreakpoints,
      removeBreakpointMutation,
      addBreakpointMutation,
      handleBreakpointBarSelect,
    ],
  );

  /**
   * Adds a breakpoint to the DESIGN, not to one screen. A design has a single
   * active breakpoint set in v1, so every screen renders the same widths — the
   * old `(screenId, widthPx)` signature accepted a screen id it then ignored,
   * which is why adding a breakpoint "to a frame" silently applied it to all of
   * them. The parameter is gone so the call sites cannot imply scoping the
   * action does not have.
   */
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
      // Item 9 — see handleBreakpointBarSelect's matching comment.
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [id, designDataJson, persistActiveBreakpoint],
  );
  // STEVE TEST BATCH 3 item 8b — overview breakpoint frame "…" menu (Remove /
  // Change width) and full-view entry. Width-first, same convention as
  // onAddBreakpoint/onActiveBreakpointChange above: MultiScreenCanvas has no
  // per-screen breakpoint-id data (only widths, see ScreenFile.breakpointWidths),
  // so these resolve widthPx back to a breakpoint id and delegate to the SAME
  // handlers the inspector's BreakpointDeviceControl "…" menu already calls
  // (handleBreakpointBarRemove / handleBreakpointChangeWidth) — one design-wide
  // breakpoint set, so screenId is accepted but unused, same as
  // handleOverviewAddBreakpoint.
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
  // Full-view entry for one breakpoint: BreakpointPreviewRow's
  // activateThisFrame already calls onActiveBreakpointChange (which sets
  // activeBreakpointWidthState) BEFORE onEditBreakpoint fires (see the
  // frame's onDoubleClick/full-view-button handlers), so the active
  // breakpoint scope is already correct by the time this runs — this only
  // needs to enter single-screen mode for the right file, exactly like the
  // base frame's onEdit={enterSingleScreen}.
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

  // Hooks must not be called conditionally; keep navigate as an effect so the
  // render phase stays pure. This branch is unreachable in practice because the
  // design.$id.tsx route always supplies an id param.
  useEffect(() => {
    if (!id) navigate("/");
  }, [id, navigate]);

  // ── Early returns and derived render values ────────────────────────────────
  if (!id) return null;

  // A shell with no design yet is waiting for the host's `design:init`, not
  // looking at a design that does not exist.
  if (designLoading || (!design && (pendingGenerationActive || shellMode))) {
    return (
      <DesignEditorSkeleton
        embedded={embedded}
        pendingGeneration={pendingGenerationActive}
      />
    );
  }

  if (!design) {
    return (
      <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden bg-[var(--design-editor-canvas-bg)] px-6 py-12">
        <div
          aria-hidden="true"
          className="design-editor-not-found-grid absolute inset-0 opacity-60"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-[var(--design-editor-panel-divider-color)]"
        />
        <div className="relative flex w-full max-w-sm flex-col items-center text-center">
          <div className="mb-2 !text-[11px] font-medium uppercase text-muted-foreground">
            404
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {t("designEditor.notFound")}
          </h1>
          <Button
            asChild
            variant="default"
            className="mt-7 h-9 cursor-pointer gap-2 rounded-md border border-foreground bg-foreground px-3.5 text-background shadow-sm hover:border-foreground/90 hover:bg-foreground/90 hover:text-background focus-visible:ring-foreground"
          >
            <Link to="/">
              <IconArrowLeft className="size-4 rtl:-scale-x-100" />
              {t("designEditor.backToDesigns")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const questionFlowActive = pendingQuestionsVisible;

  // ── Header chrome fragments ────────────────────────────────────────────────
  // BP-DEEP v2 (items 4/6/7) — the unified breakpoint/device targeting
  // control. Replaces BOTH the old device-preview dropdown that used to live
  // in this header slot AND the floating/chrome-row BreakpointBar that used
  // to cover or displace the canvas: one segmented control (Base + each
  // breakpoint width + "+"), with a per-breakpoint "…" menu (change width /
  // remove). Segment clicks route through the same
  // handleBreakpointBarSelect scope-switching the old chips used.
  const deviceFrameControl = (
    <BreakpointDeviceControl
      breakpoints={designBreakpoints}
      activeWidthPx={activeBreakpointWidthState}
      baseWidthPx={activeScreenBaseWidthPx}
      canEdit={canEditDesign}
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
          <Link to="/">
            <IconArrowLeft className="mr-2 h-4 w-4" />
            {t("designEditor.backToDesigns")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setSaveTemplateOpen(true)}
          disabled={!canEditDesign || files.length === 0}
        >
          <IconTemplate className="mr-2 h-4 w-4" />
          {t("designEditor.saveAsTemplate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconFileExport className="mr-2 h-4 w-4" />
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
            <IconPencil className="mr-2 h-4 w-4" />
            {t("designEditor.modes.edit")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>
              {t("designEditor.undo")}
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>
              {t("designEditor.redo")}
              <DropdownMenuShortcut>
                {"⇧⌘Z" /* i18n-ignore keyboard shortcut */}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDuplicateSelection}
              disabled={!activeFile}
            >
              {"Duplicate" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDeleteSelection}
              disabled={!selectedElement && (!activeFile || files.length <= 1)}
            >
              {"Delete" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconLayoutGrid className="mr-2 h-4 w-4" />
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
          <IconPin className="mr-2 h-4 w-4" />
          {pinMode
            ? t("designEditor.stopPinningComments")
            : t("designEditor.pinComment")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleShowKeyboardShortcutsFromMenu}>
          <IconKeyboard className="mr-2 h-4 w-4" />
          {t("designEditor.keyboardShortcuts.title")}
          <DropdownMenuShortcut>
            {/* Control, not Command: ⌘⇧? is the macOS Help-menu shortcut and
                the browser consumes it before the page ever sees it. */}
            {"⌃⇧?" /* i18n-ignore keyboard shortcut */}
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
              <IconRocket className="mr-2 h-4 w-4" />
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

  // ── Zoom control, signed-out actions, node-rewrite control ─────────────────
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
            {"Cmd Plus" /* i18n-ignore shortcut key label */}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomOut}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom out" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            {"Cmd Minus" /* i18n-ignore shortcut key label */}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleZoomToFit}
          className="h-6 px-2 py-0 text-[12px]"
        >
          <span className="flex-1">{"Zoom to fit" /* i18n-ignore */}</span>
          <DropdownMenuShortcut className="tracking-normal">
            ⇧1
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {[50, 100, 200].map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => {
              // "Zoom to N%" is an explicit destination, not a zoom-out
              // gesture — see suppressOverviewPopForExplicitZoomRef's doc
              // comment. Without this, "Zoom to 50%" from the default 100%
              // single-view zoom crosses OVERVIEW_ZOOM_THRESHOLD (60) and the
              // edge-triggered pop-to-overview guard would kick the editor
              // back to overview instead of zooming the focused screen.
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
                ⌘0
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
            aria-label={t("designEditor.share")}
          >
            <a href={signInToShareHref}>
              <span>{t("designEditor.share")}</span>
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("designEditor.signUpToShare")}</TooltipContent>
      </Tooltip>
    </>
  );

  const pendingNodeRewriteCompact = rightSidebarWidth < 320;
  const pendingNodeRewriteLabel = t("designEditor.nodeRewrite.pendingReview", {
    count: pendingNodeRewriteProposals.length,
  });
  const pendingNodeRewriteButtonContent = (
    <>
      {!pendingNodeRewriteCompact ? (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
      <IconFileStack className="size-3.5 shrink-0" />
      {pendingNodeRewriteCompact ? (
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
    pendingNodeRewriteCompact
      ? "min-w-10 gap-1 px-1.5"
      : "max-w-44 gap-1.5 px-2",
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
        {pendingNodeRewriteCompact ? (
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
                {!pendingNodeRewriteCompact ? (
                  <IconChevronDown className="size-3 shrink-0 opacity-70" />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {pendingNodeRewriteCompact ? (
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

  // ── Right sidebar actions ──────────────────────────────────────────────────
  const rightSidebarActions = (
    <div className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-2 py-1.5">
      <div className="flex min-h-8 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {hostEmbeddedEditor ? null : (
            <DesignCollaboratorsMenu
              collaborators={designCollaborators}
              followingEmail={followingEmail}
              label={t("designEditor.collaborators")}
              onAvatarClick={handleAvatarClick}
            />
          )}
        </div>

        {/* Not shrink-0: the signed-out CTA ("Sign up free to save") is a
            nowrap label wide enough to push this row past the right rail's
            edge on its own, and a shrink-0 row has no way to give that space
            back — it just overflows the panel. */}
        <div className="flex min-w-0 shrink items-center gap-1">
          {pendingNodeRewriteControl}
          {canEditDesign && reviewAgentQueueCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 rounded-md px-2 text-xs"
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
                      "h-8 cursor-pointer gap-1 rounded-md px-2 text-foreground hover:bg-accent hover:text-foreground",
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
                      handleOpenDesignPreview();
                      setPublishWaitlistPopoverOpen(false);
                    }}
                    disabled={!activeScreenPreviewUrl && !activeContent.trim()}
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

          {hostEmbeddedEditor ? null : canRenderAuthenticatedShare ? (
            <ShareButton
              resourceType="design"
              resourceId={id}
              resourceTitle={design.title}
              hideTriggerIcon
              defaultOpen={shouldOpenShare}
              shareUrl={editorShareUrl}
              shareUrlLabel={t("designEditor.shareEditorLink")}
              shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
              roleCopy={{
                commenter: {
                  label: t("designEditor.commenterRoleLabel"),
                  description: t("designEditor.commenterRoleDescription"),
                },
              }}
              shareTabs={designShareTabs}
              popoverClassName={designSharePopoverClassName}
              triggerClassName="h-8 rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-3 text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
            />
          ) : sessionResolved ? (
            signedOutPersistenceActions
          ) : null}
        </div>
      </div>
      {activeScreenIsLocalSource &&
      viewMode === "single" &&
      activeScreenPreviewUrl ? (
        <div className="mt-1 flex min-w-0 items-center gap-1">
          <a
            href={activeScreenPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-[var(--design-editor-panel-raised-bg)] px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      className="size-7"
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
                    className="size-7"
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
      {/* BP-DEEP v2 items 4/6/7 — the unified breakpoint/device segmented
          control gets its own slim row under the actions row: it needs
          ~130px+ (growing with each breakpoint) and the actions row above
          (collaborators + play + share in a ~300px panel) cannot spare that
          without overlapping — squeezing both into one line collapsed the
          collaborators menu to a sliver behind the segments. */}
      {/* Zoom sits here rather than in the inspector tab row below: sharing
          that row truncated the "Comments" tab label at normal panel widths. */}
      <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {deviceFrameControl}
          {responsiveEditScopeControl}
        </div>
        <div className="shrink-0">{renderZoomControl("inspector")}</div>
      </div>
    </div>
  );

  const leftContentWidth =
    activeLeftPanel === "code"
      ? Math.max(leftSidebarWidth, 640)
      : Math.max(Math.min(leftSidebarWidth, 420), 220);
  const routeCodeFileId =
    activeLeftPanel === "code" ? searchParams.get("fileId") : null;
  const routeCodeFilename =
    activeLeftPanel === "code" ? searchParams.get("filename") : null;
  // Both inspector mounts (desktop rail, mobile sheet) take an identical prop
  // set; only `width` differs. One shared object keeps a prop added here from
  // silently reaching just one of them.
  const editPanelProps = {
    selectedElement,
    readOnly: !canEditDesign,
    selectedElements: selectedInspectorElements,
    selectedScreenGeometry,
    canvasBackground,
    onCanvasBackgroundChange: canEditDesign
      ? handleCanvasBackgroundChange
      : undefined,
    onScreenGeometryChange: canEditDesign
      ? handleScreenGeometryChange
      : undefined,
    pageStyles,
    files: documentColorFiles,
    activeTool,
    onCreateScreenFromPreset: canEditDesign
      ? handleCreateScreenFromPreset
      : undefined,
    zoom,
    activeTab: activeInspectorTab,
    onActiveTabChange: setActiveInspectorTab,
    tweaks,
    tweakValues: tweakSelections,
    activeContent,
    pendingInteractionStateStyles: pendingInspectorInteractionStateStyles,
    activeFileUpdatedAt: activeFile?.updatedAt ?? null,
    componentSwapPickerRequest,
    onComponentPropApplied: handleComponentPropApplied,
    onTweakChange: handleTweakChange,
    onRequestTweaks: handleRequestTweaks,
    onStyleChange: handleStyleChange,
    onStylesChange: handleStylesChange,
    motionKeyframeState,
    onToggleMotionKeyframe: canEditDesign
      ? handleToggleMotionKeyframe
      : undefined,
    breakpointContext,
    onExport: handleInspectorExport,
    onRenderExportPreview: handleRenderExportPreview,
    exporting: pngExporting || svgExporting,
    designId: id,
    fileId: activeFile?.id,
    componentNodeId: selectedComponentNodeId,
    sourceCapabilities,
    selectedElementAlreadyComponent,
    onCreateComponent:
      id && selectedElement && !selectedElementAlreadyComponent
        ? handleCreateComponent
        : undefined,
    defaultComponentName,
    inspectCode: inspectCodeData,
    statesPanelProps,
    reviewPanelProps: resolvedReviewPanelProps,
    reviewCommentsPanelProps,
    reviewCommentsCount: reviewOpenCount,
    onAlignSelection: canEditDesign ? handleAlignSelection : undefined,
    onDisableAutoLayout: canEditDesign ? handleDisableAutoLayout : undefined,
    onInteractionStateChange: handleInteractionStateChange,
    onEditCode: handleShaderEditCode,
  };

  return (
    // h-full not flex-1: the parent <main> uses overflow-y-auto, not flex,
    // so flex-1 on the child doesn't resolve to the available height. h-full
    // works because main itself has a definite height (flex-1 inside a
    // flex-col page shell). Without this the canvas collapses to ~150px.
    <div className="h-full flex flex-col overflow-hidden bg-[var(--design-editor-canvas-bg)]">
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
        {!hostOwnsChrome && !uiHidden ? (
          <div className="relative flex min-h-0 shrink-0 bg-[var(--design-editor-panel-bg)]">
            <DesignWorkspaceRail
              activePanel={activeLeftPanel}
              disabledPanels={
                initialGenerationChromeLimited
                  ? INITIAL_GENERATION_DISABLED_LEFT_PANELS
                  : undefined
              }
              motionOpen={motionDockOpen}
              motionDisabled={!activeFile}
              projectMenu={hostEmbeddedEditor ? null : projectMenu}
              onMotionToggle={() => setMotionDockOpenAnimated(!motionDockOpen)}
              onPanelChange={setActiveLeftPanel}
            />
            <div
              ref={leftSidebarContentRef}
              className="flex min-h-0 max-w-[calc(100dvw-57px)] shrink-0 flex-col border-r border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] transition-[width] duration-150 ease-out md:max-w-none"
              style={{ width: leftContentWidth }}
            >
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "file" ? "flex" : "hidden",
                )}
              >
                <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3">
                  {projectTitleControl}
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
                        : undefined
                    }
                    layers={
                      viewMode === "overview"
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
                    onSelectionChange={handleLayerSelectionChange}
                    onRename={handleLayerRename}
                    onToggleLocked={handleToggleLayerLocked}
                    onToggleHidden={handleToggleLayerHidden}
                    onHoverLayer={handleLayerHover}
                    onLeaveLayer={handleLayerLeave}
                    onMoveLayer={handleLayerMove}
                    canMoveLayer={canMoveLayer}
                    boardElements={
                      viewMode === "overview" ? boardElements : undefined
                    }
                    hoveredLayerId={hoveredCodeLayerNode?.id ?? null}
                    onCopyLayer={() => handleCopySelection()}
                    onDuplicateLayer={() => handleDuplicateSelection()}
                    onDeleteLayer={() => handleDeleteSelection()}
                    onGroupSelection={() => handleGroupSelection()}
                    onUngroupSelection={() => handleUngroupSelection()}
                    onReorderLayer={(_ids, direction) =>
                      changeSelectedZIndex(direction)
                    }
                    onPasteToReplace={() => handlePasteToReplace()}
                    onFrameSelection={() => handleFrameSelection()}
                    onFlipHorizontal={() => handleFlipHorizontal()}
                    onFlipVertical={() => handleFlipVertical()}
                  />
                </div>
              </div>
              <div
                data-design-agent-panel
                className={cn(
                  "min-h-0 flex-1 flex-col overflow-hidden",
                  activeLeftPanel === "agent" ? "flex" : "hidden",
                )}
              >
                {hostEmbeddedEditor ? (
                  <div ref={attachHostChatSlot} className="min-h-0 flex-1" />
                ) : canEditDesign ? (
                  <AgentChatSurface
                    mode="panel"
                    className="min-h-0 flex-1 border-0 bg-transparent shadow-none"
                    storageKey={DESIGN_CHAT_STORAGE_KEY}
                    emptyStateText={t("chat.emptyState")}
                    suggestions={[
                      t("chat.suggestionLandingPage"),
                      t("chat.suggestionBrandMatch"),
                      t("chat.suggestionMobile"),
                    ]}
                    scope={designChatScope}
                    showScopeBadge={false}
                    showHeader={false}
                    showTabBar={false}
                    browserTabId={browserTabId}
                    onComposerTextChange={handleComposerTextChange}
                    composerSlot={
                      detectedFigmaComposerLink ? (
                        <FigmaLinkComposerBubble
                          link={detectedFigmaComposerLink}
                          designId={id}
                        />
                      ) : null
                    }
                  />
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
                  <div className="flex min-h-8 shrink-0 items-center border-b border-border/60 px-3">
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
                        setFigmaHydrationFileIds(result.files.map((f) => f.id));
                        setFigmaHydrationImageCount(count);
                        setFigmaHydrationOpen(true);
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
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("layersPanel.title")}
              className="absolute right-[-2px] top-0 z-[80] h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--design-editor-selection-color)]"
              onPointerDown={(event) => startSidebarResize("left", event)}
            />
          </div>
        ) : null}

        {/* Interact owns the running app's surface (same reasoning as the
            Escape hotkey gate): its canvas tools and mode tabs belong to the
            infinite canvas, and ResponsiveInteractBar's Close is the way
            back. */}
        {!hostOwnsChrome &&
          !uiHidden &&
          !responsiveInteractActive &&
          designBottomToolbarMode === "editor" &&
          activeFile &&
          !questionFlowActive && (
            <DesignBottomToolbar
              mode={mode}
              pinMode={pinMode}
              drawMode={drawMode}
              activeTool={activeTool}
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
          /* Panel background, not canvas: these are the agent's own follow-up
             questions, and on the canvas grey they read as an unrelated object
             parked beside the chat rather than a continuation of it. */
          <div className="relative mx-1 h-full min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--design-editor-panel-bg)]">
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
              if (!open) setCanvasLayerHitCandidates([]);
              if (open) void refreshClipboardFromSystemClipboard();
            }}
            canPasteHere={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canSelectAll={files.length > 0}
            canZoomToFit={Boolean(activeFile)}
            canZoomToSelection={Boolean(
              selectedElement || selectedScreenIds.length > 0,
            )}
            // handleCopySelection (wired to onCopy/onCopyAsCode below) falls
            // back to whole-screen clipboard snapshots when there's no deeper
            // layer selection (see its "Whole-screen copy (U6)" branch), so a
            // selected-screens-only selection is a real, supported copy
            // target — not just an element selection (mirrors canDelete's
            // pattern just below).
            canCopy={Boolean(
              selectedElement?.selector || selectedScreenIds.length > 0,
            )}
            canPaste={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            canPasteOver={
              canEditDesign && hasCanvasClipboard && Boolean(activeFile)
            }
            // Figma: Duplicate requires a selection, matching canDelete.
            canDuplicate={Boolean(
              canEditDesign &&
              (selectedElement || selectedScreenIds.length > 0),
            )}
            canDelete={Boolean(
              canEditDesign &&
              (selectedElement ||
                (selectedScreenIds.length > 0 && files.length > 1)),
            )}
            canReorder={canEditDesign && Boolean(selectedElement)}
            // L12: rename is only offered for a single selectable layer
            // target (matching Cmd+R's routing) — the design-title rename
            // flow lives elsewhere (the title control), not this menu.
            canRename={
              canEditDesign && Boolean(getSingleSelectedRenamableLayerId())
            }
            canToggleLocked={canEditDesign && Boolean(activeLayerId)}
            canToggleHidden={canEditDesign && Boolean(activeLayerId)}
            canCopyProps={Boolean(selectedElement)}
            canPasteProps={
              canEditDesign && hasPropsClipboard && Boolean(selectedElement)
            }
            canCopyAnimation={
              Boolean(selectedElement) && selectedElementHasMotionTrack
            }
            canPasteAnimation={
              canEditDesign && hasAnimationClipboard && Boolean(selectedElement)
            }
            // Same handleCopySelection screen-fallback as canCopy above —
            // onCopyAsCode is wired to the same handler.
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
              getCanvasClipboardEntries().length === 1 &&
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
              !selectedElementAlreadyComponent
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
            // Figma instance-only cluster: only meaningful when the current
            // selection IS a recognised component instance.
            isComponentInstance={
              canEditDesign && Boolean(selectedComponentNodeId)
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
              void handlePasteSelection(
                details.point?.canvasX !== undefined &&
                  details.point.canvasY !== undefined
                  ? { x: details.point.canvasX, y: details.point.canvasY }
                  : undefined,
              )
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
            onPaste={() => void handlePasteSelection()}
            onPasteOver={handlePasteOverSelection}
            onDuplicate={handleDuplicateSelection}
            onDelete={handleDeleteSelection}
            onBringForward={() => changeSelectedZIndex("forward")}
            onBringToFront={() => changeSelectedZIndex("front")}
            onSendBackward={() => changeSelectedZIndex("backward")}
            onSendToBack={() => changeSelectedZIndex("back")}
            // L12: start the layers panel's real inline rename editor on the
            // single selected layer — canRename above already gates this item
            // to exactly that case, so getSingleSelectedRenamableLayerId()
            // should always resolve here.
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
            onPasteToReplace={canEditDesign ? handlePasteToReplace : undefined}
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
          >
            {activeFile ? (
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* Interact's device chrome sits inside the canvas column so
                    the workspace rails stay put — Interact is a different view
                    of the same editor, not a chrome-free takeover. */}
                {responsiveInteractActive ? (
                  <ResponsiveInteractBar
                    deviceName={interactDeviceName}
                    width={interactDeviceSize.width}
                    height={interactDeviceSize.height}
                    zoom={interactZoom}
                    onDeviceChange={handleInteractDeviceChange}
                    onWidthChange={handleInteractWidthChange}
                    onHeightChange={handleInteractHeightChange}
                    onZoomChange={setInteractZoom}
                    onModeChange={handleModeChange}
                    canAnnotate={canEditDesign}
                    onClose={handleExitResponsiveInteract}
                  />
                ) : null}
                {/* §6.4 / BP-DEEP v2 — breakpoint targeting no longer
                    renders any bar over or above the canvas (the earlier
                    floating overlay covered screen headers; the chrome-row
                    replacement bumped the canvas down). It now lives in the
                    right-inspector header as the unified
                    BreakpointDeviceControl — see rightSidebarActions. */}
                <div
                  ref={canvasContainerRef}
                  className="relative min-w-0 flex-1 overflow-hidden bg-[var(--design-editor-canvas-bg)]"
                  // Overrides the themed canvas colour rather than a background
                  // shorthand, so every descendant reading the var follows.
                  style={
                    canvasBackground
                      ? ({
                          "--design-editor-canvas-bg": canvasBackground,
                        } as React.CSSProperties)
                      : undefined
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
                  {/* Figma-style notice for viewers/commenters who can't edit
                      this design. Only shown once accessRole has resolved. */}
                  {(designAccessRole === "viewer" ||
                    designAccessRole === "commenter") && (
                    <ReadOnlyDesignBanner
                      pinMode={pinMode}
                      onCommentPin={
                        !hostOwnsChrome && !uiHidden && canCommentDesign
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
                  {showPendingVisualStyleApply ? (
                    <div
                      data-design-pending-visual-style-toolbar
                      className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4"
                    >
                      <div className="pointer-events-auto flex w-fit max-w-full items-center overflow-x-auto">
                        <Button
                          className={cn(
                            // guard:allow-raw-color — primary-foreground inverts to near-black in dark mode
                            "h-9 min-w-0 shrink-0 cursor-pointer bg-blue-500 px-3.5 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:ring-blue-400",
                            !shellMode && "rounded-r-none",
                          )}
                          aria-label={t(
                            "designEditor.pendingVisualStyles.applyAria",
                          )}
                          disabled={
                            applyingViaHost ||
                            pendingAgentHandoffBusy ||
                            pendingStructureVerificationBusy
                          }
                          onClick={handleApplyPendingVisualStylesWithAgent}
                        >
                          {applyingViaHost ? (
                            <Spinner className="mr-2 h-4 w-4 shrink-0" />
                          ) : null}
                          <span className="truncate">
                            {t(
                              applyingViaHost
                                ? "designEditor.pendingVisualStyles.applying"
                                : pendingStructureVerificationBusy
                                  ? "designEditor.pendingVisualStyles.verifying"
                                  : pendingStructureVerificationStatus ===
                                      "conflict"
                                    ? "designEditor.pendingVisualStyles.retryWithAgent"
                                    : "designEditor.pendingVisualStyles.applyDesignUpdates",
                            )}
                          </span>
                        </Button>
                        {/* The host runs the turn and owns the chat, so copying
                            the prompt or aborting into interact mode have no
                            meaning here. */}
                        {shellMode ? null : (
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
                            >
                              <DropdownMenuLabel className="text-xs text-muted-foreground">
                                {t(
                                  "designEditor.pendingVisualStyles.previewLabel",
                                )}
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={handleCopyPendingVisualStylePrompt}
                              >
                                <IconClipboard className="mr-2 h-4 w-4" />
                                {t(
                                  "designEditor.pendingVisualStyles.copyPrompt",
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={handleAbortPendingVisualStyles}
                              >
                                <IconX className="mr-2 h-4 w-4" />
                                {t(
                                  "designEditor.pendingVisualStyles.abortPreview",
                                )}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {viewMode === "overview" ? (
                    <>
                      {/* ── Render: overview canvas ── */}
                      <MultiScreenCanvas
                        screens={overviewScreens}
                        zoom={overviewCanvasZoom}
                        onZoomChange={setExplicitOverviewCanvasZoom}
                        cameraCommand={cameraCommand}
                        activeId={activeFileId}
                        selectedScreenIds={overviewSelectedScreenIds}
                        hiddenScreenIds={hiddenLayerIds}
                        lockedScreenIds={lockedLayerIds}
                        fullViewScreenIds={fullViewScreenIds}
                        pendingReviewScreenIds={pendingNodeRewriteScreenIds}
                        onReviewPendingScreen={handleReviewPendingScreen}
                        interactMode={mode === "interact"}
                        readOnly={!canEditDesign}
                        activeScreenHasHoveredChild={
                          Boolean(hoveredElement) &&
                          !hoveredElementIsScreenRoot &&
                          hoveredElementScreenId === activeFileId
                        }
                        hoveredChildScreenId={hoveredChildScreenId}
                        directlyHoveredScreenId={hoveredScreenRootId}
                        previewDeviceFrame={deviceFrame}
                        activeTool={activeTool}
                        onActiveToolChange={handleOverviewActiveToolChange}
                        selectAllRequest={overviewSelectAllRequest}
                        clearSelectionRequest={overviewClearSelectionRequest}
                        onScreenSelectionChange={
                          handleOverviewScreenSelectionChange
                        }
                        geometryById={canvasFrameGeometryById}
                        onGeometryChange={queueFrameGeometrySave}
                        onGeometryCommit={handleGeometryCommit}
                        // Screen-frame-only partial implementation — see the
                        // gradientEditTarget derivation above for the BOARD/
                        // DRAFT primitive gap and the exact EditPanel/
                        // DesignColorPicker contract still needed to close it.
                        gradientEditTarget={gradientEditTarget}
                        vectorEdit={vectorEditOverlayState}
                        onCreatePrimitive={handleCreatePrimitive}
                        onPrimitiveCreated={handlePrimitiveCreated}
                        onPrimitiveReparent={handleOverviewPrimitiveReparent}
                        onCrossScreenElementDrop={handleCrossScreenElementDrop}
                        onDropFiles={
                          canEditDesign ? handleOverviewDropFiles : undefined
                        }
                        boardFileId={boardFileId}
                        boardIsActive={activeFileId === boardFileId}
                        boardFileContent={boardFileContent}
                        boardFrameGeometry={boardFrameGeometry}
                        boardClearSelectionRequest={
                          overviewClearSelectionRequest
                        }
                        boardSelectedSelector={
                          activeFileId === boardFileId
                            ? selectedCanvasSelector
                            : null
                        }
                        boardSelectedSelectorCandidates={
                          activeFileId === boardFileId
                            ? selectedCanvasSelectorCandidates
                            : undefined
                        }
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
                        boardEditMode={canEditDesign}
                        onBoardElementSelect={
                          boardFileId ? handleBoardElementSelect : undefined
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
                        renderBreakpointContent={renderBreakpointContent}
                      />
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
                        onRuntimeStructureInsertRejected={
                          handleRuntimeStructureInsertRejected
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
                          responsiveInteractActive ? setInteractZoom : setZoom
                        }
                        deviceFrame={deviceFrame}
                        sourceType={activeCanvasSourceType}
                        bridgeUrl={activeScreenBridgeUrl}
                        connectionId={activeOverviewScreen?.connectionId}
                        previewToken={activeScreenPreviewToken}
                        externalSnapshotHtml={activeScreenExternalSnapshotHtml}
                        onExternalContentSnapshot={(snapshot) => {
                          if (!activeFile?.id) return;
                          handleScreenExternalContentSnapshot(
                            activeFile.id,
                            snapshot,
                          );
                        }}
                        onRuntimeLayerSnapshot={
                          shouldUseRuntimeLayerProjection({
                            screen: activeOverviewScreen,
                            fallbackSourceType: designSourceType,
                            content: activeContent,
                          })
                            ? handleActiveRuntimeLayerSnapshot
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
                        editMode={mode === "edit"}
                        interactMode={mode === "interact"}
                        readOnly={!canEditDesign}
                        scaleMode={activeTool === "scale"}
                        handToolActive={activeTool === "hand"}
                        spacePanActive={spacePanActive}
                        activeCreationTool={activeSingleScreenCreationTool}
                        onCreatePrimitive={handleSingleScreenCreatePrimitive}
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
                          // Also signal the iframe bridge so an in-screen
                          // element's selection highlight (drawn inside the
                          // iframe) is cleared, not just host state. Harmless
                          // echo when this fires from the iframe's own
                          // clear-selection message.
                          setOverviewClearSelectionRequest(
                            (request) => request + 1,
                          );
                        }}
                        onIframeHotkey={handleIframeHotkey}
                        onFigmaClipboardPaste={handleCanvasFigmaClipboardPaste}
                        onImagePaste={handleCanvasImagePaste}
                        onIframeContextMenu={handleIframeContextMenu}
                        onVisualStyleChange={handleVisualStyleChange}
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
                          // Exact (normalized) filename match only — a substring match
                          // could send "board" to "dashboard.html".
                          const match = files.find(
                            (f) => norm(f.filename) === target,
                          );
                          if (match) {
                            enterSingleScreenInteract(match.id);
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
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
                <div className="flex w-full max-w-md flex-col items-center text-center">
                  {generating || pendingGenerationActive ? (
                    <>
                      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] shadow-[0_18px_50px_-34px_rgba(0,0,0,0.8)]">
                        <Spinner className="size-5 text-foreground/40" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("designEditor.generating")}
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        aria-hidden="true"
                        className="mb-5 w-full max-w-sm rounded-xl bg-[#f7f8fb] p-3 dark:bg-[#f4f6f8]"
                      >
                        <div className="flex h-7 items-center justify-between px-1 pb-2">
                          <div className="flex gap-1.5">
                            <span className="size-2 rounded-full bg-slate-950/[0.12]" />
                            <span className="size-2 rounded-full bg-slate-950/[0.1]" />
                            <span className="size-2 rounded-full bg-slate-950/[0.08]" />
                          </div>
                          <span className="h-2 w-16 rounded bg-slate-950/[0.08]" />
                        </div>
                        <div className="space-y-3 pt-4">
                          <span className="block h-5 w-2/3 rounded bg-slate-950/[0.085]" />
                          <span className="block h-4 w-1/2 rounded bg-slate-950/[0.07]" />
                          <div className="grid grid-cols-3 gap-2 pt-2">
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                            <span className="h-12 rounded-md bg-slate-950/[0.07]" />
                          </div>
                          <span className="block h-20 rounded-lg bg-slate-950/[0.07]" />
                        </div>
                      </div>
                      <p className="mb-3 text-sm font-medium text-foreground/85">
                        {generationIssue ?? t("designEditor.noFiles")}
                      </p>
                      {retryablePrompt ? (
                        <p className="mx-auto mb-4 max-w-sm text-xs italic text-muted-foreground/70">
                          {`"${retryablePrompt.prompt}"`}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-center gap-2">
                        {retryablePrompt ? (
                          <Button
                            size="sm"
                            className="h-8 cursor-pointer rounded-md"
                            onClick={handleRetryGeneration}
                          >
                            <IconRefresh className="h-3.5 w-3.5" />
                            {t("designEditor.tryAgain")}
                          </Button>
                        ) : null}
                        <Button
                          ref={generateBtnRef}
                          variant={retryablePrompt ? "ghost" : "outline"}
                          size="sm"
                          className="h-8 cursor-pointer rounded-md"
                          onClick={() => {
                            setRetryablePrompt(null);
                            handlePromptOpenChange(true);
                          }}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                          {retryablePrompt
                            ? t("designEditor.newPrompt")
                            : t("designEditor.generateDesign")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </CanvasContextMenu>
        )}

        {/* ── Render: right rail ── */}
        {!hostOwnsChrome && !uiHidden && !initialGenerationChromeLimited ? (
          <div
            ref={rightSidebarContentRef}
            className="relative hidden h-full min-h-0 shrink-0 flex-col border-l border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] md:flex"
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
      </div>

      {/* ── Render: mobile inspector sheet ── */}
      {!hostOwnsChrome &&
      !uiHidden &&
      !initialGenerationChromeLimited &&
      mode === "edit" ? (
        <Sheet>
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
        imageCount={figmaHydrationImageCount}
        onHydrated={() => {
          void queryClient.invalidateQueries({ queryKey: ["action"] });
        }}
      />

      <PendingScreenDeletionDialog
        pendingScreenDeletion={pendingScreenDeletion}
        onCancel={handleCancelScreenDeletion}
        onConfirm={handleConfirmScreenDeletion}
      />

      {/* ── Render: motion dock ── */}
      {/* Motion dock (§6.3) — bottom timeline mounted while opening, open, or
          closing. Canvas remains visible above.
          Preview-only scrubbing fires a motion-preview postMessage to the
          canvas iframe; track/duration edits autosave through apply-motion-edit. */}
      {!hostOwnsChrome && activeFile && motionDockMounted ? (
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
          const designSystemId = selectedPromptDesignSystemId;
          persistPromptDesignSystem(designSystemId);
          const fileContext = formatUploadedFileContext(files);
          const images = imageAttachmentsFromUploadedFiles(files);
          const designSystemContext =
            await loadDesignSystemGenerationContext(designSystemId);
          const shouldExploreVariants =
            promptRequestsVariantExploration(prompt);
          const precedent = shouldExploreVariants
            ? null
            : await (async () => {
                await creativeContextPersistRef.current?.catch(() => {});
                return loadCreativeContextPrecedent(
                  (await readCreativeContextState()).selectedContextId,
                );
              })();
          const shouldSkipQuestions =
            shouldExploreVariants || precedent?.status === "strong";
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
                    ...(precedent?.status === "strong"
                      ? designPrecedentDirectives(
                          precedent.contextId,
                          precedent.matches,
                          id,
                        )
                      : []),
                  ]
                : designIntakeQuestionDirectives(id, designSystemId)),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          generationModelRef.current = {
            model: options.model,
            engine: options.engine,
            effort: options.effort,
          };
          const startedAt = Date.now();
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
          const runTabId = agentSubmit(
            shouldSkipQuestions
              ? `Generate design for "${design.title}": ${prompt}`
              : `Prepare design questions for "${design.title}": ${prompt}`,
            context,
            { ...options, newTab: true, images },
          );
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
        loading={generating}
        anchorRef={promptAnchorRef}
        designSystems={designSystems}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={selectedPromptDesignSystemId}
        onDesignSystemChange={setPromptDesignSystemId}
        creativeContexts={creativeContextOptions}
        creativeContextsLoading={creativeContextsQuery.isLoading}
        selectedCreativeContextId={
          creativeContextState.state.selectedContextId ?? null
        }
        onCreativeContextChange={handleCreativeContextChange}
        onCreateDesignSystem={() => {
          handlePromptOpenChange(false);
          navigate("/design-systems/setup");
        }}
      />
      <PromptPopover
        open={showTweakPrompt}
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

      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        defaultTitle={design.title}
        defaultDescription={design.description ?? ""}
        screenCount={
          files.filter((file) => file.filename !== "__board__.html").length
        }
        lockedLayerCount={durableLockedLayerCount}
        saving={saveDesignAsTemplateMutation.isPending}
        onSave={async (values) => {
          try {
            const result = (await saveDesignAsTemplateMutation.mutateAsync({
              designId: id,
              ...values,
            })) as { lockedLayerCount?: number };
            setSaveTemplateOpen(false);
            toast.success(
              t("designEditor.templateSaved", {
                count: result.lockedLayerCount ?? durableLockedLayerCount,
              }),
            );
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
