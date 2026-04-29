import { TeamPage } from "@agent-native/core/client/org";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Team — Slides" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function TeamRoute() {
  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <TeamPage createOrgDescription="Set up a team to share presentations with your colleagues." />
      </main>
    </div>
  );
}
