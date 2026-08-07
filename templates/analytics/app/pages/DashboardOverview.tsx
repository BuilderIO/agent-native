import {
  callAction,
  useActionMutation,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconLayoutDashboard,
  IconLock,
  IconPlus,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardCacheScope } from "@/lib/prefetch-keys";

import { NewDashboardDialog } from "../components/layout/NewDashboardDialog";

type Scope = "personal" | "shared";
type Dashboard = {
  id: string;
  name?: string;
  title?: string;
  visibility?: string;
  folderId?: string | null;
};
type Folder = {
  id: string;
  name: string;
  scope: Scope;
  visibility?: string;
};

const createFolderAction = "create-dashboard-folder" as Parameters<
  typeof useActionMutation
>[0];
const setFolderAction = "set-dashboard-folder" as Parameters<
  typeof useActionMutation
>[0];

export default function DashboardOverview() {
  const t = useT();
  const { auth } = useAuth();
  const dashboardScope = dashboardCacheScope(auth);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderScope, setFolderScope] = useState<Scope>("personal");
  const [search, setSearch] = useState("");
  const [folderOverrides, setFolderOverrides] = useState<
    Record<string, string | null>
  >({});
  const foldersSync = useChangeVersions([
    "dashboard-folders",
    "dashboards",
    "action",
  ]);

  useEffect(() => {
    setFolderOverrides({});
  }, [dashboardScope]);

  const dashboardsQuery = useQuery<Dashboard[]>({
    queryKey: ["dashboards-overview", dashboardScope, foldersSync],
    queryFn: async () => {
      const rows = await callAction(
        "list-sql-dashboards",
        {},
        { method: "GET" },
      );
      if (!Array.isArray(rows)) return [];

      const validDashboards: Dashboard[] = [];
      for (const dashboard of rows) {
        if (
          !dashboard ||
          typeof dashboard !== "object" ||
          typeof dashboard.id !== "string" ||
          (dashboard.visibility !== "private" &&
            dashboard.visibility !== "org" &&
            dashboard.visibility !== "public")
        ) {
          continue;
        }
        validDashboards.push({
          id: dashboard.id,
          name: dashboard.name,
          visibility: dashboard.visibility,
          folderId: dashboard.folderId ?? null,
        });
      }
      return validDashboards;
    },
    staleTime: 30_000,
  });
  const foldersQuery = useQuery<{ folders: Folder[] }>({
    queryKey: ["dashboard-folders-overview", dashboardScope, foldersSync],
    queryFn: async () => {
      const result = await callAction(
        "list-dashboard-folders",
        {},
        { method: "GET" },
      );
      return (result ?? { folders: [] }) as { folders: Folder[] };
    },
    staleTime: 30_000,
  });
  const createFolder = useActionMutation<
    { folder: Folder },
    { name: string; scope: Scope }
  >(createFolderAction);
  const setFolder = useActionMutation<
    unknown,
    { dashboardId: string; folderId: string | null }
  >(setFolderAction);

  const dashboards = dashboardsQuery.data ?? [];
  const folders = foldersQuery.data?.folders ?? [];
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const filteredDashboards = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    if (!searchTerm) return dashboards;

    return dashboards.filter((dashboard) => {
      const folderId =
        dashboard.id in folderOverrides
          ? folderOverrides[dashboard.id]
          : dashboard.folderId;
      const folderName = folderId ? folderById.get(folderId)?.name : "";
      const dashboardName = dashboard.name || dashboard.title || "";
      return `${dashboardName} ${folderName ?? ""}`
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [dashboards, folderById, folderOverrides, search]);
  const grouped = useMemo(() => {
    const result = new Map<string, Dashboard[]>();
    const visibleFolderIds = new Set(folders.map((folder) => folder.id));
    for (const dashboard of filteredDashboards) {
      const folderId =
        dashboard.id in folderOverrides
          ? folderOverrides[dashboard.id]
          : dashboard.folderId;
      const id =
        folderId && visibleFolderIds.has(folderId) ? folderId : "unfiled";
      result.set(id, [...(result.get(id) ?? []), dashboard]);
    }
    return result;
  }, [filteredDashboards, folderOverrides, folders]);

  const createNewFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    try {
      await createFolder.mutateAsync({ name, scope: folderScope });
      setFolderName("");
      setFolderDialogOpen(false);
      await foldersQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("dashboardOverview.folderCreateFailed"),
      );
    }
  };

  const moveDashboard = async (
    dashboard: Dashboard,
    folderId: string | null,
  ) => {
    const previous =
      dashboard.id in folderOverrides
        ? folderOverrides[dashboard.id]
        : (dashboard.folderId ?? null);
    setFolderOverrides((current) => ({ ...current, [dashboard.id]: folderId }));
    try {
      await setFolder.mutateAsync({ dashboardId: dashboard.id, folderId });
      await dashboardsQuery.refetch();
      setFolderOverrides((current) => {
        const next = { ...current };
        delete next[dashboard.id];
        return next;
      });
    } catch (error) {
      setFolderOverrides((current) => ({
        ...current,
        [dashboard.id]: previous,
      }));
      toast.error(
        error instanceof Error
          ? error.message
          : t("dashboardOverview.moveFailed"),
      );
    }
  };

  if (dashboardsQuery.isLoading || foldersQuery.isLoading) {
    return <DashboardOverviewSkeleton />;
  }
  if (dashboardsQuery.isError || foldersQuery.isError) {
    return (
      <div className="dashboard-overview-layout mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboardOverview.loadFailed")}</CardTitle>
            <CardDescription>
              {t("dashboardOverview.loadFailedDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() =>
                void Promise.all([
                  dashboardsQuery.refetch(),
                  foldersQuery.refetch(),
                ])
              }
            >
              {t("sidebar.retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="dashboard-overview-layout mx-auto max-w-5xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight md:hidden">
          {t("dashboardOverview.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("dashboardOverview.description")}
        </p>
      </div>

      <div className="dashboard-overview-toolbar">
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("dashboardOverview.searchPlaceholder")}
            aria-label={t("sidebar.search")}
            className="pl-9"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <NewDashboardDialog triggerClassName="w-auto flex-1 justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 sm:flex-none" />
          <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 sm:flex-none">
                <IconFolderPlus />
                {t("dashboardOverview.newFolder")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("dashboardOverview.newFolder")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="folder-name">
                    {t("dashboardOverview.folderName")}
                  </Label>
                  <Input
                    id="folder-name"
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("dashboardOverview.folderScope")}</Label>
                  <Select
                    value={folderScope}
                    onValueChange={(value) => setFolderScope(value as Scope)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">
                        {t("dashboardOverview.personal")}
                      </SelectItem>
                      <SelectItem value="shared">
                        {t("dashboardOverview.shared")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setFolderDialogOpen(false)}
                >
                  {t("sidebar.cancel")}
                </Button>
                <Button
                  onClick={() => void createNewFolder()}
                  disabled={!folderName.trim() || createFolder.isPending}
                >
                  <IconPlus />
                  {t("dashboardOverview.createFolder")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {dashboards.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex items-start gap-3 p-5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconLayoutDashboard className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("dashboardOverview.empty")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("dashboardOverview.emptyDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : filteredDashboards.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="flex items-start gap-3 p-5">
            <IconSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("dashboardOverview.noDashboards")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card">
          {(["personal", "shared"] as Scope[]).map((scope) => (
            <DashboardScopeSection
              key={scope}
              scope={scope}
              dashboards={filteredDashboards}
              folders={folders}
              grouped={grouped}
              onMove={moveDashboard}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardOverviewSkeleton() {
  return (
    <div
      className="dashboard-overview-layout mx-auto max-w-5xl space-y-8"
      aria-busy="true"
    >
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function DashboardScopeSection({
  scope,
  dashboards,
  folders,
  grouped,
  onMove,
  t,
}: {
  scope: Scope;
  dashboards: Dashboard[];
  folders: Folder[];
  grouped: Map<string, Dashboard[]>;
  onMove: (dashboard: Dashboard, folderId: string | null) => void;
  t: ReturnType<typeof useT>;
}) {
  const scopeFolders = folders.filter((folder) => folder.scope === scope);
  const scopeDashboards = dashboards.filter((dashboard) =>
    isDashboardInScope(dashboard, scope),
  );
  const Icon = scope === "personal" ? IconLock : IconUsers;

  return (
    <section className="border-t border-border/50 first:border-t-0">
      <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            {scope === "personal"
              ? t("dashboardOverview.personal")
              : t("dashboardOverview.shared")}
          </h2>
        </div>
        <Badge variant="secondary" className="rounded-md px-2 font-normal">
          {scopeDashboards.length}
        </Badge>
      </div>

      {scopeDashboards.length === 0 && scopeFolders.length === 0 ? (
        <div className="flex items-start gap-3 p-5">
          <IconFolder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("dashboardOverview.noDashboards")}
          </p>
        </div>
      ) : (
        <>
          {scopeFolders.map((folder) => (
            <FolderSection
              key={folder.id}
              folder={folder}
              dashboards={grouped.get(folder.id) ?? []}
              folders={folders}
              scope={scope}
              onMove={onMove}
              t={t}
            />
          ))}
          <FolderSection
            folder={null}
            dashboards={grouped.get("unfiled") ?? []}
            folders={folders}
            scope={scope}
            onMove={onMove}
            t={t}
            hideWhenEmpty
          />
        </>
      )}
    </section>
  );
}

function FolderSection({
  folder,
  dashboards,
  folders,
  scope,
  onMove,
  t,
  hideWhenEmpty = false,
}: {
  folder: Folder | null;
  dashboards: Dashboard[];
  folders: Folder[];
  scope: Scope;
  onMove: (dashboard: Dashboard, folderId: string | null) => void;
  t: ReturnType<typeof useT>;
  hideWhenEmpty?: boolean;
}) {
  const scopedDashboards = dashboards.filter((dashboard) =>
    isDashboardInScope(dashboard, scope),
  );
  if (hideWhenEmpty && scopedDashboards.length === 0) return null;

  return (
    <section className="border-t border-border/50 first:border-t-0">
      <div className="flex items-center gap-2 px-4 py-3">
        <IconFolder className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 truncate text-sm font-medium">
          {folder?.name ?? t("dashboardOverview.unfiled")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {scopedDashboards.length}
        </span>
      </div>
      {scopedDashboards.length === 0 ? (
        <p className="border-t border-border/50 px-4 py-4 text-sm text-muted-foreground">
          {t("dashboardOverview.noDashboards")}
        </p>
      ) : (
        <div className="divide-y divide-border/50 border-t border-border/50">
          {scopedDashboards.map((dashboard) => (
            <DashboardRow
              key={dashboard.id}
              dashboard={dashboard}
              folders={folders}
              currentFolderId={folder?.id ?? null}
              onMove={onMove}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DashboardRow({
  dashboard,
  folders,
  currentFolderId,
  onMove,
  t,
}: {
  dashboard: Dashboard;
  folders: Folder[];
  currentFolderId: string | null;
  onMove: (dashboard: Dashboard, folderId: string | null) => void;
  t: ReturnType<typeof useT>;
}) {
  const name =
    dashboard.name || dashboard.title || t("sidebar.untitledDashboard");
  const candidateFolders = folders.filter((folder) => {
    if (dashboard.visibility === "private") {
      return folder.scope === "personal";
    }
    return dashboard.visibility === "org" && folder.scope === "shared";
  });
  const canOrganize = dashboard.visibility !== "public";

  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
      <Link
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        to={`/dashboards/${dashboard.id}`}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconLayoutDashboard className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium group-hover:text-primary">
            {name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {dashboard.visibility === "private"
              ? t("dashboardOverview.personal")
              : t("dashboardOverview.shared")}
          </p>
        </div>
      </Link>
      {canOrganize ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("dashboardOverview.moveDashboard")}
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("dashboardOverview.moveDashboard")}
            </DropdownMenuLabel>
            {candidateFolders.map((candidate) => (
              <DropdownMenuItem
                key={candidate.id}
                onSelect={() => onMove(dashboard, candidate.id)}
              >
                <IconFolder className="size-4 text-muted-foreground" />
                {candidate.name}
                {currentFolderId === candidate.id ? (
                  <IconCheck className="ml-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
            {candidateFolders.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => onMove(dashboard, null)}>
              <IconFolder className="size-4 text-muted-foreground" />
              {t("dashboardOverview.unfiled")}
              {currentFolderId === null ? (
                <IconCheck className="ml-auto size-4" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function isDashboardInScope(dashboard: Dashboard, scope: Scope): boolean {
  return scope === "personal"
    ? dashboard.visibility === "private"
    : dashboard.visibility === "org" || dashboard.visibility === "public";
}
