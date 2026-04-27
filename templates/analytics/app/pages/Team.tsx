import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return (
    <div className="p-4 sm:p-6">
      <TeamPage createOrgDescription="Set up a team to share dashboards and data sources with your colleagues." />
    </div>
  );
}
