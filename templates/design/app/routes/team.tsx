import { TeamPage } from "@agent-native/core/client/org";
import { Spinner } from "@/components/ui/spinner";

export function meta() {
  return [{ title: "Team - Design" }];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
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
