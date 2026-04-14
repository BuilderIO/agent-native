import { Outlet } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";

// Pathless layout route — wraps all protected routes with AppLayout so the
// agent sidebar and calendar context persist across client-side navigations.
// Public routes (book.$slug, meet.$username.$slug, booking.manage.$token)
// intentionally live outside this layout.
export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
