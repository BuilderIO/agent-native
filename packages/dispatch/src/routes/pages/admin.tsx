import { Outlet } from "react-router";

import { AdminShell } from "../../components/admin-navigation";

export function meta() {
  return [{ title: "Admin — Dispatch" }];
}

export default function AdminRoute() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
