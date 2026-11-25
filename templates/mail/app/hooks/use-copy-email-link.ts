import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { useCallback } from "react";
import { toast } from "sonner";

import { mailThreadUrl } from "@/lib/mail-routes";

export function useCopyEmailLink() {
  const t = useT();
  return useCallback(
    async (threadId: string, accountEmail?: string) => {
      const copied = await writeClipboardText(
        mailThreadUrl(threadId, accountEmail),
      );
      if (copied) toast.success(t("mail.toasts.linkCopied"));
      else toast.error(t("mail.toasts.linkCopyFailed"));
    },
    [t],
  );
}
