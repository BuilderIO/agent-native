import { callAction, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  cancelOtherDiagnosticOwners,
  discardDiagnosticDraft,
  enqueueDiagnosticContext,
  listDiagnosticDrafts,
  subscribeDiagnosticDrafts,
  listDiagnosticOutbox,
  retryDiagnosticContext,
} from "@/lib/diagnostic-outbox";

export function useDiagnosticOutboxRecovery() {
  const { session, status } = useSession();
  const t = useT();
  const queryClient = useQueryClient();
  const ownerEmail = session?.email.toLowerCase() ?? null;
  const organization = useOrg({ enabled: status === "authenticated" });
  const orgId = organization.data
    ? organization.data.orgId
    : (session?.orgId ?? null);
  const owner =
    status === "authenticated" && ownerEmail && orgId
      ? { ownerEmail, orgId }
      : null;
  const identity = owner ? `${owner.ownerEmail}:${owner.orgId}` : null;
  const currentOwner = useRef(identity);
  currentOwner.current = identity;
  useEffect(() => {
    if (
      status === "loading" ||
      status === "unavailable" ||
      (status === "authenticated" && !organization.data && !session?.orgId)
    )
      return;
    let active = true;
    let running = false;
    const stillOwner = () => active && currentOwner.current === identity;
    const recover = async () => {
      if (running) return;
      running = true;
      try {
        await cancelOtherDiagnosticOwners(owner);
        if (!owner) return;
        for (const draft of listDiagnosticDrafts()) {
          if (!draft.payload || !stillOwner()) return;
          const toastId = `diagnostic-local:${draft.id}`;
          try {
            await enqueueDiagnosticContext(owner, draft.payload, stillOwner);
            discardDiagnosticDraft(draft.id);
            toast.dismiss(toastId);
          } catch {
            toast.error(t("privateContext.localStoreFailed"), {
              id: toastId,
              duration: Infinity,
              action: {
                label: t("privateContext.retry"),
                onClick: () => void recover(),
              },
              cancel: {
                label: t("privateContext.cancel"),
                onClick: () => {
                  discardDiagnosticDraft(draft.id);
                },
              },
            });
          }
        }
        for (const entry of await listDiagnosticOutbox()) {
          if (!active || currentOwner.current !== identity) return;
          if (
            !entry.payload ||
            entry.ownerEmail !== owner.ownerEmail ||
            entry.orgId !== owner.orgId
          )
            continue;
          try {
            await retryDiagnosticContext(
              entry.id,
              owner,
              (payload) =>
                callAction("save-recording-diagnostic-context", payload),
              stillOwner,
            );
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-recording-diagnostic-context"],
            });
          } catch {
            if (!stillOwner()) return;
            toast.error(t("privateContext.saveFailed"), {
              id: `diagnostic:${entry.id}`,
              duration: Infinity,
              action: {
                label: t("privateContext.retry"),
                onClick: () => void recover(),
              },
            });
          }
        }
      } finally {
        running = false;
      }
    };
    const unsubscribe = subscribeDiagnosticDrafts(
      () =>
        void recover().catch(() =>
          toast.error(t("privateContext.localStoreFailed")),
        ),
    );
    const warn = (event: BeforeUnloadEvent) => {
      if (!listDiagnosticDrafts().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    void recover().catch(() =>
      toast.error(t("privateContext.localStoreFailed")),
    );
    const retry = () =>
      void recover().catch(() =>
        toast.error(t("privateContext.localStoreFailed")),
      );
    window.addEventListener("online", retry);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", retry);
      for (const pendingToast of toast.getToasts()) {
        if (String(pendingToast.id).startsWith("diagnostic:"))
          toast.dismiss(pendingToast.id);
      }
      for (const pendingToast of toast.getToasts()) {
        if (String(pendingToast.id).startsWith("diagnostic-local:"))
          toast.dismiss(pendingToast.id);
      }
      queryClient.removeQueries({
        queryKey: ["action", "get-recording-diagnostic-context"],
      });
      queryClient.removeQueries({
        queryKey: ["action", "list-recording-diagnostic-grants"],
      });
    };
  }, [
    ownerEmail,
    orgId,
    identity,
    organization.data,
    queryClient,
    session?.orgId,
    status,
    t,
  ]);
}
