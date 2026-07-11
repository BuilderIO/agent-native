import {
  IconComponents,
  IconFrame,
  IconPhoto,
  IconTypography,
  IconVector,
} from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import type { CanvasLayerHitCandidate } from "./types";

// LIVE-VERIFIED (real Figma, UI3) canvas context menus:
//
// WITH a selection:
//   Copy ⌘C · Paste here · Paste to replace ⇧⌘R · Copy/Paste as ▸
//     (Copy as code · Copy as SVG · Copy as PNG ⇧⌘C · [sep] ·
//      Copy properties ⌥⌘C · Paste properties ⌥⌘V · [sep] ·
//      Copy animation · Paste animation)
//   [sep]
//   Bring to front ] · Send to back [
//   [sep]
//   Group selection ⌘G · Frame selection ⌥⌘G
//   [sep]
//   Add auto layout ⇧A · Create component ⌥⌘K
//   [sep]
//   Show/Hide ⇧⌘H · Lock/Unlock ⇧⌘L
//   [sep]
//   Flip horizontal ⇧H · Flip vertical ⇧V
//
// EMPTY canvas (no selection):
//   Paste here
//   [sep]
//   Show/Hide UI ⌘\ · Show/Hide comments ⇧C
//
// Real Figma has no Duplicate/Delete/Select-all/Zoom items on either canvas
// menu (all keyboard-only there) — those are intentionally NOT rendered here
// even though some callers may still pass the callback/capability props for
// back-compat. App-specific extras with no Figma equivalent (e.g. "Edit
// screen") are appended at the very bottom, below one more separator, so the
// Figma-muscle-memory zone above stays byte-identical to the real menu.
//
// NOTE — instance-only cluster (Go to main component / Swap instance /
// Detach instance): added for component-instance selections, gated behind
// `isComponentInstance` so it renders nothing for existing callers (fully
// backward compatible). Real Figma groups these together for an instance
// selection, but this exact placement (right after Add auto layout / Create
// component) was NOT independently re-verified against a live Figma session
// in this pass — reposition if a future LIVE-VERIFIED sweep finds a
// different spot.
export type CanvasContextMenuAction =
  | "paste-here"
  | "select-all"
  | "zoom-to-fit"
  | "zoom-to-selection"
  | "zoom-in"
  | "zoom-out"
  | "copy"
  | "paste"
  | "paste-over"
  | "paste-to-replace"
  | "duplicate"
  | "delete"
  | "bring-forward"
  | "bring-to-front"
  | "send-backward"
  | "send-to-back"
  | "group"
  | "ungroup"
  | "frame-selection"
  | "add-auto-layout"
  | "suggest-auto-layout"
  | "create-component"
  | "go-to-main-component"
  | "swap-instance"
  | "detach-instance"
  | "rename"
  | "toggle-lock"
  | "toggle-hide"
  | "copy-props"
  | "paste-props"
  | "copy-animation"
  | "paste-animation"
  | "copy-as-code"
  | "copy-as-svg"
  | "copy-as-png"
  | "flip-horizontal"
  | "flip-vertical"
  | "toggle-ui"
  | "toggle-comments";

export interface CanvasContextMenuPoint {
  clientX: number;
  clientY: number;
  canvasX?: number;
  canvasY?: number;
}

export interface CanvasContextMenuHandle {
  openAt: (point: CanvasContextMenuPoint) => void;
  close: () => void;
}

export interface CanvasContextMenuActionDetails {
  action: CanvasContextMenuAction;
  point: CanvasContextMenuPoint | null;
  selectedCount: number;
  originalEvent: Event;
}

export type CanvasContextMenuActionHandler = (
  details: CanvasContextMenuActionDetails,
) => void;

export interface CanvasContextMenuLabels {
  selectLayer: string;
  pasteHere: string;
  selectAll: string;
  zoomToFit: string;
  zoomToSelection: string;
  zoomIn: string;
  zoomOut: string;
  copy: string;
  paste: string;
  pasteOver: string;
  pasteToReplace: string;
  duplicate: string;
  delete: string;
  order: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
  group: string;
  ungroup: string;
  frameSelection: string;
  addAutoLayout: string;
  suggestAutoLayout: string;
  createComponent: string;
  goToMainComponent: string;
  swapInstance: string;
  detachInstance: string;
  rename: string;
  lock: string;
  unlock: string;
  hide: string;
  show: string;
  copyAs: string;
  copyProps: string;
  pasteProps: string;
  copyAnimation: string;
  pasteAnimation: string;
  copyAsCode: string;
  copyAsSvg: string;
  copyAsPng: string;
  flipHorizontal: string;
  flipVertical: string;
  toggleUiShow: string;
  toggleUiHide: string;
  toggleCommentsShow: string;
  toggleCommentsHide: string;
}

export interface CanvasContextMenuShortcuts {
  pasteHere: string;
  selectAll: string;
  zoomToFit: string;
  zoomToSelection: string;
  zoomIn: string;
  zoomOut: string;
  copy: string;
  paste: string;
  pasteOver: string;
  pasteToReplace: string;
  duplicate: string;
  delete: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
  group: string;
  ungroup: string;
  frameSelection: string;
  addAutoLayout: string;
  createComponent: string;
  goToMainComponent: string;
  swapInstance: string;
  detachInstance: string;
  rename: string;
  toggleLock: string;
  toggleHide: string;
  copyProps: string;
  pasteProps: string;
  copyAnimation: string;
  pasteAnimation: string;
  copyAsCode: string;
  copyAsSvg: string;
  copyAsPng: string;
  flipHorizontal: string;
  flipVertical: string;
  toggleUi: string;
  toggleComments: string;
}

export interface CanvasContextMenuProps {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  selectedCount?: number;
  layerCandidates?: readonly CanvasLayerHitCandidate[];
  onSelectLayer?: (candidate: CanvasLayerHitCandidate) => void;
  hasClipboard?: boolean;
  hasPropsClipboard?: boolean;
  hasAnimationClipboard?: boolean;
  isLocked?: boolean;
  isHidden?: boolean;
  isUiHidden?: boolean;
  isCommentsHidden?: boolean;
  canPasteHere?: boolean;
  // Kept for back-compat with existing callers; real Figma has no
  // select-all/zoom items on this menu, so these no longer render anything.
  canSelectAll?: boolean;
  canZoomToFit?: boolean;
  canZoomToSelection?: boolean;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canPasteOver?: boolean;
  canPasteToReplace?: boolean;
  // Kept for back-compat; real Figma has no Duplicate/Delete on this menu
  // (keyboard-only there), so these no longer render anything.
  canDuplicate?: boolean;
  canDelete?: boolean;
  canReorder?: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  canFrameSelection?: boolean;
  canAddAutoLayout?: boolean;
  canSuggestAutoLayout?: boolean;
  canCreateComponent?: boolean;
  // Whether the current selection IS a component instance — gates the
  // whole Go to main component / Swap instance / Detach instance cluster on
  // (rather than showing them permanently disabled for non-instance
  // selections, since real Figma doesn't show this cluster at all then).
  isComponentInstance?: boolean;
  canGoToMainComponent?: boolean;
  canSwapInstance?: boolean;
  canDetachInstance?: boolean;
  // L12: this menu is target-agnostic — it has no built-in notion of "design
  // title" vs "layer". Rename is enabled by default for a single selection
  // (see the canRename default below) and fires through the onRename
  // callback / onAction("rename", ...) regardless of what's selected. Any
  // "only rename the design title" restriction is a CALL-SITE decision (e.g.
  // passing canRename={false} and/or hiddenActions={["rename"]} when a layer
  // is selected instead of the design title) — it does not live here.
  // NOTE: real Figma's canvas menu doesn't show Rename at all — only the
  // layer-row menu does. Kept here (opt-in via a wired-up onRename) purely
  // for existing callers; no default UI relies on it being shown.
  canRename?: boolean;
  canToggleLocked?: boolean;
  canToggleHidden?: boolean;
  canCopyProps?: boolean;
  canPasteProps?: boolean;
  canCopyAnimation?: boolean;
  canPasteAnimation?: boolean;
  canCopyAsCode?: boolean;
  canCopyAsSvg?: boolean;
  canCopyAsPng?: boolean;
  canFlipHorizontal?: boolean;
  canFlipVertical?: boolean;
  canToggleUi?: boolean;
  canToggleComments?: boolean;
  hiddenActions?: readonly CanvasContextMenuAction[];
  disabledActions?: readonly CanvasContextMenuAction[];
  labels?: Partial<CanvasContextMenuLabels>;
  shortcuts?: Partial<CanvasContextMenuShortcuts>;
  getCanvasPoint?: (point: { clientX: number; clientY: number }) => {
    x: number;
    y: number;
  };
  onOpenChange?: (open: boolean) => void;
  onAction?: (
    action: CanvasContextMenuAction,
    details: CanvasContextMenuActionDetails,
  ) => void;
  onPasteHere?: CanvasContextMenuActionHandler;
  // Kept for back-compat; no longer rendered (see canSelectAll/canZoomToFit).
  onSelectAll?: CanvasContextMenuActionHandler;
  onZoomToFit?: CanvasContextMenuActionHandler;
  onZoomToSelection?: CanvasContextMenuActionHandler;
  onZoomIn?: CanvasContextMenuActionHandler;
  onZoomOut?: CanvasContextMenuActionHandler;
  onCopy?: CanvasContextMenuActionHandler;
  onPaste?: CanvasContextMenuActionHandler;
  onPasteOver?: CanvasContextMenuActionHandler;
  onPasteToReplace?: CanvasContextMenuActionHandler;
  // Kept for back-compat; no longer rendered (see canDuplicate/canDelete).
  onDuplicate?: CanvasContextMenuActionHandler;
  onDelete?: CanvasContextMenuActionHandler;
  onBringForward?: CanvasContextMenuActionHandler;
  onBringToFront?: CanvasContextMenuActionHandler;
  onSendBackward?: CanvasContextMenuActionHandler;
  onSendToBack?: CanvasContextMenuActionHandler;
  onGroup?: CanvasContextMenuActionHandler;
  onUngroup?: CanvasContextMenuActionHandler;
  onFrameSelection?: CanvasContextMenuActionHandler;
  onAddAutoLayout?: CanvasContextMenuActionHandler;
  onSuggestAutoLayout?: CanvasContextMenuActionHandler;
  onCreateComponent?: CanvasContextMenuActionHandler;
  onGoToMainComponent?: CanvasContextMenuActionHandler;
  onSwapInstance?: CanvasContextMenuActionHandler;
  onDetachInstance?: CanvasContextMenuActionHandler;
  // L12: fired when the Rename item is selected (details.selectedCount tells
  // the caller how many things are selected). The caller decides what
  // "rename" means for the current target — e.g. calling a LayersPanel
  // ref's beginRename(layerId) when exactly one layer is selected, vs.
  // starting design-title rename when nothing is selected.
  onRename?: CanvasContextMenuActionHandler;
  onToggleLocked?: CanvasContextMenuActionHandler;
  onToggleHidden?: CanvasContextMenuActionHandler;
  onCopyProps?: CanvasContextMenuActionHandler;
  onPasteProps?: CanvasContextMenuActionHandler;
  onCopyAnimation?: CanvasContextMenuActionHandler;
  onPasteAnimation?: CanvasContextMenuActionHandler;
  onCopyAsCode?: CanvasContextMenuActionHandler;
  onCopyAsSvg?: CanvasContextMenuActionHandler;
  onCopyAsPng?: CanvasContextMenuActionHandler;
  onFlipHorizontal?: CanvasContextMenuActionHandler;
  onFlipVertical?: CanvasContextMenuActionHandler;
  onToggleUi?: CanvasContextMenuActionHandler;
  onToggleComments?: CanvasContextMenuActionHandler;
  // App-specific items with no Figma equivalent (e.g. "Edit screen"). Render
  // below a trailing separator, after the Figma-muscle-memory zone, only for
  // the WITH-selection menu — matching the existing call site's need without
  // polluting the empty-canvas menu.
  appendedItems?: ReactNode;
}

const DEFAULT_LABELS: CanvasContextMenuLabels = {
  selectLayer: "Select layer",
  pasteHere: "Paste here",
  selectAll: "Select all",
  zoomToFit: "Zoom to fit",
  zoomToSelection: "Zoom to selection",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  copy: "Copy",
  paste: "Paste",
  pasteOver: "Paste over",
  pasteToReplace: "Paste to replace",
  duplicate: "Duplicate",
  delete: "Delete",
  order: "Order",
  bringForward: "Bring forward",
  bringToFront: "Bring to front",
  sendBackward: "Send backward",
  sendToBack: "Send to back",
  group: "Group selection",
  ungroup: "Ungroup",
  frameSelection: "Frame selection",
  addAutoLayout: "Add auto layout",
  suggestAutoLayout: "Suggest auto layout…",
  createComponent: "Create component",
  goToMainComponent: "Go to main component",
  swapInstance: "Swap instance",
  detachInstance: "Detach instance",
  rename: "Rename",
  lock: "Lock",
  unlock: "Unlock",
  hide: "Hide",
  show: "Show",
  copyAs: "Copy/Paste as",
  copyProps: "Copy properties",
  pasteProps: "Paste properties",
  copyAnimation: "Copy animation",
  pasteAnimation: "Paste animation",
  copyAsCode: "Copy as code",
  copyAsSvg: "Copy as SVG",
  copyAsPng: "Copy as PNG",
  flipHorizontal: "Flip horizontal",
  flipVertical: "Flip vertical",
  toggleUiShow: "Show UI",
  toggleUiHide: "Hide UI",
  toggleCommentsShow: "Show comments",
  toggleCommentsHide: "Hide comments",
};

const DEFAULT_SHORTCUTS: CanvasContextMenuShortcuts = {
  pasteHere: "",
  selectAll: "⌘A",
  zoomToFit: "⇧1",
  zoomToSelection: "⇧2",
  zoomIn: "+",
  zoomOut: "-",
  copy: "⌘C",
  paste: "⌘V",
  pasteOver: "⇧⌘V",
  pasteToReplace: "⇧⌘R",
  duplicate: "⌘D",
  delete: "⌫",
  bringForward: "⌘]",
  bringToFront: "]",
  sendBackward: "⌘[",
  sendToBack: "[",
  group: "⌘G",
  ungroup: "⇧⌘G",
  frameSelection: "⌥⌘G",
  addAutoLayout: "⇧A",
  createComponent: "⌥⌘K",
  goToMainComponent: "",
  swapInstance: "",
  detachInstance: "⌥⌘B",
  rename: "⌘R",
  toggleLock: "⇧⌘L",
  toggleHide: "⇧⌘H",
  copyProps: "⌥⌘C",
  pasteProps: "⌥⌘V",
  copyAnimation: "",
  pasteAnimation: "",
  copyAsCode: "",
  copyAsSvg: "",
  copyAsPng: "⇧⌘C",
  flipHorizontal: "⇧H",
  flipVertical: "⇧V",
  toggleUi: "⌘\\",
  toggleComments: "⇧C",
};

type ActionCallbackMap = Partial<
  Record<CanvasContextMenuAction, CanvasContextMenuActionHandler>
>;

// design-editor menu chrome: compact, dark-border, subtle shadow, no animation jitter
const MENU_CONTENT_CLASS =
  "w-52 min-w-[200px] rounded-[6px] border border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] py-[3px] px-[3px] text-[12px] text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.08)] outline-none";
// design row height ~28px, full-width highlight on hover, no icon gap waste
const MENU_ITEM_CLASS =
  "flex h-7 cursor-default select-none items-center rounded-[4px] px-2 py-0 text-[12px] leading-none gap-0 focus:bg-[var(--design-editor-selection-color)] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-35";
// Submenu trigger mirrors item styles + chevron sizing
const MENU_SUB_TRIGGER_CLASS =
  "flex h-7 cursor-default select-none items-center rounded-[4px] px-2 py-0 text-[12px] leading-none focus:bg-[var(--design-editor-selection-color)] focus:text-white data-[state=open]:bg-[var(--design-editor-selection-color)] data-[state=open]:text-white [&>svg:last-child]:ms-auto [&>svg:last-child]:size-3 [&>svg:last-child]:opacity-50";
// Separator: 1px, full-width flush, design-editor muted line
const MENU_SEPARATOR_CLASS =
  "mx-0 my-[3px] h-px bg-[var(--design-editor-control-border)] opacity-80";
// Shortcut: right-aligned, muted, use system UI for symbol rendering
const MENU_SHORTCUT_CLASS =
  "ms-auto ps-4 font-normal !text-[11px] tracking-normal text-muted-foreground/70 tabular-nums";

export const CanvasContextMenu = forwardRef<
  CanvasContextMenuHandle,
  CanvasContextMenuProps
>(function CanvasContextMenu(
  {
    children,
    disabled,
    className,
    contentClassName,
    selectedCount = 0,
    layerCandidates = [],
    onSelectLayer,
    hasClipboard = false,
    hasPropsClipboard = false,
    hasAnimationClipboard = false,
    isLocked = false,
    isHidden = false,
    isUiHidden = false,
    isCommentsHidden = false,
    canPasteHere = hasClipboard,
    canCopy = selectedCount > 0,
    canPaste = hasClipboard,
    canPasteOver = hasClipboard && selectedCount > 0,
    canPasteToReplace = hasClipboard && selectedCount > 0,
    canReorder = selectedCount > 0,
    canGroup = selectedCount > 1,
    canUngroup = false,
    canFrameSelection = selectedCount > 0,
    canAddAutoLayout = selectedCount > 0,
    canSuggestAutoLayout = false,
    canCreateComponent = selectedCount > 0,
    isComponentInstance = false,
    canGoToMainComponent = isComponentInstance,
    canSwapInstance = isComponentInstance,
    canDetachInstance = isComponentInstance,
    canRename = selectedCount === 1,
    canToggleLocked = selectedCount > 0,
    canToggleHidden = selectedCount > 0,
    canCopyProps = selectedCount > 0,
    canPasteProps = hasPropsClipboard && selectedCount > 0,
    canCopyAnimation = selectedCount > 0,
    canPasteAnimation = hasAnimationClipboard && selectedCount > 0,
    canCopyAsCode = selectedCount > 0,
    canCopyAsSvg = selectedCount > 0,
    canCopyAsPng = selectedCount > 0,
    canFlipHorizontal = selectedCount > 0,
    canFlipVertical = selectedCount > 0,
    canToggleUi = true,
    canToggleComments = true,
    hiddenActions = [],
    disabledActions = [],
    labels: labelsProp,
    shortcuts: shortcutsProp,
    getCanvasPoint,
    onOpenChange,
    onAction,
    onPasteHere,
    onCopy,
    onPaste,
    onPasteOver,
    onPasteToReplace,
    onBringForward,
    onBringToFront,
    onSendBackward,
    onSendToBack,
    onGroup,
    onUngroup,
    onFrameSelection,
    onAddAutoLayout,
    onSuggestAutoLayout,
    onCreateComponent,
    onGoToMainComponent,
    onSwapInstance,
    onDetachInstance,
    onRename,
    onToggleLocked,
    onToggleHidden,
    onCopyProps,
    onPasteProps,
    onCopyAnimation,
    onPasteAnimation,
    onCopyAsCode,
    onCopyAsSvg,
    onCopyAsPng,
    onFlipHorizontal,
    onFlipVertical,
    onToggleUi,
    onToggleComments,
    appendedItems,
  },
  ref,
) {
  const labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...labelsProp }),
    [labelsProp],
  );
  const shortcuts = useMemo(
    () => ({ ...DEFAULT_SHORTCUTS, ...shortcutsProp }),
    [shortcutsProp],
  );
  const hiddenActionSet = useMemo(
    () => new Set(hiddenActions),
    [hiddenActions],
  );
  const disabledActionSet = useMemo(
    () => new Set(disabledActions),
    [disabledActions],
  );
  const [point, setPoint] = useState<CanvasContextMenuPoint | null>(null);
  const [open, setOpen] = useState(false);
  const [manualPoint, setManualPoint] = useState<CanvasContextMenuPoint | null>(
    null,
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) setManualPoint(null);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      openAt(nextPoint) {
        setPoint(nextPoint);
        setManualPoint(nextPoint);
        setOpen(true);
      },
      close() {
        handleOpenChange(false);
      },
    }),
    [handleOpenChange],
  );

  const callbacks = useMemo<ActionCallbackMap>(
    () => ({
      "paste-here": onPasteHere,
      copy: onCopy,
      paste: onPaste,
      "paste-over": onPasteOver,
      "paste-to-replace": onPasteToReplace,
      "bring-forward": onBringForward,
      "bring-to-front": onBringToFront,
      "send-backward": onSendBackward,
      "send-to-back": onSendToBack,
      group: onGroup,
      ungroup: onUngroup,
      "frame-selection": onFrameSelection,
      "add-auto-layout": onAddAutoLayout,
      "suggest-auto-layout": onSuggestAutoLayout,
      "create-component": onCreateComponent,
      "go-to-main-component": onGoToMainComponent,
      "swap-instance": onSwapInstance,
      "detach-instance": onDetachInstance,
      rename: onRename,
      "toggle-lock": onToggleLocked,
      "toggle-hide": onToggleHidden,
      "copy-props": onCopyProps,
      "paste-props": onPasteProps,
      "copy-animation": onCopyAnimation,
      "paste-animation": onPasteAnimation,
      "copy-as-code": onCopyAsCode,
      "copy-as-svg": onCopyAsSvg,
      "copy-as-png": onCopyAsPng,
      "flip-horizontal": onFlipHorizontal,
      "flip-vertical": onFlipVertical,
      "toggle-ui": onToggleUi,
      "toggle-comments": onToggleComments,
    }),
    [
      onAddAutoLayout,
      onSuggestAutoLayout,
      onBringForward,
      onBringToFront,
      onCopy,
      onCopyAnimation,
      onCopyAsCode,
      onCopyAsPng,
      onCopyAsSvg,
      onCopyProps,
      onCreateComponent,
      onDetachInstance,
      onFlipHorizontal,
      onFlipVertical,
      onFrameSelection,
      onGoToMainComponent,
      onGroup,
      onPaste,
      onPasteAnimation,
      onPasteHere,
      onPasteOver,
      onPasteProps,
      onPasteToReplace,
      onRename,
      onSendBackward,
      onSendToBack,
      onSwapInstance,
      onToggleComments,
      onToggleHidden,
      onToggleLocked,
      onToggleUi,
      onUngroup,
    ],
  );

  const runAction = useCallback(
    (action: CanvasContextMenuAction, originalEvent: Event) => {
      const details = {
        action,
        point,
        selectedCount,
        originalEvent,
      };
      onAction?.(action, details);
      callbacks[action]?.(details);
    },
    [callbacks, onAction, point, selectedCount],
  );

  const canRun = useCallback(
    (action: CanvasContextMenuAction, capability: boolean) =>
      capability &&
      !disabledActionSet.has(action) &&
      Boolean(onAction || callbacks[action]),
    [callbacks, disabledActionSet, onAction],
  );

  const isHiddenAction = useCallback(
    (action: CanvasContextMenuAction) => hiddenActionSet.has(action),
    [hiddenActionSet],
  );

  if (disabled) {
    return <>{children}</>;
  }

  const manualContentStyle = manualPoint
    ? ({
        position: "fixed",
        left: manualPoint.clientX,
        top: manualPoint.clientY,
        transform: "none",
        zIndex: 250,
      } satisfies CSSProperties)
    : undefined;

  const hasSelection = selectedCount > 0;

  return (
    <ContextMenu open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          className={cn("contents", className)}
          onContextMenuCapture={(event) => {
            const canvasPoint = getCanvasPoint?.({
              clientX: event.clientX,
              clientY: event.clientY,
            });
            setPoint({
              clientX: event.clientX,
              clientY: event.clientY,
              canvasX: canvasPoint?.x,
              canvasY: canvasPoint?.y,
            });
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className={cn(MENU_CONTENT_CLASS, contentClassName)}
        style={manualContentStyle}
      >
        {layerCandidates.length > 0 && onSelectLayer ? (
          <>
            <ContextMenuGroup>
              <ContextMenuSub>
                <ContextMenuSubTrigger className={MENU_SUB_TRIGGER_CLASS}>
                  {labels.selectLayer}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent
                  className={cn(MENU_CONTENT_CLASS, "w-56")}
                >
                  {layerCandidates.map((candidate) => (
                    <CanvasLayerCandidateItem
                      key={candidate.key}
                      candidate={candidate}
                      onSelect={() => {
                        onSelectLayer(candidate);
                        handleOpenChange(false);
                      }}
                    />
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuGroup>
            <CanvasMenuSeparator />
          </>
        ) : null}
        {hasSelection ? (
          <>
            {/* LIVE-VERIFIED Figma "with selection" canvas menu. */}
            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("copy")}
                disabled={!canRun("copy", canCopy)}
                label={labels.copy}
                shortcut={shortcuts.copy}
                onSelect={(event) => runAction("copy", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("paste-here")}
                disabled={!canRun("paste-here", canPasteHere)}
                label={labels.pasteHere}
                shortcut={shortcuts.pasteHere}
                onSelect={(event) => runAction("paste-here", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("paste-to-replace")}
                disabled={!canRun("paste-to-replace", canPasteToReplace)}
                label={labels.pasteToReplace}
                shortcut={shortcuts.pasteToReplace}
                onSelect={(event) => runAction("paste-to-replace", event)}
              />
              {!isHiddenAction("copy-as-code") ||
              !isHiddenAction("copy-as-svg") ||
              !isHiddenAction("copy-as-png") ||
              !isHiddenAction("copy-props") ||
              !isHiddenAction("paste-props") ||
              !isHiddenAction("copy-animation") ||
              !isHiddenAction("paste-animation") ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    disabled={
                      !(
                        canRun("copy-as-code", canCopyAsCode) ||
                        canRun("copy-as-svg", canCopyAsSvg) ||
                        canRun("copy-as-png", canCopyAsPng) ||
                        canRun("copy-props", canCopyProps) ||
                        canRun("paste-props", canPasteProps) ||
                        canRun("copy-animation", canCopyAnimation) ||
                        canRun("paste-animation", canPasteAnimation)
                      )
                    }
                    className={MENU_SUB_TRIGGER_CLASS}
                  >
                    {labels.copyAs}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(MENU_CONTENT_CLASS, "w-52")}
                  >
                    <CanvasMenuItem
                      hidden={isHiddenAction("copy-as-code")}
                      disabled={!canRun("copy-as-code", canCopyAsCode)}
                      label={labels.copyAsCode}
                      shortcut={shortcuts.copyAsCode}
                      onSelect={(event) => runAction("copy-as-code", event)}
                    />
                    <CanvasMenuItem
                      hidden={isHiddenAction("copy-as-svg")}
                      disabled={!canRun("copy-as-svg", canCopyAsSvg)}
                      label={labels.copyAsSvg}
                      shortcut={shortcuts.copyAsSvg}
                      onSelect={(event) => runAction("copy-as-svg", event)}
                    />
                    <CanvasMenuItem
                      hidden={isHiddenAction("copy-as-png")}
                      disabled={!canRun("copy-as-png", canCopyAsPng)}
                      label={labels.copyAsPng}
                      shortcut={shortcuts.copyAsPng}
                      onSelect={(event) => runAction("copy-as-png", event)}
                    />
                    <CanvasMenuSeparator />
                    <CanvasMenuItem
                      hidden={isHiddenAction("copy-props")}
                      disabled={!canRun("copy-props", canCopyProps)}
                      label={labels.copyProps}
                      shortcut={shortcuts.copyProps}
                      onSelect={(event) => runAction("copy-props", event)}
                    />
                    <CanvasMenuItem
                      hidden={isHiddenAction("paste-props")}
                      disabled={!canRun("paste-props", canPasteProps)}
                      label={labels.pasteProps}
                      shortcut={shortcuts.pasteProps}
                      onSelect={(event) => runAction("paste-props", event)}
                    />
                    <CanvasMenuSeparator />
                    <CanvasMenuItem
                      hidden={isHiddenAction("copy-animation")}
                      disabled={!canRun("copy-animation", canCopyAnimation)}
                      label={labels.copyAnimation}
                      shortcut={shortcuts.copyAnimation}
                      onSelect={(event) => runAction("copy-animation", event)}
                    />
                    <CanvasMenuItem
                      hidden={isHiddenAction("paste-animation")}
                      disabled={!canRun("paste-animation", canPasteAnimation)}
                      label={labels.pasteAnimation}
                      shortcut={shortcuts.pasteAnimation}
                      onSelect={(event) => runAction("paste-animation", event)}
                    />
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("bring-to-front")}
                disabled={!canRun("bring-to-front", canReorder)}
                label={labels.bringToFront}
                shortcut={shortcuts.bringToFront}
                onSelect={(event) => runAction("bring-to-front", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("send-to-back")}
                disabled={!canRun("send-to-back", canReorder)}
                label={labels.sendToBack}
                shortcut={shortcuts.sendToBack}
                onSelect={(event) => runAction("send-to-back", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("group")}
                disabled={!canRun("group", canGroup)}
                label={labels.group}
                shortcut={shortcuts.group}
                onSelect={(event) => runAction("group", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("frame-selection")}
                disabled={!canRun("frame-selection", canFrameSelection)}
                label={labels.frameSelection}
                shortcut={shortcuts.frameSelection}
                onSelect={(event) => runAction("frame-selection", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("add-auto-layout")}
                disabled={!canRun("add-auto-layout", canAddAutoLayout)}
                label={labels.addAutoLayout}
                shortcut={shortcuts.addAutoLayout}
                onSelect={(event) => runAction("add-auto-layout", event)}
              />
              {onSuggestAutoLayout ? (
                <CanvasMenuItem
                  hidden={isHiddenAction("suggest-auto-layout")}
                  disabled={
                    !canRun("suggest-auto-layout", canSuggestAutoLayout)
                  }
                  label={labels.suggestAutoLayout}
                  shortcut=""
                  onSelect={(event) => runAction("suggest-auto-layout", event)}
                />
              ) : null}
              <CanvasMenuItem
                hidden={isHiddenAction("create-component")}
                disabled={!canRun("create-component", canCreateComponent)}
                label={labels.createComponent}
                shortcut={shortcuts.createComponent}
                onSelect={(event) => runAction("create-component", event)}
              />
            </ContextMenuGroup>

            {isComponentInstance ? (
              <>
                <CanvasMenuSeparator />
                <ContextMenuGroup>
                  <CanvasMenuItem
                    hidden={isHiddenAction("go-to-main-component")}
                    disabled={
                      !canRun("go-to-main-component", canGoToMainComponent)
                    }
                    label={labels.goToMainComponent}
                    shortcut={shortcuts.goToMainComponent}
                    onSelect={(event) =>
                      runAction("go-to-main-component", event)
                    }
                  />
                  <CanvasMenuItem
                    hidden={isHiddenAction("swap-instance")}
                    disabled={!canRun("swap-instance", canSwapInstance)}
                    label={labels.swapInstance}
                    shortcut={shortcuts.swapInstance}
                    onSelect={(event) => runAction("swap-instance", event)}
                  />
                  <CanvasMenuItem
                    hidden={isHiddenAction("detach-instance")}
                    disabled={!canRun("detach-instance", canDetachInstance)}
                    label={labels.detachInstance}
                    shortcut={shortcuts.detachInstance}
                    onSelect={(event) => runAction("detach-instance", event)}
                  />
                </ContextMenuGroup>
              </>
            ) : null}

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("toggle-hide")}
                disabled={!canRun("toggle-hide", canToggleHidden)}
                label={isHidden ? labels.show : labels.hide}
                shortcut={shortcuts.toggleHide}
                onSelect={(event) => runAction("toggle-hide", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("toggle-lock")}
                disabled={!canRun("toggle-lock", canToggleLocked)}
                label={isLocked ? labels.unlock : labels.lock}
                shortcut={shortcuts.toggleLock}
                onSelect={(event) => runAction("toggle-lock", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("flip-horizontal")}
                disabled={!canRun("flip-horizontal", canFlipHorizontal)}
                label={labels.flipHorizontal}
                shortcut={shortcuts.flipHorizontal}
                onSelect={(event) => runAction("flip-horizontal", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("flip-vertical")}
                disabled={!canRun("flip-vertical", canFlipVertical)}
                label={labels.flipVertical}
                shortcut={shortcuts.flipVertical}
                onSelect={(event) => runAction("flip-vertical", event)}
              />
            </ContextMenuGroup>

            {appendedItems ? (
              <>
                <CanvasMenuSeparator />
                {appendedItems}
              </>
            ) : null}
          </>
        ) : (
          <>
            {/* LIVE-VERIFIED Figma "empty canvas" (no selection) menu — just
                Paste here, then Show/Hide UI and Show/Hide comments. No
                zoom/select-all items (real Figma's UI3 empty menu has
                none). */}
            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("paste-here")}
                disabled={!canRun("paste-here", canPasteHere)}
                label={labels.pasteHere}
                shortcut={shortcuts.pasteHere}
                onSelect={(event) => runAction("paste-here", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("toggle-ui")}
                disabled={!canRun("toggle-ui", canToggleUi)}
                label={isUiHidden ? labels.toggleUiShow : labels.toggleUiHide}
                shortcut={shortcuts.toggleUi}
                onSelect={(event) => runAction("toggle-ui", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("toggle-comments")}
                disabled={!canRun("toggle-comments", canToggleComments)}
                label={
                  isCommentsHidden
                    ? labels.toggleCommentsShow
                    : labels.toggleCommentsHide
                }
                shortcut={shortcuts.toggleComments}
                onSelect={(event) => runAction("toggle-comments", event)}
              />
            </ContextMenuGroup>

            {appendedItems ? (
              <>
                <CanvasMenuSeparator />
                {appendedItems}
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function CanvasLayerCandidateItem({
  candidate,
  onSelect,
}: {
  candidate: CanvasLayerHitCandidate;
  onSelect: () => void;
}) {
  const tag = candidate.info.tagName.toLowerCase();
  const Icon = candidate.info.componentName
    ? IconComponents
    : /^(h[1-6]|p|span|label|input|textarea)$/.test(tag)
      ? IconTypography
      : /^(img|picture|video)$/.test(tag)
        ? IconPhoto
        : /^(svg|path|circle|ellipse|polygon|line)$/.test(tag)
          ? IconVector
          : tag === "button" || tag === "a"
            ? IconComponents
            : IconFrame;
  return (
    <ContextMenuItem
      className={cn(MENU_ITEM_CLASS, "gap-2")}
      onSelect={onSelect}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{candidate.label}</span>
    </ContextMenuItem>
  );
}

function CanvasMenuItem({
  hidden,
  disabled,
  destructive,
  label,
  shortcut,
  onSelect,
}: {
  hidden?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  label: string;
  shortcut?: string;
  onSelect: (event: Event) => void;
}) {
  if (hidden) return null;

  return (
    <ContextMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        MENU_ITEM_CLASS,
        destructive &&
          "text-destructive focus:bg-destructive/10 focus:text-destructive",
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      {shortcut ? (
        <ContextMenuShortcut className={MENU_SHORTCUT_CLASS}>
          {shortcut}
        </ContextMenuShortcut>
      ) : null}
    </ContextMenuItem>
  );
}

function CanvasMenuSeparator() {
  return <ContextMenuSeparator className={MENU_SEPARATOR_CLASS} />;
}
