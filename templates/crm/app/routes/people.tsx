import { useActionQuery } from "@agent-native/core/client/hooks";

import { RecordGrid } from "@/components/crm/RecordGrid";
import { PageHeader } from "@/components/crm/Surface";
import { normalizeRecords } from "@/lib/types";

export function meta() { return [{ title: "People · CRM" }]; }
export default function PeopleRoute() { const query = useActionQuery<unknown>("list-crm-records" as never, { kind: "person" } as never); return <><PageHeader eyebrow="Records" title="People" description="Contacts permitted through your connected CRM." /><RecordGrid kind="person" records={normalizeRecords(query.data, "person")} isLoading={query.isLoading} emptyTitle="No connected people yet" /></>; }
