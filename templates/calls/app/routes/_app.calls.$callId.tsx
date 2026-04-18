import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { IconAlertTriangle, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallPlayer } from "@/components/player/call-player";

export function meta({ params }: { params: { callId?: string } }) {
  return [{ title: `Call · ${params.callId ?? ""}` }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function parseTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const v = raw.trim();
  if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.floor(parseFloat(v) * 1000);
  if (/^\d+:\d+(:\d+)?$/.test(v)) {
    const parts = v.split(":").map((n) => parseInt(n, 10));
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3)
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  return 0;
}

export default function CallPlayerRoute() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startMs = useMemo(
    () => parseTimeParam(searchParams.get("t")),
    [searchParams],
  );

  const playerDataQ = useActionQuery<any>(
    "get-call-player-data",
    { callId: callId ?? "" },
    { enabled: !!callId },
  );

  const retryTranscript = useActionMutation<any, { callId: string }>(
    "retry-transcript",
  );

  useEffect(() => {
    if (!callId) return;
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "call",
        callId,
        path: `/calls/${callId}`,
      }),
    }).catch(() => {});
  }, [callId]);

  if (!callId) return null;

  if (playerDataQ.isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 p-6 gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="aspect-video w-full rounded-md" />
        <Skeleton className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (playerDataQ.isError || !playerDataQ.data?.call) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-background px-6">
        <h1 className="text-xl font-semibold mb-2">Call not found</h1>
        <p className="text-sm text-muted-foreground mb-4">
          {(playerDataQ.error as Error | undefined)?.message ??
            "You may not have access to this call."}
        </p>
        <Button onClick={() => navigate("/library")} variant="outline">
          Back to library
        </Button>
      </div>
    );
  }

  const data = playerDataQ.data;
  const call = data.call;
  const status = call.status as string;
  const initialSpeed = parseFloat(call.defaultSpeed || "1") || 1;

  return (
    <div className="flex flex-col h-full min-h-0">
      {status && status !== "ready" ? (
        <StatusBanner
          status={status}
          errorMessage={call.statusMessage ?? call.errorMessage ?? null}
          onRetry={
            status === "failed"
              ? () =>
                  retryTranscript
                    .mutateAsync({ callId: call.id })
                    .then(() => playerDataQ.refetch())
                    .catch(() => {})
              : undefined
          }
          retrying={retryTranscript.isPending}
        />
      ) : null}
      <div className="flex-1 min-h-0">
        <CallPlayer
          data={data}
          initialSpeed={initialSpeed}
          startMs={startMs}
        />
      </div>
    </div>
  );
}

function StatusBanner({
  status,
  errorMessage,
  onRetry,
  retrying,
}: {
  status: string;
  errorMessage: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const isFailed = status === "failed" || status === "upload-failed";
  const label =
    status === "transcribing"
      ? "Transcribing…"
      : status === "analyzing"
        ? "Analyzing…"
        : status === "uploading"
          ? "Uploading…"
          : status === "processing"
            ? "Processing…"
            : isFailed
              ? `Upload failed: ${errorMessage ?? "Unknown error"}`
              : `Status: ${status}`;

  return (
    <Alert
      variant={isFailed ? "destructive" : "default"}
      className="rounded-none border-x-0 border-t-0"
    >
      {isFailed ? (
        <IconAlertTriangle className="h-4 w-4" />
      ) : (
        <IconLoader2 className="h-4 w-4 animate-spin" />
      )}
      <AlertTitle className="flex items-center gap-2">
        {label}
        {onRetry ? (
          <Button
            onClick={onRetry}
            disabled={retrying}
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        ) : null}
      </AlertTitle>
      {errorMessage && !isFailed ? (
        <AlertDescription>{errorMessage}</AlertDescription>
      ) : null}
    </Alert>
  );
}
