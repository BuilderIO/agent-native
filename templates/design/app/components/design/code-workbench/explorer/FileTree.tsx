import {
  IconChevronDown,
  IconChevronRight,
  IconFold,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

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
import { cn } from "@/lib/utils";

import { useWorkbench } from "../store";
import { flattenVisibleTree, type TreeNode } from "../workspace/tree";
import {
  baseName,
  workbenchUri,
  type WorkspaceCapabilities,
} from "../workspace/types";
import { FileIcon, FolderIcon } from "./file-icons";

interface PendingNewFile {
  parentPath: string;
}

interface FileTreeProps {
  providerKey: string;
  providerLabel: string;
  capabilities: WorkspaceCapabilities;
  nodes: TreeNode[];
  activeUri: string | null;
  dirtyUris: ReadonlySet<string>;
  focusToken: number;
  registerRef: (element: HTMLDivElement | null) => void;
  onRefresh: () => void;
  onRequestLocalWriteConsent?: (
    connectionId: string,
    retry: () => void,
  ) => void;
}

/**
 * Single-root file tree: renders folders + files, owns expansion state,
 * roving-tabindex keyboard nav, inline rename/new-file input rows, and the
 * per-row context menu.
 */
export function FileTree({
  providerKey,
  providerLabel,
  capabilities,
  nodes,
  activeUri,
  dirtyUris,
  focusToken,
  registerRef,
  onRefresh,
  onRequestLocalWriteConsent,
}: FileTreeProps) {
  const { api } = useWorkbench();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingNewFile, setPendingNewFile] = useState<PendingNewFile | null>(
    null,
  );
  const [newFileDraft, setNewFileDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  const rows = flattenVisibleTree(nodes, expandedPaths);

  useEffect(() => {
    if (focusToken === 0) return;
    containerRef.current?.focus();
  }, [focusToken]);

  const toggleFolder = useCallback((path: string, next?: boolean) => {
    setExpandedPaths((current) => {
      const nextSet = new Set(current);
      const shouldOpen = next ?? !nextSet.has(path);
      if (shouldOpen) nextSet.add(path);
      else nextSet.delete(path);
      return nextSet;
    });
  }, []);

  const openFile = useCallback(
    (path: string, options: { preview?: boolean } = {}) => {
      void api.openFile(providerKey, path, {
        preview: options.preview ?? true,
      });
    },
    [api, providerKey],
  );

  const startRename = useCallback((node: TreeNode) => {
    setRenamingPath(node.path);
    setRenameDraft(baseName(node.path));
  }, []);

  const handleWriteError = useCallback(
    (error: unknown) => {
      // Localhost providers throw a typed error when a write needs a fresh
      // consent grant; surface the existing consent dialog flow instead of a
      // silent failure. Checked by name to avoid a hard import-time coupling
      // to the B4 provider module from this packet.
      if (
        error instanceof Error &&
        error.name === "LocalWriteConsentRequiredError" &&
        providerKey.startsWith("localhost:")
      ) {
        onRequestLocalWriteConsent?.(
          providerKey.slice("localhost:".length),
          () => {},
        );
      }
    },
    [onRequestLocalWriteConsent, providerKey],
  );

  const commitRename = useCallback(
    async (node: TreeNode) => {
      const nextName = renameDraft.trim();
      setRenamingPath(null);
      if (!nextName || nextName === baseName(node.path)) return;
      const parentPath = node.path.split("/").slice(0, -1).join("/");
      const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
      try {
        await api.renameFile(providerKey, node.path, nextPath);
      } catch (error) {
        handleWriteError(error);
      }
    },
    [api, handleWriteError, providerKey, renameDraft],
  );

  const commitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api.deleteFile(providerKey, target.path);
    } catch (error) {
      handleWriteError(error);
    }
  }, [api, deleteTarget, handleWriteError, providerKey]);

  const commitNewFile = useCallback(async () => {
    if (!pendingNewFile) return;
    const name = newFileDraft.trim();
    setPendingNewFile(null);
    setNewFileDraft("");
    if (!name) return;
    const path = pendingNewFile.parentPath
      ? `${pendingNewFile.parentPath}/${name}`
      : name;
    try {
      await api.createFile(providerKey, path);
    } catch (error) {
      handleWriteError(error);
    }
  }, [api, handleWriteError, newFileDraft, pendingNewFile, providerKey]);

  const copyToClipboard = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value);
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, node: TreeNode, index: number) => {
      if (renamingPath || pendingNewFile) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = rows[index + 1];
        if (next) setFocusedPath(next.path);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = rows[index - 1];
        if (prev) setFocusedPath(prev.path);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        if (rows[0]) setFocusedPath(rows[0].path);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = rows[rows.length - 1];
        if (last) setFocusedPath(last.path);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (node.kind === "folder") {
          if (!expandedPaths.has(node.path)) toggleFolder(node.path, true);
          else {
            const next = rows[index + 1];
            if (next?.parentPath === node.path) setFocusedPath(next.path);
          }
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (node.kind === "folder" && expandedPaths.has(node.path)) {
          toggleFolder(node.path, false);
        } else {
          const row = rows[index];
          if (row?.parentPath) setFocusedPath(row.parentPath);
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (node.kind === "folder") toggleFolder(node.path);
        else openFile(node.path, { preview: false });
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (capabilities.rename) startRename(node);
        return;
      }
      if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const now = Date.now();
        const state = typeaheadRef.current;
        const text = now - state.at < 800 ? state.text + event.key : event.key;
        typeaheadRef.current = { text, at: now };
        const lower = text.toLowerCase();
        const match = rows.find((row) =>
          row.node.name.toLowerCase().startsWith(lower),
        );
        if (match) setFocusedPath(match.path);
      }
    },
    [
      capabilities.rename,
      expandedPaths,
      openFile,
      pendingNewFile,
      renamingPath,
      rows,
      startRename,
      toggleFolder,
    ],
  );

  return (
    <div className="flex flex-col">
      <div className="group/header flex h-[22px] shrink-0 items-center gap-1 px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-[var(--workbench-muted-fg)]">
        <span className="min-w-0 flex-1 truncate">{providerLabel}</span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/header:opacity-100">
          {capabilities.create ? (
            <HeaderIconButton
              label="New File" /* i18n-ignore */
              icon={IconPlus}
              onClick={() => {
                setPendingNewFile({ parentPath: "" });
                setNewFileDraft("");
              }}
            />
          ) : null}
          <HeaderIconButton
            label="Refresh" /* i18n-ignore */
            icon={IconRefresh}
            onClick={onRefresh}
          />
          <HeaderIconButton
            label="Collapse Folders" /* i18n-ignore */
            icon={IconFold}
            onClick={collapseAll}
          />
        </div>
      </div>
      <div
        ref={(element) => {
          containerRef.current = element;
          registerRef(element);
        }}
        role="tree"
        aria-label={providerLabel}
        tabIndex={0}
        className="px-1 outline-none"
        onKeyDown={(event) => {
          const index = rows.findIndex(
            (row) => row.path === (focusedPath ?? rows[0]?.path),
          );
          const node = rows[index]?.node;
          if (node) handleRowKeyDown(event, node, index);
        }}
      >
        {rows.map((row, index) => {
          const uri = workbenchUri(providerKey, row.path);
          const isActive = activeUri === uri;
          const isFocused = (focusedPath ?? rows[0]?.path) === row.path;
          const isDirty = dirtyUris.has(uri);
          const isExpanded =
            row.node.kind === "folder" && expandedPaths.has(row.path);
          const isRenaming = renamingPath === row.path;
          const canRenameNode = row.node.kind === "file" && capabilities.rename;
          const canDeleteNode = row.node.kind === "file" && capabilities.delete;
          return (
            <ContextMenu key={row.path}>
              <ContextMenuTrigger asChild>
                <div
                  role="treeitem"
                  aria-selected={isActive}
                  aria-expanded={
                    row.node.kind === "folder" ? isExpanded : undefined
                  }
                  tabIndex={isFocused ? 0 : -1}
                  data-tree-row-path={row.path}
                  className={cn(
                    "group flex h-6 cursor-pointer items-center gap-1 rounded-[5px] pr-1 text-[12px] outline-none",
                    isActive
                      ? "bg-[var(--workbench-list-active-bg,var(--workbench-active-bg))] text-[var(--workbench-active-fg)]"
                      : "text-[var(--workbench-fg)] hover:bg-[var(--workbench-hover-bg)]",
                    isFocused &&
                      "ring-1 ring-inset ring-[var(--workbench-accent)]",
                  )}
                  style={{ paddingLeft: 4 + row.depth * 12 }}
                  draggable={false}
                  onFocus={() => setFocusedPath(row.path)}
                  onClick={() => {
                    setFocusedPath(row.path);
                    if (row.node.kind === "folder") toggleFolder(row.path);
                    else openFile(row.path, { preview: true });
                  }}
                  onDoubleClick={() => {
                    if (row.node.kind === "file")
                      openFile(row.path, { preview: false });
                  }}
                  onKeyDown={(event) =>
                    handleRowKeyDown(event, row.node, index)
                  }
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-[var(--workbench-muted-fg)]">
                    {row.node.kind === "folder" ? (
                      isExpanded ? (
                        <IconChevronDown className="size-3.5" />
                      ) : (
                        <IconChevronRight className="size-3.5 rtl:-scale-x-100" />
                      )
                    ) : null}
                  </span>
                  {row.node.kind === "folder" ? (
                    <FolderIcon open={isExpanded} />
                  ) : (
                    <FileIcon path={row.node.path} />
                  )}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => commitRename(row.node)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void commitRename(row.node);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingPath(null);
                        }
                      }}
                      className="h-5 min-w-0 flex-1 rounded-[3px] border border-[var(--workbench-accent)] bg-[var(--workbench-editor-bg)] px-1 text-[12px] text-[var(--workbench-fg)] outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate" title={row.path}>
                      {row.node.name}
                    </span>
                  )}
                  {!isRenaming && isDirty ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--workbench-accent)]" />
                  ) : null}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-[180px] text-[12px]">
                {row.node.kind === "folder" && capabilities.create ? (
                  <ContextMenuItem
                    className="text-[12px]"
                    onSelect={() => {
                      toggleFolder(row.path, true);
                      setPendingNewFile({ parentPath: row.path });
                      setNewFileDraft("");
                    }}
                  >
                    {"New File…" /* i18n-ignore */}
                  </ContextMenuItem>
                ) : null}
                {canRenameNode ? (
                  <ContextMenuItem
                    className="text-[12px]"
                    onSelect={() => startRename(row.node)}
                  >
                    {"Rename…" /* i18n-ignore */}
                  </ContextMenuItem>
                ) : null}
                {canDeleteNode ? (
                  <ContextMenuItem
                    className="text-[12px] text-destructive focus:text-destructive"
                    onSelect={() => setDeleteTarget(row.node)}
                  >
                    {"Delete" /* i18n-ignore */}
                  </ContextMenuItem>
                ) : null}
                {canRenameNode || canDeleteNode ? (
                  <ContextMenuSeparator />
                ) : null}
                <ContextMenuItem
                  className="text-[12px]"
                  onSelect={() => copyToClipboard(row.path)}
                >
                  {"Copy Path" /* i18n-ignore */}
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-[12px]"
                  onSelect={() => copyToClipboard(row.path)}
                >
                  {"Copy Relative Path" /* i18n-ignore */}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {pendingNewFile ? (
          <div
            className="flex h-6 items-center gap-1 rounded-[5px] pr-1 text-[12px]"
            style={{
              paddingLeft:
                4 +
                (pendingNewFile.parentPath
                  ? (rows.find((row) => row.path === pendingNewFile.parentPath)
                      ?.depth ?? 0) + 1
                  : 0) *
                  12,
            }}
          >
            <span className="size-4 shrink-0" />
            <FileIcon path={newFileDraft || "untitled"} />
            <input
              autoFocus
              value={newFileDraft}
              placeholder="filename.ext" /* i18n-ignore */
              onChange={(event) => setNewFileDraft(event.target.value)}
              onBlur={() => commitNewFile()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitNewFile();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setPendingNewFile(null);
                  setNewFileDraft("");
                }
              }}
              className="h-5 min-w-0 flex-1 rounded-[3px] border border-[var(--workbench-accent)] bg-[var(--workbench-editor-bg)] px-1 text-[12px] text-[var(--workbench-fg)] outline-none"
            />
          </div>
        ) : null}
      </div>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {"Delete file?" /* i18n-ignore */}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.path
                ? `"${deleteTarget.path}" will be permanently deleted.` /* i18n-ignore */
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{"Cancel" /* i18n-ignore */}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void commitDelete()}>
              {"Delete" /* i18n-ignore */}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HeaderIconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof IconPlus;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-5 cursor-pointer items-center justify-center rounded-[4px] text-[var(--workbench-muted-fg)] hover:bg-[var(--workbench-hover-bg)] hover:text-[var(--workbench-fg)]"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
