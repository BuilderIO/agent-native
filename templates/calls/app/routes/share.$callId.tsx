import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { CallPlayer } from "@/components/player/call-player";

export function meta() {
  return [{ title: "Shared call" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

const STORAGE_KEY_PREFIX = "calls-share-pw-";

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

export default function PublicShareRoute() {
  const { callId } = useParams<{ callId: string }>();
  const [password, setPassword] = useState<string | null>(() => {
    if (typeof window === "undefined" || !callId) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_PREFIX + callId);
    } catch {
      return null;
    }
  });
  const [pwError, setPwError] = useState<string | null>(null);

  const dataQ = useQuery({
    queryKey: ["public-call", callId, password],
    queryFn: async () => {
      const url = new URL("/api/public-call", window.location.origin);
      url.searchParams.set("callId", callId ?? "");
      if (password) url.searchParams.set("p", password);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
    enabled: !!callId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const call = dataQ.data?.data?.call;

  useEffect(() => {
    if (call?.id) {
      reportViewEvent({ callId: call.id, type: "view-start", source: "share" });
    }
  }, [call?.id]);

  const needsPassword =
    dataQ.data?.status === 401 && dataQ.data.data?.passwordRequired;

  useEffect(() => {
    if (needsPassword && password) {
      setPwError("Incorrect password");
      setPassword(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + (callId ?? ""));
      } catch {}
    }
  }, [needsPassword, password, callId]);

  if (dataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black">
        <Spinner className="size-8 text-white" />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <PasswordGate
        error={pwError}
        onSubmit={(pw) => {
          setPwError(null);
          setPassword(pw);
          try {
            sessionStorage.setItem(STORAGE_KEY_PREFIX + (callId ?? ""), pw);
          } catch {}
        }}
      />
    );
  }

  if (dataQ.data?.status === 410 || dataQ.data?.status === 404 || !call) {
    return <Unavailable />;
  }

  const includeSummary = Boolean(
    dataQ.data?.data?.shareIncludesSummary ?? call.shareIncludesSummary,
  );
  const includeTranscript = Boolean(
    dataQ.data?.data?.shareIncludesTranscript ?? call.shareIncludesTranscript,
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <CallPlayer
        data={dataQ.data.data}
        readonly
        hideSummary={!includeSummary}
        hideTranscript={!includeTranscript}
        onEvent={(type, payload) =>
          reportViewEvent({
            callId: call.id,
            type,
            source: "share",
            ...((payload as Record<string, unknown>) ?? {}),
          })
        }
      />
    </div>
  );
}

function PasswordGate({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (pw: string) => void;
}) {
  const [value, setValue] = useState("");
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
              if (value.trim()) onSubmit(value.trim());
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
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

function Unavailable() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] text-white px-6">
      <h1 className="text-2xl font-semibold mb-2">
        This call isn't available.
      </h1>
      <p className="text-sm text-white/60">
        It may have been deleted, expired, or the link is invalid.
      </p>
    </div>
  );
}
