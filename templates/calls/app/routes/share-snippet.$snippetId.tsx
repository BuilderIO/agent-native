import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { appBasePath } from "@agent-native/core/client";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { CallPlayer } from "@/components/player/call-player";

export function meta() {
  return [{ title: "Shared snippet" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

const STORAGE_KEY_PREFIX = "calls-share-snippet-pw-";

async function reportViewEvent(payload: Record<string, unknown>) {
  try {
    await fetch(`${appBasePath()}/api/view-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {}
}

export default function PublicShareSnippetRoute() {
  const { snippetId } = useParams<{ snippetId: string }>();
  const [password, setPassword] = useState<string | null>(() => {
    if (typeof window === "undefined" || !snippetId) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_PREFIX + snippetId);
    } catch {
      return null;
    }
  });
  const [pwError, setPwError] = useState<string | null>(null);

  const dataQ = useQuery({
    queryKey: ["public-snippet", snippetId, password],
    queryFn: async () => {
      const url = new URL(
        `${appBasePath()}/api/public-snippet`,
        window.location.origin,
      );
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
        source: "share-snippet",
      });
    }
  }, [snippet?.id, call?.id]);

  const needsPassword =
    dataQ.data?.status === 401 && dataQ.data.data?.passwordRequired;

  useEffect(() => {
    if (needsPassword && password) {
      setPwError("Incorrect password");
      setPassword(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + (snippetId ?? ""));
      } catch {}
    }
  }, [needsPassword, password, snippetId]);

  if (dataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black">
        <Spinner className="size-8 text-white" />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#0a0a0a]">
        <Card className="max-w-sm w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconLock className="h-5 w-5 text-[#625DF5]" />
              Password required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const pw = (
                  e.currentTarget.elements.namedItem(
                    "pw",
                  ) as HTMLInputElement | null
                )?.value.trim();
                if (!pw) return;
                setPwError(null);
                setPassword(pw);
                try {
                  sessionStorage.setItem(
                    STORAGE_KEY_PREFIX + (snippetId ?? ""),
                    pw,
                  );
                } catch {}
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" name="pw" type="password" autoFocus />
                {pwError ? (
                  <p className="text-xs text-destructive">{pwError}</p>
                ) : null}
              </div>
              <Button
                type="submit"
                className="w-full bg-[#625DF5] hover:bg-[#5049d9]"
              >
                Unlock
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (dataQ.data?.status === 410 || dataQ.data?.status === 404 || !snippet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white px-6">
        <h1 className="text-2xl font-semibold mb-2">
          This snippet isn't available.
        </h1>
        <p className="text-sm text-white/60">
          It may have been deleted, expired, or the link is invalid.
        </p>
      </div>
    );
  }

  const includeTranscript = Boolean(
    dataQ.data?.data?.shareIncludesTranscript ?? call?.shareIncludesTranscript,
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <CallPlayer
        data={dataQ.data.data}
        boundsMs={bounds}
        readonly
        hideSummary
        hideTranscript={!includeTranscript}
        onEvent={(type, payload) =>
          reportViewEvent({
            snippetId: snippet.id,
            callId: call?.id,
            type,
            source: "share-snippet",
            ...((payload as Record<string, unknown>) ?? {}),
          })
        }
      />
    </div>
  );
}
