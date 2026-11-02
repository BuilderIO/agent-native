import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { useContentActionMutation } from "@/hooks/use-content-action-mutation";
import { documentQueryFilter } from "@/lib/document-query";

/**
 * The Share panel's "Agents can't edit the text of this" switch. Anyone who
 * can open the panel sees whether it's on; only someone who manages the page
 * can change it.
 */
export function AgentTextLockSetting({
  documentId,
  locked,
  canManage,
}: {
  documentId: string;
  locked: boolean;
  canManage: boolean;
}) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const setLock = useContentActionMutation("set-document-agent-text-lock", {
    invalidates: [],
  });
  const [pending, setPending] = useState<boolean | null>(null);

  const handleChange = async (next: boolean) => {
    setPending(next);
    try {
      await setLock.mutateAsync({ id: documentId, locked: next });
      queryClient.setQueriesData(
        documentQueryFilter(documentId),
        (old: unknown) =>
          old && typeof old === "object"
            ? { ...old, agentTextLocked: next }
            : old,
      );
    } catch (err) {
      toast.error(t("editor.toolbar.failedToUpdateSharing"), {
        description:
          err instanceof Error ? err.message : t("empty.genericError"),
      });
    } finally {
      setPending(null);
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {t("editor.toolbar.agentTextLock")}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
          {t("editor.toolbar.agentTextLockDescription")}
        </span>
      </label>
      <Switch
        id={id}
        checked={pending ?? locked}
        disabled={!canManage || pending !== null}
        onCheckedChange={(next) => void handleChange(next)}
      />
    </div>
  );
}
