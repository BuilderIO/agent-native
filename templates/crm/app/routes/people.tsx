import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSearchParams } from "react-router";

import { RecordGrid } from "@/components/crm/RecordGrid";
import { SavedViewDataProgram } from "@/components/crm/SavedViewDataProgram";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() {
  return [{ title: "People · CRM" }];
}
export default function PeopleRoute() {
  const [searchParams] = useSearchParams();
  const viewId = searchParams.get("view") ?? undefined;
  const query = useActionQuery<unknown>(
    "list-crm-records" as never,
    { kind: "person", viewId } as never,
  );
  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="People"
        description={
          viewId
            ? "People matching this saved view."
            : "Contacts permitted through your connected CRM."
        }
      />
      <SavedViewDataProgram data={query.data} />
      <RecordGrid
        kind="person"
        records={normalizeRecords(query.data, "person")}
        isLoading={query.isLoading}
        emptyTitle="No connected people yet"
      />
    </>
  );
}
