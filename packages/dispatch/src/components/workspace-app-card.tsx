import { useActionMutation } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconClockHour4,
  IconDots,
  IconEye,
  IconEyeOff,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { AppKeysPopover } from "@/components/app-keys-popover";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  isPendingBuilderHref,
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "@/lib/workspace-apps";

export function WorkspaceAppCard({
  app,
  className,
}: {
  app: WorkspaceAppSummary;
  className?: string;
}) {
  const href = workspaceAppHref(app);
  const openInNewTab = isPendingBuilderHref(app);
  const isPending = app.status === "pending";
  const isArchived = !!app.archived;

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

  return (
    <div
      aria-disabled={!href}
      className={cn(
        "group relative rounded-lg border bg-card p-4 transition hover:border-foreground/30 aria-disabled:opacity-60",
        isArchived && "opacity-70",
        className,
      )}
    >
      {href ? (
        <a
          href={href}
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noreferrer" : undefined}
          aria-label={`Open ${app.name}`}
          className="absolute inset-0 z-0 rounded-lg"
        />
      ) : null}

      <div className="pointer-events-none relative z-10 flex h-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {app.name}
            </h3>
            {isPending ? (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                Building
              </Badge>
            ) : null}
            {isArchived ? (
              <Badge variant="outline" className="shrink-0 gap-1">
                <IconEyeOff size={12} />
                Hidden
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {app.path}
          </p>
          {isPending && app.branchName ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Branch: {app.branchName}
            </p>
          ) : null}
          {app.description ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {app.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isPending && !isArchived ? (
            <div className="pointer-events-auto">
              <AppKeysPopover appId={app.id} appName={app.name} />
            </div>
          ) : null}
          <div className="pointer-events-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`More actions for ${app.name}`}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDots size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {isPending ? (
                  <DropdownMenuItem
                    onSelect={handleRemovePending}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    <IconTrash size={14} className="mr-2" />
                    Remove from list
                  </DropdownMenuItem>
                ) : isArchived ? (
                  <DropdownMenuItem onSelect={handleUnarchive}>
                    <IconEye size={14} className="mr-2" />
                    Restore to list
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={handleArchive}>
                    <IconEyeOff size={14} className="mr-2" />
                    Hide from list
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {href && !isArchived ? (
            <IconArrowUpRight
              size={16}
              className="text-muted-foreground transition group-hover:text-foreground"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
