import { ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation, useParams } from "react-router";
import {
  IconInbox,
  IconArchive,
  IconTrash,
  IconUsersGroup,
  IconFolderPlus,
  IconPlayerRecord,
  IconAppWindow,
  IconX,
} from "@tabler/icons-react";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useFolders,
  useSpaces,
  useOrganizations,
  useCreateFolder,
} from "@/hooks/use-library";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import { FolderTree, type FolderNode } from "./folder-tree";
import { SearchBar } from "./search-bar";
import { OrganizationSwitcher } from "./organization-switcher";
import { toast } from "sonner";

interface LibraryLayoutProps {
  children: ReactNode;
}

export function LibraryLayout({ children }: LibraryLayoutProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { folderId, spaceId } = useParams<{
    folderId?: string;
    spaceId?: string;
  }>();

  const { shouldShowPromo, shouldShowSidebarLink, dismiss } = useDesktopPromo();

  const { data: organizations } = useOrganizations();
  const currentOrganizationId =
    organizations?.currentId ?? organizations?.organizations?.[0]?.id;

  const { data: spaces } = useSpaces(currentOrganizationId);
  const { data: libFolders } = useFolders({
    organizationId: currentOrganizationId,
  });

  const libFolderList: FolderNode[] = useMemo(
    () =>
      (libFolders?.folders ?? [])
        .filter((f: any) => !f.spaceId)
        .map((f: any) => ({
          id: f.id,
          parentId: f.parentId ?? null,
          spaceId: f.spaceId ?? null,
          name: f.name,
        })),
    [libFolders],
  );

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const createFolder = useCreateFolder();

  const navItems: {
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    match: (path: string) => boolean;
  }[] = [
    {
      to: "/library",
      label: "Library",
      icon: IconInbox,
      match: (p) => p.startsWith("/library"),
    },
    {
      to: "/spaces",
      label: "Spaces",
      icon: IconUsersGroup,
      match: (p) => p.startsWith("/spaces"),
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
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AgentSidebar
        position="right"
        defaultOpen={!isMobile}
        emptyStateText="How can I help with your recordings?"
        suggestions={[
          "Summarize my last recording",
          "Find the recording where I mentioned the Q3 plan",
          "Create a folder called Onboarding",
        ]}
      >
        <div className="flex h-full w-full">
          {/* Left sidebar */}
          <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
            <div className="px-3 py-3">
              <OrganizationSwitcher />
            </div>

            <div className="px-3">
              <Button
                className="w-full gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                size="sm"
                asChild
              >
                <NavLink to="/record">
                  <IconPlayerRecord className="h-4 w-4" />
                  New recording
                </NavLink>
              </Button>
            </div>

            <nav className="mt-3 px-2 space-y-0.5">
              {navItems.map(({ to, label, icon: Icon, match }) => {
                const active = match(location.pathname);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-accent/60",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </NavLink>
                );
              })}
            </nav>

            {shouldShowSidebarLink && (
              <div className="mt-3 px-2">
                <NavLink
                  to="/download"
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <IconAppWindow className="h-4 w-4" />
                  Get desktop app
                </NavLink>
              </div>
            )}

            <div className="mt-4 flex-1 overflow-y-auto px-2 pb-3 space-y-4">
              <div>
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Folders
                  </span>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-accent"
                    title="New folder"
                    onClick={() => setNewFolderOpen(true)}
                  >
                    <IconFolderPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <FolderTree
                  folders={libFolderList}
                  organizationId={currentOrganizationId}
                  spaceId={null}
                  buildPath={(id) => `/library/folder/${id}`}
                  activeFolderId={folderId ?? null}
                />
              </div>

              <div>
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Spaces
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {(spaces?.spaces ?? []).map((s: any) => {
                    const active = spaceId === s.id;
                    return (
                      <li key={s.id}>
                        <NavLink
                          to={`/spaces/${s.id}`}
                          className={cn(
                            "flex items-center gap-2 rounded px-2 py-1 text-xs",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-accent/60",
                          )}
                        >
                          <div
                            className="h-4 w-4 rounded flex items-center justify-center text-[10px]"
                            style={{
                              background: s.color ?? "hsl(var(--primary))",
                              color: "white",
                            }}
                          >
                            {s.iconEmoji ?? s.name.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="truncate">{s.name}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                  {(spaces?.spaces ?? []).length === 0 && (
                    <li className="px-2 py-1 text-[11px] text-muted-foreground/70">
                      No spaces yet
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </aside>

          {/* Main content area */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border px-5 py-2">
              <SearchBar />
              <div className="ml-auto flex items-center gap-2">
                <AgentToggleButton />
              </div>
            </header>
            {shouldShowPromo && (
              <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-5 py-2.5 text-sm">
                <IconAppWindow className="h-4 w-4 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">
                    Get the Clips desktop app.
                  </span>{" "}
                  <span className="text-muted-foreground">
                    Record from the menu bar, global shortcut, auto-updates.
                  </span>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <NavLink to="/download">Download</NavLink>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={dismiss}
                  title="I already have it"
                >
                  <IconX className="h-4 w-4" />
                </Button>
              </div>
            )}
            <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </AgentSidebar>

      {/* New folder dialog (library root) */}
      <AlertDialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New folder</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = newFolderName.trim();
                if (!name) return;
                if (!currentOrganizationId) {
                  toast.error("Organization not ready");
                  return;
                }
                createFolder.mutate(
                  {
                    name,
                    organizationId: currentOrganizationId,
                    parentId: null,
                  },
                  {
                    onSuccess: () => toast.success("Folder created"),
                    onError: (err: any) =>
                      toast.error(err?.message ?? "Create failed"),
                  },
                );
                setNewFolderName("");
                setNewFolderOpen(false);
              }}
            >
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
