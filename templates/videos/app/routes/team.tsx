import { TeamPage } from "@agent-native/core/client/org";

export function meta() {
  return [{ title: "Team — Remotion Studio" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function TeamRoute() {
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TeamPage createOrgDescription="Set up a team to share compositions and animations with your colleagues." />
      </main>
    </div>
  );
}
