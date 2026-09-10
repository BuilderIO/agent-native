import { useT } from "@agent-native/core/client/i18n";
import type { BugReportContext } from "@shared/bug-report";
import { useEffect, useState } from "react";

import { BugReportForm } from "@/components/bug-report/bug-report-form";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OPEN_BUG_REPORT_EVENT } from "@/lib/command-events";

function currentBugReportContext(): BugReportContext {
  return {
    projectId: null,
    title: null,
    description: null,
    severity: "normal",
    sourceUrl: window.location.href,
    pageTitle: document.title || null,
    appVersion: null,
    environment: null,
    reporterEmail: null,
    reporterName: null,
    reporterId: null,
    metadata: null,
    returnUrl: window.location.href,
  };
}

export function BugReportDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [initialContext, setInitialContext] = useState<BugReportContext | null>(
    null,
  );

  useEffect(() => {
    const handleOpen = () => {
      setInitialContext(currentBugReportContext());
      setOpen(true);
    };
    window.addEventListener(OPEN_BUG_REPORT_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_BUG_REPORT_EVENT, handleOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl gap-0 p-0">
        <DialogTitle className="sr-only">
          {t("bugReportRoute.title")}
        </DialogTitle>
        {open ? (
          <div className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto p-5 sm:p-6">
            <BugReportForm
              initialContext={initialContext}
              onRecordingStarted={() => setOpen(false)}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
