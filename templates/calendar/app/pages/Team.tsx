import { TeamPage } from "@agent-native/core/client/org";

export default function Team() {
  return (
    <div className="p-4 sm:p-6">
      <TeamPage
        title="Team"
        createOrgDescription="Set up a team to share calendars and booking links with your colleagues."
      />
    </div>
  );
}
