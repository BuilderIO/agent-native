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
  provider: string;
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
    () => hubSpotConnections(connectionsQuery.data),
    [connectionsQuery.data],
  );
  const [workspaceConnectionId, setWorkspaceConnectionId] = useState("");
  const [pipelineIds, setPipelineIds] = useState("");
  const [historyDays, setHistoryDays] = useState("90");
  const configure = useActionMutation<
    { id: string },
    {
      workspaceConnectionId: string;
      selectedPipelineIds: string[];
      selectedObjectTypes: string[];
    }
  >("configure-crm-connection" as never);
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
        selectedPipelineIds: selectedPipelines,
        selectedObjectTypes: ["companies", "contacts", "deals"],
      });
      const updatedAfter = new Date(
        Date.now() - days * 24 * 60 * 60 * 1_000,
      ).toISOString();
      for (const objectType of ["companies", "contacts", "deals"]) {
        await sync.mutateAsync({
          connectionId: connection.id,
          objectType,
          scope: {
            updatedAfter,
            ...(objectType === "deals" && selectedPipelines.length
              ? { pipelineIds: selectedPipelines }
              : {}),
          },
          maxPages: 2,
        });
      }
      toast.success("Recent HubSpot records are ready.");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "HubSpot sync failed.",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Set up CRM"
        description="Choose the exact shared HubSpot connection and a bounded initial cohort."
      />
      <div className="mx-auto grid w-full max-w-xl gap-6 p-5 sm:p-7">
        <div className="grid gap-2">
          <Label htmlFor="hubspot-connection">HubSpot connection</Label>
          <Select
            value={workspaceConnectionId}
            onValueChange={setWorkspaceConnectionId}
            disabled={connectionsQuery.isLoading}
          >
            <SelectTrigger id="hubspot-connection">
              <SelectValue placeholder="Select a shared connection" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.label}
                  {connection.accountLabel
                    ? ` · ${connection.accountLabel}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only workspace Connections granted to this app can be used. CRM
            never stores the provider token.
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
              No connected HubSpot account is available.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Authorize HubSpot and grant it to CRM from shared settings.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/settings#connections">Open shared connections</Link>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function hubSpotConnections(data: unknown): WorkspaceConnection[] {
  if (!data || typeof data !== "object") return [];
  const rows = (data as { connections?: unknown }).connections;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      item.provider !== "hubspot" ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      typeof item.status !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        provider: "hubspot",
        label: item.label,
        accountLabel:
          typeof item.accountLabel === "string" ? item.accountLabel : null,
        status: item.status,
      },
    ];
  });
}
