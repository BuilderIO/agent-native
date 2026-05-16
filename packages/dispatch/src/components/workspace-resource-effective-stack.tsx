import { useActionQuery } from "@agent-native/core/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function appAvailabilityLabel(value?: string) {
  switch (value) {
    case "all-apps":
      return "Inherited by all apps";
    case "selected-granted":
      return "Granted to this app";
    case "selected-not-granted":
      return "Not granted";
    case "selected-no-app":
      return "Select app";
    case "path-not-managed":
      return "Not managed";
    default:
      return "Checking";
  }
}

export function appLayerState(layer: any): {
  label: string;
  className: string;
} {
  if (layer.effective) {
    return {
      label: "Wins",
      className: "border-green-500/30 bg-green-500/10 text-green-700",
    };
  }
  if (layer.overridden) {
    return {
      label: "Overridden",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    };
  }
  return {
    label: "Missing",
    className: "text-muted-foreground",
  };
}

export function formatResourceTimestamp(value?: number | null): string {
  if (!value) return "not present";
  return new Date(value).toLocaleString();
}

export function AppResourceEffectiveStack({
  appId,
  resource,
}: {
  appId: string;
  resource: any;
}) {
  const { data: context, isLoading } = useActionQuery(
    "get-workspace-resource-effective-context",
    { resourceId: resource.id, appId },
    { enabled: !!resource.id },
  );
  const layers = ((context as any)?.layers ?? []) as any[];
  const active = (context as any)?.effectiveResource;
  const availability = (context as any)?.availability;

  if (isLoading && !context) {
    return (
      <div className="mt-3 rounded-lg border bg-muted/20 p-3">
        <div className="h-3 w-44 animate-pulse rounded bg-muted-foreground/10" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="h-20 animate-pulse rounded-md bg-muted-foreground/10" />
          <div className="h-20 animate-pulse rounded-md bg-muted-foreground/10" />
          <div className="h-20 animate-pulse rounded-md bg-muted-foreground/10" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Effective context stack
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {resource.path}
          </div>
        </div>
        <Badge variant="outline">{appAvailabilityLabel(availability)}</Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {layers.map((layer) => {
          const state = appLayerState(layer);
          return (
            <div
              key={layer.scope}
              className={cn("rounded-md border bg-background/70 p-2", {
                "border-green-500/30 bg-green-500/10": layer.effective,
              })}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {layer.label}
                </span>
                <Badge variant="outline" className={state.className}>
                  {state.label}
                </Badge>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {layer.owner}
              </div>
              {layer.resource ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Updated {formatResourceTimestamp(layer.resource.updatedAt)}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  No file at this layer
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-md bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        {active ? (
          <>
            Winning layer:{" "}
            <span className="font-mono text-foreground">
              {active.owner}/{active.path}
            </span>
          </>
        ) : (
          "No active resource exists for this path yet."
        )}
      </div>
    </div>
  );
}
