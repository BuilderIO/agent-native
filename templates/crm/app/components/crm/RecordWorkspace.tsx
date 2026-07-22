import {
  IconChecklist,
  IconExternalLink,
  IconFileSearch,
  IconHistory,
  IconNotes,
  IconSparkles,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { CrmSignalsPanel } from "@/components/crm/CrmSignalsPanel";
import { LoadingRows, SetupEmptyState } from "@/components/crm/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  asText,
  normalizeTasks,
  recordId,
  type CrmRecordDetail,
} from "@/lib/types";

export function RecordWorkspace({
  record,
  isLoading,
  onCompleteTask,
  isCompletingTask,
  actions,
}: {
  record: CrmRecordDetail | undefined;
  isLoading: boolean;
  onCompleteTask: (taskId: string) => void;
  isCompletingTask: boolean;
  actions?: React.ReactNode;
}) {
  const details = useMemo(
    () =>
      Object.entries(record?.fields ?? {})
        .filter(([, value]) => typeof value !== "object" || value === null)
        .slice(0, 10),
    [record?.fields],
  );
  const tasks = normalizeTasks(record?.tasks);

  if (isLoading) return <LoadingRows rows={8} />;
  if (!record)
    return (
      <SetupEmptyState
        title="This CRM record is unavailable"
        description="It may have been archived, removed from a connected scope, or no longer shared with you."
      />
    );

  return (
    <div className="min-h-full">
      <header className="border-b border-border/70 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{record.kind}</span>
          {record.stage ? (
            <>
              <span>•</span>
              <Badge variant="secondary" className="font-normal">
                {record.stage}
              </Badge>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {record.displayName}
            </h1>
            {record.subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {record.subtitle}
              </p>
            ) : null}
          </div>
          <div className="grid justify-items-end gap-3">
            {record.owner ? (
              <p className="text-sm text-muted-foreground">
                Owner · {record.owner}
              </p>
            ) : null}
            {actions}
          </div>
        </div>
      </header>
      <Tabs defaultValue="details" className="px-5 py-5 sm:px-7">
        <TabsList className="h-9 bg-muted/70">
          <TabsTrigger value="details" className="gap-1.5">
            <IconNotes className="size-3.5" />
            Details
          </TabsTrigger>
          <TabsTrigger value="cadence">Cadence</TabsTrigger>
          <TabsTrigger value="evidence" className="gap-1.5">
            <IconFileSearch className="size-3.5" />
            Evidence
          </TabsTrigger>
          <TabsTrigger value="signals" className="gap-1.5">
            <IconSparkles className="size-3.5" />
            Signals
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <IconHistory className="size-3.5" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-1.5">
            <IconChecklist className="size-3.5" />
            Tasks
          </TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-5 max-w-3xl">
          <SectionTitle
            title="Details"
            description="Permitted fields owned locally or mirrored from a connected CRM."
          />
          <dl className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {details.length ? (
              details.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(9rem,0.45fr)_minmax(0,1fr)] gap-4 px-4 py-3"
                >
                  <dt className="text-sm text-muted-foreground">
                    {displayFieldName(key)}
                  </dt>
                  <dd className="break-words text-sm">{displayValue(value)}</dd>
                </div>
              ))
            ) : (
              <EmptyCopy text="No permitted fields are mirrored for this record." />
            )}
          </dl>
          <div className="mt-6">
            <SectionTitle
              title="Related records"
              description="Permitted records linked in this CRM workspace."
            />
            <div className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
              {record.relatedRecords?.length ? (
                record.relatedRecords.map((related) => (
                  <Link
                    key={`${related.id}:${related.relationshipType}`}
                    to={`/records/${encodeURIComponent(related.id)}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {related.displayName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[
                          related.relationshipLabel ?? related.relationshipType,
                          related.subtitle,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="capitalize font-normal"
                    >
                      {related.kind}
                    </Badge>
                  </Link>
                ))
              ) : (
                <EmptyCopy text="No permitted linked records are available." />
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="cadence" className="mt-5 max-w-3xl">
          <SectionTitle
            title="Cadence"
            description="The next contact rhythm is based on permitted CRM activity."
          />
          <div className="mt-4 grid gap-3 rounded-lg border border-border/70 bg-card p-4 sm:grid-cols-3">
            <Metric label="Cadence" value={record.cadence ?? "Not set"} />
            <Metric
              label="Next step"
              value={record.nextStep ?? "No next step"}
            />
            <Metric
              label="Last updated"
              value={
                record.updatedAt ? formatDate(record.updatedAt) : "Unknown"
              }
            />
          </div>
        </TabsContent>
        <TabsContent value="evidence" className="mt-5 max-w-3xl">
          <SectionTitle
            title="Evidence"
            description="Bounded references supporting CRM context."
          />
          <div className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {record.evidence?.length ? (
              record.evidence.map((evidence) => (
                <div key={evidence.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{evidence.label}</p>
                    {evidence.url ? (
                      <a
                        href={evidence.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${evidence.label}`}
                      >
                        <IconExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </div>
                  {evidence.quote ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {evidence.quote}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyCopy text="No evidence references are available yet." />
            )}
          </div>
        </TabsContent>
        <TabsContent value="signals" className="mt-5">
          <CrmSignalsPanel
            recordId={record.id}
            evidence={record.evidence ?? []}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-5 max-w-3xl">
          <SectionTitle
            title="Activity"
            description="Recent permitted interaction metadata."
          />
          <div className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {record.activity?.length ? (
              record.activity.map((activity) => (
                <div key={activity.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{activity.title}</p>
                  {activity.summary ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activity.summary}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {[
                      activity.actor,
                      activity.occurredAt
                        ? formatDate(activity.occurredAt)
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              ))
            ) : (
              <EmptyCopy text="No recent activity is available." />
            )}
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="mt-5 max-w-3xl">
          <SectionTitle
            title="Tasks"
            description="Keep follow-up work connected to the record."
          />
          <div className="mt-4 divide-y divide-border rounded-lg border border-border/70 bg-card">
            {tasks.length ? (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.dueAt
                        ? `Due ${formatDate(task.dueAt)}`
                        : task.status}
                    </p>
                  </div>
                  {task.status !== "done" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isCompletingTask}
                      onClick={() => onCompleteTask(task.id)}
                    >
                      Complete
                    </Button>
                  ) : (
                    <Badge variant="secondary">Done</Badge>
                  )}
                </div>
              ))
            ) : (
              <EmptyCopy text="No follow-up tasks are attached to this record." />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
function EmptyCopy({ text }: { text: string }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
function displayFieldName(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (letter: string) => letter.toUpperCase());
}
function displayValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return asText(value) ?? String(value ?? "—");
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
