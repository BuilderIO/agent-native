import { useMemo } from "react";
import { ToolViewerPage } from "@agent-native/core/client/tools";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export default function ToolViewerRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">Tools</h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <ToolViewerPage />;
}
