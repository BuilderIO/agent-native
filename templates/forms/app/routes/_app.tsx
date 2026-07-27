import { Outlet } from "react-router";

import { Layout } from "@/components/layout/Layout";

// Pathless layout route — wraps all protected routes with Layout so the
// agent sidebar persists across client-side navigations. Public routes
// (f.$ for form filling, _index chat home) live outside this layout.
export default function AppLayoutRoute() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
