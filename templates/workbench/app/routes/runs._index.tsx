import { useMemo, useState } from "react";
import {
  IconActivity,
  IconCheck,
  IconChevronDown,
  IconFilter,
  IconMessage,
} from "@tabler/icons-react";
import {
  focusAgentChat,
  sendToAgentChat,
  useActionQuery,
} from "@agent-native/core/client";
import { RoomHeader } from "@/components/room-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RunListCard } from "@/components/run/run-list-card";
import type { RunDisplayStatus } from "@/components/run/run-status-pill";

export function meta() {
  return [
    { title: "Workbench — Agent Runs" },
    {
      name: "description",
      content: "Monitor AI agent runs — active, paused, and recently finished.",
    },
  ];
}

type RunsFilter = "active" | "needs-input" | "recent" | "all";
type RunsSort = "recent" | "started" | "status";

interface RunSummary {
  runId: string;
  threadId: string;
  title: string;
  displayStatus: RunDisplayStatus;
  startedAt: number;
  completedAt: number | null;
  preview: string;
  appearsStuck: boolean;
}

interface ListRunsResponse {
  runs: RunSummary[];
  counts?: { active: number; total: number };
}

const FILTER_TABS: Array<{ value: RunsFilter; label: string }> = [
  { value: "recent", label: "Recent" },
  { value: "active", label: "Active" },
  { value: "needs-input", label: "Needs input" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: Array<{ value: RunsSort; label: string }> = [
  { value: "recent", label: "Last activity" },
  { value: "started", label: "Started" },
  { value: "status", label: "Status" },
];

/**
 * Agent run list room. Cards show status, current blocker if paused, and
 * the one-line ask from the agent. Polling sync (`useDbSync` in root.tsx)
 * invalidates the `list-runs` cache so live runs refresh in place.
 *
 * v1.0 only surfaces local agent-native runs read from the framework's
 * `agent_runs` table joined to the owning `chat_threads` row. Claude Code
 * session parsing lands in v1.1+.
 */
export default function RunsIndex() {
  const [filter, setFilter] = useState<RunsFilter>("recent");
  const [sort, setSort] = useState<RunsSort>("recent");

  const { data, isLoading, isError, error } = useActionQuery<ListRunsResponse>(
    "list-runs",
    { filter, sort } as any,
    {
      // Light client-side refetch so list updates feel snappy even when the
      // db-sync polling tick hasn't fired yet (~2s default).
      refetchInterval: 5_000,
      retry: 1,
    },
  );

  const runs = data?.runs ?? [];
  const activeCount = useMemo(
    () =>
      runs.filter(
        (r) => r.displayStatus === "running" || r.displayStatus === "paused",
      ).length,
    [runs],
  );

  return (
    <div className="flex h-full flex-col">
      <RoomHeader
        title="Agent Runs"
        subtitle={
          isLoading
            ? "Loading runs…"
            : runs.length === 0
              ? "Track local agent-native runs in flight, paused, and recently finished."
              : `${activeCount} active · ${runs.length} shown`
        }
        meta={
          runs.length > 0 ? (
            <>
              {activeCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                >
                  <span
                    aria-hidden
                    className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500"
                  />
                  {activeCount} live
                </Badge>
              ) : null}
            </>
          ) : undefined
        }
        right={<SortPicker value={sort} onChange={setSort} />}
      />

      <div className="border-b border-border px-6 py-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as RunsFilter)}>
          <TabsList>
            {FILTER_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="cursor-pointer"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {isLoading ? (
            <RunsSkeleton />
          ) : isError ? (
            <EmptyState
              icon={IconActivity}
              title="Couldn't load runs"
              description={error?.message ?? "Try again in a moment."}
            />
          ) : runs.length === 0 ? (
            <EmptyState
              icon={IconActivity}
              title={emptyTitle(filter)}
              description={emptyDescription(filter)}
              action={
                filter === "recent" || filter === "active" ? (
                  <KickOffRunButton />
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <RunListCard key={run.runId} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RunsSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted/60" />
          <div className="mt-4 flex gap-2">
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyTitle(filter: RunsFilter): string {
  switch (filter) {
    case "active":
      return "No active runs";
    case "needs-input":
      return "Nothing waiting on you";
    case "all":
      return "No runs yet";
    default:
      return "No recent runs";
  }
}

function emptyDescription(filter: RunsFilter): string {
  switch (filter) {
    case "active":
      return "Local agent-native runs in flight will appear here. Kick one off from the agent sidebar.";
    case "needs-input":
      return "Paused runs that are asking you a question land here. Inbox zero.";
    case "all":
      return "Local agent-native runs appear here automatically. More agent hosts coming soon.";
    default:
      return "Runs you've started in the last 24 hours show up here.";
  }
}

/**
 * "Kick off a run" CTA shown in the Recent / Active empty state. Seeds the
 * agent composer with a starter prompt and focuses the chat so the user
 * can type their task without ever leaving the room. Mirrors the
 * "+ New tool" pattern in `/extensions._index.tsx` (see `openCreatePrompt`).
 */
function KickOffRunButton() {
  const handleClick = () => {
    sendToAgentChat({
      message: "",
      context: [
        "The user is on the Agent Runs room in Workbench and clicked 'Kick off a run'.",
        "Treat the user's next message as the task to start. A new agent run will appear in this same Runs room once the work begins.",
      ].join("\n"),
      submit: false,
      openSidebar: true,
    });
    focusAgentChat();
  };
  return (
    <Button onClick={handleClick} className="cursor-pointer">
      <IconMessage size={16} aria-hidden />
      Kick off a run
    </Button>
  );
}

/**
 * Sort picker. shadcn DropdownMenu instead of a native select per the
 * framework's "always use shadcn" rule — DropdownMenu also gets us
 * keyboard nav and a consistent focus ring for free.
 */
function SortPicker({
  value,
  onChange,
}: {
  value: RunsSort;
  onChange: (v: RunsSort) => void;
}) {
  const current = SORT_OPTIONS.find((opt) => opt.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer gap-1.5">
          <IconFilter size={14} aria-hidden />
          <span className="hidden sm:inline">Sort:&nbsp;</span>
          {current?.label ?? value}
          <IconChevronDown size={12} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {SORT_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => onChange(opt.value)}
            className="flex cursor-pointer items-center justify-between gap-2"
          >
            {opt.label}
            {opt.value === value ? <IconCheck size={14} aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
