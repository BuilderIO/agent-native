import { useT } from "@agent-native/core/client/i18n";
import { withoutEarlierAudio } from "@shared/earlier-audio";
import { readSegmentEntries } from "@shared/transcript-segments";
import { IconHistory } from "@tabler/icons-react";
import { useState } from "react";

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
  earlierAudioMinutes?: number;
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

export function EarlierAudioNotice({
  minutes,
  canRemove,
  onRemove,
}: {
  minutes: number;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  if (minutes <= 0) return null;

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
