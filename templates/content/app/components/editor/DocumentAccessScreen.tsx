import {
  signOut,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useResourceAccessGate,
  type ResourceAccessGateRole,
  type ResourceAccessGateStatus,
} from "@agent-native/core/client/sharing";
import { ResourceAccessScreen } from "@agent-native/toolkit/app/sharing";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { useSidebarTrigger } from "@/components/layout/sidebar-trigger";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { useRestoreDocument } from "@/hooks/use-documents";
import { CONTENT_LANDING_PATH } from "@/lib/content-landing";

function managesPage(role: ResourceAccessGateRole | undefined) {
  return role === "owner" || role === "admin";
}

// A Page link this account can't open stays on its URL and says what is
// true: the page exists but isn't shared with them, it doesn't exist, or it
// is in the trash. Trash reads as missing to anyone who couldn't open it.
export function DocumentAccessScreen({
  documentId,
  loading,
  reloading = false,
  onReload,
}: {
  documentId: string;
  /** Shown while the link's status loads. */
  loading: ReactNode;
  /** Whether the page is being read again. */
  reloading?: boolean;
  /** Reads the page again once the viewer can open it. */
  onReload: () => void;
}) {
  const t = useT();
  const sidebarTrigger = useSidebarTrigger();
  const { session } = useSession();
  // The page this screen already read again because its status said it could
  // be opened, so a second failure reads as missing instead of reloading.
  const [reloadedFor, setReloadedFor] = useState<string | null>(null);
  const gate = useResourceAccessGate({
    resourceType: "document",
    resourceId: documentId,
    onAccessGranted: () => {
      setReloadedFor(documentId);
      onReload();
    },
  });
  const restore = useRestoreDocument();

  // Restore brings back the subtree trashed with the page, starting at the
  // page that was deleted, so it needs admin access to that page, the same
  // rule as Restore in the Trash list.
  const trashed = gate.status?.state === "trashed";
  const trashedPage = useActionQuery<{ trashRootId?: string | null }>(
    "get-trashed-document",
    { id: documentId },
    { enabled: trashed && managesPage(gate.status?.role), retry: false },
  );
  const trashRootId = trashedPage.data
    ? (trashedPage.data.trashRootId ?? documentId)
    : null;
  const rootAccess = useActionQuery<ResourceAccessGateStatus>(
    "get-resource-access-status",
    { resourceType: "document", resourceId: trashRootId ?? "" },
    {
      enabled: trashed && !!trashRootId && trashRootId !== documentId,
      retry: false,
    },
  );

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
    const checkingRestore =
      managesPage(role) &&
      (trashedPage.isPending ||
        (trashRootId !== null &&
          trashRootId !== documentId &&
          rootAccess.isPending));
    if (checkingRestore) return <>{loading}</>;
    const canRestore =
      managesPage(role) &&
      trashRootId !== null &&
      (trashRootId === documentId || managesPage(rootAccess.data?.role));
    const restorePage = async () => {
      if (!trashRootId) return;
      try {
        await restore.mutateAsync({ id: trashRootId });
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

  // The status says the page can be opened, so it was read again; wait for
  // that read before saying anything.
  if (state === "allowed" && (reloading || reloadedFor !== documentId)) {
    return <>{loading}</>;
  }

  // `missing`, or `allowed` when the page still can't be read after reading
  // it again (for example a page whose collection was deleted).
  return (
    <ResourceAccessScreen
      state="missing"
      header={header}
      title={t("empty.pageMissing")}
      actions={goToMyPages}
    />
  );
}
