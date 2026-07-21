import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSearchParams } from "react-router";

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
            : "Current commercial work from the connected CRM."
        }
      />
      <SavedViewDataProgram data={query.data} />
      <RecordGrid
        kind="opportunity"
        records={normalizeRecords(query.data, "opportunity")}
        isLoading={query.isLoading}
        emptyTitle="No connected opportunities yet"
      />
    </>
  );
}
