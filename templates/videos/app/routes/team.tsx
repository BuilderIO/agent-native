import { TeamPage } from "@agent-native/core/client/org";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Team — Remotion Studio" }];
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
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <TeamPage createOrgDescription="Set up a team to share compositions and animations with your colleagues." />
    </main>
  );
}
