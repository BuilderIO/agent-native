import { useActionQuery } from "@agent-native/core/client/hooks";

import { RecordGrid } from "@/components/crm/RecordGrid";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() {
  return [{ title: "Accounts · CRM" }];
}
export default function AccountsRoute() {
  const query = useActionQuery<unknown>(
    "list-crm-records" as never,
    { kind: "account" } as never,
  );
  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Accounts"
        description="Connected accounts in the active CRM mirror."
      />
      <RecordGrid
        kind="account"
        records={normalizeRecords(query.data, "account")}
        isLoading={query.isLoading}
        emptyTitle="No connected accounts yet"
      />
    </>
  );
}
