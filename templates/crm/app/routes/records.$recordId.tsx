import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useParams } from "react-router";

import { RecordActions } from "@/components/crm/RecordActions";
import { RecordWorkspace } from "@/components/crm/RecordWorkspace";
import { normalizeRecord, type CrmRecordDetail } from "@/lib/types";

export default function RecordRoute() {
  const t = useT();
  const { recordId } = useParams();
  const query = useActionQuery<unknown>(
    "get-crm-record" as never,
    { recordId } as never,
    { enabled: Boolean(recordId) },
  );
  const manageTask = useActionMutation<
    unknown,
    { taskId: string; status: "done" }
  >("manage-crm-task" as never);
  const summary = normalizeRecord(query.data, "account");
  const detail = summary
    ? ({ ...summary, ...(query.data as object) } as CrmRecordDetail)
    : undefined;

  // A read that failed is not a record that is gone. Rendering the "archived or
  // no longer shared" empty state for a transport or permission error would
  // tell the user something we do not know.
  if (query.error)
    return (
      <div className="p-6">
        <p className="text-sm font-medium">{t("record.loadFailedTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {query.error instanceof Error
            ? query.error.message
            : t("record.loadFailedDescription")}
        </p>
      </div>
    );

  return (
    <RecordWorkspace
      record={detail}
      isLoading={query.isLoading}
      isCompletingTask={manageTask.isPending}
      onCompleteTask={(taskId) => manageTask.mutate({ taskId, status: "done" })}
      actions={detail ? <RecordActions record={detail} /> : undefined}
    />
  );
}
