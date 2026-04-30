import { Outlet } from "react-router";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { AppLayout } from "@/components/layout/AppLayout";

export default function AppLayoutRoute() {
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </ClientOnly>
  );
}
