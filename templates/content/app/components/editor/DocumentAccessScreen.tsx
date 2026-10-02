import {
  callAction,
  signOut,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useResourceAccessGate } from "@agent-native/core/client/sharing";
import { ResourceAccessScreen } from "@agent-native/toolkit/app/sharing";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { useRestoreDocument } from "@/hooks/use-documents";
import { CONTENT_LANDING_PATH } from "@/lib/content-landing";

// A Page link this account can't open stays on its URL and says what is
// true: the page exists but isn't shared with them, it doesn't exist, or it
// is in the trash. Trash reads as missing to anyone who couldn't open it.
export function DocumentAccessScreen({
  documentId,
  loading,
  onReload,
}: {
  documentId: string;
  /** Shown while the link's status loads. */
  loading: ReactNode;
  /** Reads the page again once the viewer can open it. */
  onReload: () => void;
}) {
  const t = useT();
  const sidebarTrigger = useSidebarTrigger();
  const { session } = useSession();
  const gate = useResourceAccessGate({
    resourceType: "document",
    resourceId: documentId,
    onAccessGranted: onReload,
  });
  const restore = useRestoreDocument();

  if (gate.isError) {
    return <QueryErrorState onRetry={() => void gate.refetch()} />;
  }
  if (!gate.status) return <>{loading}</>;

  const header = sidebarTrigger ? (
    <div className="flex h-12 shrink-0 items-center px-4">{sidebarTrigger}</div>
  ) : null;
  const goToMyPages = (
    <Button asChild>
      <Link to={CONTENT_LANDING_PATH}>{t("empty.goToMyPages")}</Link>
    </Button>
  );
  const { state, role } = gate.status;

  if (state === "signed-out") {
    return <ResourceAccessScreen state="signed-out" header={header} />;
  }

  if (state === "denied") {
    return (
      <ResourceAccessScreen
        state="denied"
        header={header}
        title={t("empty.pageNoAccess")}
        signedInEmail={session?.email ?? null}
        actions={goToMyPages}
        onSwitchAccount={() => void signOut()}
      />
    );
  }

  if (state === "trashed") {
    const canRestore = role === "owner" || role === "admin";
    // Restoring a page restores the subtree that was trashed with it, which
    // starts at the page that was deleted.
    const restorePage = async () => {
      try {
        const trashed = await callAction<{ trashRootId?: string | null }>(
          "get-trashed-document",
          { id: documentId },
          { method: "GET" },
        );
        await restore.mutateAsync({ id: trashed.trashRootId ?? documentId });
        toast.success(t("trash.restored"));
        onReload();
      } catch {
        toast.error(t("trash.restoreFailed"));
      }
    };
    return (
      <ResourceAccessScreen
        state="trashed"
        header={header}
        title={t("empty.pageInTrash")}
        description={canRestore ? undefined : t("empty.pageInTrashAskOwner")}
        actions={
          canRestore ? (
            <>
              <Button
                onClick={() => void restorePage()}
                disabled={restore.isPending}
              >
                {t("trash.restore")}
              </Button>
              <Button asChild variant="outline">
                <Link to="/trash">{t("empty.openTrash")}</Link>
              </Button>
            </>
          ) : (
            goToMyPages
          )
        }
      />
    );
  }

  // `missing`, or `allowed` after the page read failed (for example a page
  // whose collection was deleted), which the viewer can't open either way.
  return (
    <ResourceAccessScreen
      state="missing"
      header={header}
      title={t("empty.pageMissing")}
      actions={goToMyPages}
    />
  );
}
