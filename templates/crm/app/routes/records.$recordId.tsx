import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useParams } from "react-router";

import { RecordActions } from "@/components/crm/RecordActions";
import { RecordWorkspace } from "@/components/crm/RecordWorkspace";
import { normalizeRecord, type CrmRecordDetail } from "@/lib/types";

export default function RecordRoute() {
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
