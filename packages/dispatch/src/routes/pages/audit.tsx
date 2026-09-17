import { useActionQuery } from "@agent-native/core/client/hooks";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Skeleton } from "../../components/ui/skeleton";

export function meta() {
  return [{ title: "Audit — Dispatch" }];
}

export default function AuditRoute() {
  const query = useActionQuery("list-dispatch-audit", { limit: 100 });
  const { data } = query;

  return (
    <DispatchShell
      title="Audit"
      description="Change history for routes, settings, and approvals."
    >
      <section className="overflow-hidden rounded-lg bg-card">
        {query.isError ? (
          <ActionQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="grid gap-2 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div>
                  <Skeleton className="h-4 w-2/3 max-w-sm" />
                  <Skeleton className="mt-2 h-3 w-1/2 max-w-xs" />
                </div>
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        ) : (
          <div>
            {(data || []).map((event: any) => (
              <div
                key={event.id}
                className="grid gap-1 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {event.summary}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {event.actor} · {event.action}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground sm:text-right">
                  {new Date(event.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
            {(data?.length || 0) === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No audit entries yet.
              </div>
            )}
          </div>
        )}
      </section>
    </DispatchShell>
  );
}
