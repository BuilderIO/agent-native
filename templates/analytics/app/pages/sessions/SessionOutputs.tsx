import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import {
  IconExternalLink,
  IconPackage,
  IconRefresh,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { ANALYTICS_SESSIONS_TRIAGE_LAB } from "../../../shared/labs";
import {
  MIN_PRESENTATION_MS,
  OUTPUT_USE_WINDOW_DAYS,
  type OutputUseApp,
  type SessionOutput,
  type SessionRecordingOutputs,
} from "../../../shared/output-use";

type T = ReturnType<typeof useT>;

export function unusedFilterLabel(app: OutputUseApp, t: T): string {
  switch (app) {
    case "slides":
      return t("sessions.unusedSlidesDecks");
  }
}

export function unusedRuleText(app: OutputUseApp, t: T): string {
  switch (app) {
    case "slides":
      return t("sessions.unusedSlidesRule", {
        days: String(OUTPUT_USE_WINDOW_DAYS),
        seconds: String(MIN_PRESENTATION_MS / 1000),
      });
  }
}

function openOutputLabel(output: SessionOutput, t: T): string {
  switch (output.app) {
    case "slides":
      return t("sessions.openDeck");
  }
}

function outputTitle(output: SessionOutput, t: T): string {
  const date = new Date(output.madeAt).toLocaleDateString();
  switch (output.app) {
    case "slides":
      return t("sessions.deckMadeOn", { date });
  }
}

export function outputStatusText(output: SessionOutput, t: T): string {
  switch (output.status) {
    case "used": {
      const date = output.usedAt
        ? new Date(output.usedAt).toLocaleDateString()
        : "";
      if (output.usedEvent === "presentation_ended") {
        return t("sessions.outputPresentedOn", { date });
      }
      if (output.usedEvent === "deck_exported") {
        return t("sessions.outputExportedOn", { date });
      }
      return t("sessions.outputUsedOn", { date });
    }
    case "unused":
      return t("sessions.outputUnused", {
        days: String(OUTPUT_USE_WINDOW_DAYS),
      });
    case "open":
      return t("sessions.outputOpen", {
        date: new Date(output.useBy).toLocaleDateString(),
      });
    case "unmeasured":
      return t("sessions.outputUnmeasured");
  }
}

function OutputLink({ output }: { output: SessionOutput }) {
  const t = useT();
  if (!output.url) return null;
  return (
    <Button asChild variant="ghost" size="xs" className="shrink-0">
      <a href={output.url} target="_blank" rel="noreferrer">
        {openOutputLabel(output, t)}
        <IconExternalLink />
      </a>
    </Button>
  );
}

// A link cannot nest inside the row's replay link, so this sits beside it.
export function UnusedOutputLink({
  outputs,
}: {
  outputs?: SessionOutput[] | null;
}) {
  const t = useT();
  const unusedOutputs = (outputs ?? []).filter(
    (output) => output.status === "unused",
  );
  const linked = unusedOutputs.find((output) => output.url);
  if (!linked) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 px-3">
      <OutputLink output={linked} />
      {unusedOutputs.length > 1 ? (
        <span className="text-xs text-muted-foreground">
          {t("sessions.moreOutputs", {
            count: String(unusedOutputs.length - 1),
          })}
        </span>
      ) : null}
    </div>
  );
}

/** The outputs a replay's session made, and whether each was used in time. */
export function SessionOutputsButton({ recordingId }: { recordingId: string }) {
  const t = useT();
  const lab = useLab(ANALYTICS_SESSIONS_TRIAGE_LAB);
  const query = useActionQuery<SessionRecordingOutputs>(
    "list-session-outputs",
    { recordingIds: [recordingId] },
    { enabled: lab, staleTime: 30_000 },
  );
  if (!lab) return null;
  if (query.isError && !query.data) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
      >
        <IconRefresh className={cn(query.isFetching && "animate-spin")} />
        {t("sessions.outputsUnavailable")}
      </Button>
    );
  }
  const outputs = query.data?.outputs[recordingId];
  if (!outputs?.length) return null;
  const omitted = query.data?.omittedOutputs[recordingId] ?? 0;
  const total = outputs.length + omitted;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <IconPackage />
          {t(
            total === 1 ? "sessions.deckCountSingular" : "sessions.deckCount",
            { count: String(total) },
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ul className="space-y-3">
          {outputs.map((output) => (
            <li
              key={`${output.app}:${output.outputId}`}
              className="flex items-start justify-between gap-3"
            >
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">
                  {outputTitle(output, t)}
                </span>
                <span
                  className={cn(
                    "block text-xs text-muted-foreground",
                    output.status === "unused" && "text-foreground",
                  )}
                >
                  {outputStatusText(output, t)}
                </span>
              </span>
              <OutputLink output={output} />
            </li>
          ))}
        </ul>
        {omitted ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("sessions.moreOutputs", { count: String(omitted) })}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
