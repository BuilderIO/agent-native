import { useActionQuery } from "@agent-native/core/client";
import type { IconProps } from "@tabler/icons-react";
import {
  IconArrowUpRight,
  IconFingerprint,
  IconHistory,
  IconShieldCheck,
} from "@tabler/icons-react";
import { DispatcherShell } from "@/components/dispatcher-shell";

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<IconProps>;
}) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card/70 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-muted/50 p-3 text-muted-foreground">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export function meta() {
  return [{ title: "Overview — Dispatcher" }];
}

export default function OverviewRoute() {
  const { data, isLoading } = useActionQuery("list-dispatcher-overview", {});

  const counts = data?.counts || {
    destinations: 0,
    pendingApprovals: 0,
    linkedIdentities: 0,
    activeTokens: 0,
  };

  return (
    <DispatcherShell
      title="One control plane for every inbound message"
      description="Route Slack and Telegram through one workspace-aware agent, keep durable behavior reviewable, and let specialized agents do the domain work."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Destinations"
          value={counts.destinations}
          icon={IconArrowUpRight}
        />
        <StatCard
          label="Pending Approvals"
          value={counts.pendingApprovals}
          icon={IconShieldCheck}
        />
        <StatCard
          label="Linked Identities"
          value={counts.linkedIdentities}
          icon={IconFingerprint}
        />
        <StatCard
          label="Recent Audit"
          value={data?.recentAudit?.length || 0}
          icon={IconHistory}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-3xl border border-border/60 bg-card/70 p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Latest activity
            </h2>
            {isLoading && (
              <span className="text-xs text-muted-foreground">Loading…</span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {(data?.recentAudit || []).map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-border/50 bg-muted/40 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {event.summary}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {event.actor} · {new Date(event.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
            {!isLoading && (data?.recentAudit?.length || 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                No audit events yet. Save a destination, issue a link token, or
                send a proactive message to start building the trail.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-border/60 bg-card/70 p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Approval posture
          </h2>
          <div className="mt-4 rounded-2xl border border-border/50 bg-muted/40 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Durable changes
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data?.settings?.enabled ? "Reviewed" : "Immediate"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {data?.settings?.enabled
                ? "Destination, job, and instruction changes are queued for approval."
                : "Destination and policy changes apply immediately and are only audited."}
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.recentApprovals || []).map((approval) => (
              <div
                key={approval.id}
                className="rounded-2xl border border-border/50 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {approval.summary}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {approval.status} · requested by {approval.requestedBy}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DispatcherShell>
  );
}
