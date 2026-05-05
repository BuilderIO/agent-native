import { useMemo } from "react";
import { ExtensionViewerPage } from "@agent-native/core/client/extensions";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export default function ExtensionViewerRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">Tools</h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <ExtensionViewerPage />;
}
