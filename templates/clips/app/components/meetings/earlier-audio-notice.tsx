import { useT } from "@agent-native/core/client/i18n";
import { withoutEarlierAudio } from "@shared/earlier-audio";
import { readSegmentEntries } from "@shared/transcript-segments";
import { IconHistory } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface MeetingWithEarlierAudio {
  earlierAudioMinutes?: number | null;
  actionItems?: unknown[];
  transcript?: { segmentsJson?: unknown } | null;
  meeting?: { actualEnd?: string | null } | null;
}

/**
 * What `get-meeting` will return once the removal lands. A live meeting keeps
 * its notes: they aren't built from the transcript until it ends.
 */
export function withEarlierAudioRemoved<T extends MeetingWithEarlierAudio>(
  resp: T,
): T {
  const raw = resp.transcript?.segmentsJson;
  const entries = typeof raw === "string" ? readSegmentEntries(raw) : null;
  return {
    ...resp,
    earlierAudioMinutes: 0,
    ...(resp.transcript && entries
      ? {
          transcript: {
            ...resp.transcript,
            segmentsJson: JSON.stringify(withoutEarlierAudio(entries)),
          },
        }
      : {}),
    ...(resp.meeting?.actualEnd
      ? {
          actionItems: [],
          meeting: {
            ...resp.meeting,
            summaryMd: "",
            bulletsJson: "[]",
            actionItemsJson: "[]",
          },
        }
      : {}),
  } as T;
}

export const DEFERRED_NOTES_POLL_MS = 5_000;
// Covers the removal's 30-second job, then the two minutes before it can take
// over a claim left by a run that died.
export const DEFERRED_NOTES_WAIT_MS = 3 * 60_000;

/**
 * Watches for notes built by a run this page didn't start: the removal's
 * delayed job, or a run already under way when the page asked for its own. An
 * ended meeting's page doesn't otherwise poll, so it would sit blank or stale
 * until the next focus or reload.
 */
export function useDeferredNotesWait({
  meetingId,
  notesArrived,
  notesFailed = false,
  refetch,
  onGiveUp,
}: {
  meetingId: string | undefined;
  notesArrived: boolean;
  notesFailed?: boolean;
  refetch: () => unknown;
  onGiveUp: () => void;
}) {
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const pending = !!meetingId && waitingFor === meetingId;
  if (pending && notesFailed) {
    setWaitingFor(null);
    setFailedFor(meetingId);
  } else if (pending && notesArrived) {
    setWaitingFor(null);
  }

  const onGiveUpRef = useRef(onGiveUp);
  useEffect(() => {
    onGiveUpRef.current = onGiveUp;
  });
  useEffect(() => {
    if (failedFor) onGiveUpRef.current();
  }, [failedFor]);
  useEffect(() => {
    if (!pending) return;
    const poll = setInterval(() => void refetch(), DEFERRED_NOTES_POLL_MS);
    const giveUp = setTimeout(() => {
      setWaitingFor(null);
      onGiveUpRef.current();
    }, DEFERRED_NOTES_WAIT_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [pending, refetch]);

  const start = (id: string) => {
    setFailedFor(null);
    setWaitingFor(id);
  };
  return { pending, start };
}

export function EarlierAudioNotice({
  minutes,
  canRemove,
  onRemove,
}: {
  minutes: number | null | undefined;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  if (minutes === null) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-accent/20 px-3 py-2">
        <IconHistory className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm">
          {t("meetingDetail.earlierAudioUnreadable")}
        </span>
      </div>
    );
  }
  if (!minutes) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-accent/20 px-3 py-2.5">
      <IconHistory className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-sm">
        {t("meetingDetail.earlierAudioAdded", { count: minutes })}
      </span>
      {canRemove && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="-my-1 h-7 shrink-0 cursor-pointer"
            >
              {t("meetingDetail.remove")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("meetingDetail.removeEarlierAudioTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("meetingDetail.removeEarlierAudioDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("meetingDetail.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={onRemove}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("meetingDetail.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
