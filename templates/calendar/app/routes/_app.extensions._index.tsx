import { useMemo } from "react";
import { ExtensionsListPage } from "@agent-native/core/client/extensions";
import { useAppHeaderControls } from "@/components/layout/AppLayout";

export default function ExtensionsRoute() {
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">Extensions</h1>
      ),
    }),
    [],
  );
  useAppHeaderControls(controls);
  return <ExtensionsListPage />;
}
