import {
  agentNativePath,
  ObservabilityDashboard,
  useActionMutation,
  useActionQuery,
  useFormatters,
  useT,
} from "@agent-native/core/client";
import { DbAdminPage } from "@agent-native/core/client/db-admin";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconActivity,
  IconAlertTriangle,
  IconChartBar,
  IconChevronDown,
  IconDatabase,
  IconEye,
  IconLoader2,
  IconMouse,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type AgentAdminView = "monitoring" | "dashboards" | "database";

interface DbAdminConnection {
  id: string;
  name: string;
  appId: string | null;
  appUrl: string | null;
  databaseUrlLast4: string | null;
  hasDatabaseAuthToken: boolean;
  databaseAuthTokenLast4: string | null;
}

interface SaveDbAdminConnectionInput {
  name: string;
  appId?: string;
  appUrl?: string;
  databaseUrl: string;
  databaseAuthToken?: string;
}

interface DashboardUsageStats {
  id: string;
  name: string;
  kind: "explorer" | "sql";
  ownerEmail: string | null;
  visibility: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  viewCount: number;
  engagementCount: number;
  eventEngagementCount: number;
  savedViewCount: number;
  uniqueUserCount: number;
  lastViewedAt: string | null;
  lastSavedViewAt: string | null;
  panelCount: number | null;
  url: string;
}

const AGENT_ADMIN_VIEWS: AgentAdminView[] = [
  "monitoring",
  "dashboards",
  "database",
];

function parseView(value: string | null): AgentAdminView {
  return AGENT_ADMIN_VIEWS.includes(value as AgentAdminView)
    ? (value as AgentAdminView)
    : "monitoring";
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function DashboardUsageAdminPanel() {
  const t = useT();
  const { formatDate } = useFormatters();
  const numberFormat = useMemo(() => new Intl.NumberFormat(), []);
  const {
    data: dashboards = [],
    isLoading,
    error,
  } = useActionQuery<DashboardUsageStats[]>(
    "list-dashboard-usage-stats",
    undefined,
    { retry: false },
  );

  function formatCount(value: unknown) {
    return numberFormat.format(toCount(value));
  }

  function formatMaybeDate(value: string | null) {
    if (!value) return t("agents.notTracked");
    try {
      return formatDate(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return value;
    }
  }

  const activeDashboards = dashboards.filter(
    (dashboard) => !dashboard.archivedAt,
  );
  const totalViews = dashboards.reduce(
    (sum, dashboard) => sum + toCount(dashboard.viewCount),
    0,
  );
  const staleDashboards = dashboards.filter(
    (dashboard) => dashboard.viewCount === 0 && !dashboard.archivedAt,
  );
  const mostViewedDashboard = dashboards[0] ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {t("agents.dashboardUsageTitle")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("agents.dashboardUsageDescription")}
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      ) : isLoading ? (
        <div className="flex min-h-[460px] items-center justify-center rounded-lg border bg-background">
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : dashboards.length === 0 ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-lg border bg-background p-8 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <IconChartBar className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold">
              {t("agents.dashboardUsageEmpty")}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {t("agents.dashboardUsageEmptyDescription")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <UsageStatCard
              icon={IconChartBar}
              label={t("agents.dashboardUsageTotal")}
              value={formatCount(dashboards.length)}
              detail={t("agents.dashboardUsageActive", {
                count: formatCount(activeDashboards.length),
              })}
            />
            <UsageStatCard
              icon={IconEye}
              label={t("agents.dashboardUsageViews")}
              value={formatCount(totalViews)}
              detail={
                mostViewedDashboard
                  ? t("agents.dashboardUsageTop", {
                      name: mostViewedDashboard.name,
                    })
                  : t("agents.notTracked")
              }
            />
            <UsageStatCard
              icon={IconMouse}
              label={t("agents.dashboardUsageEngagements")}
              value={formatCount(
                dashboards.reduce(
                  (sum, dashboard) => sum + toCount(dashboard.engagementCount),
                  0,
                ),
              )}
              detail={t("agents.dashboardUsageEngagementsHint")}
            />
            <UsageStatCard
              icon={IconAlertTriangle}
              label={t("agents.dashboardUsageStale")}
              value={formatCount(staleDashboards.length)}
              detail={t("agents.dashboardUsageStaleHint")}
            />
          </div>

          <div className="overflow-hidden rounded-lg border bg-background">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("agents.dashboardUsageDashboard")}</TableHead>
                    <TableHead>{t("agents.dashboardUsageOwner")}</TableHead>
                    <TableHead>{t("agents.dashboardUsageViews")}</TableHead>
                    <TableHead>
                      {t("agents.dashboardUsageEngagements")}
                    </TableHead>
                    <TableHead>{t("agents.dashboardUsageUsers")}</TableHead>
                    <TableHead>{t("agents.dashboardUsageModified")}</TableHead>
                    <TableHead>{t("agents.dashboardUsageCreated")}</TableHead>
                    <TableHead>{t("agents.dashboardUsageState")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboards.map((dashboard) => (
                    <TableRow key={dashboard.id}>
                      <TableCell className="min-w-[240px]">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Link
                            to={dashboard.url}
                            className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {dashboard.name}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{dashboard.kind.toUpperCase()}</span>
                            {typeof dashboard.panelCount === "number" ? (
                              <span>
                                {t("agents.dashboardUsagePanels", {
                                  count: formatCount(dashboard.panelCount),
                                })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[180px] text-sm text-muted-foreground">
                        {dashboard.ownerEmail ?? t("agents.notTracked")}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCount(dashboard.viewCount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatMaybeDate(dashboard.lastViewedAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCount(dashboard.engagementCount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("agents.dashboardUsageSavedViews", {
                            count: formatCount(dashboard.savedViewCount),
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatCount(dashboard.uniqueUserCount)}
                      </TableCell>
                      <TableCell className="min-w-[180px]">
                        <div>{formatMaybeDate(dashboard.updatedAt)}</div>
                        <div className="text-xs text-muted-foreground">
                          {dashboard.updatedBy ?? t("agents.notTracked")}
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatMaybeDate(dashboard.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">
                            {t(`agents.visibility${dashboard.visibility}`)}
                          </Badge>
                          {dashboard.hiddenAt ? (
                            <Badge variant="secondary">
                              {t("agents.dashboardUsageHidden")}
                            </Badge>
                          ) : null}
                          {dashboard.archivedAt ? (
                            <Badge variant="secondary">
                              {t("agents.dashboardUsageArchived")}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UsageStatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof IconChartBar;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const t = useT();
  const { canManageOrg, isLoading: orgRoleLoading } = useOrgRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const selectedConnectionId = searchParams.get("db");
  const isAdminView = view === "dashboards" || view === "database";

  function setView(next: AgentAdminView) {
    const params = new URLSearchParams(searchParams);
    if (next === "monitoring") {
      params.delete("view");
      params.delete("db");
    } else {
      params.set("view", next);
    }
    setSearchParams(params, { replace: true });
  }

  function setSelectedConnectionId(id: string | null) {
    const params = new URLSearchParams(searchParams);
    params.set("view", "database");
    if (id) params.set("db", id);
    else params.delete("db");
    setSearchParams(params, { replace: true });
  }

  if (orgRoleLoading) {
    return (
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-center px-4 py-5 lg:px-6">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManageOrg && isAdminView) {
    return (
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-center px-4 py-5 lg:px-6">
        <div className="max-w-sm rounded-lg border bg-background p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <IconAlertTriangle className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-sm font-semibold">
            {t("agents.adminOnlyTitle")}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {t("agents.adminOnlyDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">{t("agents.title")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("agents.description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/catalog">{t("agents.openCatalog")}</Link>
          </Button>
          {canManageOrg ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  {t("agents.advanced")}
                  <IconChevronDown className="ms-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{t("agents.advanced")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setView("database")}>
                  <IconDatabase className="me-2 h-4 w-4" />
                  {t("agents.database")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <button
          type="button"
          onClick={() => setView("monitoring")}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
            view === "monitoring"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <IconActivity className="h-4 w-4" />
          {t("agents.monitoring")}
        </button>
        {canManageOrg ? (
          <button
            type="button"
            onClick={() => setView("dashboards")}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
              view === "dashboards"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <IconChartBar className="h-4 w-4" />
            {t("agents.dashboardUsage")}
          </button>
        ) : null}
        {canManageOrg && view === "database" && (
          <button
            type="button"
            onClick={() => setView("database")}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
          >
            <IconDatabase className="h-4 w-4" />
            {t("agents.database")}
          </button>
        )}
      </div>

      {view === "database" ? (
        <AnalyticsDbAdminPanel
          selectedConnectionId={selectedConnectionId}
          onSelectConnection={setSelectedConnectionId}
        />
      ) : view === "dashboards" ? (
        <DashboardUsageAdminPanel />
      ) : (
        <div className="min-w-0">
          <div className="mb-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("agents.monitoringDescription")}
          </div>
          <ObservabilityDashboard />
        </div>
      )}
    </div>
  );
}

function AnalyticsDbAdminPanel({
  selectedConnectionId,
  onSelectConnection,
}: {
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}) {
  const t = useT();
  const [connectOpen, setConnectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<SaveDbAdminConnectionInput>({
    name: "",
    appId: "",
    appUrl: "",
    databaseUrl: "",
    databaseAuthToken: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: connections = [],
    isLoading,
    error,
  } = useActionQuery<DbAdminConnection[]>(
    "list-db-admin-connections",
    undefined,
    { retry: false },
  );
  const saveConnection = useActionMutation<
    DbAdminConnection,
    SaveDbAdminConnectionInput
  >("save-db-admin-connection");
  const deleteConnection = useActionMutation<
    { deleted: boolean },
    { id: string }
  >("delete-db-admin-connection");

  const selectedConnection = useMemo(() => {
    return (
      connections.find(
        (connection) => connection.id === selectedConnectionId,
      ) ??
      connections[0] ??
      null
    );
  }, [connections, selectedConnectionId]);

  useEffect(() => {
    if (!selectedConnection) {
      if (selectedConnectionId) onSelectConnection(null);
      return;
    }
    if (selectedConnection.id !== selectedConnectionId) {
      onSelectConnection(selectedConnection.id);
    }
  }, [onSelectConnection, selectedConnection, selectedConnectionId]);

  const apiBasePath = selectedConnection
    ? agentNativePath(
        `/_agent-native/analytics-db-admin/${encodeURIComponent(
          selectedConnection.id,
        )}`,
      )
    : null;

  async function handleSaveConnection(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const saved = await saveConnection.mutateAsync(form);
      setConnectOpen(false);
      setForm({
        name: "",
        appId: "",
        appUrl: "",
        databaseUrl: "",
        databaseAuthToken: "",
      });
      onSelectConnection(saved.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteConnection() {
    if (!selectedConnection) return;
    await deleteConnection.mutateAsync({ id: selectedConnection.id });
    setDeleteOpen(false);
    const next = connections.find(
      (connection) => connection.id !== selectedConnection.id,
    );
    onSelectConnection(next?.id ?? null);
  }

  return (
    <div className="flex min-h-[560px] flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {t("agents.dbConnectionsTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("agents.dbConnectionsDescription")}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {connections.length > 0 ? (
            <Select
              value={selectedConnection?.id ?? ""}
              onValueChange={onSelectConnection}
            >
              <SelectTrigger className="h-9 w-[260px] max-w-full">
                <SelectValue placeholder={t("agents.selectConnection")} />
              </SelectTrigger>
              <SelectContent>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <IconPlus className="me-2 h-4 w-4" />
            {t("agents.connectDatabase")}
          </Button>
          {selectedConnection ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("agents.deleteConnection")}
              onClick={() => setDeleteOpen(true)}
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      ) : isLoading ? (
        <div className="flex min-h-[460px] items-center justify-center rounded-lg border bg-background">
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : selectedConnection && apiBasePath ? (
        <div className="min-h-[560px] flex-1 overflow-hidden rounded-lg border bg-background">
          <DbAdminPage
            apiBasePath={apiBasePath}
            cacheScope={`analytics-db-admin:${selectedConnection.id}`}
            title={selectedConnection.name}
            subtitle={
              selectedConnection.appId ??
              selectedConnection.appUrl ??
              t("agents.connectedDatabase")
            }
            codeModeGate={false}
            syncNavigation={false}
          />
        </div>
      ) : (
        <div className="flex min-h-[460px] items-center justify-center rounded-lg border bg-background p-8 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <IconDatabase className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-sm font-semibold">
              {t("agents.noConnections")}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {t("agents.noConnectionsDescription")}
            </p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => setConnectOpen(true)}
            >
              <IconPlus className="me-2 h-4 w-4" />
              {t("agents.connectDatabase")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("agents.connectDatabase")}</DialogTitle>
            <DialogDescription>
              {t("agents.connectDatabaseDescription")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={handleSaveConnection}>
            <div className="grid gap-2">
              <Label htmlFor="db-connection-name">
                {t("agents.connectionName")}
              </Label>
              <Input
                id="db-connection-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="db-connection-app-id">
                  {t("agents.connectionAppId")}
                </Label>
                <Input
                  id="db-connection-app-id"
                  value={form.appId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      appId: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="db-connection-app-url">
                  {t("agents.connectionAppUrl")}
                </Label>
                <Input
                  id="db-connection-app-url"
                  value={form.appUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      appUrl: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="db-connection-url">
                {t("agents.connectionDatabaseUrl")}
              </Label>
              <Input
                id="db-connection-url"
                value={form.databaseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    databaseUrl: event.target.value,
                  }))
                }
                type="password"
                autoComplete="off"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="db-connection-auth-token">
                {t("agents.connectionAuthToken")}
              </Label>
              <Input
                id="db-connection-auth-token"
                value={form.databaseAuthToken}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    databaseAuthToken: event.target.value,
                  }))
                }
                type="password"
                autoComplete="off"
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConnectOpen(false)}
              >
                {t("sidebar.cancel")}
              </Button>
              <Button type="submit" disabled={saveConnection.isPending}>
                {saveConnection.isPending ? (
                  <IconLoader2 className="me-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("agents.saveConnection")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agents.deleteConnectionTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("agents.deleteConnectionDescription", {
                name: selectedConnection?.name ?? t("agents.connectedDatabase"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConnection}>
              {t("agents.deleteConnection")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
