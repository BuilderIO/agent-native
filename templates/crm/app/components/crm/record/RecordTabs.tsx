/**
 * The centre pane: Activity, Notes, Tasks, Related.
 *
 * Two of these are deliberately honest about not existing yet rather than
 * dressed up with a plausible-looking feed:
 *  - Activity reads `crm_interactions`, which nothing in this app writes today.
 *  - Notes has no table at all; inventing one here would be a schema change.
 */

import { useT } from "@agent-native/core/client/i18n";
import {
  IconChecklist,
  IconHistory,
  IconLink,
  IconNotes,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { overlayProps } from "@/components/crm/shared/ui-tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CrmRecordDetail } from "@/lib/types";
import { normalizeTasks } from "@/lib/types";

import { resolveActivityState, type RecordTab } from "./record-data";

export function RecordTabs({
  record,
  tab,
  onTabChange,
  onCompleteTask,
  isCompletingTask,
}: {
  record: CrmRecordDetail;
  tab: RecordTab;
  onTabChange: (tab: RecordTab) => void;
  onCompleteTask: (taskId: string) => void;
  isCompletingTask: boolean;
}) {
  const t = useT();
  const tasks = normalizeTasks(record.tasks);
  const activity = resolveActivityState(record.activity);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => onTabChange(next as RecordTab)}
      className="flex flex-col p-5 sm:p-6"
    >
      <TabsList className="h-9 self-start bg-muted/70">
        <TabsTrigger value="activity" className="gap-1.5">
          <IconHistory className="size-3.5" />
          {t("record.tabActivity")}
        </TabsTrigger>
        <TabsTrigger value="notes" className="gap-1.5">
          <IconNotes className="size-3.5" />
          {t("record.tabNotes")}
        </TabsTrigger>
        <TabsTrigger value="tasks" className="gap-1.5">
          <IconChecklist className="size-3.5" />
          {t("record.tabTasks")}
        </TabsTrigger>
        <TabsTrigger value="related" className="gap-1.5">
          <IconLink className="size-3.5" />
          {t("record.tabRelated")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="activity" className="mt-4 max-w-2xl">
        {activity.kind === "not-ingested" ? (
          <ComingSoon
            title={t("record.activityNotIngestedTitle")}
            description={t("record.activityNotIngestedDescription")}
          />
        ) : (
          <div className="divide-y divide-hairline rounded-card border border-hairline bg-card">
            {activity.items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <p className="text-sm font-medium">{item.title}</p>
                {item.summary ? (
                  <p className="mt-1 text-sm text-content-secondary">
                    {item.summary}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-content-secondary">
                  {[
                    item.actor,
                    item.occurredAt ? formatDate(item.occurredAt) : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="notes" className="mt-4 max-w-2xl">
        <ComingSoon
          title={t("record.notesComingSoonTitle")}
          description={t("record.notesComingSoonDescription")}
        />
      </TabsContent>

      <TabsContent value="tasks" className="mt-4 max-w-2xl">
        <div className="divide-y divide-hairline rounded-card border border-hairline bg-card">
          {tasks.length ? (
            tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="mt-0.5 text-xs text-content-secondary">
                    {task.dueAt
                      ? t("record.taskDue", { when: formatDate(task.dueAt) })
                      : task.status}
                  </p>
                </div>
                {task.status === "done" ? (
                  <Badge variant="secondary">{t("record.taskDone")}</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    disabled={isCompletingTask}
                    onClick={() => onCompleteTask(task.id)}
                  >
                    {t("record.completeTask")}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-sm text-content-secondary">
              {t("record.tasksEmpty")}
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="related" className="mt-4 max-w-2xl">
        <div className="divide-y divide-hairline rounded-card border border-hairline bg-card">
          {record.relatedRecords?.length ? (
            record.relatedRecords.map((related) => (
              <Link
                key={`${related.id}:${related.relationshipType}`}
                to={`/records/${encodeURIComponent(related.id)}`}
                {...overlayProps({
                  className: "flex items-center gap-3 px-4 py-3",
                })}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {related.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-content-secondary">
                    {[
                      related.relationshipLabel ?? related.relationshipType,
                      related.subtitle,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge variant="secondary" className="font-normal capitalize">
                  {related.kind}
                </Badge>
              </Link>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-sm text-content-secondary">
              {t("record.relatedEmpty")}
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-card border border-dashed border-hairline bg-card px-5 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-content-secondary">
        {description}
      </p>
    </div>
  );
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
