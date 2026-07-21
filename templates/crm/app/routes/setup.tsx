import { PageHeader, SetupEmptyState } from "@/components/crm/Surface";

export default function SetupRoute() {
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Set up CRM"
        description="Use shared workspace connections to authorize a CRM provider."
      />
      <SetupEmptyState title="Connect your CRM" />
    </>
  );
}
