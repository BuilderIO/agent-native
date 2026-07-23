import { useT } from "@agent-native/core/client/i18n";
import { ShareDialog } from "@agent-native/core/client/sharing";
import { Avatar, Status } from "@agent-native/toolkit/design-system";
import { useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export default function DesignSystemProofRoute() {
  const t = useT();
  const [open, setOpen] = useState(true);

  return (
    <ShareDialog
      open={open}
      onClose={() => setOpen(false)}
      resourceType="chat_thread"
      resourceId="design-system-proof"
      resourceTitle={APP_TITLE}
      shareUrl="/design-system-proof"
      linkTabExtras={
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Avatar
            name={APP_TITLE}
            fallback={APP_TITLE.slice(0, 2).toUpperCase()}
            size="compact"
          />
          <span className="min-w-0 flex-1 truncate text-sm">{APP_TITLE}</span>
          <Status tone="success" size="compact">
            {t("share.ownerRole")}
          </Status>
        </div>
      }
    />
  );
}
