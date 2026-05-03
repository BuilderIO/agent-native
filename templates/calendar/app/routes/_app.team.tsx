import { useMemo } from "react";
import Team from "@/pages/Team";
import { Spinner } from "@/components/ui/spinner";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export function meta() {
  return [{ title: "Team — Calendar" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function TeamRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">Team</h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <Team />;
}
