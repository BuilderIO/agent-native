import { useMemo } from "react";
import Settings from "@/pages/Settings";
import { Spinner } from "@/components/ui/spinner";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export function meta() {
  return [{ title: "Settings — Calendar" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
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
