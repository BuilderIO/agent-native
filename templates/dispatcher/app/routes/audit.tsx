import { useActionQuery } from "@agent-native/core/client";
import { DispatcherShell } from "@/components/dispatcher-shell";

export function meta() {
  return [{ title: "Audit — Dispatcher" }];
}

export default function AuditRoute() {
  const { data } = useActionQuery("list-dispatcher-audit", { limit: 100 });

  return (
    <DispatcherShell
      title="Trace who changed what and when"
      description="Audit gives teams a fast way to unwind annoying behavioral changes, confirm who created routes, and understand which identity a change came from."
    >
      <section className="rounded-3xl border border-border/60 bg-card/70 p-5">
        <div className="space-y-3">
          {(data || []).map((event) => (
            <div
              key={event.id}
              className="rounded-2xl border border-border/50 bg-muted/35 px-4 py-3"
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
        </div>
      </section>
    </DispatcherShell>
  );
}
