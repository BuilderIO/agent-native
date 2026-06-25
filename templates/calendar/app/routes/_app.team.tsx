import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import Team from "@/pages/Team";

export function meta() {
  return [{ title: "Team — Calendar" }];
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
