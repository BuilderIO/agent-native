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

  if (isAutomationsRoute) return <Outlet />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
