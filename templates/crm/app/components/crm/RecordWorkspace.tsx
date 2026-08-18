/**
 * The record page: TWO panes. A resizable left pane carrying the record's
 * typed attributes and its list memberships, and a main pane carrying the tabs
 * and the signals section.
 *
 * There is deliberately no third pane. Lists and signals used to sit in one,
 * which cost the main pane ~350px on every screen and gave the page three
 * competing reading orders. Lists are label/value rows, so they belong beside
 * the attributes; signals are an evidence feed, so they belong in the main
 * pane. The app shell's own left sidebar and right agent rail are untouched.
 *
 * The page reads two actions on purpose. `get-crm-record` is the one that
 * verifies provider read-through permission for a mirrored record and carries
 * evidence, tasks, and relationships; `get-crm-record-page` carries the typed
 * attribute schema, the current bitemporal values, and list memberships. The
 * second does not replace the first.
 */

import { setClientAppState } from "@agent-native/core/client/application-state";
import { ExtensionSlot } from "@agent-native/core/client/extensions";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CrmSignalsPanel } from "@/components/crm/CrmSignalsPanel";
import { PANEL_SECTION_HEADING } from "@/components/crm/record/attribute-row";
import { AttributePanel } from "@/components/crm/record/AttributePanel";
import {
  clampPanelPercent,
  DEFAULT_RECORD_PANEL_PERCENT,
  readPanelPercent,
  writePanelPercent,
} from "@/components/crm/record/panel-resize";
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
import {
  RECORD_MAIN_MIN_WIDTH,
  RECORD_PANEL_MIN_WIDTH,
} from "@/components/crm/shared/ui-tokens";
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
  const regionRef = useRef<HTMLDivElement>(null);
  const [panelPercent, setPanelPercent] = useState(readPanelPercent);
  const [isResizing, setIsResizing] = useState(false);

  function resizeTo(clientX: number) {
    const region = regionRef.current;
    if (!region) return;
    const bounds = region.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setPanelPercent(
      clampPanelPercent(
        ((clientX - bounds.left) / bounds.width) * 100,
        bounds.width,
      ),
    );
  }

  function nudgePanel(deltaPercent: number) {
    const width = regionRef.current?.getBoundingClientRect().width ?? 0;
    const next = clampPanelPercent(panelPercent + deltaPercent, width);
    setPanelPercent(next);
    writePanelPercent(next);
  }

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
      <div ref={regionRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The pane's floors live in CSS, not in the drag handler: a window
            resize must not be able to strand the main pane under its minimum,
            and only `min-width`/`max-width` hold at every width without a
            resize observer. */}
        <aside
          style={
            {
              "--crm-record-panel": `${panelPercent}%`,
              "--crm-record-panel-min": `${RECORD_PANEL_MIN_WIDTH}px`,
              "--crm-record-panel-max": `min(60%, calc(100% - ${RECORD_MAIN_MIN_WIDTH}px))`,
            } as React.CSSProperties
          }
          className="grid w-full content-start gap-5 border-hairline p-4 lg:w-[var(--crm-record-panel)] lg:min-w-[var(--crm-record-panel-min)] lg:max-w-[var(--crm-record-panel-max)] lg:shrink-0 lg:border-r"
        >
          {/* A failed panel load is a visible error, not an empty attribute
              list: "this record has no attributes" and "we could not read them"
              are different answers and must not render the same. */}
          {pageQuery.error ? (
            <p className="text-sm text-destructive">
              {pageQuery.error instanceof Error
                ? pageQuery.error.message
                : t("record.panelLoadFailed")}
            </p>
          ) : page ? (
            <>
              <AttributePanel page={page} onCommit={commitField} />
              <RecordLists page={page} onEntryCommit={commitEntryValue} />
              {/* Stable extension contract: changing this slot id or context is
                  a migration. */}
              <ExtensionSlot
                id="crm.record-sidebar.bottom"
                context={{
                  recordId: page.record.id,
                  objectType: page.record.objectType,
                  kind: page.record.kind,
                  displayName: page.record.displayName,
                  provider: page.record.provider,
                  values: page.values,
                }}
              />
            </>
          ) : (
            <LoadingRows rows={6} />
          )}
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("record.resizePanel")}
          aria-valuenow={Math.round(panelPercent)}
          tabIndex={0}
          data-resizing={isResizing ? "true" : undefined}
          className="group/resize relative hidden w-1.5 shrink-0 cursor-col-resize touch-none lg:block"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsResizing(true);
          }}
          onPointerMove={(event) => {
            if (!isResizing) return;
            resizeTo(event.clientX);
          }}
          onPointerUp={(event) => {
            if (!isResizing) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            setIsResizing(false);
            writePanelPercent(panelPercent);
          }}
          onDoubleClick={() => {
            setPanelPercent(DEFAULT_RECORD_PANEL_PERCENT);
            writePanelPercent(DEFAULT_RECORD_PANEL_PERCENT);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") nudgePanel(-2);
            else if (event.key === "ArrowRight") nudgePanel(2);
            else return;
            event.preventDefault();
          }}
        >
          {/* The 100ms delay before the handle appears is deliberate: without
              it, crossing the divider on the way somewhere else flickers. */}
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-[3px] bg-primary opacity-0 transition-opacity delay-100 duration-100 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-data-[resizing=true]/resize:opacity-100" />
        </div>

        <div
          style={
            {
              "--crm-record-main-min": `${RECORD_MAIN_MIN_WIDTH}px`,
            } as React.CSSProperties
          }
          className="min-w-0 flex-1 lg:min-w-[var(--crm-record-main-min)]"
        >
          <RecordTabs
            record={record}
            tab={tab}
            onTabChange={setTab}
            onCompleteTask={onCompleteTask}
            isCompletingTask={isCompletingTask}
          />
          <section
            aria-labelledby="crm-record-signals"
            className="border-t border-hairline p-5 sm:p-6"
          >
            <h2 id="crm-record-signals" className={PANEL_SECTION_HEADING}>
              {t("record.signals")}
            </h2>
            <div className="mt-3 max-w-2xl">
              <CrmSignalsPanel
                recordId={record.id}
                evidence={record.evidence ?? []}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
