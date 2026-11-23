import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cellEmbedHref } from "@/lib/cell-link";

/**
 * The code that shows one cell of the latest published app inside another
 * page. It only names the app's own address, so whoever opens it still needs
 * access to the app; nothing is made public by copying it.
 */
export function CellEmbedDialog({
  projectId,
  cellId,
  onClose,
}: {
  projectId: string;
  cellId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [notice, setNotice] = useState<string | null>(null);
  const snippet = `<iframe src="${cellEmbedHref(window.location, { projectId, cellId })}" width="100%" height="480" style="border:0" loading="lazy"></iframe>`;
  const clipboard: Clipboard | undefined = (
    navigator as { clipboard?: Clipboard }
  ).clipboard;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("notebook.embed.title")}</DialogTitle>
          <DialogDescription>{t("notebook.embed.access")}</DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          rows={4}
          className="nb-embed-code"
          aria-label={t("notebook.embed.code")}
          value={snippet}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="nb-embed-actions">
          <button
            type="button"
            className="nb-button"
            onClick={() => {
              if (clipboard === undefined) {
                setNotice(t("notebook.cellActions.copyUnavailable"));
                return;
              }
              clipboard.writeText(snippet).then(
                () => setNotice(t("notebook.embed.copied")),
                () => setNotice(t("notebook.cellActions.copyFailed")),
              );
            }}
          >
            {t("notebook.embed.copy")}
          </button>
          {notice === null ? null : <span role="status">{notice}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
