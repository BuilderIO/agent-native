import {
  PromptComposer,
  sendToAgentChat,
  useChangeVersions,
} from "@agent-native/core/client";
import { IconPlus, IconSettingsAutomation } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import {
  automationIdentity,
  automationLastRun,
  automationNextRun,
  automationStatus,
  automationTarget,
  sortAutomations,
  type AutomationStatusTone,
} from "../../lib/automation-display";
import {
  listDispatchAutomations,
  setDispatchAutomationEnabled,
  type DispatchAutomationItem,
  type SetDispatchAutomationEnabledInput,
} from "../../lib/automations";
import { cn } from "../../lib/utils";

const AUTOMATIONS_QUERY_KEY = ["dispatch-automations"] as const;

export function meta() {
  return [{ title: "Automations — Dispatch" }];
}

function StatusDot({ tone }: { tone: AutomationStatusTone }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "success" && "bg-emerald-500",
        tone === "warning" && "bg-amber-500",
        tone === "danger" && "bg-destructive",
        tone === "muted" && "bg-muted-foreground/35",
        tone === "default" && "bg-primary",
      )}
    />
  );
}

function useAutomations() {
  const version = useChangeVersions(["action", "screen-refresh"]);
  return useQuery<DispatchAutomationItem[]>({
    queryKey: [...AUTOMATIONS_QUERY_KEY, version],
    queryFn: listDispatchAutomations,
    placeholderData: (prev) => prev,
    staleTime: 5_000,
  });
}

function useToggleAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setDispatchAutomationEnabled,
    onMutate: async (input: SetDispatchAutomationEnabledInput) => {
      await queryClient.cancelQueries({ queryKey: AUTOMATIONS_QUERY_KEY });
      const snapshots = queryClient.getQueriesData<DispatchAutomationItem[]>({
        queryKey: AUTOMATIONS_QUERY_KEY,
      });

      queryClient.setQueriesData<DispatchAutomationItem[]>(
        { queryKey: AUTOMATIONS_QUERY_KEY },
        (rows) =>
          rows?.map((item) =>
            automationIdentity(item) === automationIdentity(input)
              ? { ...item, enabled: input.enabled }
              : item,
          ),
      );

      return { snapshots };
    },
    onError: (err, _input, context) => {
      for (const [queryKey, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      toast.error(
        `Could not update automation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<DispatchAutomationItem[]>(
        { queryKey: AUTOMATIONS_QUERY_KEY },
        (rows) =>
          rows?.map((item) =>
            automationIdentity(item) === automationIdentity(updated)
              ? updated
              : item,
          ),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_QUERY_KEY });
    },
  });
}

function CreateAutomationButton() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"personal" | "organization">("personal");

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", {
        detail: { mode: "chat" },
      }),
    );
    sendToAgentChat({
      message: trimmed,
      context: `The user wants to create a new automation. Scope: ${scope}. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`,
      submit: true,
      newTab: true,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <IconPlus size={14} />
          New automation
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(100vw-2rem,24rem)] p-3">
        <p className="pb-2 text-sm font-semibold text-foreground">
          New automation
        </p>
        <PromptComposer
          autoFocus
          placeholder="Describe what you want to automate..."
          draftScope="dispatch-automations:create"
          onSubmit={handleSubmit}
        />
        <select
          value={scope}
          onChange={(event) =>
            setScope(event.target.value as "personal" | "organization")
          }
          className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground"
        >
          <option value="personal">Personal</option>
          <option value="organization">Organization</option>
        </select>
      </PopoverContent>
    </Popover>
  );
}

export default function AutomationsRoute() {
  const automationsQuery = useAutomations();
  const toggleAutomation = useToggleAutomation();
  const automations = automationsQuery.data ?? [];
  const ordered = useMemo(() => sortAutomations(automations), [automations]);
  const enabledCount = automations.filter((item) => item.enabled).length;
  const errorCount = automations.filter(
    (item) => item.enabled && item.lastStatus === "error",
  ).length;
  const pendingToggleIdentity = toggleAutomation.isPending
    ? toggleAutomation.variables
      ? automationIdentity(toggleAutomation.variables)
      : null
    : null;

  return (
    <DispatchShell
      title="Automations"
      description="See scheduled and event-triggered jobs, pause them, or ask the agent to create one."
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <IconSettingsAutomation size={16} className="shrink-0" />
            <span>
              {enabledCount} enabled
              {errorCount > 0 ? ` · ${errorCount} errors` : ""}
            </span>
          </div>
          <CreateAutomationButton />
        </div>

        <div className="divide-y rounded-lg border bg-card">
          {automationsQuery.isLoading && ordered.length === 0 ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            ))
          ) : ordered.length > 0 ? (
            ordered.map((item) => {
              const status = automationStatus(item);
              const canUpdate = item.canUpdate !== false;
              const isToggling =
                pendingToggleIdentity === automationIdentity(item);
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot tone={status.tone} />
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {automationTarget(item)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Last {automationLastRun(item)}</span>
                      <span>Next {automationNextRun(item)}</span>
                    </div>
                    {item.lastError ? (
                      <div className="mt-1 truncate text-xs text-destructive">
                        {item.lastError}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge
                      variant={
                        status.tone === "danger" ? "destructive" : "outline"
                      }
                      className="h-5"
                    >
                      {status.label}
                    </Badge>
                    <Switch
                      checked={!!item.enabled}
                      disabled={!canUpdate || isToggling}
                      aria-label={`${item.enabled ? "Disable" : "Enable"} automation ${item.name}`}
                      onCheckedChange={(checked) =>
                        toggleAutomation.mutate({
                          owner: item.owner,
                          path: item.path,
                          enabled: checked,
                        })
                      }
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No automations yet. Create one here, or ask Dispatch to set up a
              scheduled or event-triggered job.
            </div>
          )}
        </div>
      </section>
    </DispatchShell>
  );
}
