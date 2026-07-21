import { useActionMutation } from "@agent-native/core/client/hooks";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { PageHeader, SetupEmptyState } from "@/components/crm/Surface";

export default function SetupRoute() {
  const navigate = useNavigate();
  const configure = useActionMutation<
    { id: string },
    { selectedObjectTypes: string[] }
  >("configure-crm-connection" as never);
  const sync = useActionMutation<
    unknown,
    {
      connectionId: string;
      objectType: string;
      scope: { updatedAfter: string };
      maxPages: number;
    }
  >("sync-crm" as never);

  async function syncRecentRecords() {
    try {
      const connection = await configure.mutateAsync({
        selectedObjectTypes: ["companies", "contacts", "deals"],
      });
      const updatedAfter = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      for (const objectType of ["companies", "contacts", "deals"]) {
        await sync.mutateAsync({
          connectionId: connection.id,
          objectType,
          scope: { updatedAfter },
          maxPages: 2,
        });
      }
      toast.success("Recent HubSpot records are ready.");
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "HubSpot sync failed.",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Set up CRM"
        description="Use shared workspace connections to authorize a CRM provider."
      />
      <SetupEmptyState
        title="Connect your CRM"
        onSync={() => void syncRecentRecords()}
        isSyncing={configure.isPending || sync.isPending}
      />
    </>
  );
}
