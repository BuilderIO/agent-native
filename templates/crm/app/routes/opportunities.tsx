import { useActionQuery } from "@agent-native/core/client/hooks";

import { RecordGrid } from "@/components/crm/RecordGrid";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() {
  return [{ title: "Opportunities · CRM" }];
}
export default function OpportunitiesRoute() {
  const query = useActionQuery<unknown>(
    "list-crm-records" as never,
    { kind: "opportunity" } as never,
  );
  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Opportunities"
        description="Current commercial work from the connected CRM."
      />
      <RecordGrid
        kind="opportunity"
        records={normalizeRecords(query.data, "opportunity")}
        isLoading={query.isLoading}
        emptyTitle="No connected opportunities yet"
      />
    </>
  );
}
