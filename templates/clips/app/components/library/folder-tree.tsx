import { useT } from "@agent-native/core/client";
import {
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconTrash,
  IconEdit,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router";
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
import {
  useCreateFolder,
  useDeleteFolder,
  useRenameFolder,
} from "@/hooks/use-library";
import { cn } from "@/lib/utils";

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
  organizationId?: string;
  spaceId?: string | null;
  /** Build the URL for a folder — allows library or space-scoped trees. */
  buildPath: (folderId: string) => string;
  activeFolderId?: string | null;
}

export function FolderTree({
  folders,
  organizationId,
  spaceId = null,
  buildPath,
  activeFolderId,
}: FolderTreeProps) {
  const t = useT();
  const tree = useMemo(() => buildTree(folders), [folders]);

  if (folders.length === 0) {
    return (
      <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
        {t("folderTree.noFolders")}
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
          organizationId={organizationId}
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
  organizationId?: string;
  spaceId?: string | null;
}

function FolderItem({
  node,
  depth,
  buildPath,
  activeFolderId,
  organizationId,
  spaceId,
}: FolderItemProps) {
  const t = useT();
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
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-accent/60",
            )}
            style={{ paddingInlineStart: 6 + depth * 12 }}
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
                  "h-3 w-3 transition-transform rtl:-scale-x-100",
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
            <IconEdit className="h-3.5 w-3.5 me-2" /> {t("folderTree.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setNewValue("");
              setNewOpen(true);
            }}
          >
            <IconFolderPlus className="h-3.5 w-3.5 me-2" />{" "}
            {t("folderTree.newSubfolder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setConfirmDelete(true)}
            className="text-destructive"
          >
            <IconTrash className="h-3.5 w-3.5 me-2" /> {t("folderTree.delete")}
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
              organizationId={organizationId}
              spaceId={spaceId}
            />
          ))}
        </ul>
      )}

      {/* Rename dialog */}
      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("folderTree.renameFolder")}</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = renameValue.trim();
                if (!name) return;
                renameFolder.mutate(
                  { id: node.id, name },
                  {
                    onSuccess: () => toast.success(t("folderTree.renamed")),
                    onError: (err: any) =>
                      toast.error(err?.message ?? t("folderTree.renameFailed")),
                  },
                );
                setRenameOpen(false);
              }}
            >
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New subfolder dialog */}
      <AlertDialog open={newOpen} onOpenChange={setNewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("folderTree.newSubfolder")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("folderTree.createInside", { name: node.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={t("folderTree.folderName")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = newValue.trim();
                if (!name) return;
                createFolder.mutate(
                  {
                    name,
                    ...(organizationId ? { organizationId } : {}),
                    spaceId: spaceId ?? undefined,
                    parentId: node.id,
                  },
                  {
                    onSuccess: () => toast.success(t("folderTree.created")),
                    onError: (err: any) =>
                      toast.error(err?.message ?? t("folderTree.createFailed")),
                  },
                );
                setNewOpen(false);
              }}
            >
              {t("common.create")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("folderTree.deleteFolder")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("folderTree.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteFolder.mutate(
                  { id: node.id },
                  {
                    onSuccess: () => toast.success(t("folderTree.deleted")),
                    onError: (err: any) =>
                      toast.error(err?.message ?? t("folderTree.deleteFailed")),
                  },
                );
                setConfirmDelete(false);
              }}
            >
              {t("folderTree.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
