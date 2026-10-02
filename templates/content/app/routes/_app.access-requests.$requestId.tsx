import { AccessRequestApprovalPage } from "@agent-native/toolkit/app/sharing";

import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";

export default function AccessRequestRoute() {
  const sidebarTrigger = useSidebarTrigger();
  return (
    <AccessRequestApprovalPage
      header={
        sidebarTrigger ? (
          <div className="flex h-12 shrink-0 items-center px-4">
            {sidebarTrigger}
          </div>
        ) : null
      }
    />
  );
}
