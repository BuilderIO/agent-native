import { AppLayout } from "@/components/layout/AppLayout";
import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Recruiting" }];
}

export default function TeamRoute() {
  return (
    <AppLayout>
      <div className="p-8">
        <TeamPage />
      </div>
    </AppLayout>
  );
}
