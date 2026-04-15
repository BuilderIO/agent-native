import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconFingerprint,
  IconHistory,
  IconInfoCircle,
  IconKey,
  IconPlugConnected,
  IconShieldCheck,
  type IconProps,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
}

function HelpTooltip({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-foreground"
        >
          <IconInfoCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function StatCard({
  label,
  help,
  value,
  icon: Icon,
  cta,
}: {
  label: string;
  help: string;
  value: number;
  icon: React.ComponentType<IconProps>;
  cta?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span>{label}</span>
            <HelpTooltip content={help} />
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {value}
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground">
          <Icon size={18} />
        </div>
      </div>
      {cta ? <div className="mt-4">{cta}</div> : null}
    </div>
  );
}

function SetupCard({
  title,
  description,
  actionLabel,
  to,
}: {
  title: string;
  description: string;
  actionLabel: string;
  to: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">
        <Button asChild>
          <Link to={to}>{actionLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

export function meta() {
  return [{ title: "Overview — Dispatch" }];
}

export default function OverviewRoute() {
  const { data, isLoading } = useActionQuery("list-dispatch-overview", {});
  const { data: connectedAgents } = useActionQuery("list-connected-agents", {});
  const [integrationStatuses, setIntegrationStatuses] = useState<
    IntegrationStatus[]
  >([]);

  useEffect(() => {
    let active = true;
    fetch("/_agent-native/integrations/status")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (active) {
          setIntegrationStatuses(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(() => {
        if (active) setIntegrationStatuses([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = data?.counts || {
    destinations: 0,
    pendingApprovals: 0,
    linkedIdentities: 0,
    activeTokens: 0,
  };

  const messagingStatuses = useMemo(
    () =>
      integrationStatuses.filter(
        (row) => row.platform === "slack" || row.platform === "telegram",
      ),
    [integrationStatuses],
  );

  const connectedMessagingCount = messagingStatuses.filter(
    (row) => row.enabled || row.configured,
  ).length;
  const missingPlatforms = messagingStatuses
    .filter((row) => !row.configured)
    .map((row) => row.label);
  const connectedAgentCount = connectedAgents?.length || 0;
  const shouldShowMessagingSetup = connectedMessagingCount === 0;
  const shouldShowAgentSetup = connectedAgentCount === 0;

  return (
    <DispatchShell
      title="Overview"
      description="Workspace control plane — manage secrets, integrations, messaging, and agent delegation."
    >
      {(shouldShowMessagingSetup || shouldShowAgentSetup) && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Setup</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {shouldShowMessagingSetup && (
              <SetupCard
                title="Connect Slack or Telegram"
                description={
                  missingPlatforms.length > 0
                    ? `No messaging channels are configured yet. Connect ${missingPlatforms.join(" or ")} to start receiving messages here.`
                    : "No messaging channels are configured yet."
                }
                actionLabel="Set up messaging"
                to="/messaging"
              />
            )}
            {shouldShowAgentSetup && (
              <SetupCard
                title="Connect agents"
                description="Choose which agents dispatch should hand work to. The built-in suite is available automatically, and you can add external agents from the Agents page."
                actionLabel="Review agents"
                to="/agents"
              />
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vault secrets"
          help="Credentials stored in the workspace vault. Grant them to apps from the Vault page."
          value={data?.vault?.secretCount || 0}
          icon={IconKey}
          cta={
            (data?.vault?.secretCount || 0) === 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/vault">Set up vault</Link>
              </Button>
            ) : undefined
          }
        />
        <StatCard
          label="Active grants"
          help="Secrets currently granted to apps. Sync them to push credentials."
          value={data?.vault?.activeGrantCount || 0}
          icon={IconShieldCheck}
        />
        <StatCard
          label="Destinations"
          help="Saved outbound targets used for proactive sends and scheduled jobs."
          value={counts.destinations}
          icon={IconArrowUpRight}
          cta={
            counts.destinations === 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/destinations">Set up destinations</Link>
              </Button>
            ) : undefined
          }
        />
        <StatCard
          label="Agents"
          help="Agents available to dispatch for delegation over A2A. This includes the built-in app suite plus any additional agents you add."
          value={connectedAgentCount}
          icon={IconPlugConnected}
          cta={
            connectedAgentCount === 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/agents">Open agents</Link>
              </Button>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border bg-card p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Recent activity
            </h2>
            {isLoading && (
              <span className="text-xs text-muted-foreground">Loading...</span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {(data?.recentAudit || []).map((event) => (
              <div
                key={event.id}
                className="rounded-xl border bg-muted/30 px-4 py-3"
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
              <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No activity yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Approval mode
          </h2>
          <div className="mt-4 rounded-xl border bg-muted/30 p-4">
            <div className="text-sm font-medium text-muted-foreground">
              Current policy
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data?.settings?.enabled ? "Reviewed" : "Immediate"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {data?.settings?.enabled
                ? "Changes wait for approval before they apply."
                : "Changes apply immediately and are recorded in audit."}
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.recentApprovals || []).map((approval) => (
              <div key={approval.id} className="rounded-xl border px-4 py-3">
                <div className="text-sm font-medium text-foreground">
                  {approval.summary}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {approval.status} · requested by {approval.requestedBy}
                </div>
              </div>
            ))}
            {(data?.recentApprovals?.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No approval requests.
              </div>
            )}
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
