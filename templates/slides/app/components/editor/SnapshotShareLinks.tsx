import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface SnapshotShareLink {
  token: string;
  createdAt: string;
}

export function SnapshotShareLinks({ deckId }: { deckId: string }) {
  const t = useT();
  const query = useActionQuery<{ links: SnapshotShareLink[] }>(
    "list-deck-share-links",
    { deckId },
  );
  const revoke = useActionMutation<unknown, { deckId: string; token: string }>(
    "revoke-deck-share-link",
    {
      onSuccess: () => void query.refetch(),
      onError: () => toast.error(t("share.revokeFailed")),
    },
  );

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
