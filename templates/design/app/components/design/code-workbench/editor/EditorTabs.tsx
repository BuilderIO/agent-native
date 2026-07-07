import { IconX } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

import { FileIcon } from "../explorer/file-icons";
import { useWorkbench, type EditorTab } from "../store";
import {
  baseName,
  parseWorkbenchUri,
  providerKindFromKey,
} from "../workspace/types";
import { isTabReorderNoop, resolveTabDropIndex } from "./tab-drag";

interface PendingClose {
  /** Uris that will be closed by this operation. */
  uris: string[];
  /** The dirty subset needing a save-or-discard decision. */
  dirtyUris: string[];
}

/**
 * Module-level drag state, mirroring LayersPanel's pattern: HTML5 DnD's
 * dataTransfer payload is unreliable for same-window reordering (some
 * browsers withhold it during dragover), so the source index is tracked in
 * module scope instead.
 */
let activeTabDrag: { fromIndex: number } | null = null;

export function EditorTabs() {
  const { state, api } = useWorkbench();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    index: number;
    side: "left" | "right";
  } | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

  const closeUris = useCallback(
    (uris: string[]) => {
      for (const uri of uris) api.closeTab(uri);
    },
    [api],
  );

  // Closing dirty tabs asks Save / Don't Save / Cancel (VS Code behavior);
  // clean tabs close immediately.
  const requestClose = useCallback(
    (uris: string[]) => {
      const buffers = api.getState().buffers;
      const dirtyUris = uris.filter((uri) => buffers[uri]?.dirty);
      if (dirtyUris.length === 0) {
        closeUris(uris);
        return;
      }
      setPendingClose({ uris, dirtyUris });
    },
    [api, closeUris],
  );

  const requestCloseTab = useCallback(
    (uri: string) => requestClose([uri]),
    [requestClose],
  );
  const requestCloseOthers = useCallback(
    (uri: string) =>
      requestClose(
        api
          .getState()
          .tabs.map((tab) => tab.uri)
          .filter((entry) => entry !== uri),
      ),
    [api, requestClose],
  );
  const requestCloseAll = useCallback(
    () => requestClose(api.getState().tabs.map((tab) => tab.uri)),
    [api, requestClose],
  );

  const handleSaveAndClose = useCallback(async () => {
    const pending = pendingClose;
    if (!pending) return;
    setPendingClose(null);
    try {
      for (const uri of pending.dirtyUris) {
        await api.save(uri);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save file" /* i18n-ignore */,
      );
      return;
    }
    closeUris(pending.uris);
  }, [api, closeUris, pendingClose]);

  const handleDiscardAndClose = useCallback(() => {
    const pending = pendingClose;
    if (!pending) return;
    setPendingClose(null);
    closeUris(pending.uris);
  }, [closeUris, pendingClose]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (event.deltaY === 0) return;
    el.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const handleDragStart = useCallback(
    (index: number) => (event: React.DragEvent) => {
      activeTabDrag = { fromIndex: index };
      event.dataTransfer.effectAllowed = "move";
      // Firefox requires data to be set for drag to initiate.
      event.dataTransfer.setData("text/plain", String(index));
    },
    [],
  );

  const handleDragOver = useCallback(
    (index: number) => (event: React.DragEvent) => {
      if (!activeTabDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const rightHalf = event.clientX - rect.left > rect.width / 2;
      setDropIndicator({ index, side: rightHalf ? "right" : "left" });
    },
    [],
  );

  const handleDrop = useCallback(
    (index: number) => (event: React.DragEvent) => {
      event.preventDefault();
      const drag = activeTabDrag;
      activeTabDrag = null;
      setDropIndicator(null);
      if (!drag) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const rightHalf = event.clientX - rect.left > rect.width / 2;
      const toIndex = resolveTabDropIndex(drag.fromIndex, index, rightHalf);
      if (isTabReorderNoop(drag.fromIndex, toIndex)) return;
      api.reorderTabs(drag.fromIndex, toIndex);
    },
    [api],
  );

  const handleDragEnd = useCallback(() => {
    activeTabDrag = null;
    setDropIndicator(null);
  }, []);

  if (state.tabs.length === 0) {
    return (
      <div
        data-testid="workbench-editor-tabs"
        className="h-9 shrink-0 border-b border-[var(--workbench-tab-border)] bg-[var(--workbench-tabbar-bg)]"
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      onWheel={handleWheel}
      data-testid="workbench-editor-tabs"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-[var(--workbench-tab-border)] bg-[var(--workbench-tabbar-bg)] [scrollbar-width:thin]"
    >
      {state.tabs.map((tab, index) => (
        <EditorTabRow
          key={tab.uri}
          tab={tab}
          index={index}
          active={tab.uri === state.activeUri}
          dropIndicator={
            dropIndicator?.index === index ? dropIndicator.side : null
          }
          onDragStart={handleDragStart(index)}
          onDragOver={handleDragOver(index)}
          onDrop={handleDrop(index)}
          onDragEnd={handleDragEnd}
          onRequestClose={requestCloseTab}
          onRequestCloseOthers={requestCloseOthers}
          onRequestCloseAll={requestCloseAll}
        />
      ))}
      <AlertDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {"Save changes before closing?" /* i18n-ignore */}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {"The following files have unsaved changes:" /* i18n-ignore */}{" "}
              {pendingClose?.dirtyUris
                .map((uri) => baseName(parseWorkbenchUri(uri).path))
                .join(", ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{"Cancel" /* i18n-ignore */}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-transparent text-foreground shadow-none hover:bg-muted"
              onClick={handleDiscardAndClose}
            >
              {"Don't Save" /* i18n-ignore */}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void handleSaveAndClose()}>
              {"Save" /* i18n-ignore */}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditorTabRow({
  tab,
  index,
  active,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRequestClose,
  onRequestCloseOthers,
  onRequestCloseAll,
}: {
  tab: EditorTab;
  index: number;
  active: boolean;
  dropIndicator: "left" | "right" | null;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onRequestClose: (uri: string) => void;
  onRequestCloseOthers: (uri: string) => void;
  onRequestCloseAll: () => void;
}) {
  const { state, api } = useWorkbench();
  const [hovered, setHovered] = useState(false);
  const meta = state.buffers[tab.uri];
  const dirty = meta?.dirty ?? false;
  const fileName = baseName(tab.path);
  const name =
    providerKindFromKey(tab.providerKey) === "inline"
      ? prettyScreenName(fileName)
      : fileName;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => api.setActive(tab.uri)}
          onMouseDown={(event) => {
            // Middle-click closes (VS Code parity).
            if (event.button === 1) {
              event.preventDefault();
              onRequestClose(tab.uri);
            }
          }}
          onDoubleClick={() => api.pinTab(tab.uri)}
          title={tab.path}
          data-testid="workbench-editor-tab"
          data-active={active || undefined}
          className={cn(
            "relative flex h-9 min-w-0 max-w-[200px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-[var(--workbench-tab-border)] px-3 text-[12px] outline-none",
            active
              ? "bg-[var(--workbench-tab-active-bg)] text-[var(--workbench-tab-active-fg)]"
              : "bg-[var(--workbench-tab-inactive-bg)] text-[var(--workbench-tab-inactive-fg)] hover:bg-[var(--workbench-list-hover-bg)]",
            dropIndicator === "left" &&
              "shadow-[inset_2px_0_0_0_var(--workbench-accent)]",
            dropIndicator === "right" &&
              "shadow-[inset_-2px_0_0_0_var(--workbench-accent)]",
          )}
        >
          {active ? (
            <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--workbench-accent)]" />
          ) : null}
          <FileIcon path={tab.path} />
          <span
            className={cn("min-w-0 flex-1 truncate", tab.preview && "italic")}
          >
            {name}
          </span>
          <button
            type="button"
            aria-label={
              dirty
                ? `Close ${name} (unsaved)` /* i18n-ignore */
                : `Close ${name}` /* i18n-ignore */
            }
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[3px] hover:bg-[var(--workbench-list-hover-bg)]"
            onClick={(event) => {
              event.stopPropagation();
              onRequestClose(tab.uri);
            }}
          >
            {dirty && !hovered ? (
              <span className="size-2 rounded-full bg-[var(--workbench-accent)]" />
            ) : (
              <IconX className="size-3.5" />
            )}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onRequestClose(tab.uri)}>
          {"Close" /* i18n-ignore */}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCloseOthers(tab.uri)}>
          {"Close Others" /* i18n-ignore */}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => api.closeSaved()}>
          {"Close Saved" /* i18n-ignore */}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestCloseAll()}>
          {"Close All" /* i18n-ignore */}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(tab.path);
          }}
        >
          {"Copy Path" /* i18n-ignore */}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => api.setSideView("explorer")}>
          {"Reveal in Explorer" /* i18n-ignore */}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
