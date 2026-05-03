import { useMemo } from "react";
import { ToolsListPage } from "@agent-native/core/client/tools";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export default function ToolsRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">Tools</h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <ToolsListPage />;
}
