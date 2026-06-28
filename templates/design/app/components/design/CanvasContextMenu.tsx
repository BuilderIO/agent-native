import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconArrowDown,
  IconArrowUp,
  IconClipboard,
  IconClipboardCopy,
  IconCode,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconHierarchy,
  IconLayersSubtract,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconSelectAll,
  IconTrash,
  IconZoomInArea,
  IconZoomScan,
  type Icon,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

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

export type CanvasContextMenuAction =
  | "paste-here"
  | "select-all"
  | "zoom-to-fit"
  | "zoom-to-selection"
  | "copy"
  | "paste"
  | "paste-over"
  | "duplicate"
  | "delete"
  | "bring-forward"
  | "bring-to-front"
  | "send-backward"
  | "send-to-back"
  | "group"
  | "ungroup"
  | "rename"
  | "toggle-lock"
  | "toggle-hide"
  | "copy-props"
  | "paste-props"
  | "copy-as-code";

export interface CanvasContextMenuPoint {
  clientX: number;
  clientY: number;
  canvasX?: number;
  canvasY?: number;
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
  pasteHere: string;
  selectAll: string;
  zoomToFit: string;
  zoomToSelection: string;
  copy: string;
  paste: string;
  pasteOver: string;
  duplicate: string;
  delete: string;
  order: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
  group: string;
  ungroup: string;
  rename: string;
  lock: string;
  unlock: string;
  hide: string;
  show: string;
  copyProps: string;
  pasteProps: string;
  copyAsCode: string;
}

export interface CanvasContextMenuShortcuts {
  pasteHere: string;
  selectAll: string;
  zoomToFit: string;
  zoomToSelection: string;
  copy: string;
  paste: string;
  pasteOver: string;
  duplicate: string;
  delete: string;
  bringForward: string;
  bringToFront: string;
  sendBackward: string;
  sendToBack: string;
  group: string;
  ungroup: string;
  rename: string;
  copyProps: string;
  pasteProps: string;
  copyAsCode: string;
}

export interface CanvasContextMenuProps {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  selectedCount?: number;
  hasClipboard?: boolean;
  hasPropsClipboard?: boolean;
  isLocked?: boolean;
  isHidden?: boolean;
  canPasteHere?: boolean;
  canSelectAll?: boolean;
  canZoomToFit?: boolean;
  canZoomToSelection?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canPasteOver?: boolean;
  canDuplicate?: boolean;
  canDelete?: boolean;
  canReorder?: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  canRename?: boolean;
  canToggleLocked?: boolean;
  canToggleHidden?: boolean;
  canCopyProps?: boolean;
  canPasteProps?: boolean;
  canCopyAsCode?: boolean;
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
  onSelectAll?: CanvasContextMenuActionHandler;
  onZoomToFit?: CanvasContextMenuActionHandler;
  onZoomToSelection?: CanvasContextMenuActionHandler;
  onCopy?: CanvasContextMenuActionHandler;
  onPaste?: CanvasContextMenuActionHandler;
  onPasteOver?: CanvasContextMenuActionHandler;
  onDuplicate?: CanvasContextMenuActionHandler;
  onDelete?: CanvasContextMenuActionHandler;
  onBringForward?: CanvasContextMenuActionHandler;
  onBringToFront?: CanvasContextMenuActionHandler;
  onSendBackward?: CanvasContextMenuActionHandler;
  onSendToBack?: CanvasContextMenuActionHandler;
  onGroup?: CanvasContextMenuActionHandler;
  onUngroup?: CanvasContextMenuActionHandler;
  onRename?: CanvasContextMenuActionHandler;
  onToggleLocked?: CanvasContextMenuActionHandler;
  onToggleHidden?: CanvasContextMenuActionHandler;
  onCopyProps?: CanvasContextMenuActionHandler;
  onPasteProps?: CanvasContextMenuActionHandler;
  onCopyAsCode?: CanvasContextMenuActionHandler;
}

const DEFAULT_LABELS: CanvasContextMenuLabels = {
  pasteHere: "Paste here",
  selectAll: "Select all",
  zoomToFit: "Zoom to fit",
  zoomToSelection: "Zoom to selection",
  copy: "Copy",
  paste: "Paste",
  pasteOver: "Paste over",
  duplicate: "Duplicate",
  delete: "Delete",
  order: "Order",
  bringForward: "Bring forward",
  bringToFront: "Bring to front",
  sendBackward: "Send backward",
  sendToBack: "Send to back",
  group: "Group",
  ungroup: "Ungroup",
  rename: "Rename",
  lock: "Lock",
  unlock: "Unlock",
  hide: "Hide",
  show: "Show",
  copyProps: "Copy properties",
  pasteProps: "Paste properties",
  copyAsCode: "Copy as code",
};

const DEFAULT_SHORTCUTS: CanvasContextMenuShortcuts = {
  pasteHere: "Cmd+V",
  selectAll: "Cmd+A",
  zoomToFit: "Shift+1",
  zoomToSelection: "Shift+2",
  copy: "Cmd+C",
  paste: "Cmd+V",
  pasteOver: "Shift+Cmd+V",
  duplicate: "Cmd+D",
  delete: "Del",
  bringForward: "Cmd+]",
  bringToFront: "Opt+Cmd+]",
  sendBackward: "Cmd+[",
  sendToBack: "Opt+Cmd+[",
  group: "Cmd+G",
  ungroup: "Shift+Cmd+G",
  rename: "Cmd+R",
  copyProps: "Opt+Cmd+C",
  pasteProps: "Opt+Cmd+V",
  copyAsCode: "Shift+Cmd+C",
};

type ActionCallbackMap = Partial<
  Record<CanvasContextMenuAction, CanvasContextMenuActionHandler>
>;

export function CanvasContextMenu({
  children,
  disabled,
  className,
  contentClassName,
  selectedCount = 0,
  hasClipboard = false,
  hasPropsClipboard = false,
  isLocked = false,
  isHidden = false,
  canPasteHere = hasClipboard,
  canSelectAll = true,
  canZoomToFit = true,
  canZoomToSelection = selectedCount > 0,
  canCopy = selectedCount > 0,
  canPaste = hasClipboard,
  canPasteOver = hasClipboard && selectedCount > 0,
  canDuplicate = selectedCount > 0,
  canDelete = selectedCount > 0,
  canReorder = selectedCount > 0,
  canGroup = selectedCount > 1,
  canUngroup = false,
  canRename = selectedCount === 1,
  canToggleLocked = selectedCount > 0,
  canToggleHidden = selectedCount > 0,
  canCopyProps = selectedCount > 0,
  canPasteProps = hasPropsClipboard && selectedCount > 0,
  canCopyAsCode = selectedCount > 0,
  hiddenActions = [],
  disabledActions = [],
  labels: labelsProp,
  shortcuts: shortcutsProp,
  getCanvasPoint,
  onOpenChange,
  onAction,
  onPasteHere,
  onSelectAll,
  onZoomToFit,
  onZoomToSelection,
  onCopy,
  onPaste,
  onPasteOver,
  onDuplicate,
  onDelete,
  onBringForward,
  onBringToFront,
  onSendBackward,
  onSendToBack,
  onGroup,
  onUngroup,
  onRename,
  onToggleLocked,
  onToggleHidden,
  onCopyProps,
  onPasteProps,
  onCopyAsCode,
}: CanvasContextMenuProps) {
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

  const callbacks = useMemo<ActionCallbackMap>(
    () => ({
      "paste-here": onPasteHere,
      "select-all": onSelectAll,
      "zoom-to-fit": onZoomToFit,
      "zoom-to-selection": onZoomToSelection,
      copy: onCopy,
      paste: onPaste,
      "paste-over": onPasteOver,
      duplicate: onDuplicate,
      delete: onDelete,
      "bring-forward": onBringForward,
      "bring-to-front": onBringToFront,
      "send-backward": onSendBackward,
      "send-to-back": onSendToBack,
      group: onGroup,
      ungroup: onUngroup,
      rename: onRename,
      "toggle-lock": onToggleLocked,
      "toggle-hide": onToggleHidden,
      "copy-props": onCopyProps,
      "paste-props": onPasteProps,
      "copy-as-code": onCopyAsCode,
    }),
    [
      onBringForward,
      onBringToFront,
      onCopy,
      onCopyAsCode,
      onCopyProps,
      onDelete,
      onDuplicate,
      onGroup,
      onPaste,
      onPasteHere,
      onPasteOver,
      onPasteProps,
      onRename,
      onSelectAll,
      onSendBackward,
      onSendToBack,
      onToggleHidden,
      onToggleLocked,
      onUngroup,
      onZoomToFit,
      onZoomToSelection,
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

  return (
    <ContextMenu onOpenChange={onOpenChange}>
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
      <ContextMenuContent className={cn("w-56", contentClassName)}>
        <ContextMenuGroup>
          <CanvasMenuItem
            hidden={isHiddenAction("paste-here")}
            disabled={!canRun("paste-here", canPasteHere)}
            icon={IconClipboard}
            label={labels.pasteHere}
            shortcut={shortcuts.pasteHere}
            onSelect={(event) => runAction("paste-here", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("select-all")}
            disabled={!canRun("select-all", canSelectAll)}
            icon={IconSelectAll}
            label={labels.selectAll}
            shortcut={shortcuts.selectAll}
            onSelect={(event) => runAction("select-all", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <CanvasMenuItem
            hidden={isHiddenAction("zoom-to-fit")}
            disabled={!canRun("zoom-to-fit", canZoomToFit)}
            icon={IconZoomScan}
            label={labels.zoomToFit}
            shortcut={shortcuts.zoomToFit}
            onSelect={(event) => runAction("zoom-to-fit", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("zoom-to-selection")}
            disabled={!canRun("zoom-to-selection", canZoomToSelection)}
            icon={IconZoomInArea}
            label={labels.zoomToSelection}
            shortcut={shortcuts.zoomToSelection}
            onSelect={(event) => runAction("zoom-to-selection", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <CanvasMenuItem
            hidden={isHiddenAction("copy")}
            disabled={!canRun("copy", canCopy)}
            icon={IconCopy}
            label={labels.copy}
            shortcut={shortcuts.copy}
            onSelect={(event) => runAction("copy", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("paste")}
            disabled={!canRun("paste", canPaste)}
            icon={IconClipboard}
            label={labels.paste}
            shortcut={shortcuts.paste}
            onSelect={(event) => runAction("paste", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("paste-over")}
            disabled={!canRun("paste-over", canPasteOver)}
            icon={IconClipboardCopy}
            label={labels.pasteOver}
            shortcut={shortcuts.pasteOver}
            onSelect={(event) => runAction("paste-over", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("duplicate")}
            disabled={!canRun("duplicate", canDuplicate)}
            icon={IconCopy}
            label={labels.duplicate}
            shortcut={shortcuts.duplicate}
            onSelect={(event) => runAction("duplicate", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          {!isHiddenAction("bring-forward") ||
          !isHiddenAction("bring-to-front") ||
          !isHiddenAction("send-backward") ||
          !isHiddenAction("send-to-back") ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger
                disabled={
                  !(
                    canRun("bring-forward", canReorder) ||
                    canRun("bring-to-front", canReorder) ||
                    canRun("send-backward", canReorder) ||
                    canRun("send-to-back", canReorder)
                  )
                }
              >
                <IconArrowUp className="mr-2 size-4" />
                {labels.order}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                <CanvasMenuItem
                  hidden={isHiddenAction("bring-forward")}
                  disabled={!canRun("bring-forward", canReorder)}
                  icon={IconArrowUp}
                  label={labels.bringForward}
                  shortcut={shortcuts.bringForward}
                  onSelect={(event) => runAction("bring-forward", event)}
                />
                <CanvasMenuItem
                  hidden={isHiddenAction("bring-to-front")}
                  disabled={!canRun("bring-to-front", canReorder)}
                  icon={IconArrowBarToUp}
                  label={labels.bringToFront}
                  shortcut={shortcuts.bringToFront}
                  onSelect={(event) => runAction("bring-to-front", event)}
                />
                <CanvasMenuItem
                  hidden={isHiddenAction("send-backward")}
                  disabled={!canRun("send-backward", canReorder)}
                  icon={IconArrowDown}
                  label={labels.sendBackward}
                  shortcut={shortcuts.sendBackward}
                  onSelect={(event) => runAction("send-backward", event)}
                />
                <CanvasMenuItem
                  hidden={isHiddenAction("send-to-back")}
                  disabled={!canRun("send-to-back", canReorder)}
                  icon={IconArrowBarToDown}
                  label={labels.sendToBack}
                  shortcut={shortcuts.sendToBack}
                  onSelect={(event) => runAction("send-to-back", event)}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <CanvasMenuItem
            hidden={isHiddenAction("group")}
            disabled={!canRun("group", canGroup)}
            icon={IconHierarchy}
            label={labels.group}
            shortcut={shortcuts.group}
            onSelect={(event) => runAction("group", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("ungroup")}
            disabled={!canRun("ungroup", canUngroup)}
            icon={IconLayersSubtract}
            label={labels.ungroup}
            shortcut={shortcuts.ungroup}
            onSelect={(event) => runAction("ungroup", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <CanvasMenuItem
            hidden={isHiddenAction("rename")}
            disabled={!canRun("rename", canRename)}
            icon={IconPencil}
            label={labels.rename}
            shortcut={shortcuts.rename}
            onSelect={(event) => runAction("rename", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("toggle-lock")}
            disabled={!canRun("toggle-lock", canToggleLocked)}
            icon={isLocked ? IconLockOpen : IconLock}
            label={isLocked ? labels.unlock : labels.lock}
            onSelect={(event) => runAction("toggle-lock", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("toggle-hide")}
            disabled={!canRun("toggle-hide", canToggleHidden)}
            icon={isHidden ? IconEye : IconEyeOff}
            label={isHidden ? labels.show : labels.hide}
            onSelect={(event) => runAction("toggle-hide", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <ContextMenuGroup>
          <CanvasMenuItem
            hidden={isHiddenAction("copy-props")}
            disabled={!canRun("copy-props", canCopyProps)}
            icon={IconClipboardCopy}
            label={labels.copyProps}
            shortcut={shortcuts.copyProps}
            onSelect={(event) => runAction("copy-props", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("paste-props")}
            disabled={!canRun("paste-props", canPasteProps)}
            icon={IconClipboard}
            label={labels.pasteProps}
            shortcut={shortcuts.pasteProps}
            onSelect={(event) => runAction("paste-props", event)}
          />
          <CanvasMenuItem
            hidden={isHiddenAction("copy-as-code")}
            disabled={!canRun("copy-as-code", canCopyAsCode)}
            icon={IconCode}
            label={labels.copyAsCode}
            shortcut={shortcuts.copyAsCode}
            onSelect={(event) => runAction("copy-as-code", event)}
          />
        </ContextMenuGroup>

        <ContextMenuSeparator />

        <CanvasMenuItem
          hidden={isHiddenAction("delete")}
          disabled={!canRun("delete", canDelete)}
          icon={IconTrash}
          label={labels.delete}
          shortcut={shortcuts.delete}
          destructive
          onSelect={(event) => runAction("delete", event)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CanvasMenuItem({
  hidden,
  disabled,
  destructive,
  icon: Icon,
  label,
  shortcut,
  onSelect,
}: {
  hidden?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  icon: Icon;
  label: string;
  shortcut?: string;
  onSelect: (event: Event) => void;
}) {
  if (hidden) return null;

  return (
    <ContextMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(destructive && "text-destructive focus:text-destructive")}
    >
      <Icon className="mr-2 size-4" />
      <span className="truncate">{label}</span>
      {shortcut ? <ContextMenuShortcut>{shortcut}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  );
}
