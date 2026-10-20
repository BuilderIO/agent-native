import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

type TriageOutcome = "resolved" | "reopen";

export function TriageOutcomeMenu({
  factoryId,
  itemId,
  itemTitle,
}: {
  factoryId: string;
  itemId: string;
  itemTitle: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    { status: string },
    { factoryId: string; itemId: string; outcome: TriageOutcome }
  >("set-triage-item-outcome");

  async function setOutcome(outcome: TriageOutcome) {
    try {
      await mutation.mutateAsync({ factoryId, itemId, outcome });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["action", "list-triage-items"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["action", "get-triage-item"],
        }),
      ]);
      toast.success(t("factoryRoute.inboxOutcomeUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("factoryRoute.inboxOutcomeFailed"),
      );
    }
  }

  return (
    <RowActionsMenu
      ariaLabel={t("factoryRoute.inboxRowActions", { title: itemTitle })}
      disabled={mutation.isPending}
    >
      <DropdownMenuItem onSelect={() => void setOutcome("resolved")}>
        {t("factoryRoute.inboxMarkResolved")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void setOutcome("reopen")}>
        {t("factoryRoute.inboxSendBackToAutomation")}
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
