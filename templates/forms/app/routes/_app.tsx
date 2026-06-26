import { Outlet } from "react-router";

import { AppLayout } from "@/components/layout/AppLayout";

// Pathless layout route — wraps all protected routes with AppLayout so the
// agent sidebar persists across client-side navigations. Public routes
// (f.$ for form filling, _index chat home) live outside this layout.
export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
