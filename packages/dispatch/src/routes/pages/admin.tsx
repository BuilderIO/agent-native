import { Outlet, useLocation } from "react-router";

import { AdminShell } from "../../components/admin-navigation";

export function meta() {
  return [{ title: "Admin — Dispatch" }];
}

export default function AdminRoute() {
  const location = useLocation();
  const isAutomationsRoute =
    location.pathname === "/admin/automations" ||
    location.pathname.startsWith("/admin/automations/");
  const isIntegrationsRoute =
    location.pathname === "/admin/integrations" ||
    location.pathname.startsWith("/admin/integrations/");

  if (isAutomationsRoute || isIntegrationsRoute) return <Outlet />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
