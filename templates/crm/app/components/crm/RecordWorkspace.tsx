/**
 * The record page: attribute panel on the left, tabs in the middle, list
 * memberships and signals on the right.
 *
 * The page reads two actions on purpose. `get-crm-record` is the one that
 * verifies provider read-through permission for a mirrored record and carries
 * evidence, tasks, and relationships; `get-crm-record-page` carries the typed
 * attribute schema, the current bitemporal values, and list memberships. The
 * second does not replace the first.
 */

import { setClientAppState } from "@agent-native/core/client/application-state";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CrmSignalsPanel } from "@/components/crm/CrmSignalsPanel";
import { AttributePanel } from "@/components/crm/record/AttributePanel";
import {
  applyEntryValue,
  applyFieldValue,
  rollbackEntryValue,
  rollbackFieldValue,
  type CrmRecordPage,
  type CrmRecordPageListAttribute,
  type RecordTab,
} from "@/components/crm/record/record-data";
import { RecordHeader } from "@/components/crm/record/RecordHeader";
import { RecordLists } from "@/components/crm/record/RecordLists";
import { RecordTabs } from "@/components/crm/record/RecordTabs";
import { LoadingRows, SetupEmptyState } from "@/components/crm/Surface";
import { TAB_ID } from "@/lib/tab-id";
import type { CrmRecordDetail } from "@/lib/types";

import type {
  CrmAttributeDefinition,
  CrmValue,
} from "../../../shared/crm-contract";

const RECORD_APP_STATE_KEY = "crm-record-workspace";

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
  const t = useT();
  const [tab, setTab] = useState<RecordTab>("activity");
  const queryClient = useQueryClient();
  const recordId = record?.id;

  const pageParams = { recordId };
  const pageQuery = useActionQuery<CrmRecordPage>(
    "get-crm-record-page" as never,
    pageParams as never,
    { enabled: Boolean(recordId) },
  );
  const pageKey = ["action", "get-crm-record-page", pageParams] as const;

  const updateRecord = useActionMutation<
    { mutationId: string; status?: string },
    {
      recordId: string;
      target: "local";
      fields: Record<string, unknown>;
      expectedRemoteRevision?: string;
    }
  >("update-crm-record" as never);
  const updateEntry = useActionMutation<
    unknown,
    { entryId: string; values: Record<string, unknown> }
  >("update-crm-list-entry" as never);

  // The agent needs to know which record is open and which tab is showing.
  useEffect(() => {
    if (!recordId) return;
    void setClientAppState(
      `${RECORD_APP_STATE_KEY}:${TAB_ID}`,
      { recordId, tab },
      { requestSource: TAB_ID },
    );
  }, [recordId, tab]);

  async function commitField(
    attribute: CrmAttributeDefinition,
    value: CrmValue,
  ) {
    const current = queryClient.getQueryData<CrmRecordPage>(pageKey);
    if (!current) return;
    const { page: optimistic, edit } = applyFieldValue(
      current,
      attribute.apiSlug,
      value,
      { since: new Date().toISOString(), actorType: "user", actorId: null },
    );
    queryClient.setQueryData(pageKey, optimistic);
    try {
      await updateRecord.mutateAsync({
        recordId: current.record.id,
        target: "local",
        fields: { [attribute.apiSlug]: value },
        ...(current.record.remoteRevision
          ? { expectedRemoteRevision: current.record.remoteRevision }
          : {}),
      });
    } catch (error) {
      queryClient.setQueryData<CrmRecordPage>(pageKey, (previous) =>
        rollbackFieldValue(previous ?? optimistic, edit),
      );
      toast.error(
        error instanceof Error ? error.message : t("record.saveFailed"),
      );
    }
  }

  async function commitEntryValue(
    entryId: string,
    attribute: CrmRecordPageListAttribute,
    value: CrmValue,
  ) {
    const current = queryClient.getQueryData<CrmRecordPage>(pageKey);
    if (!current) return;
    const { page: optimistic, previousValue } = applyEntryValue(
      current,
      entryId,
      attribute.apiSlug,
      value,
    );
    queryClient.setQueryData(pageKey, optimistic);
    try {
      await updateEntry.mutateAsync({
        entryId,
        values: { [attribute.apiSlug]: value },
      });
    } catch (error) {
      queryClient.setQueryData<CrmRecordPage>(pageKey, (previous) =>
        rollbackEntryValue(
          previous ?? optimistic,
          entryId,
          attribute.apiSlug,
          previousValue,
        ),
      );
      toast.error(
        error instanceof Error ? error.message : t("record.saveFailed"),
      );
    }
  }

  if (isLoading) return <LoadingRows rows={8} />;
  if (!record)
    return (
      <SetupEmptyState
        title={t("record.unavailableTitle")}
        description={t("record.unavailableDescription")}
      />
    );

  const page = pageQuery.data;

  return (
    <div className="flex min-h-full flex-col">
      <RecordHeader
        record={record}
        recordUrl={page?.recordUrl ?? null}
        recordUrlUnavailableReason={page?.recordUrlUnavailableReason ?? null}
        actions={actions}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* A failed panel load is a visible error, not an empty attribute list:
            "this record has no attributes" and "we could not read them" are
            different answers and must not render the same. */}
        {pageQuery.error ? (
          <aside className="w-full border-border/70 p-5 lg:w-[22rem] lg:shrink-0 lg:border-r">
            <p className="text-sm text-destructive">
              {pageQuery.error instanceof Error
                ? pageQuery.error.message
                : t("record.panelLoadFailed")}
            </p>
          </aside>
        ) : page ? (
          <AttributePanel page={page} onCommit={commitField} />
        ) : (
          <aside className="w-full border-border/70 p-5 lg:w-[22rem] lg:shrink-0 lg:border-r">
            <LoadingRows rows={6} />
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <RecordTabs
            record={record}
            tab={tab}
            onTabChange={setTab}
            onCompleteTask={onCompleteTask}
            isCompletingTask={isCompletingTask}
          />
        </div>

        <div className="grid w-full content-start gap-6 border-border/70 p-5 lg:w-[22rem] lg:shrink-0 lg:border-l">
          {page ? (
            <RecordLists page={page} onEntryCommit={commitEntryValue} />
          ) : null}
          <section aria-labelledby="crm-record-signals">
            <h2
              id="crm-record-signals"
              className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              {t("record.signals")}
            </h2>
            <CrmSignalsPanel
              recordId={record.id}
              evidence={record.evidence ?? []}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
