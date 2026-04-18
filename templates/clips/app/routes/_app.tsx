import { Outlet } from "react-router";
import { LibraryLayout } from "@/components/library/library-layout";
import { useAutoTitleBridge } from "@/hooks/use-auto-title";

// Pathless layout route — keeps the left sidebar + agent chat mounted across
// every library/space/archive/trash navigation. See client-side-routing skill.
export default function AppLayoutRoute() {
  // Watch for server-queued title delegations and dispatch them to the agent
  // chat. `sendToAgentChat` is browser-only so the server can't call it
  // directly; this bridge is how `request-transcript`'s "auto-title when the
  // clip still has the default title" hand-off actually reaches the agent.
  useAutoTitleBridge();

  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}
