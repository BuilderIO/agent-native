import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CallPlayer } from "@/components/player/call-player";

export function meta() {
  return [{ title: "Call" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
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

async function reportViewEvent(payload: Record<string, unknown>) {
  try {
    await fetch("/api/view-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {}
}

export default function EmbedCallRoute() {
  const { callId } = useParams<{ callId: string }>();
  const [searchParams] = useSearchParams();
  const startMs = useMemo(
    () => parseTimeParam(searchParams.get("t")),
    [searchParams],
  );
  const [password] = useState<string | null>(searchParams.get("p"));

  const dataQ = useQuery({
    queryKey: ["public-call-embed", callId, password],
    queryFn: async () => {
      const url = new URL("/api/public-call", window.location.origin);
      url.searchParams.set("callId", callId ?? "");
      if (password) url.searchParams.set("p", password);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
    enabled: !!callId,
  });

  const call = dataQ.data?.data?.call;

  useEffect(() => {
    if (call?.id) {
      reportViewEvent({ callId: call.id, type: "view-start", source: "embed" });
    }
  }, [call?.id]);

  if (dataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black text-white">
        <p className="text-sm">Call unavailable.</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <CallPlayer
        data={dataQ.data!.data}
        compact
        readonly
        autoPlay
        muted
        startMs={startMs}
        hideSummary
        hideTranscript
        onEvent={(type, payload) =>
          reportViewEvent({
            callId: call.id,
            type,
            source: "embed",
            ...((payload as Record<string, unknown>) ?? {}),
          })
        }
      />
    </div>
  );
}
