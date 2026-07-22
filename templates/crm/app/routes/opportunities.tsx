import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSearchParams } from "react-router";

import { CreateCrmRecordDialog } from "@/components/crm/CreateCrmRecordDialog";
import { RecordGrid } from "@/components/crm/RecordGrid";
import { SavedViewDataProgram } from "@/components/crm/SavedViewDataProgram";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() {
  return [{ title: "Opportunities · CRM" }];
}
export default function OpportunitiesRoute() {
  const [searchParams] = useSearchParams();
  const viewId = searchParams.get("view") ?? undefined;
  const query = useActionQuery<unknown>(
    "list-crm-records" as never,
    { kind: "opportunity", viewId } as never,
  );
  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Opportunities"
        description={
          viewId
            ? "Opportunities matching this saved view."
            : "Opportunities in your Native SQL workspace and connected CRM mirrors."
        }
        actions={<CreateCrmRecordDialog kind="opportunity" />}
      />
      <SavedViewDataProgram data={query.data} />
      <RecordGrid
        kind="opportunity"
        records={normalizeRecords(query.data, "opportunity")}
        isLoading={query.isLoading}
        emptyTitle="No opportunities yet"
      />
    </>
  );
}
