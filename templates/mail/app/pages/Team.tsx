import { AppLayout } from "@/components/layout/AppLayout";
import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return (
    <TeamPage
      layout={(content) => <AppLayout>{content}</AppLayout>}
      title="Team"
    />
  );
}
