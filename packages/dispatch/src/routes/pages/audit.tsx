import { useActionQuery } from "@agent-native/core/client";
import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "Audit — Dispatch" }];
}

export default function AuditRoute() {
  const { data } = useActionQuery("list-dispatch-audit", { limit: 100 });

  return (
    <DispatchShell
      title="Audit"
      description="Change history for routes, settings, and approvals."
    >
      <section className="rounded-2xl border bg-card p-5">
        <div className="space-y-3">
          {(data || []).map((event) => (
            <div
              key={event.id}
              className="rounded-xl border bg-muted/30 px-4 py-3"
            >
              <div className="text-sm font-medium text-foreground">
                {event.summary}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {event.actor} · {event.action} ·{" "}
                {new Date(event.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
          {(data?.length || 0) === 0 && (
            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
              No audit entries yet.
            </div>
          )}
        </div>
      </section>
    </DispatchShell>
  );
}
