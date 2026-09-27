import { Outlet } from "react-router";

import { AppLayout } from "@/components/layout/AppLayout";
import { ViewPreferencesProvider } from "@/hooks/use-view-preferences";

export default function AppLayoutRoute() {
  return (
    <ViewPreferencesProvider>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </ViewPreferencesProvider>
  );
}
