import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  IconCalendar,
  IconChevronDown,
  IconChevronRight,
  IconClockHour4,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconKey,
  IconSettings,
  IconTrash,
  IconUser,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { cn } from "../lib/utils";
import {
  isPendingBuilderHref,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "../lib/workspace-apps";
import { ActionQueryError } from "./action-query-error";
import { AppIcon } from "./app-icon";
import { AppKeysPanel } from "./app-keys-popover";
import { AppListRow } from "./app-list-row";
import { AppOpenActions } from "./app-open-actions";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AppResourceEffectiveStack } from "./workspace-resource-effective-stack";

const APP_CARD_ACTION_CLASS =
  "size-7 rounded-md p-0 text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground";

export function WorkspaceAppCard({
  app,
  className,
}: {
  app: WorkspaceAppSummary;
  className?: string;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const href = workspaceAppHref(app);
  const isPending = app.status === "pending";
  const pendingLabel = app.statusLabel || "Builder branch";
  const isArchived = !!app.archived;
  const audience = app.audience ?? "internal";
  const [editOpen, setEditOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [draftName, setDraftName] = useState(app.name);
  const [draftDescription, setDraftDescription] = useState(
    app.description || "",
  );

  useEffect(() => {
    if (editOpen) return;
    setDraftName(app.name);
    setDraftDescription(app.description || "");
  }, [app.description, app.name, editOpen]);

  const archive = useActionMutation("archive-workspace-app", {
    onError: (err) =>
      toast.error(`Could not hide ${app.name}: ${stringifyError(err)}`),
  });
  const unarchive = useActionMutation("unarchive-workspace-app", {
    onError: (err) =>
      toast.error(`Could not restore ${app.name}: ${stringifyError(err)}`),
  });
  const removePending = useActionMutation("remove-pending-workspace-app", {
    onError: (err) =>
      toast.error(`Could not remove ${app.name}: ${stringifyError(err)}`),
  });
  const updateMetadata = useActionMutation("update-workspace-app-metadata", {
    onSuccess: () => {
      toast.success(`Updated ${draftName.trim() || app.name}`);
      setEditOpen(false);
    },
    onError: (err) =>
      toast.error(`Could not update ${app.name}: ${stringifyError(err)}`),
  });

  const handleArchive = () => {
    archive.mutate({ appId: app.id });
    toast.success(`Hid ${app.name} from the Apps list`);
  };
  const handleUnarchive = () => {
    unarchive.mutate({ appId: app.id });
    toast.success(`Restored ${app.name} to the Apps list`);
  };
  const handleRemovePending = () => {
    removePending.mutate({ appId: app.id });
    toast.success(`Removed pending ${app.name}`);
  };
  const handleMetadataSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      toast.error("App name is required.");
      return;
    }
    updateMetadata.mutate({
      appId: app.id,
      name,
      description: draftDescription.trim(),
    });
  };

  return (
    <>
      <AppListRow
        className={cn(
          !href && "opacity-60",
          isArchived && "opacity-70",
          className,
        )}
      >
        <AppIcon id={app.id} name={app.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {app.name}
          </h3>
          {app.description || isPending ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {app.description || pendingLabel}
            </p>
          ) : null}
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {isPending ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <IconClockHour4 size={12} />
                <span className="truncate">{pendingLabel}</span>
              </span>
            ) : null}
            {isArchived ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <IconEyeOff size={12} />
                Hidden
              </span>
            ) : null}
            {audience === "public" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <IconWorld size={12} />
                Public
              </span>
            ) : null}
            {isPending && app.branchName ? (
              <span className="min-w-0 truncate">{app.branchName}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WorkspaceAppOpenActions app={app} href={href} />
          <WorkspaceAppSettings
            app={app}
            formatDate={formatDate}
            isArchived={isArchived}
            isPending={isPending}
            onEdit={() => setEditOpen(true)}
            onKeys={() => setKeysOpen(true)}
            onResources={() => setResourcesOpen(true)}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onRemovePending={handleRemovePending}
            labels={{
              created: t("agents.dashboardMetadataCreated"),
              createdBy: t("agents.dashboardMetadataCreatedBy"),
              owner: t("dispatch.pages.appMetadataOwner"),
              teams: t("dispatch.pages.appMetadataTeams"),
              notTracked: t("agents.notTracked"),
            }}
          />
        </div>
      </AppListRow>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit app details</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleMetadataSubmit}>
            <div className="space-y-2">
              <Label htmlFor={`app-name-${app.id}`}>Name</Label>
              <Input
                id={`app-name-${app.id}`}
                value={draftName}
                maxLength={120}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`app-description-${app.id}`}>Description</Label>
              <Textarea
                id={`app-description-${app.id}`}
                value={draftDescription}
                maxLength={500}
                rows={4}
                onChange={(event) => setDraftDescription(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMetadata.isPending}>
                {updateMetadata.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage keys for {app.name}</DialogTitle>
            <DialogDescription>
              Choose which workspace credentials this app can use.
            </DialogDescription>
          </DialogHeader>
          <AppKeysPanel appId={app.id} appName={app.name} />
          <DialogFooter>
            <Button type="button" onClick={() => setKeysOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AppResourcesDialog
        app={app}
        open={resourcesOpen}
        onOpenChange={setResourcesOpen}
      />
    </>
  );
}

function WorkspaceAppOpenActions({
  app,
  href,
}: {
  app: WorkspaceAppSummary;
  href: string | null;
}) {
  const openInNewTab = isPendingBuilderHref(app);

  if (!href) {
    return (
      <Button size="sm" variant="outline" disabled>
        Open app
      </Button>
    );
  }

  return (
    <AppOpenActions
      name={app.name}
      href={href}
      target={openInNewTab ? "_blank" : undefined}
      rel={openInNewTab ? "noreferrer" : undefined}
      showInlineOption
      showNewTabOption
    />
  );
}

type WorkspaceAppMetadataLabels = {
  created: string;
  createdBy: string;
  owner: string;
  teams: string;
  notTracked: string;
};

function WorkspaceAppSettings({
  app,
  formatDate,
  isArchived,
  isPending,
  onEdit,
  onKeys,
  onResources,
  onArchive,
  onUnarchive,
  onRemovePending,
  labels,
}: {
  app: WorkspaceAppSummary;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
  isArchived: boolean;
  isPending: boolean;
  onEdit: () => void;
  onKeys: () => void;
  onResources: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onRemovePending: () => void;
  labels: WorkspaceAppMetadataLabels;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Settings for ${app.name}`}
              className={APP_CARD_ACTION_CLASS}
            >
              <IconSettings size={15} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>App settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={onEdit}>
          <IconEdit size={14} className="mr-2" />
          Edit details
        </DropdownMenuItem>
        {!isPending && !isArchived ? (
          <>
            <DropdownMenuItem onSelect={onKeys}>
              <IconKey size={14} className="mr-2" />
              Manage keys
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onResources}>
              <IconFileText size={14} className="mr-2" />
              Agent resources
            </DropdownMenuItem>
          </>
        ) : null}
        {isPending ? (
          <DropdownMenuItem
            onSelect={onRemovePending}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash size={14} className="mr-2" />
            Remove from list
          </DropdownMenuItem>
        ) : isArchived ? (
          <DropdownMenuItem onSelect={onUnarchive}>
            <IconEye size={14} className="mr-2" />
            Restore to list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onArchive}>
            <IconEyeOff size={14} className="mr-2" />
            Hide from list
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal">
          <WorkspaceAppMetadata
            app={app}
            formatDate={formatDate}
            labels={labels}
          />
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceAppMetadata({
  app,
  formatDate,
  labels,
}: {
  app: WorkspaceAppSummary;
  formatDate: ReturnType<typeof useFormatters>["formatDate"];
  labels: WorkspaceAppMetadataLabels;
}) {
  function formatMetadataDate(value: string | null | undefined): string {
    if (!value) return labels.notTracked;
    try {
      return formatDate(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return value;
    }
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <WorkspaceAppMetadataRow
        icon={IconCalendar}
        label={labels.created}
        value={formatMetadataDate(app.createdAt)}
      />
      <WorkspaceAppMetadataRow
        icon={IconUser}
        label={labels.createdBy}
        value={app.createdBy || labels.notTracked}
      />
      <WorkspaceAppMetadataRow
        icon={IconUser}
        label={labels.owner}
        value={app.owner || labels.notTracked}
      />
      <WorkspaceAppMetadataRow
        icon={IconUsersGroup}
        label={labels.teams}
        value={app.teams?.join(", ") || labels.notTracked}
      />
    </div>
  );
}

function WorkspaceAppMetadataRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconCalendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-foreground/80">{value}</span>
    </div>
  );
}

function AppResourcesDialog({
  app,
  open,
  onOpenChange,
}: {
  app: WorkspaceAppSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [inspectedResourceId, setInspectedResourceId] = useState<string | null>(
    null,
  );
  const query = useActionQuery(
    "list-workspace-resources-for-app",
    { appId: app.id },
    { enabled: open },
  );
  const { data, isLoading } = query;

  const resources = ((data as any)?.resources ?? []) as any[];
  const counts = (data as any)?.counts;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setInspectedResourceId(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{app.name} agent resources</DialogTitle>
          <DialogDescription>
            Workspace-scope agent resources are inherited at runtime. App shared
            and personal resources can override them locally.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            All-app agent resources live once at workspace scope and are read by
            each app agent when it builds context. Nothing is copied into this
            app.
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{counts?.total ?? 0} total</Badge>
            <Badge variant="outline">
              {counts?.workspace ?? counts?.global ?? 0} workspace
            </Badge>
            <Badge variant="outline">{counts?.granted ?? 0} granted</Badge>
            <Badge variant="outline">
              {counts?.autoLoaded ?? 0} auto-loaded
            </Badge>
          </div>

          {query.isError ? (
            <ActionQueryError
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : isLoading ? (
            <div className="space-y-2">
              <div className="h-14 rounded-lg border bg-muted/30" />
              <div className="h-14 rounded-lg border bg-muted/30" />
              <div className="h-14 rounded-lg border bg-muted/30" />
            </div>
          ) : resources.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No workspace or granted resources are visible to this app yet.
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {resources.map((resource) => {
                const inspected = inspectedResourceId === resource.id;
                return (
                  <div
                    key={resource.id}
                    className="rounded-lg border px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {resource.name}
                          </span>
                          <Badge variant="secondary">{resource.kind}</Badge>
                          <Badge variant="outline">
                            {resource.source === "workspace"
                              ? "All apps"
                              : "Granted"}
                          </Badge>
                          {resource.autoLoaded ? (
                            <Badge variant="outline">Auto-loaded</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {resource.path}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {resource.source === "grant" ? (
                          <div className="text-right text-[11px] text-muted-foreground">
                            Selected grant
                          </div>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            setInspectedResourceId(
                              inspected ? null : resource.id,
                            );
                          }}
                        >
                          {inspected ? (
                            <IconChevronDown size={14} className="mr-1" />
                          ) : (
                            <IconChevronRight size={14} className="mr-1" />
                          )}
                          Stack
                        </Button>
                      </div>
                    </div>

                    {resource.description ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {resource.description}
                      </p>
                    ) : null}

                    {inspected ? (
                      <AppResourceEffectiveStack
                        appId={app.id}
                        resource={resource}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
