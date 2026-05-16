import { useActionQuery } from "@agent-native/core/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatResourceTimestamp } from "./workspace-resource-effective-stack";

function isApprovalRequest(result: any): boolean {
  return (
    result?.status === "pending" &&
    typeof result?.changeType === "string" &&
    result.changeType.startsWith("workspace-resource.")
  );
}

export function workspaceResourceMutationMessage(
  result: any,
  fallback: string,
): string {
  return isApprovalRequest(result) ? "Approval requested" : fallback;
}

export function ImpactPreview({
  operation,
  resourceId,
  path,
  scope,
  enabled = true,
}: {
  operation: "create" | "update" | "delete";
  resourceId?: string;
  path?: string;
  scope?: "all" | "selected";
  enabled?: boolean;
}) {
  const { data: impact, isLoading } = useActionQuery(
    "preview-workspace-resource-change",
    {
      operation,
      resourceId,
      path,
      scope,
    },
    { enabled: enabled && Boolean(resourceId || path) },
  );

  if (!enabled || (!resourceId && !path)) return null;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
    );
  }

  const data = impact as any;
  if (!data) return null;
  const affectsAllApps = data.affectsAllApps === true;
  const appCount = data.affectedApps?.count;
  const overrides = data.overrides ?? { count: 0, items: [] };
  const willRequestApproval = data.approval?.willRequestApproval === true;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={affectsAllApps ? "secondary" : "outline"}>
          {affectsAllApps ? "All apps impact" : "Selected only"}
        </Badge>
        {willRequestApproval ? (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            Approval required
          </Badge>
        ) : null}
        {overrides.count > 0 ? (
          <Badge variant="outline">
            {overrides.count} override{overrides.count === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        {affectsAllApps
          ? `This change applies to every workspace app${typeof appCount === "number" ? ` (${appCount} discovered)` : ""}.`
          : "This change only applies to explicitly granted apps."}{" "}
        {willRequestApproval
          ? "It will be queued for approval before it takes effect."
          : "It will take effect immediately when saved."}
      </p>
      {overrides.count > 0 ? (
        <div className="mt-2 space-y-1">
          {overrides.items.slice(0, 4).map((override: any) => (
            <div
              key={`${override.scope}:${override.owner}`}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {override.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatResourceTimestamp(override.updatedAt)}
              </span>
            </div>
          ))}
          {overrides.count > 4 ? (
            <div className="text-muted-foreground">
              +{overrides.count - 4} more override
              {overrides.count - 4 === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
