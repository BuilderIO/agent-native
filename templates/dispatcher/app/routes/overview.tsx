import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { openAgentSidebar, useActionQuery } from "@agent-native/core/client";
import {
  IconCheck,
  IconExternalLink,
  IconArrowUpRight,
  IconFingerprint,
  IconHistory,
  IconInfoCircle,
  IconPlugConnected,
  IconPlus,
  IconShieldCheck,
  IconTrash,
  type IconProps,
} from "@tabler/icons-react";
import { DispatcherShell } from "@/components/dispatcher-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface ConnectedAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  source: "builtin" | "custom";
  resourceId?: string;
  path?: string;
  scope?: "shared" | "personal";
}

function openAgentSettings() {
  openAgentSidebar();
  window.dispatchEvent(new Event("agent-panel:open-settings"));
}

function openWorkspaceResources() {
  openAgentSidebar();
  window.dispatchEvent(
    new CustomEvent("agent-panel:set-mode", {
      detail: { mode: "resources" },
    }),
  );
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
  onAction,
  secondary,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAction}>{actionLabel}</Button>
        {secondary}
      </div>
    </div>
  );
}

function AgentConnectionsSection({
  agents,
  onRefresh,
}: {
  agents: ConnectedAgent[];
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const customAgents = agents.filter((agent) => agent.source === "custom");
  const builtinAgents = agents.filter((agent) => agent.source === "builtin");

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;

    const id = trimmedName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const agentJson = JSON.stringify(
      {
        id,
        name: trimmedName,
        description: description.trim() || undefined,
        url: trimmedUrl,
        color: "#6B7280",
      },
      null,
      2,
    );

    setSaving(true);
    try {
      const res = await fetch("/_agent-native/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `agents/${id}.json`,
          content: agentJson,
          shared: true,
        }),
      });
      if (res.ok) {
        setName("");
        setUrl("");
        setDescription("");
        onRefresh();
        nameRef.current?.focus();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (resourceId?: string) => {
    if (!resourceId) return;
    const res = await fetch(`/_agent-native/resources/${resourceId}`, {
      method: "DELETE",
    });
    if (res.ok) onRefresh();
  };

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">Agents</h2>
        <HelpTooltip content="Dispatcher can delegate to the built-in app suite over A2A by default. Add extra agents here if you want to route work to apps outside that built-in set." />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">
              Available by default
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {builtinAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                  <span>{agent.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-foreground">
              Added in this workspace
            </div>
            <div className="mt-2 space-y-2">
              {customAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {agent.name}
                    </div>
                    {agent.description ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {agent.description}
                      </div>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <a
                        href={agent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {agent.url}
                        <IconExternalLink className="h-3 w-3" />
                      </a>
                      <span>·</span>
                      <span>{agent.scope || "shared"}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(agent.resourceId)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {customAgents.length === 0 && (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No extra agents added yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="text-sm font-medium text-foreground">
            Add external agent
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Add another A2A-compatible app by saving its agent endpoint here.
          </p>
          <div className="mt-4 space-y-3">
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://app.example.com"
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            <Button
              className="w-full"
              onClick={handleAdd}
              disabled={!name.trim() || !url.trim() || saving}
            >
              {saving ? "Saving..." : "Add agent"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function meta() {
  return [{ title: "Overview — Dispatcher" }];
}

export default function OverviewRoute() {
  const { data, isLoading } = useActionQuery("list-dispatcher-overview", {});
  const { data: connectedAgents, refetch: refetchAgents } = useActionQuery(
    "list-connected-agents",
    {},
  );
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
    <DispatcherShell
      title="Overview"
      description="Status for routes, linked identities, approvals, and recent activity."
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
                actionLabel="Open integrations"
                onAction={openAgentSettings}
              />
            )}
            {shouldShowAgentSetup && (
              <SetupCard
                title="Connect agents"
                description="No agents are available for delegation yet. The built-in suite should appear automatically; if you need more, add them below."
                actionLabel="View agents"
                onAction={() => {
                  document
                    .getElementById("agents-section")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Destinations"
          help="Saved outbound targets used for proactive sends and scheduled jobs. Destinations are different from integrations: integrations let messages come in, destinations tell dispatcher where to send messages back out."
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
          label="Pending approvals"
          help="Durable changes waiting for approval before they apply."
          value={counts.pendingApprovals}
          icon={IconShieldCheck}
        />
        <StatCard
          label="Linked identities"
          help="External Slack and Telegram users that are mapped to real workspace users."
          value={counts.linkedIdentities}
          icon={IconFingerprint}
          cta={
            counts.linkedIdentities === 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/identities">Set up identities</Link>
              </Button>
            ) : undefined
          }
        />
        <StatCard
          label="Agents"
          help="Agents available to dispatcher for delegation over A2A. This includes the built-in app suite plus any additional agents you add."
          value={connectedAgentCount}
          icon={IconPlugConnected}
          cta={
            connectedAgentCount === 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={openWorkspaceResources}
              >
                Add agents
              </Button>
            ) : undefined
          }
        />
      </div>

      <div id="agents-section">
        <AgentConnectionsSection
          agents={(connectedAgents || []) as ConnectedAgent[]}
          onRefresh={refetchAgents}
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
    </DispatcherShell>
  );
}
