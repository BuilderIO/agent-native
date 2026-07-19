import {
  agentNativePath,
  appBasePath,
  useActionMutation,
} from "@agent-native/core/client";
import { IconHistory, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportConcat } from "@/lib/ffmpeg-export";
import { uploadFileClient } from "@/lib/upload-file-client";

interface RewindExtensionRequest {
  requestId: string;
  recordingId: string;
  seconds: 30 | 300;
  status:
    | "pending"
    | "processing"
    | "ready"
    | "applying"
    | "applied"
    | "failed";
  preRollRecordingId?: string;
  actualDurationMs?: number;
  error?: string;
}

interface RewindExtensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordingId: string;
  durationMs: number;
  videoFormat: "webm" | "mp4";
  hasAudio: boolean;
  visibility: "private" | "org" | "public";
  onVisibilityChanged: () => void | Promise<void>;
  onApplied: () => void | Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readRequest(
  recordingId: string,
): Promise<RewindExtensionRequest | null> {
  const params = new URLSearchParams({ recordingId });
  const response = await fetch(
    agentNativePath(
      `/_agent-native/actions/get-rewind-extension-request?${params}`,
    ),
  );
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || json?.message || "Could not check Rewind.");
  }
  return (json?.result ?? json)?.request ?? null;
}

export function RewindExtensionDialog({
  open,
  onOpenChange,
  recordingId,
  durationMs,
  videoFormat,
  hasAudio,
  visibility,
  onVisibilityChanged,
  onApplied,
}: RewindExtensionDialogProps) {
  const makePrivateForRewind = useActionMutation(
    "make-recording-private-for-rewind",
  );
  const requestExtension = useActionMutation("request-rewind-extension");
  const applyExtension = useActionMutation("apply-rewind-extension");
  const requestTranscript = useActionMutation("request-transcript" as any);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open && !busy) {
      setStatus(null);
      setProgress(0);
      setPrivacyConfirmed(false);
    }
  }, [busy, open]);

  const makePrivate = useCallback(async () => {
    setBusy(true);
    setStatus("Making this Clip private…");
    try {
      await makePrivateForRewind.mutateAsync({ recordingId });
      await onVisibilityChanged();
      setPrivacyConfirmed(true);
      setStatus(null);
      toast.success(
        "This Clip is private. You can now add local Rewind history.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [makePrivateForRewind, onVisibilityChanged, recordingId]);

  const addFromRewind = useCallback(
    async (seconds: 30 | 300) => {
      setBusy(true);
      setProgress(0);
      try {
        setStatus("Asking Clips Alpha for local Rewind history…");
        const created = (await requestExtension.mutateAsync({
          recordingId,
          seconds,
        })) as RewindExtensionRequest;
        let request = created;
        for (let attempt = 0; attempt < 160; attempt += 1) {
          if (request.status === "failed") {
            throw new Error(
              request.error || "Clips Alpha could not read Rewind.",
            );
          }
          if (
            request.status === "ready" &&
            request.preRollRecordingId &&
            request.actualDurationMs
          ) {
            break;
          }
          setStatus(
            request.status === "processing"
              ? "Clips Alpha is preparing that local interval…"
              : "Waiting for Clips Alpha…",
          );
          await wait(1_500);
          request = (await readRequest(recordingId)) ?? request;
        }
        if (
          request.status !== "ready" ||
          !request.preRollRecordingId ||
          !request.actualDurationMs
        ) {
          throw new Error(
            "Clips Alpha did not finish the Rewind request in time.",
          );
        }

        setStatus("Combining the selected history with this Clip…");
        const blob = await exportConcat(
          [
            {
              url: `${appBasePath()}/api/video/${encodeURIComponent(request.preRollRecordingId)}`,
              format: "mp4",
              hasAudio,
            },
            {
              url: `${appBasePath()}/api/video/${encodeURIComponent(recordingId)}`,
              format: videoFormat,
              hasAudio,
            },
          ],
          (next) => mounted.current && setProgress(next.progress),
        );
        setStatus("Saving the longer Clip…");
        const upload = await uploadFileClient(
          blob,
          `rewind-${recordingId}.mp4`,
        );
        if (!upload?.url) {
          throw new Error(
            "Connect video storage before adding Rewind history.",
          );
        }
        await applyExtension.mutateAsync({
          recordingId,
          requestId: request.requestId,
          preRollRecordingId: request.preRollRecordingId,
          videoUrl: upload.url,
          durationMs: durationMs + request.actualDurationMs,
          addedMs: request.actualDurationMs,
        });
        if (hasAudio) {
          void requestTranscript
            .mutateAsync({ recordingId, force: true, regenerate: true })
            .catch(() => {
              toast.info(
                "The longer Clip was saved; its transcript can be regenerated later.",
              );
            });
        }
        await onApplied();
        toast.success(
          `${request.actualDurationMs >= 60_000 ? "Five minutes" : "Thirty seconds"} added from Rewind.`,
        );
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        setStatus(null);
      } finally {
        if (mounted.current) {
          setBusy(false);
          setProgress(0);
        }
      }
    },
    [
      applyExtension,
      durationMs,
      hasAudio,
      onApplied,
      onOpenChange,
      recordingId,
      requestExtension,
      requestTranscript,
      videoFormat,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconHistory className="h-4 w-4 text-primary" />
            Add what happened before
          </DialogTitle>
          <DialogDescription>
            Pull a specific interval from local Rewind and add it to the start
            of this Clip. Nothing is added automatically.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div
            className="rounded-lg border bg-muted/30 p-4 text-sm"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 font-medium">
              <IconLoader2
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              {status}
            </div>
            {progress > 0 ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  role="progressbar"
                  aria-label="Rewind history processing progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : visibility !== "private" && !privacyConfirmed ? (
          <div className="grid gap-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <strong className="block">Make this Clip private first</strong>
              <span className="mt-1 block text-muted-foreground">
                Local Rewind history can contain context from before you chose
                to record. This changes the Clip to private. If anyone still has
                direct access, Clips will stop here so you can remove them in
                Share first.
              </span>
            </div>
            <Button onClick={() => void makePrivate()}>
              Make private and continue
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="h-auto justify-start py-3 text-left"
              onClick={() => void addFromRewind(30)}
            >
              <span>
                <strong className="block">Add the previous 30 seconds</strong>
                <span className="text-xs font-normal text-muted-foreground">
                  Useful when you clicked Record just after the important bit.
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto justify-start py-3 text-left"
              onClick={() => void addFromRewind(300)}
            >
              <span>
                <strong className="block">Add the previous 5 minutes</strong>
                <span className="text-xs font-normal text-muted-foreground">
                  Good for recovering the lead-in to a longer explanation.
                </span>
              </span>
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
