import { useActionQuery } from "@agent-native/core/client/hooks";

import { PageHeader } from "@/components/crm/Surface";
import { WorkOverview } from "@/components/crm/WorkOverview";
import type { CrmOverview } from "@/lib/types";

export function meta() { return [{ title: "My work · CRM" }]; }

export default function WorkRoute() {
  const overview = useActionQuery<CrmOverview>("get-crm-overview" as never, {} as never);
  return <><PageHeader eyebrow="CRM" title="My work" description="A calm view of follow-up work and current relationship context." /><WorkOverview overview={overview.data} isLoading={overview.isLoading} /></>;
}
