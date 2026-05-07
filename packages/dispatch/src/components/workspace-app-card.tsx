import { IconArrowUpRight, IconClockHour4 } from "@tabler/icons-react";
import { AppKeysPopover } from "@/components/app-keys-popover";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div
      aria-disabled={!href}
      className={cn(
        "group relative rounded-lg border bg-card p-4 transition hover:border-foreground/30 aria-disabled:opacity-60",
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
            {app.status === "pending" ? (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                Building
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {app.path}
          </p>
          {app.status === "pending" && app.branchName ? (
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
          {app.status === "ready" ? (
            <div className="pointer-events-auto">
              <AppKeysPopover appId={app.id} appName={app.name} />
            </div>
          ) : null}
          {href ? (
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
