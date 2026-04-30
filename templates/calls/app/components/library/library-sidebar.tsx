import { useMemo, useState } from "react";
import { NavLink, useLocation, useParams } from "react-router";
import {
  IconInbox,
  IconUsers,
  IconShare2,
  IconArchive,
  IconTrash,
  IconSettings,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconChevronRight,
  IconPlus,
  IconUpload,
  IconBookmark,
  IconSun,
  IconMoon,
  IconMessageChatbot,
  IconBolt,
  IconTarget,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  useActionQuery,
  useActionMutation,
  useSession,
} from "@agent-native/core/client";
import { openAgentSidebar } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { toast } from "sonner";

interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  children?: FolderNode[];
}

interface SpaceItem {
  id: string;
  name: string;
  color?: string | null;
  iconEmoji?: string | null;
}

interface SavedViewItem {
  id: string;
  name: string;
}

const NAV_ITEMS: Array<{
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (path: string) => boolean;
}> = [
  {
    to: "/library",
    label: "My Library",
    icon: IconInbox,
    match: (p) => p === "/" || p === "/library" || p.startsWith("/library/my"),
  },
  {
    to: "/library/team",
    label: "Team Library",
    icon: IconUsers,
    match: (p) => p.startsWith("/library/team"),
  },
  {
    to: "/library/shared",
    label: "Shared with Me",
    icon: IconShare2,
    match: (p) => p.startsWith("/library/shared"),
  },
  {
    to: "/trackers",
    label: "Trackers",
    icon: IconTarget,
    match: (p) => p.startsWith("/trackers"),
  },
  {
    to: "/archive",
    label: "Archive",
    icon: IconArchive,
    match: (p) => p.startsWith("/archive"),
  },
  {
    to: "/trash",
    label: "Trash",
    icon: IconTrash,
    match: (p) => p.startsWith("/trash"),
  },
  {
    to: "/settings",
    label: "Settings",
    icon: IconSettings,
    match: (p) => p.startsWith("/settings"),
  },
];

function buildTree(flat: FolderNode[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of flat) map.set(f.id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  for (const f of flat) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) {
      map.get(f.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface LibrarySidebarProps {
  className?: string;
}

export function LibrarySidebar({ className }: LibrarySidebarProps) {
  const location = useLocation();
  const params = useParams<{
    folderId?: string;
    spaceId?: string;
    viewId?: string;
  }>();

  const qc = useQueryClient();
  const { data: workspaceState } = useActionQuery<{
    currentId?: string | null;
    workspaces?: Array<{
      id: string;
      name: string;
      brandColor?: string | null;
    }>;
    folders?: FolderNode[];
    spaces?: SpaceItem[];
  }>("list-workspace-state", undefined, {});

  const workspaceId =
    workspaceState?.currentId ?? workspaceState?.workspaces?.[0]?.id ?? null;

  const folderList: FolderNode[] = useMemo(
    () => (workspaceState?.folders ?? []) as FolderNode[],
    [workspaceState?.folders],
  );
  const folderTree = useMemo(() => buildTree(folderList), [folderList]);

  const spaces: SpaceItem[] = workspaceState?.spaces ?? [];

  const { data: savedViewsData } = useActionQuery<{ views?: SavedViewItem[] }>(
    "list-saved-views",
    undefined,
    {},
  );
  const savedViews = savedViewsData?.views ?? [];

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(
    null,
  );
  const [newFolderName, setNewFolderName] = useState("");

  const createFolder = useActionMutation<
    any,
    { name: string; workspaceId: string; parentId: string | null }
  >("create-folder");

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    if (!workspaceId) {
      toast.error("Workspace not ready");
      return;
    }
    try {
      await createFolder.mutateAsync({
        name,
        workspaceId,
        parentId: newFolderParentId,
      });
      qc.invalidateQueries({ queryKey: ["action", "list-workspace-state"] });
      toast.success("Folder created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setNewFolderOpen(false);
      setNewFolderName("");
      setNewFolderParentId(null);
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="px-3 py-3">
        <WorkspaceSwitcher />
      </div>

      <div className="px-3">
        <Button className="w-full gap-1.5" size="sm" asChild>
          <NavLink to="/upload">
            <IconUpload className="h-4 w-4" />
            New call
          </NavLink>
        </Button>
      </div>

      <nav className="mt-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon, match }) => {
          const active = match
            ? match(location.pathname)
            : location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                active
                  ? "bg-accent text-foreground font-medium"
                  : "text-foreground hover:bg-accent/60",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-2 pb-3 space-y-5">
        <Section
          title="Folders"
          action={
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New folder"
              onClick={() => {
                setNewFolderParentId(null);
                setNewFolderOpen(true);
              }}
            >
              <IconFolderPlus className="h-3.5 w-3.5" />
            </button>
          }
        >
          {folderTree.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
              No folders yet
            </p>
          ) : (
            <ul className="space-y-0.5">
              {folderTree.map((f) => (
                <FolderItem
                  key={f.id}
                  node={f}
                  depth={0}
                  activeFolderId={params.folderId ?? null}
                  onNewSubfolder={(parentId) => {
                    setNewFolderParentId(parentId);
                    setNewFolderOpen(true);
                  }}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section title="Spaces">
          {spaces.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
              No spaces yet
            </p>
          ) : (
            <ul className="space-y-0.5">
              {spaces.map((s) => {
                const active = params.spaceId === s.id;
                return (
                  <li key={s.id}>
                    <NavLink
                      to={`/spaces/${s.id}`}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1 text-xs",
                        active
                          ? "bg-accent text-foreground"
                          : "text-foreground hover:bg-accent/60",
                      )}
                    >
                      <div
                        className="h-4 w-4 rounded flex items-center justify-center text-[10px] text-background shrink-0"
                        style={{
                          background: s.color ?? "hsl(var(--foreground))",
                        }}
                      >
                        {s.iconEmoji ?? s.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="truncate">{s.name}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Saved views">
          {savedViews.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
              Saved filters will appear here
            </p>
          ) : (
            <ul className="space-y-0.5">
              {savedViews.map((v) => {
                const active = params.viewId === v.id;
                return (
                  <li key={v.id}>
                    <NavLink
                      to={`/views/${v.id}`}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1 text-xs",
                        active
                          ? "bg-accent text-foreground"
                          : "text-foreground hover:bg-accent/60",
                      )}
                    >
                      <IconBookmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{v.name}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <div className="border-t border-border px-2 py-1">
        <ToolsSidebarSection />
      </div>

      <SidebarFooter />

      <AlertDialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {newFolderParentId ? "New subfolder" : "New folder"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateFolder();
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateFolder}>
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

interface FolderItemProps {
  node: FolderNode;
  depth: number;
  activeFolderId: string | null;
  onNewSubfolder: (parentId: string) => void;
}

function FolderItem({
  node,
  depth,
  activeFolderId,
  onNewSubfolder,
}: FolderItemProps) {
  const [open, setOpen] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isActive = activeFolderId === node.id;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1.5 py-1 text-xs",
          isActive
            ? "bg-accent text-foreground"
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
          aria-label={open ? "Collapse folder" : "Expand folder"}
        >
          <IconChevronRight className={cn("h-3 w-3", open && "rotate-90")} />
        </button>
        <NavLink
          to={`/library/folder/${node.id}`}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          {open && hasChildren ? (
            <IconFolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <IconFolder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </NavLink>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent-foreground/10"
          onClick={(e) => {
            e.stopPropagation();
            onNewSubfolder(node.id);
          }}
          title="New subfolder"
        >
          <IconPlus className="h-3 w-3" />
        </button>
      </div>
      {open && hasChildren && (
        <ul className="space-y-0.5">
          {node.children!.map((child) => (
            <FolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              onNewSubfolder={onNewSubfolder}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SidebarFooter() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { session } = useSession();
  const email = session?.email ?? "";
  const initials = email ? email.slice(0, 2).toUpperCase() : "??";
  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";

  return (
    <div className="border-t border-border p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-semibold shrink-0">
              {initials}
            </div>
            <span className="min-w-0 flex-1 truncate text-left">{email}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuItem
            onSelect={() => setTheme(isDark ? "light" : "dark")}
          >
            {isDark ? (
              <IconSun className="h-4 w-4 mr-2" />
            ) : (
              <IconMoon className="h-4 w-4 mr-2" />
            )}
            {isDark ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAgentSidebar()}>
            <IconMessageChatbot className="h-4 w-4 mr-2" />
            Open agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex items-center justify-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <IconSun className="h-3.5 w-3.5" />
          ) : (
            <IconMoon className="h-3.5 w-3.5" />
          )}
          {isDark ? "Light" : "Dark"}
        </button>
        <button
          type="button"
          onClick={() => openAgentSidebar()}
          className="flex items-center justify-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open agent"
        >
          <IconBolt className="h-3.5 w-3.5" />
          Agent
        </button>
      </div>
    </div>
  );
}
