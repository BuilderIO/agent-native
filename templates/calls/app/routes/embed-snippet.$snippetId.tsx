import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CallPlayer } from "@/components/player/call-player";

export function meta() {
  return [{ title: "Snippet" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
    </div>
  );
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

export default function EmbedSnippetRoute() {
  const { snippetId } = useParams<{ snippetId: string }>();
  const [searchParams] = useSearchParams();
  const [password] = useState<string | null>(searchParams.get("p"));

  const dataQ = useQuery({
    queryKey: ["public-snippet-embed", snippetId, password],
    queryFn: async () => {
      const url = new URL("/api/public-snippet", window.location.origin);
      url.searchParams.set("snippetId", snippetId ?? "");
      if (password) url.searchParams.set("p", password);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
    enabled: !!snippetId,
  });

  const snippet = dataQ.data?.data?.snippet;
  const call = dataQ.data?.data?.call;

  const bounds = useMemo(() => {
    if (!snippet) return undefined;
    return { startMs: snippet.startMs ?? 0, endMs: snippet.endMs ?? 0 };
  }, [snippet]);

  useEffect(() => {
    if (snippet?.id) {
      reportViewEvent({
        snippetId: snippet.id,
        callId: call?.id,
        type: "view-start",
        source: "embed-snippet",
      });
    }
  }, [snippet?.id, call?.id]);

  if (dataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  if (!snippet) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black text-white">
        <p className="text-sm">Snippet unavailable.</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <CallPlayer
        data={dataQ.data!.data}
        boundsMs={bounds}
        compact
        readonly
        autoPlay
        muted
        hideSummary
        hideTranscript
        onEvent={(type, payload) =>
          reportViewEvent({
            snippetId: snippet.id,
            callId: call?.id,
            type,
            source: "embed-snippet",
            ...((payload as Record<string, unknown>) ?? {}),
          })
        }
      />
    </div>
  );
}
