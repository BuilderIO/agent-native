import { AppLayout } from "@/components/layout/AppLayout";
import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return (
    <TeamPage
      layout={(content) => (
        <AppLayout>
          <div className="p-4 sm:p-6">{content}</div>
        </AppLayout>
      )}
      title="Team"
      createOrgDescription="Set up a team to share email automations and settings with your colleagues."
    />
  );
}
