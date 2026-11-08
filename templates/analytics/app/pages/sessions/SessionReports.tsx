import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import { useSendToAgentChat } from "@agent-native/toolkit/app/chat";
import {
  IconFileDescription,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import { sessionReportPath } from "../../../shared/session-reports";
import { formatOffsetClock } from "./session-replay-devtools";

function createReportContext(recordingId: string, fromMs: number | null) {
  const from =
    fromMs === null
      ? "The person asked from the session page."
      : `The person asked from the moment ${formatOffsetClock(fromMs)} into the recording (fromMs=${fromMs}); start the report there.`;
  return (
    `Write a report on session replay recording ${recordingId}. ${from} ` +
    `Read get-session-replay-summary and get-session-replay-timeline first. ` +
    `Then call create-session-report with recordingId=${recordingId}${fromMs === null ? "" : ` and fromMs=${fromMs}`}: ` +
    `a one-line title naming what went wrong, a summary in plain words that cites the moments showing it, the key moments in time order, steps that reproduce it, and errorIssueId when the session hit a Monitoring error issue. ` +
    `Write only what the session shows. Then call navigate with the new reportId to open it.`
  );
}

/** A replay's reports, and a way to have the agent write one. */
export function SessionReportsButton({
  recordingId,
  fromMs,
}: {
  recordingId: string;
  fromMs: number | null;
}) {
  const t = useT();
  const lab = useLab(ANALYTICS_SESSIONS_TRIAGE_LAB);
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();
  const query = useActionQuery(
    "list-session-reports",
    { recordingId, limit: 20 },
    { enabled: lab, staleTime: 30_000 },
  );
  if (!lab) return null;

  function createReport() {
    setOpen(false);
    send({
      message: t("sessions.createReportMessage"),
      context: createReportContext(recordingId, fromMs),
      submit: true,
    });
  }

  const reports = query.data?.reports ?? [];
  const createButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          onClick={createReport}
          disabled={isGenerating || query.isLoading}
        >
          <IconFileDescription className="h-4 w-4" />
          {t("sessions.createReport")}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("sessions.createReportTooltip")}</TooltipContent>
    </Tooltip>
  );
  // Writing a report doesn't need the list, so a failed list keeps Create.
  if (query.isError && !query.data) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <IconRefresh className={cn(query.isFetching && "animate-spin")} />
          {t("sessions.reportsUnavailable")}
        </Button>
        {createButton}
      </>
    );
  }
  if (!reports.length) return createButton;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          <IconFileDescription className="h-4 w-4" />
          {t("sessions.reportCount", { count: String(reports.length) })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <ul className="flex flex-col">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                to={sessionReportPath(report.id)}
                className="block truncate rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                {report.title}
              </Link>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={createReport}
          disabled={isGenerating}
        >
          <IconPlus className="h-4 w-4" />
          {t("sessions.createReport")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
