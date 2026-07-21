import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSearchParams } from "react-router";

import { RecordGrid } from "@/components/crm/RecordGrid";
import { SavedViewDataProgram } from "@/components/crm/SavedViewDataProgram";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() {
  return [{ title: "Accounts · CRM" }];
}
export default function AccountsRoute() {
  const [searchParams] = useSearchParams();
  const viewId = searchParams.get("view") ?? undefined;
  const query = useActionQuery<unknown>(
    "list-crm-records" as never,
    { kind: "account", viewId } as never,
  );
  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Accounts"
        description={
          viewId
            ? "Accounts matching this saved view."
            : "Connected accounts in the active CRM mirror."
        }
      />
      <SavedViewDataProgram data={query.data} />
      <RecordGrid
        kind="account"
        records={normalizeRecords(query.data, "account")}
        isLoading={query.isLoading}
        emptyTitle="No connected accounts yet"
      />
    </>
  );
}
