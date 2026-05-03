import { ToolViewerPage } from "@agent-native/core/client/tools";
import { DispatchShell } from "@/components/dispatch-shell";

export default function ToolViewerRoute() {
  return (
    <DispatchShell title="Tools">
      <ToolViewerPage />
    </DispatchShell>
  );
}
