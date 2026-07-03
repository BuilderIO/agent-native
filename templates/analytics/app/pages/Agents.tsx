import {
  agentNativePath,
  ObservabilityDashboard,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { DbAdminPage } from "@agent-native/core/client/db-admin";
import {
  IconActivity,
  IconAlertTriangle,
  IconChevronDown,
  IconDatabase,
  IconLoader2,
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
import { cn } from "@/lib/utils";

type AgentAdminView = "monitoring" | "database";

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

const AGENT_ADMIN_VIEWS: AgentAdminView[] = ["monitoring", "database"];

function parseView(value: string | null): AgentAdminView {
  return AGENT_ADMIN_VIEWS.includes(value as AgentAdminView)
    ? (value as AgentAdminView)
    : "monitoring";
}

export default function AgentsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const selectedConnectionId = searchParams.get("db");

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
        {view === "database" && (
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
