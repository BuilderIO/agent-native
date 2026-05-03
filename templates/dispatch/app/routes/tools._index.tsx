import { ToolsListPage } from "@agent-native/core/client/tools";
import { DispatchShell } from "@/components/dispatch-shell";

export default function ToolsRoute() {
  return (
    <DispatchShell title="Tools">
      <ToolsListPage />
    </DispatchShell>
  );
}
