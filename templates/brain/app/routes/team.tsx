import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team - Brain" }];
}

export default function TeamRoute() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <TeamPage createOrgDescription="Set up a team to share Brain sources, reviewed knowledge, and settings with your colleagues." />
    </main>
  );
}
