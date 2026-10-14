import type { AgentShareDestination } from "@agent-native/toolkit/sharing";
import {
  IconComponents,
  IconFrame,
  IconPhoto,
  IconVector,
} from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import { cn } from "@/lib/utils";

import { CanvasMenuItem } from "./context-menu-item";
import {
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_SEPARATOR_CLASS,
  MENU_SUB_TRIGGER_CLASS,
} from "./context-menu-styles";
import { IconText } from "./inspector/design-icons";
import { formatShortcutLabel } from "./keyboard-shortcuts";
import type { CanvasLayerHitCandidate } from "./types";

export type CanvasContextMenuAction =
  | "paste-here"
  | "copy"
  | "paste"
  | "paste-over"
  | "paste-to-replace"
  | "bring-forward"
  | "bring-to-front"
  | "send-backward"
  | "send-to-back"
  | "frame-selection"
  | "add-auto-layout"
  | "suggest-auto-layout"
  | "create-component"
  | "edit-with-agent"
  | "group"
  | "boolean-subtract"
  | "go-to-main-component"
  | "swap-instance"
  | "detach-instance"
  | "rename"
  | "toggle-lock"
  | "toggle-hide"
  | "copy-props"
  | "paste-props"
  | "copy-as-png"
  | "rotate-clockwise"
  | "flip-horizontal"
  | "flip-vertical"
  | "toggle-ui"
  | "toggle-comments"
  | "explore-with-agent"
  | "copy-link";

export interface CanvasContextMenuPoint {
  clientX: number;
  clientY: number;
  canvasX?: number;
  canvasY?: number;
  screenId?: string;
  emptyCanvas?: boolean;
}

export interface CanvasContextMenuHandle {
  openAt: (point: CanvasContextMenuPoint) => void;
  close: () => void;
}

export interface CanvasContextMenuActionDetails {
  action: CanvasContextMenuAction;
  point: CanvasContextMenuPoint | null;
  selectedCount: number;
  emptyCanvas: boolean;
  originalEvent: Event;
}

export type CanvasContextMenuActionHandler = (
  details: CanvasContextMenuActionDetails,
) => void;

export type CanvasAgentPreset =
  | "inspiration"
  | "polish"
  | "debug"
  | "states"
  | "responsive";

export interface CanvasContextMenuLabels {
  selectLayer: string;
  editWithAgent: string;
  arrange: string;
  transform: string;
  group: string;
  booleanOperations: string;
  subtract: string;
  inspiration: string;
  inspirationDescription: string;
  polish: string;
  polishDescription: string;
  debug: string;
  debugDescription: string;
  states: string;
  statesDescription: string;
  responsive: string;
  responsiveDescription: string;
  pasteHere: string;
  copy: string;
  paste: string;
  pasteOver: string;
  pasteToReplace: string;
  order: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
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
  copyAsPng: string;
  rotateClockwise: string;
  flipHorizontal: string;
  flipVertical: string;
  toggleUiShow: string;
  toggleUiHide: string;
  toggleCommentsShow: string;
  toggleCommentsHide: string;
  exploreWithAgent: string;
  copyLink: string;
  sendTo: string;
  sendToAgents: string;
  copyAgentPrompt: string;
}

export interface CanvasContextMenuShortcuts {
  pasteHere: string;
  copy: string;
  paste: string;
  pasteOver: string;
  pasteToReplace: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
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
  copyAsPng: string;
  rotateClockwise: string;
  flipHorizontal: string;
  flipVertical: string;
  toggleUi: string;
  toggleComments: string;
  exploreWithAgent: string;
  copyLink: string;
  group: string;
  booleanSubtract: string;
}

export interface CanvasContextMenuProps {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  selectedCount?: number;
  selectedLayerCount?: number;
  layerCandidates?: readonly CanvasLayerHitCandidate[];
  onSelectLayer?: (candidate: CanvasLayerHitCandidate) => void;
  onAgentPreset?: (
    preset: CanvasAgentPreset,
    details: CanvasContextMenuActionDetails,
  ) => void;
  onSendTo?: (target: AgentShareDestination | "prompt") => void;
  hasClipboard?: boolean;
  hasPropsClipboard?: boolean;
  isLocked?: boolean;
  isHidden?: boolean;
  isUiHidden?: boolean;
  isCommentsHidden?: boolean;
  canPasteHere?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canPasteOver?: boolean;
  canPasteToReplace?: boolean;
  canReorder?: boolean;
  canFrameSelection?: boolean;
  canAddAutoLayout?: boolean;
  canSuggestAutoLayout?: boolean;
  canCreateComponent?: boolean;
  isComponentInstance?: boolean;
  canGoToMainComponent?: boolean;
  canSwapInstance?: boolean;
  canDetachInstance?: boolean;
  canRename?: boolean;
  canToggleLocked?: boolean;
  canToggleHidden?: boolean;
  canCopyProps?: boolean;
  canPasteProps?: boolean;
  canCopyAsPng?: boolean;
  canRotateClockwise?: boolean;
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
  onCopy?: CanvasContextMenuActionHandler;
  onPaste?: CanvasContextMenuActionHandler;
  onPasteOver?: CanvasContextMenuActionHandler;
  onPasteToReplace?: CanvasContextMenuActionHandler;
  onBringForward?: CanvasContextMenuActionHandler;
  onBringToFront?: CanvasContextMenuActionHandler;
  onSendBackward?: CanvasContextMenuActionHandler;
  onSendToBack?: CanvasContextMenuActionHandler;
  onFrameSelection?: CanvasContextMenuActionHandler;
  onAddAutoLayout?: CanvasContextMenuActionHandler;
  onSuggestAutoLayout?: CanvasContextMenuActionHandler;
  onCreateComponent?: CanvasContextMenuActionHandler;
  onGoToMainComponent?: CanvasContextMenuActionHandler;
  onSwapInstance?: CanvasContextMenuActionHandler;
  onDetachInstance?: CanvasContextMenuActionHandler;
  onRename?: CanvasContextMenuActionHandler;
  onToggleLocked?: CanvasContextMenuActionHandler;
  onToggleHidden?: CanvasContextMenuActionHandler;
  onCopyProps?: CanvasContextMenuActionHandler;
  onPasteProps?: CanvasContextMenuActionHandler;
  onCopyAsPng?: CanvasContextMenuActionHandler;
  onRotateClockwise?: CanvasContextMenuActionHandler;
  onFlipHorizontal?: CanvasContextMenuActionHandler;
  onFlipVertical?: CanvasContextMenuActionHandler;
  onToggleUi?: CanvasContextMenuActionHandler;
  onToggleComments?: CanvasContextMenuActionHandler;
  onGroup?: CanvasContextMenuActionHandler;
  onBooleanSubtract?: CanvasContextMenuActionHandler;
  onExploreWithAgent?: CanvasContextMenuActionHandler;
  onCopyLink?: CanvasContextMenuActionHandler;
  appendedItems?: ReactNode;
}

const DEFAULT_LABELS: CanvasContextMenuLabels = {
  selectLayer: "Select layer",
  editWithAgent: "Edit with Agent",
  arrange: "Arrange",
  transform: "Transform",
  group: "Group selection",
  booleanOperations: "Boolean operations",
  subtract: "Subtract",
  inspiration: "Inspiration",
  inspirationDescription: "Explore multiple variants",
  polish: "Polish",
  polishDescription: "Improve hierarchy and consistency",
  debug: "Debug",
  debugDescription: "Find and fix issues",
  states: "Generate states",
  statesDescription: "Empty, loading, and error",
  responsive: "Make responsive",
  responsiveDescription: "Adapt to narrow widths",
  pasteHere: "Paste here",
  copy: "Copy",
  paste: "Paste",
  pasteOver: "Paste over",
  pasteToReplace: "Paste to replace",
  order: "Order",
  bringForward: "Bring forward",
  bringToFront: "Bring to front",
  sendBackward: "Send backward",
  sendToBack: "Send to back",
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
  copyAsPng: "Copy as PNG",
  rotateClockwise: "Rotate 90° clockwise",
  flipHorizontal: "Flip horizontal",
  flipVertical: "Flip vertical",
  toggleUiShow: "Show UI",
  toggleUiHide: "Hide UI",
  toggleCommentsShow: "Show comments",
  toggleCommentsHide: "Hide comments",
  exploreWithAgent: "Explore with Agent",
  copyLink: "Copy link",
  sendTo: "Send to",
  sendToAgents: "Agents",
  copyAgentPrompt: "Copy agent prompt",
};

const DEFAULT_SHORTCUT_BINDINGS: Record<
  keyof CanvasContextMenuShortcuts,
  string
> = {
  pasteHere: "$mod+v",
  copy: "$mod+c",
  paste: "$mod+v",
  pasteOver: "$mod+shift+v",
  pasteToReplace: "$mod+shift+r",
  bringForward: "$mod+]",
  bringToFront: "]",
  sendBackward: "$mod+[",
  sendToBack: "[",
  frameSelection: "$mod+alt+g",
  addAutoLayout: "shift+a",
  createComponent: "$mod+alt+k",
  goToMainComponent: "",
  swapInstance: "",
  detachInstance: "$mod+alt+b",
  rename: "$mod+r",
  toggleLock: "$mod+shift+l",
  toggleHide: "$mod+shift+h",
  copyProps: "$mod+alt+c",
  pasteProps: "$mod+alt+v",
  copyAsPng: "$mod+shift+c",
  rotateClockwise: "",
  flipHorizontal: "shift+h",
  flipVertical: "shift+v",
  toggleUi: "$mod+\\",
  toggleComments: "shift+c",
  exploreWithAgent: "",
  copyLink: "",
  group: "$mod+g",
  booleanSubtract: "alt+shift+s",
};

function defaultShortcutLabels(
  applePlatform: boolean,
): CanvasContextMenuShortcuts {
  const labels = {} as CanvasContextMenuShortcuts;
  for (const action of Object.keys(
    DEFAULT_SHORTCUT_BINDINGS,
  ) as (keyof CanvasContextMenuShortcuts)[]) {
    labels[action] = formatShortcutLabel(
      DEFAULT_SHORTCUT_BINDINGS[action],
      applePlatform,
    );
  }
  return labels;
}

type ActionCallbackMap = Partial<
  Record<CanvasContextMenuAction, CanvasContextMenuActionHandler>
>;

export function dispatchContextMenuAt(
  target: HTMLElement,
  point: CanvasContextMenuPoint,
) {
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: point.clientX,
      clientY: point.clientY,
    }),
  );
}

const CANVAS_CONTENT_TARGET_SELECTOR =
  "[data-frame-shell],[data-design-preview-iframe],[data-frame-selection-box],[data-draft-id]";

const SEND_TO_AGENTS: readonly {
  id: AgentShareDestination;
  label: string;
}[] = [
  { id: "claude", label: "Claude" },
  { id: "claude-code", label: "Claude Code" }, // i18n-ignore: product name
  { id: "codex", label: "Codex" },
];

const AGENT_PRESET_IDS: readonly CanvasAgentPreset[] = [
  "inspiration",
  "polish",
  "debug",
  "states",
  "responsive",
];

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
    selectedLayerCount = 0,
    layerCandidates = [],
    onSelectLayer,
    onAgentPreset,
    onSendTo,
    hasClipboard = false,
    hasPropsClipboard = false,
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
    canCopyAsPng = selectedCount > 0,
    canRotateClockwise = false,
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
    onCopyAsPng,
    onRotateClockwise,
    onFlipHorizontal,
    onFlipVertical,
    onToggleUi,
    onToggleComments,
    onGroup,
    onBooleanSubtract,
    onExploreWithAgent,
    onCopyLink,
    appendedItems,
  },
  ref,
) {
  const labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...labelsProp }),
    [labelsProp],
  );
  const applePlatform = useApplePlatform();
  const shortcuts = useMemo(
    () => ({ ...defaultShortcutLabels(applePlatform), ...shortcutsProp }),
    [applePlatform, shortcutsProp],
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
  const [emptyCanvasTarget, setEmptyCanvasTarget] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const imperativePointRef = useRef<CanvasContextMenuPoint | null>(null);
  const preventContextMenuFocusRestoreRef = useRef(false);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      openAt(nextPoint) {
        setPoint(nextPoint);
        imperativePointRef.current = nextPoint;
        if (triggerRef.current) {
          dispatchContextMenuAt(triggerRef.current, nextPoint);
        }
        imperativePointRef.current = null;
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
      "copy-as-png": onCopyAsPng,
      "rotate-clockwise": onRotateClockwise,
      "flip-horizontal": onFlipHorizontal,
      "flip-vertical": onFlipVertical,
      "toggle-ui": onToggleUi,
      "toggle-comments": onToggleComments,
      group: onGroup,
      "boolean-subtract": onBooleanSubtract,
      "explore-with-agent": onExploreWithAgent,
      "copy-link": onCopyLink,
    }),
    [
      onAddAutoLayout,
      onSuggestAutoLayout,
      onBringForward,
      onBringToFront,
      onCopy,
      onCopyAsPng,
      onCopyLink,
      onExploreWithAgent,
      onGroup,
      onBooleanSubtract,
      onRotateClockwise,
      onCopyProps,
      onCreateComponent,
      onDetachInstance,
      onFlipHorizontal,
      onFlipVertical,
      onFrameSelection,
      onGoToMainComponent,
      onPaste,
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
    ],
  );

  const runAction = useCallback(
    (action: CanvasContextMenuAction, originalEvent: Event) => {
      const details = {
        action,
        point,
        selectedCount,
        emptyCanvas: emptyCanvasTarget,
        originalEvent,
      };
      onAction?.(action, details);
      callbacks[action]?.(details);
    },
    [callbacks, emptyCanvasTarget, onAction, point, selectedCount],
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

  const hasSelection =
    (selectedCount > 0 || selectedLayerCount > 0) && !emptyCanvasTarget;
  const multipleLayers = selectedLayerCount > 1;
  const singleLayerCreationActions = !multipleLayers && !isComponentInstance;

  return (
    <ContextMenu open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
          className={cn("contents", className)}
          onContextMenuCapture={(event) => {
            if (imperativePointRef.current) {
              setPoint(imperativePointRef.current);
              setEmptyCanvasTarget(
                Boolean(imperativePointRef.current.emptyCanvas),
              );
              return;
            }
            // The open screen counts as selected even when nothing was
            // clicked, so only the pointer target says whether this is empty
            // canvas.
            setEmptyCanvasTarget(
              !(event.target as Element | null)?.closest?.(
                CANVAS_CONTENT_TARGET_SELECTOR,
              ),
            );
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
        onCloseAutoFocus={(event) => {
          if (!preventContextMenuFocusRestoreRef.current) return;
          event.preventDefault();
          preventContextMenuFocusRestoreRef.current = false;
        }}
      >
        {hasSelection ? (
          <>
            {layerCandidates.length > 1 && onSelectLayer ? (
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

            <ContextMenuGroup>
              {!isHiddenAction("edit-with-agent") ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    className={MENU_SUB_TRIGGER_CLASS}
                    onClick={(event) => {
                      preventContextMenuFocusRestoreRef.current = true;
                      runAction("explore-with-agent", event.nativeEvent);
                      handleOpenChange(false);
                    }}
                  >
                    {labels.editWithAgent}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(MENU_CONTENT_CLASS, "w-[280px]")}
                  >
                    {AGENT_PRESET_IDS.map((preset) => (
                      <CanvasMenuItem
                        key={preset}
                        disabled={!onAgentPreset}
                        label={labels[preset]}
                        description={labels[`${preset}Description`]}
                        onSelect={(event) => {
                          preventContextMenuFocusRestoreRef.current = true;
                          onAgentPreset?.(preset, {
                            action: "edit-with-agent",
                            point,
                            selectedCount,
                            emptyCanvas: emptyCanvasTarget,
                            originalEvent: event,
                          });
                        }}
                      />
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
              {onSendTo ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger className={MENU_SUB_TRIGGER_CLASS}>
                    {labels.sendTo}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className={MENU_CONTENT_CLASS}>
                    <ContextMenuLabel className="px-2 py-1 text-[11px] font-normal text-muted-foreground">
                      {labels.sendToAgents}
                    </ContextMenuLabel>
                    {SEND_TO_AGENTS.map(({ id, label }) => (
                      <CanvasMenuItem
                        key={id}
                        label={label}
                        onSelect={() => onSendTo(id)}
                      />
                    ))}
                    <CanvasMenuSeparator />
                    <CanvasMenuItem
                      label={labels.copyAgentPrompt}
                      onSelect={() => onSendTo("prompt")}
                    />
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
              <CanvasMenuItem
                hidden={isHiddenAction("copy-link")}
                disabled={!canRun("copy-link", true)}
                label={labels.copyLink}
                onSelect={(event) => runAction("copy-link", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("copy")}
                disabled={!canRun("copy", canCopy)}
                label={labels.copy}
                shortcut={shortcuts.copy}
                onSelect={(event) => runAction("copy", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("paste-to-replace")}
                disabled={!canRun("paste-to-replace", canPasteToReplace)}
                label={labels.pasteToReplace}
                shortcut={shortcuts.pasteToReplace}
                onSelect={(event) => runAction("paste-to-replace", event)}
              />
              {!isComponentInstance ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    disabled={
                      !(
                        canRun("copy-as-png", canCopyAsPng) ||
                        canRun("copy-props", canCopyProps) ||
                        canRun("paste-props", canPasteProps) ||
                        canRun("paste-over", canPasteOver)
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
                      hidden={isHiddenAction("copy-as-png")}
                      disabled={!canRun("copy-as-png", canCopyAsPng)}
                      label={labels.copyAsPng}
                      shortcut={shortcuts.copyAsPng}
                      onSelect={(event) => runAction("copy-as-png", event)}
                    />
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
                      hidden={isHiddenAction("paste-over")}
                      disabled={!canRun("paste-over", canPasteOver)}
                      label={labels.pasteOver}
                      shortcut={shortcuts.pasteOver}
                      onSelect={(event) => runAction("paste-over", event)}
                    />
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
            </ContextMenuGroup>

            <CanvasMenuSeparator />

            <ContextMenuGroup>
              {isComponentInstance ? (
                <>
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
                </>
              ) : null}
              <CanvasMenuItem
                hidden={!singleLayerCreationActions || isHiddenAction("rename")}
                disabled={!canRun("rename", canRename)}
                label={labels.rename}
                shortcut={shortcuts.rename}
                onSelect={(event) => {
                  preventContextMenuFocusRestoreRef.current = true;
                  runAction("rename", event);
                }}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("group") || !multipleLayers}
                disabled={!canRun("group", true)}
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
              <CanvasMenuItem
                hidden={
                  isHiddenAction("add-auto-layout") || isComponentInstance
                }
                disabled={!canRun("add-auto-layout", canAddAutoLayout)}
                label={labels.addAutoLayout}
                shortcut={shortcuts.addAutoLayout}
                onSelect={(event) => runAction("add-auto-layout", event)}
              />
              {onSuggestAutoLayout && !isComponentInstance ? (
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
                hidden={
                  !singleLayerCreationActions ||
                  isHiddenAction("create-component")
                }
                disabled={!canRun("create-component", canCreateComponent)}
                label={labels.createComponent}
                shortcut={shortcuts.createComponent}
                onSelect={(event) => runAction("create-component", event)}
              />
              {multipleLayers &&
              onBooleanSubtract &&
              !isHiddenAction("boolean-subtract") ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    disabled={!canRun("boolean-subtract", true)}
                    className={MENU_SUB_TRIGGER_CLASS}
                  >
                    {labels.booleanOperations}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(MENU_CONTENT_CLASS, "w-52")}
                  >
                    <CanvasMenuItem
                      disabled={!canRun("boolean-subtract", true)}
                      label={labels.subtract}
                      shortcut={shortcuts.booleanSubtract}
                      onSelect={(event) => runAction("boolean-subtract", event)}
                    />
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : null}
            </ContextMenuGroup>

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
              <ContextMenuSub>
                <ContextMenuSubTrigger
                  disabled={
                    !(
                      canRun("bring-to-front", canReorder) ||
                      canRun("send-to-back", canReorder)
                    )
                  }
                  className={MENU_SUB_TRIGGER_CLASS}
                >
                  {labels.arrange}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent
                  className={cn(MENU_CONTENT_CLASS, "w-52")}
                >
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
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSub>
                <ContextMenuSubTrigger
                  disabled={
                    !(
                      canRun("rotate-clockwise", canRotateClockwise) ||
                      canRun("flip-horizontal", canFlipHorizontal) ||
                      canRun("flip-vertical", canFlipVertical)
                    )
                  }
                  className={MENU_SUB_TRIGGER_CLASS}
                >
                  {labels.transform}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent
                  className={cn(MENU_CONTENT_CLASS, "w-52")}
                >
                  <CanvasMenuItem
                    hidden={isHiddenAction("rotate-clockwise")}
                    disabled={!canRun("rotate-clockwise", canRotateClockwise)}
                    label={labels.rotateClockwise}
                    shortcut={shortcuts.rotateClockwise}
                    onSelect={(event) => runAction("rotate-clockwise", event)}
                  />
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
                </ContextMenuSubContent>
              </ContextMenuSub>
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
            {/* The empty canvas menu leads with agent and sharing, then paste and visibility controls. */}
            <ContextMenuGroup>
              <CanvasMenuItem
                hidden={isHiddenAction("explore-with-agent")}
                disabled={!canRun("explore-with-agent", true)}
                label={labels.exploreWithAgent}
                shortcut={shortcuts.exploreWithAgent}
                onSelect={(event) => runAction("explore-with-agent", event)}
              />
              <CanvasMenuItem
                hidden={isHiddenAction("copy-link")}
                disabled={!canRun("copy-link", true)}
                label={labels.copyLink}
                shortcut={shortcuts.copyLink}
                onSelect={(event) => runAction("copy-link", event)}
              />
            </ContextMenuGroup>

            <CanvasMenuSeparator />

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
  onSelect: (event: Event) => void;
}) {
  const tag = candidate.info.tagName.toLowerCase();
  const Icon = candidate.info.componentName
    ? IconComponents
    : /^(h[1-6]|p|span|label|input|textarea)$/.test(tag)
      ? IconText
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

function CanvasMenuSeparator() {
  return <ContextMenuSeparator className={MENU_SEPARATOR_CLASS} />;
}
