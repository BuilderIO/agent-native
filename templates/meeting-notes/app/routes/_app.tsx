import { Outlet } from "react-router";
import { AppLayout } from "@/components/layout/AppLayout";

export default function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
