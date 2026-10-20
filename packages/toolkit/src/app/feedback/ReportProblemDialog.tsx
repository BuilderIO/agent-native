import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  countRecorderEventsByType,
  formatProblemReportSummary,
  formatRecorderEvent,
  isFailedRecorderEvent,
  uploadProblemReport,
} from "@agent-native/core/client/problem-report";
import {
  recorder,
  type RecorderEvent,
  type RecorderReport,
} from "@agent-native/core/client/recorder";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import { useRef, useState } from "react";

import { useHasAgentChat } from "../chat/agent-chat-presence.js";

const PREVIEW_FAILURES = 3;
const PREVIEW_EVENTS = 5;
const PREVIEW_DATA_CHARS = 80;

type Step =
  | { kind: "preview" }
  | { kind: "attaching" }
  | { kind: "notAttached"; message?: string }
  | { kind: "copy"; summary: string; copied: boolean };

export interface ReportProblemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportProblemDialog({
  open,
  onOpenChange,
}: ReportProblemDialogProps) {
  const [attaching, setAttaching] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!attaching) onOpenChange(next);
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-md gap-4">
        <ReportProblemBody
          onAttachingChange={setAttaching}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReportProblemBody({
  onAttachingChange,
  onClose,
}: {
  onAttachingChange: (attaching: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const hasAgentChat = useHasAgentChat();
  const [preview] = useState(() => recorder.report());
  const [step, setStep] = useState<Step>({ kind: "preview" });
  // Built once on consent: a retry re-sends this report instead of firing the
  // recorder's onReport destinations a second time.
  const consentedReport = useRef<RecorderReport | null>(null);

  const copySummary = async (summary: string) => {
    const copied = await writeClipboardText(summary);
    setStep({ kind: "copy", summary, copied });
  };

  const attach = async () => {
    setStep({ kind: "attaching" });
    onAttachingChange(true);
    const report = (consentedReport.current ??= recorder.report({
      reason: "user",
    }));
    const upload = await uploadProblemReport(report);
    onAttachingChange(false);
    if (upload.status === "failed") {
      setStep({ kind: "notAttached", message: upload.message });
      return;
    }
    const summary = formatProblemReportSummary(report, upload.ref);
    if (!hasAgentChat) {
      await copySummary(summary);
      return;
    }
    sendToAgentChat({
      message: t("agentChat.reportProblem.agentMessage"),
      context: summary,
      submit: true,
      openSidebar: true,
    });
    onClose();
  };

  const attaching = step.kind === "attaching";
  const primaryLabel =
    step.kind === "attaching"
      ? t("agentChat.reportProblem.attaching")
      : step.kind === "notAttached"
        ? t("agentChat.common.retry")
        : step.kind === "copy"
          ? step.copied
            ? t("agentChat.common.copied")
            : t("agentChat.recovery.copyFailed")
          : hasAgentChat
            ? t("agentChat.reportProblem.send")
            : t("agentChat.reportProblem.copy");

  return (
    <>
      <DialogTitle className="text-base">
        {t("agentChat.reportProblem.title", { count: preview.windowSeconds })}
      </DialogTitle>
      <ReportPreview report={preview} />
      {step.kind === "notAttached" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("agentChat.reportProblem.notAttached")}
          {step.message ? ` ${step.message}` : null}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={attaching}
          onClick={onClose}
        >
          {t("agentChat.common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={attaching}
          onClick={() =>
            void (step.kind === "copy" ? copySummary(step.summary) : attach())
          }
        >
          {attaching ? <Spinner aria-hidden /> : null}
          {primaryLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReportPreview({ report }: { report: RecorderReport }) {
  const t = useT();
  if (report.events.length === 0) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        {t("agentChat.reportProblem.noEvents")}
      </p>
    );
  }
  const counts = Object.entries(countRecorderEventsByType(report.events))
    .map(([type, count]) => `${type} ${count}`)
    .join(" · ");
  const failures = report.events
    .filter(isFailedRecorderEvent)
    .slice(0, PREVIEW_FAILURES);
  return (
    <div className="overflow-hidden rounded-md border border-border font-mono text-xs">
      <p className="border-b border-border px-3 py-2 text-foreground">
        {counts}
      </p>
      {failures.length > 0 ? (
        <EventLines
          events={failures}
          className="border-b border-border text-destructive"
        />
      ) : null}
      <EventLines
        events={report.events.slice(0, PREVIEW_EVENTS)}
        className="text-muted-foreground"
      />
    </div>
  );
}

function EventLines({
  events,
  className,
}: {
  events: RecorderEvent[];
  className: string;
}) {
  return (
    <ul className={cn("space-y-1 px-3 py-2", className)}>
      {events.map((event, index) => (
        <li key={index} className="truncate">
          {formatRecorderEvent(event, PREVIEW_DATA_CHARS)}
        </li>
      ))}
    </ul>
  );
}
