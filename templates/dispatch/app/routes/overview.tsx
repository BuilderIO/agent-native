import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconCheck,
  IconInfoCircle,
  IconKey,
  IconMessage,
  IconNetwork,
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

interface ChecklistStep {
  number: number;
  title: string;
  description: string;
  complete: boolean;
  /** If set, renders a link button to this path */
  to?: string;
  actionLabel?: string;
  /** If true, this step is always shown as informational (never "complete") */
  informational?: boolean;
}

function StepRow({ step }: { step: ChecklistStep }) {
  const done = step.complete && !step.informational;

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${done ? "border-border/50 bg-muted/20" : "bg-card"}`}
    >
      {/* Number / check circle */}
      <div className="flex-none pt-0.5">
        {done ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <IconCheck size={16} strokeWidth={2.5} />
          </div>
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-sm font-semibold text-muted-foreground">
            {step.number}
          </div>
        )}
      </div>

      {/* Text */}
      <div className={`min-w-0 flex-1 ${done ? "opacity-50" : ""}`}>
        <div
          className={`text-sm font-semibold ${done ? "line-through decoration-muted-foreground/40" : "text-foreground"}`}
        >
          {step.title}
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
          {step.description}
        </p>
      </div>

      {/* Action */}
      {step.to && !done && (
        <div className="flex-none pt-0.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={step.to}>{step.actionLabel || "Set up"}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "Make me a presentation about Q2 results",
  "What were our top traffic sources last week?",
  "Draft a blog post about our new feature",
  "Create a dashboard showing signup trends",
  "Search our clips for the product demo",
  "Generate a video intro for our product",
];

function ExamplePrompts() {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <IconMessage size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">
          Example prompts
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <span
            key={prompt}
            className="inline-block rounded-full border px-3.5 py-1.5 text-sm text-muted-foreground"
          >
            {prompt}
          </span>
        ))}
      </div>
    </section>
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
  const connectedAgentCount = connectedAgents?.length || 0;
  const vaultSecretCount = data?.vault?.secretCount || 0;

  const messagingDone = connectedMessagingCount > 0;
  const agentsDone = connectedAgentCount > 0;
  const vaultDone = vaultSecretCount > 0;

  const steps: ChecklistStep[] = [
    {
      number: 1,
      title: "Connect Slack",
      description:
        "Add @agent-native to your Slack workspace so your team can ask questions, create decks, pull analytics, and more — right from Slack.",
      complete: messagingDone,
      to: "/messaging",
      actionLabel: "Connect",
    },
    {
      number: 2,
      title: "Review connected agents",
      description:
        "Dispatch delegates work to specialized apps. The built-in suite (Slides, Analytics, Content, Video, and more) is available automatically.",
      complete: agentsDone,
      to: "/agents",
      actionLabel: "Review",
    },
    {
      number: 3,
      title: "Set up your vault",
      description:
        "Store API keys centrally and sync them to apps that need them.",
      complete: vaultDone,
      to: "/vault",
      actionLabel: "Open vault",
    },
    {
      number: 4,
      title: "Try it out",
      description: "Mention @agent-native in any Slack channel to get started.",
      complete: false,
      informational: true,
    },
  ];

  const hasIncompleteSteps = steps.some((s) => !s.complete && !s.informational);

  return (
    <DispatchShell
      title="Overview"
      description="Workspace control plane — manage secrets, integrations, messaging, and agent delegation."
    >
      {hasIncompleteSteps && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <IconNetwork size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Getting started
            </h2>
          </div>
          <div className="space-y-2">
            {steps.map((step) => (
              <StepRow key={step.number} step={step} />
            ))}
          </div>
        </section>
      )}

      <ExamplePrompts />

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
