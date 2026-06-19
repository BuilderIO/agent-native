import { Outlet } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";

export function meta() {
  return [
    {
      title:
        "Agent-Native Content - Open Source, agent-friendly Obsidian alternative",
    },
  ];
}

// Pathless layout route — wraps all protected routes with AppLayout so the
// agent sidebar and document tree persist across client-side navigations.
export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
