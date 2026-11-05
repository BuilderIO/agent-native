import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useDeckRole } from "@/hooks/use-deck-role";

interface SnapshotShareLink {
  token: string;
  createdAt: string;
}

export function SnapshotShareLinks({ deckId }: { deckId: string }) {
  const t = useT();
  const { role } = useDeckRole(deckId);
  // Listing needs admin access, so a failure only means something for managers.
  const canManage = role === "owner" || role === "admin";
  const query = useActionQuery<{ links: SnapshotShareLink[] }>(
    "list-deck-share-links",
    { deckId },
    { enabled: canManage },
  );
  const revoke = useActionMutation<unknown, { deckId: string; token: string }>(
    "revoke-deck-share-link",
    {
      onSuccess: () => void query.refetch(),
      onError: () => toast.error(t("share.revokeFailed")),
    },
  );

  if (!canManage) return null;
  if (query.isError) {
    return (
      <div
        role="alert"
        className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground"
      >
        <span>{t("share.snapshotLinksLoadFailed")}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("settings.retry")}
        </Button>
      </div>
    );
  }

  const links = query.data?.links ?? [];
  if (links.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        {t("share.snapshotLinks")}
      </div>
      {links.map((link) => (
        <div
          key={link.token}
          className="flex items-center justify-between gap-3"
        >
          <span className="text-sm text-muted-foreground">
            {new Date(link.createdAt).toLocaleString()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({ deckId, token: link.token })}
          >
            <IconTrash className="h-3.5 w-3.5" />
            {t("share.revokeLink")}
          </Button>
        </div>
      ))}
    </div>
  );
}
