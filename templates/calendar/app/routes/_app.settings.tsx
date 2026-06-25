import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: "Settings — Calendar" }];
}

export default function SettingsRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">
          Settings
        </h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <Settings />;
}
