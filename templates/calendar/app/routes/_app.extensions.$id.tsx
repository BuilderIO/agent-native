import { ExtensionViewerPage } from "@agent-native/toolkit/app/extensions";
import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { HeaderActions } from "@/components/layout/HeaderActions";

export default function ExtensionViewerRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">
          Extensions
        </h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <ExtensionViewerPage headerActions={<HeaderActions />} />;
}
