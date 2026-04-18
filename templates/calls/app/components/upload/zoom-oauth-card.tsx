import { useEffect, useState } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconBrandZoom,
  IconCircleCheck,
  IconRefresh,
  IconPlug,
  IconDownload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface ZoomStatus {
  connected: boolean;
  email?: string | null;
  autoImport?: boolean;
  expiresAt?: string | null;
}

export function ZoomOauthCard() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [recordingId, setRecordingId] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const { data: status, refetch } = useActionQuery<ZoomStatus>(
    "get-zoom-status",
    undefined,
    {},
  );

  const connect = useActionMutation<{ authorizeUrl: string }, void>(
    "connect-zoom",
  );
  const disconnect = useActionMutation<any, void>("disconnect-zoom");
  const importRecording = useActionMutation<
    { callId?: string },
    { recordingId: string }
  >("import-zoom-recording");
  const updatePrefs = useActionMutation<any, { autoImport: boolean }>(
    "update-zoom-prefs",
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (data?.type === "zoom-oauth-complete") {
        setConnecting(false);
        qc.invalidateQueries({ queryKey: ["action", "get-zoom-status"] });
        refetch();
        if (data.ok) toast.success("Zoom connected");
        else toast.error(data.error ?? "Zoom connection failed");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, refetch]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await connect.mutateAsync();
      const url = res?.authorizeUrl;
      if (!url) throw new Error("No authorize URL");
      const popup = window.open(
        url,
        "zoom-oauth",
        "width=520,height=680,noopener=no",
      );
      if (!popup) {
        setConnecting(false);
        toast.error("Popup blocked. Allow popups and try again.");
      }
    } catch (err) {
      setConnecting(false);
      toast.error(err instanceof Error ? err.message : "Connect failed");
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success("Zoom disconnected");
      qc.invalidateQueries({ queryKey: ["action", "get-zoom-status"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnectOpen(false);
    }
  }

  async function handleImport() {
    const id = recordingId.trim();
    if (!id) return;
    try {
      const res = await importRecording.mutateAsync({ recordingId: id });
      toast.success("Import started — we'll process it in the background.");
      setRecordingId("");
      qc.invalidateQueries({ queryKey: ["action", "list-calls"] });
      if (res?.callId) {
        window.location.href = `/calls/${res.callId}`;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function toggleAutoImport(next: boolean) {
    try {
      await updatePrefs.mutateAsync({ autoImport: next });
      qc.invalidateQueries({ queryKey: ["action", "get-zoom-status"] });
      toast.success(
        next
          ? "Zoom Cloud recordings will import automatically"
          : "Auto-import disabled",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconBrandZoom className="h-4 w-4" />
          Connect Zoom Cloud
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pull your existing Zoom Cloud recordings — we transcribe, analyze, and
          keep them in sync.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
              <IconCircleCheck className="h-5 w-5 text-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  Connected
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {status.email ?? "Zoom account"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">Auto-import</div>
                <div className="text-xs text-muted-foreground">
                  New Zoom Cloud recordings arrive here automatically.
                </div>
              </div>
              <Switch
                checked={status.autoImport ?? true}
                onCheckedChange={(v) => toggleAutoImport(!!v)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="zoom-recording-id" className="text-xs">
                Import a specific recording
              </Label>
              <div className="flex gap-2">
                <Input
                  id="zoom-recording-id"
                  value={recordingId}
                  onChange={(e) => setRecordingId(e.target.value)}
                  placeholder="Zoom meeting UUID or recording ID"
                />
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={!recordingId.trim() || importRecording.isPending}
                  className="gap-1.5 shrink-0"
                >
                  <IconDownload className="h-4 w-4" />
                  Import
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Grab the UUID from your Zoom recordings dashboard.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>· Imports cloud recordings that already exist in Zoom.</li>
              <li>· New recordings arrive automatically after you connect.</li>
              <li>· Transcripts and trackers run the same as uploads.</li>
            </ul>
            <Button
              type="button"
              onClick={handleConnect}
              disabled={connecting || connect.isPending}
              className="w-full gap-1.5"
            >
              {connecting ? (
                <>
                  <IconRefresh className="h-4 w-4 animate-spin" />
                  Waiting for Zoom…
                </>
              ) : (
                <>
                  <IconPlug className="h-4 w-4" />
                  Connect Zoom Cloud
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Zoom?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing calls stay in your library. New Zoom Cloud recordings
              will no longer import until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
