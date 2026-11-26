import { useT } from "@agent-native/core/client/i18n";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { createPortal } from "react-dom";

import { BuilderReviewLoadingRow } from "./BuilderSourceReviewDialog";

const REVIEW_DIALOG_FADE_IN_MS = 200;

export type BuilderReviewOpeningPanelHandle = {
  show: () => void;
  hide: () => void;
};

export const BuilderReviewOpeningPanel = forwardRef<
  BuilderReviewOpeningPanelHandle,
  { dialogOpen: boolean }
>(function BuilderReviewOpeningPanel({ dialogOpen }, ref) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useImperativeHandle(
    ref,
    () => ({ show: () => setShown(true), hide: () => setShown(false) }),
    [],
  );
  useEffect(() => {
    if (!dialogOpen) return;
    const timer = setTimeout(() => setShown(false), REVIEW_DIALOG_FADE_IN_MS);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [dialogOpen]);

  if (!shown) return null;
  return createPortal(
    <div
      data-builder-review-opening=""
      role="status"
      className="fixed left-1/2 top-1/2 z-[275] flex w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl"
    >
      <div className="flex h-12 shrink-0 flex-col justify-center border-b border-border px-4">
        <div className="truncate text-sm font-semibold">
          {t("database.reviewBuilderUpdate")}
        </div>
        <div aria-hidden="true" className="truncate text-xs">
          &nbsp;
        </div>
      </div>
      <div className="p-4">
        <BuilderReviewLoadingRow />
      </div>
      <div className="h-14 shrink-0 border-t border-border" />
    </div>,
    document.body,
  );
});
