import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import type listLegacyProposals from "../../../actions/list-notebook-legacy-proposals";
import type recoverLegacyProposal from "../../../actions/recover-notebook-legacy-proposal";

type LegacyRead = Awaited<ReturnType<typeof listLegacyProposals.run>>;
type LegacyChange = LegacyRead["changes"][number];
type RecoveryRequest = Parameters<typeof recoverLegacyProposal.run>[0];

export function NotebookLegacyProposals({
  projectId,
  identity,
  ensureThread,
  selectThread,
}: {
  projectId: string;
  identity: string;
  ensureThread: () => Promise<string>;
  selectThread: (id: string) => void;
}) {
  const t = useT();
  const legacy = useActionQuery<LegacyRead>(
    "list-notebook-legacy-proposals",
    { projectId },
    { uiOnly: true, retry: false, queryKeyScope: [identity] },
  );
  const [working, setWorking] = useState(false);
  const last = useRef<RecoveryRequest | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const data = legacy.data;
  async function recover(
    change: LegacyChange,
    decision: RecoveryRequest["decision"],
  ) {
    if (!data || working) return;
    setWorking(true);
    try {
      const previous = last.current;
      const same =
        previous?.legacyId === change.legacyId &&
        previous.decision === decision;
      const operation = {
        projectId,
        head: data.head,
        cellId: change.cellId,
        legacyId: change.legacyId,
        opId: crypto.randomUUID(),
      };
      const request: RecoveryRequest = same
        ? previous
        : decision === "re-propose"
          ? { ...operation, decision, threadId: await ensureThread() }
          : { ...operation, decision };
      last.current = request;
      await callAction("recover-notebook-legacy-proposal", request, {
        uiOnly: true,
        keepalive: false,
      });
      last.current = undefined;
      await legacy.refetch();
      if (request.decision === "re-propose" && mounted.current)
        selectThread(request.threadId);
    } catch {
      toast.error(t("notebook.reviewRecoveryFailed"));
    } finally {
      setWorking(false);
    }
  }

  if (legacy.isError)
    return (
      <div role="alert" className="nb-banner">
        {t("notebook.reviewRecoveryFailed")}
      </div>
    );
  if (!data?.changes.length) return null;
  return (
    <details className="nb-banner">
      <summary>{t("notebook.reviewEarlierChanges")}</summary>
      {data.changes.map((change) => (
        <div className="my-2 space-y-1" key={change.legacyId}>
          <p>{t("notebook.reviewCurrent")}</p>
          <pre className="nb-pending-code">{change.baseSource}</pre>
          <p>{t("notebook.reviewProposed")}</p>
          <pre className="nb-pending-code">{change.source}</pre>
          <Button
            size="sm"
            variant="ghost"
            disabled={working}
            onClick={() => void recover(change, "discard")}
          >
            {t("notebook.reviewDiscard")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => void recover(change, "re-propose")}
          >
            {t("notebook.reviewRepropose")}
          </Button>
        </div>
      ))}
    </details>
  );
}
