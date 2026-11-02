import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useRequestDeckAccess } from "@/hooks/use-deck-access";

/**
 * "View only", and for a signed-in viewer a way to ask the owner for edit
 * access. The request goes to the owner, who picks the role when approving.
 */
export function ViewOnlyBadge({
  deckId,
  canRequestEdit,
}: {
  deckId: string;
  canRequestEdit: boolean;
}) {
  const t = useT();
  const { session } = useSession();
  const request = useRequestDeckAccess();
  const queryClient = useQueryClient();
  const requested = request.isSuccess && !request.data.alreadyHasAccess;
  const showRequest = canRequestEdit && Boolean(session?.email);

  return (
    <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {t("editorToolbar.viewOnly")}
      {showRequest ? (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            disabled={request.isPending || requested}
            onClick={() =>
              request.mutate(
                { deckId, role: "editor" },
                {
                  // Edit access granted since the role last loaded.
                  onSuccess: (result) => {
                    if (!result.alreadyHasAccess) return;
                    void queryClient.invalidateQueries({
                      queryKey: ["action", "list-resource-shares"],
                    });
                  },
                  onError: () =>
                    toast.error(t("editorToolbar.editAccessRequestFailed")),
                },
              )
            }
            className="text-foreground underline-offset-2 hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
          >
            {requested
              ? t("editorToolbar.editAccessRequested")
              : t("editorToolbar.requestEditAccess")}
          </button>
        </>
      ) : null}
    </span>
  );
}
