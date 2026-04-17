import { useMemo, useState } from "react";
import { NavLink } from "react-router";
import {
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconTrash,
  IconEdit,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { cn } from "@/lib/utils";
import {
  useCreateFolder,
  useDeleteFolder,
  useRenameFolder,
} from "@/hooks/use-library";
import { toast } from "sonner";

export interface FolderNode {
  id: string;
  parentId: string | null;
  spaceId: string | null;
  name: string;
  children?: FolderNode[];
}

function buildTree(folders: FolderNode[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

interface FolderTreeProps {
  folders: FolderNode[];
  workspaceId?: string;
  spaceId?: string | null;
  /** Build the URL for a folder — allows library or space-scoped trees. */
  buildPath: (folderId: string) => string;
  activeFolderId?: string | null;
}

export function FolderTree({
  folders,
  workspaceId,
  spaceId = null,
  buildPath,
  activeFolderId,
}: FolderTreeProps) {
  const tree = useMemo(() => buildTree(folders), [folders]);

  if (folders.length === 0) {
    return (
      <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
        No folders yet
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <FolderItem
          key={node.id}
          node={node}
          depth={0}
          buildPath={buildPath}
          activeFolderId={activeFolderId}
          workspaceId={workspaceId}
          spaceId={spaceId}
        />
      ))}
    </ul>
  );
}

interface FolderItemProps {
  node: FolderNode;
  depth: number;
  buildPath: (folderId: string) => string;
  activeFolderId?: string | null;
  workspaceId?: string;
  spaceId?: string | null;
}

function FolderItem({
  node,
  depth,
  buildPath,
  activeFolderId,
  workspaceId,
  spaceId,
}: FolderItemProps) {
  const [open, setOpen] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [newOpen, setNewOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasChildren = (node.children?.length ?? 0) > 0;
  const isActive = activeFolderId === node.id;

  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const createFolder = useCreateFolder();

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex items-center gap-1 rounded px-1.5 py-1 text-xs",
              isActive
                ? "bg-[#625DF5]/10 text-[#625DF5]"
                : "text-foreground hover:bg-accent/60",
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <button
              type="button"
              className={cn(
                "rounded p-0.5 text-muted-foreground",
                !hasChildren && "invisible",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
            >
              <IconChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  open && "rotate-90",
                )}
              />
            </button>
            <NavLink
              to={buildPath(node.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              {open && hasChildren ? (
                <IconFolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <IconFolder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{node.name}</span>
            </NavLink>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              setRenameValue(node.name);
              setRenameOpen(true);
            }}
          >
            <IconEdit className="h-3.5 w-3.5 mr-2" /> Rename
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setNewValue("");
              setNewOpen(true);
            }}
          >
            <IconFolderPlus className="h-3.5 w-3.5 mr-2" /> New subfolder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setConfirmDelete(true)}
            className="text-destructive"
          >
            <IconTrash className="h-3.5 w-3.5 mr-2" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {open && hasChildren && (
        <ul className="space-y-0.5">
          {node.children!.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              buildPath={buildPath}
              activeFolderId={activeFolderId}
              workspaceId={workspaceId}
              spaceId={spaceId}
            />
          ))}
        </ul>
      )}

      {/* Rename dialog */}
      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename folder</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#625DF5]/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = renameValue.trim();
                if (!name) return;
                renameFolder.mutate(
                  { id: node.id, name },
                  {
                    onSuccess: () => toast.success("Folder renamed"),
                    onError: (err: any) =>
                      toast.error(err?.message ?? "Rename failed"),
                  },
                );
                setRenameOpen(false);
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New subfolder dialog */}
      <AlertDialog open={newOpen} onOpenChange={setNewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New subfolder</AlertDialogTitle>
            <AlertDialogDescription>
              Create a folder inside "{node.name}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Folder name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#625DF5]/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!workspaceId) {
                  toast.error("Workspace not ready");
                  return;
                }
                const name = newValue.trim();
                if (!name) return;
                createFolder.mutate(
                  {
                    name,
                    workspaceId,
                    spaceId: spaceId ?? undefined,
                    parentId: node.id,
                  },
                  {
                    onSuccess: () => toast.success("Folder created"),
                    onError: (err: any) =>
                      toast.error(err?.message ?? "Create failed"),
                  },
                );
                setNewOpen(false);
              }}
            >
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Recordings inside will move to the parent scope (library root or
              the parent folder). Nested subfolders are removed. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteFolder.mutate(
                  { id: node.id },
                  {
                    onSuccess: () => toast.success("Folder deleted"),
                    onError: (err: any) =>
                      toast.error(err?.message ?? "Delete failed"),
                  },
                );
                setConfirmDelete(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
