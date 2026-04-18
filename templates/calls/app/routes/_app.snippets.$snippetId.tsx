import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { IconArrowLeft, IconLoader2, IconShare3 } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallPlayer } from "@/components/player/call-player";

export function meta({ params }: { params: { snippetId?: string } }) {
  return [{ title: `Snippet · ${params.snippetId ?? ""}` }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function SnippetPlayerRoute() {
  const { snippetId } = useParams<{ snippetId: string }>();
  const navigate = useNavigate();

  const snippetQ = useActionQuery<any>(
    "get-snippet-player-data",
    { snippetId: snippetId ?? "" },
    { enabled: !!snippetId },
  );

  useEffect(() => {
    if (!snippetId) return;
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "snippet",
        snippetId,
        path: `/snippets/${snippetId}`,
      }),
    }).catch(() => {});
  }, [snippetId]);

  const bounds = useMemo(() => {
    const s = snippetQ.data?.snippet;
    if (!s) return undefined;
    return { startMs: s.startMs ?? 0, endMs: s.endMs ?? 0 };
  }, [snippetQ.data?.snippet]);

  if (!snippetId) return null;

  if (snippetQ.isLoading) {
    return (
      <div className="flex flex-col h-full min-h-0 p-6 gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="aspect-video w-full rounded-md" />
      </div>
    );
  }

  if (snippetQ.isError || !snippetQ.data?.snippet) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full px-6">
        <h1 className="text-xl font-semibold mb-2">Snippet not found</h1>
        <Button onClick={() => navigate("/library")} variant="outline">
          Back to library
        </Button>
      </div>
    );
  }

  const snippet = snippetQ.data.snippet;
  const parent = snippetQ.data.call;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">{snippet.title}</h1>
          {parent ? (
            <Link
              to={`/calls/${parent.id}`}
              className="text-xs text-muted-foreground hover:text-foreground truncate inline-block"
            >
              From: {parent.title}
            </Link>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            const url = `${window.location.origin}/share-snippet/${snippetId}`;
            navigator.clipboard?.writeText(url).catch(() => {});
          }}
        >
          <IconShare3 className="h-4 w-4" />
          Share
        </Button>
      </header>
      <div className="flex-1 min-h-0">
        <CallPlayer data={snippetQ.data} boundsMs={bounds} />
      </div>
    </div>
  );
}
