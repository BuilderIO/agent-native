import { Outlet } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";

// Pathless layout route — wraps all protected routes with AppLayout so the
// agent sidebar and document tree persist across client-side navigations.
export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
