import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/core/client/composer";
import { useChangeVersions } from "@agent-native/core/client/hooks";
import {
  IconFileSearch,
  IconListDetails,
  IconPlus,
  IconSearch,
  IconSettingsAutomation,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { AutomationDetailsPanel } from "../../components/automation-details-panel";
import { DispatchShell } from "../../components/dispatch-shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import {
  automationIdentity,
  automationLastCheck,
  automationLastRun,
  automationNextRun,
  automationScopeLabel,
  automationStatus,
  automationTarget,
  automationTroubleshootPath,
  belongsToDispatch,
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
  const [view, setView] = useState<"dispatch" | "all">("dispatch");
  const [query, setQuery] = useState("");
  const [detailsTarget, setDetailsTarget] =
    useState<DispatchAutomationItem | null>(null);
  const automationsQuery = useAutomations();
  const toggleAutomation = useToggleAutomation();
  const automations = automationsQuery.data ?? [];
  const visibleAutomations = useMemo(
    () =>
      view === "all"
        ? automations
        : automations.filter((item) => belongsToDispatch(item)),
    [automations, view],
  );
  const ordered = useMemo(
    () => sortAutomations(visibleAutomations),
    [visibleAutomations],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return ordered;
    return ordered.filter((item) =>
      [
        item.name,
        item.event,
        item.schedule,
        item.scheduleDescription,
        item.body,
        item.model,
        item.domain,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [ordered, query]);
  const enabledCount = visibleAutomations.filter((item) => item.enabled).length;
  const errorCount = visibleAutomations.filter(
    (item) =>
      item.enabled &&
      (item.lastStatus === "error" || item.lastStatus === "skipped"),
  ).length;
  const pendingToggleIdentity = toggleAutomation.isPending
    ? toggleAutomation.variables
      ? automationIdentity(toggleAutomation.variables)
      : null
    : null;

  useEffect(() => {
    if (!detailsTarget) return;
    const current = filtered.find(
      (item) => automationIdentity(item) === automationIdentity(detailsTarget),
    );
    if (current) {
      if (current !== detailsTarget) setDetailsTarget(current);
    } else {
      setDetailsTarget(null);
    }
  }, [detailsTarget, filtered]);

  return (
    <DispatchShell
      title="Automations"
      description="See scheduled and event-triggered jobs, inspect their checks and past runs, pause them, or ask the agent to create one."
    >
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <IconSearch
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search automations"
                aria-label="Search automations"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconSettingsAutomation size={16} className="shrink-0" />
              <span>
                {enabledCount} enabled
                {errorCount > 0 ? ` · ${errorCount} errors` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={view}
              onValueChange={(value) => {
                if (value === "dispatch" || value === "all") setView(value);
              }}
            >
              <SelectTrigger
                className="h-8 w-[10.5rem] text-xs"
                aria-label="Automation view"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dispatch">Dispatch automations</SelectItem>
                <SelectItem value="all">All apps</SelectItem>
              </SelectContent>
            </Select>
            <CreateAutomationButton />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
          <div className="min-w-0 divide-y rounded-lg bg-card">
            {automationsQuery.isLoading && ordered.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              ))
            ) : filtered.length > 0 ? (
              filtered.map((item) => {
                const status = automationStatus(item);
                const canUpdate = item.canUpdate !== false;
                const isToggling =
                  pendingToggleIdentity === automationIdentity(item);
                const isSelected =
                  detailsTarget !== null &&
                  automationIdentity(detailsTarget) ===
                    automationIdentity(item);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 transition-colors",
                      isSelected && "bg-accent/40",
                    )}
                  >
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="w-full min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                        aria-pressed={isSelected}
                        onClick={() => setDetailsTarget(item)}
                      >
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
                          <span>{automationScopeLabel(item)}</span>
                          {item.lastCheck ? (
                            <span>Checked {automationLastCheck(item)}</span>
                          ) : null}
                        </div>
                      </button>
                      {item.lastError ? (
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-destructive">
                          <span className="min-w-0 break-words">
                            {item.lastError}
                          </span>
                          <Link
                            to={automationTroubleshootPath(item)}
                            className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                            aria-label={`Troubleshoot ${item.name} in Thread Debug`}
                          >
                            <IconFileSearch size={13} aria-hidden="true" />
                            Troubleshoot in Thread Debug
                          </Link>
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
                {query
                  ? "No matching automations."
                  : view === "all"
                    ? "No automations yet. Create one here, or ask Dispatch to set up a scheduled or event-triggered job."
                    : "No Dispatch automations yet. Switch to All apps to inspect workspace automations."}
              </div>
            )}
          </div>

          {detailsTarget ? (
            <AutomationDetailsPanel
              automation={detailsTarget}
              isToggling={
                pendingToggleIdentity === automationIdentity(detailsTarget)
              }
              onToggle={() =>
                toggleAutomation.mutate({
                  owner: detailsTarget.owner,
                  path: detailsTarget.path,
                  enabled: !detailsTarget.enabled,
                })
              }
            />
          ) : (
            <div className="flex min-h-[34rem] flex-col items-center justify-center rounded-lg border border-dashed bg-card p-6 text-center">
              <IconListDetails
                size={24}
                strokeWidth={1.6}
                className="text-muted-foreground"
              />
              <p className="mt-3 text-sm font-medium text-foreground">
                Select an automation
              </p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Inspect its prompt, configuration, capabilities, and run
                history.
              </p>
            </div>
          )}
        </div>
      </section>
    </DispatchShell>
  );
}
