import { Outlet } from "react-router";

import { AppShell } from "@/components/shell/AppShell";

export default function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
