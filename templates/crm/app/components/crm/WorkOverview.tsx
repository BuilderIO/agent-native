import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconArrowRight, IconCheck, IconListCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import { LoadingRows, SetupEmptyState } from "@/components/crm/Surface";
import {
  normalizeRecords,
  normalizeTasks,
  type CrmOverview,
} from "@/lib/types";

export function WorkOverview({
  overview,
  isLoading,
}: {
  overview: CrmOverview | undefined;
  isLoading: boolean;
}) {
  const tasks = normalizeTasks(overview?.tasks);
  const records = normalizeRecords(overview?.records, "account");
  const focus = overview?.focus ?? [];

  if (isLoading) return <LoadingRows rows={7} />;
  if (!overview) return <SetupEmptyState />;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <section>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Today’s work</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A focused queue from your connected CRM.
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
            >
              <Link to="/views">
                Saved views <IconArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <div className="mt-3 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {tasks.length ? (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex min-h-14 items-center gap-3 px-3.5 py-2.5"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border text-muted-foreground">
                    <IconCheck className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.dueAt
                        ? `Due ${formatDate(task.dueAt)}`
                        : "No due date"}
                    </p>
                  </div>
                  {task.recordId ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to={`/records/${encodeURIComponent(task.recordId)}`}
                      >
                        Open
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <QuietEmpty
                icon={<IconListCheck className="size-4" />}
                text="No open CRM tasks right now."
              />
            )}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recently active</h2>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
            >
              <Link to="/accounts">
                Accounts <IconArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <div className="mt-3 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {records.length ? (
              records.slice(0, 5).map((record) => (
                <Link
                  key={record.id}
                  to={`/records/${encodeURIComponent(record.id)}`}
                  className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {record.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {record.subtitle ?? record.owner ?? "CRM record"}
                    </p>
                  </div>
                  {record.stage ? (
                    <Badge variant="secondary" className="font-normal">
                      {record.stage}
                    </Badge>
                  ) : null}
                </Link>
              ))
            ) : (
              <QuietEmpty text="Recent activity will appear after the first sync." />
            )}
          </div>
        </section>
      </div>

      <aside className="self-start border-t border-border/70 pt-5 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
        <h2 className="text-sm font-semibold">Focus</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Signals worth deciding on.
        </p>
        <div className="mt-4 grid gap-3">
          {focus.length ? (
            focus.map((item) => (
              <div
                key={item.label}
                className="border-b border-border/70 pb-3 last:border-0"
              >
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-medium">{item.value}</p>
                {item.detail ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              CRM will surface follow-up signals as connected records become
              available.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function QuietEmpty({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-20 items-center justify-center gap-2 px-4 text-sm text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
