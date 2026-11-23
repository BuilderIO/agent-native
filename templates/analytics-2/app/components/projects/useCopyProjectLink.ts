import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { toast } from "sonner";

import { projectPublicUrl } from "./projectList";

export function useCopyProjectLink() {
  const t = useT();
  return async (projectId: string) => {
    try {
      await navigator.clipboard.writeText(
        projectPublicUrl(projectId, window.location.origin, appBasePath()),
      );
      toast.success(t("analytics.lists.projectLinkCopied"));
    } catch {
      toast.error(t("analytics.lists.linkCopyFailed"));
    }
  };
}
