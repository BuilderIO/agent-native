import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team - Design" }];
}

export default function TeamRoute() {
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <TeamPage createOrgDescription="Set up a team to share designs with your colleagues." />
      </main>
    </div>
  );
}
