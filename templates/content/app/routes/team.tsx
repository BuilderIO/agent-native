import { AppLayout } from "@/components/layout/AppLayout";
import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Documents" }];
}

export default function TeamRoute() {
  return (
    <AppLayout activeDocumentId={null}>
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto p-8">
          <TeamPage createOrgDescription="Set up a team to share documents and collaborate with your colleagues." />
        </div>
      </div>
    </AppLayout>
  );
}
