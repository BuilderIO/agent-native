import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { PageHeader } from "@/components/crm/Surface";

interface WorkspaceConnection {
  id: string;
  provider: "hubspot" | "salesforce";
  label: string;
  accountLabel?: string | null;
  status: string;
}

export default function SetupRoute() {
  const navigate = useNavigate();
  const connectionsQuery = useActionQuery<unknown>(
    "list-workspace-connections" as never,
    { includeDisabled: false } as never,
  );
  const connections = useMemo(
    () => crmConnections(connectionsQuery.data),
    [connectionsQuery.data],
  );
  const [workspaceConnectionId, setWorkspaceConnectionId] = useState("");
  const [pipelineIds, setPipelineIds] = useState("");
  const [historyDays, setHistoryDays] = useState("90");
  const configure = useActionMutation<
    { id: string },
    {
      workspaceConnectionId: string;
      provider: "hubspot" | "salesforce";
      selectedPipelineIds: string[];
      selectedObjectTypes: string[];
    }
  >("configure-crm-connection" as never);
  const configureNative = useActionMutation<
    { id: string },
    Record<string, never>
  >("configure-native-crm" as never);
  const sync = useActionMutation<
    unknown,
    {
      connectionId: string;
      objectType: string;
      scope: { updatedAfter: string; pipelineIds?: string[] };
      maxPages: number;
    }
  >("sync-crm" as never);

  const selected = connections.find(
    (connection) => connection.id === workspaceConnectionId,
  );

  async function syncRecentRecords() {
    if (!selected) return;
    const selectedPipelines = pipelineIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 50);
    const days = Math.max(
      1,
      Math.min(365, Number.parseInt(historyDays, 10) || 90),
    );
    try {
      const connection = await configure.mutateAsync({
        workspaceConnectionId,
        provider: selected.provider,
        selectedPipelineIds:
          selected.provider === "hubspot" ? selectedPipelines : [],
        selectedObjectTypes: objectTypesForProvider(selected.provider),
      });
      const updatedAfter = new Date(
        Date.now() - days * 24 * 60 * 60 * 1_000,
      ).toISOString();
      for (const objectType of objectTypesForProvider(selected.provider)) {
        await sync.mutateAsync({
          connectionId: connection.id,
          objectType,
          scope: {
            updatedAfter,
            ...(selected.provider === "hubspot" &&
            objectType === "deals" &&
            selectedPipelines.length
              ? { pipelineIds: selectedPipelines }
              : {}),
          },
          maxPages: 2,
        });
      }
      toast.success(
        `Recent ${providerLabel(selected.provider)} records are ready.`,
      );
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CRM sync failed.");
    }
  }

  async function startNativeCrm() {
    try {
      await configureNative.mutateAsync({});
      toast.success("Your native CRM is ready.");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start native CRM.",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Set up CRM"
        description="Start with CRM's built-in SQL store, or connect a scoped HubSpot or Salesforce companion."
      />
      <div className="mx-auto grid w-full max-w-xl gap-6 p-5 sm:p-7">
        <section className="grid gap-4 rounded-lg border border-border/70 bg-card p-4">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Start with Native SQL</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Run accounts, people, opportunities, saved views, tasks, and
              cadence without connecting another CRM. Your CRM is
              local-authoritative and portable across SQLite, Postgres, and D1.
            </p>
          </div>
          <Button
            className="w-full sm:w-fit"
            disabled={configureNative.isPending}
            onClick={() => void startNativeCrm()}
          >
            {configureNative.isPending ? "Starting…" : "Start with Native SQL"}
          </Button>
        </section>
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          Or connect an existing CRM
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="crm-connection">CRM connection</Label>
          <Select
            value={workspaceConnectionId}
            onValueChange={setWorkspaceConnectionId}
            disabled={connectionsQuery.isLoading}
          >
            <SelectTrigger id="crm-connection">
              <SelectValue placeholder="Select HubSpot or Salesforce" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.label} · {providerLabel(connection.provider)}
                  {connection.accountLabel
                    ? ` · ${connection.accountLabel}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only workspace Connections granted to this app can be used. CRM
            never stores provider tokens.
          </p>
        </div>
        <div className="grid gap-4 rounded-lg border border-border/70 bg-card p-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="history-days">Recent history</Label>
            <Input
              id="history-days"
              type="number"
              min={1}
              max={365}
              value={historyDays}
              onChange={(event) => setHistoryDays(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Days, capped at 365.
            </p>
          </div>
          {selected?.provider === "hubspot" ? (
            <div className="grid gap-2">
              <Label htmlFor="pipeline-ids">Deal pipeline IDs</Label>
              <Input
                id="pipeline-ids"
                value={pipelineIds}
                maxLength={8_000}
                placeholder="Optional, comma-separated"
                onChange={(event) => setPipelineIds(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for recently updated deals.
              </p>
            </div>
          ) : selected?.provider === "salesforce" ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Salesforce objects</p>
              <p className="text-xs leading-5 text-muted-foreground">
                CRM mirrors recently updated Accounts, Contacts, and
                Opportunities in this initial cohort.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Cohort objects</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Choose a connection to see its initial object cohort.
              </p>
            </div>
          )}
        </div>
        {connections.length ? (
          <Button
            disabled={
              !selected ||
              selected.status !== "connected" ||
              configure.isPending ||
              sync.isPending
            }
            onClick={() => void syncRecentRecords()}
          >
            {configure.isPending || sync.isPending
              ? "Syncing…"
              : "Configure and sync"}
          </Button>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-sm font-medium">
              No connected HubSpot or Salesforce account is available.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              You can start with Native SQL above, or authorize a provider and
              grant it to CRM from shared settings.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/settings/connections">Open shared connections</Link>
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Using a Salesforce sandbox?{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href="/_agent-native/connections/oauth/salesforce/start?environment=sandbox"
              >
                Authorize the sandbox directly
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function crmConnections(data: unknown): WorkspaceConnection[] {
  if (!data || typeof data !== "object") return [];
  const rows = (data as { connections?: unknown }).connections;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      (item.provider !== "hubspot" && item.provider !== "salesforce") ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      typeof item.status !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        provider: item.provider,
        label: item.label,
        accountLabel:
          typeof item.accountLabel === "string" ? item.accountLabel : null,
        status: item.status,
      },
    ];
  });
}

function objectTypesForProvider(provider: WorkspaceConnection["provider"]) {
  return provider === "hubspot"
    ? ["companies", "contacts", "deals"]
    : ["Account", "Contact", "Opportunity"];
}

function providerLabel(provider: WorkspaceConnection["provider"]) {
  return provider === "hubspot" ? "HubSpot" : "Salesforce";
}
