import { IconClock, IconRestore, IconTimeline } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import type { ResourceVersion } from "../../history/types.js";
import { cn } from "../utils.js";
import {
  useResourceVersions,
  useRestoreResourceVersion,
} from "./use-history.js";

export interface VersionHistoryPanelProps {
  resourceType: string;
  resourceId: string;
  title?: string;
  className?: string;
  limit?: number;
  emptyState?: ReactNode;
  renderVersion?: (version: ResourceVersion) => ReactNode;
  onRestored?: (version: ResourceVersion, result: unknown) => void;
}

export function VersionHistoryPanel({
  resourceType,
  resourceId,
  title = "Version history",
  className,
  limit = 20,
  emptyState = "No saved versions yet.",
  renderVersion,
  onRestored,
}: VersionHistoryPanelProps) {
  const versions = useResourceVersions({ resourceType, resourceId, limit });
  const restore = useRestoreResourceVersion();
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <IconTimeline className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="divide-y divide-border">
        {versions.isLoading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Loading versions...
          </div>
        ) : versions.data?.versions.length ? (
          versions.data.versions.map((version) => {
            const confirming = confirmRestoreId === version.id;
            return (
              <article key={version.id} className="flex gap-3 px-4 py-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <IconClock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  {renderVersion ? (
                    renderVersion(version)
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="truncate text-sm font-medium">
                          {version.title ?? `Version ${version.versionNumber}`}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {formatVersionDate(version.createdAt)}
                        </span>
                      </div>
                      {version.summary ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {version.summary}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={restore.isPending}
                        onClick={() => setConfirmRestoreId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive bg-destructive px-2.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={restore.isPending}
                        onClick={() =>
                          restore.mutate(
                            { id: version.id },
                            {
                              onSuccess: (result) => {
                                setConfirmRestoreId(null);
                                onRestored?.(result.version, result.result);
                              },
                              onError: () => setConfirmRestoreId(null),
                            },
                          )
                        }
                      >
                        <IconRestore className="h-3.5 w-3.5" />
                        Confirm restore
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={restore.isPending}
                      onClick={() => setConfirmRestoreId(version.id)}
                    >
                      <IconRestore className="h-3.5 w-3.5" />
                      Restore
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {emptyState}
          </div>
        )}
      </div>
    </section>
  );
}

export function HistoryTimeline({
  versions,
  className,
}: {
  versions: ResourceVersion[];
  className?: string;
}) {
  return (
    <ol className={cn("space-y-3", className)}>
      {versions.map((version) => (
        <li key={version.id} className="flex gap-3">
          <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {version.title ?? `Version ${version.versionNumber}`}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatVersionDate(version.createdAt)}
            </div>
            {version.summary ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {version.summary}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatVersionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
