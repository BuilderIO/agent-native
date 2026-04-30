import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconCalendarEvent,
  IconBrandZoom,
  IconKey,
  IconTrash,
  IconVideoPlus,
  IconLink,
  IconAlertCircle,
  IconBuilding,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Provider = "zoom" | "meet" | "teams" | "unsupported";

function detectProvider(url: string): Provider {
  const u = url.trim().toLowerCase();
  if (!u) return "unsupported";
  if (/(^https?:\/\/)?([\w-]+\.)?zoom\.us\//.test(u)) return "zoom";
  if (/(^https?:\/\/)?meet\.google\.com\//.test(u)) return "meet";
  if (/(^https?:\/\/)?teams\.(microsoft|live)\.com\//.test(u)) return "teams";
  return "unsupported";
}

function providerLabel(p: Provider): string {
  switch (p) {
    case "zoom":
      return "Zoom";
    case "meet":
      return "Google Meet";
    case "teams":
      return "Microsoft Teams";
    default:
      return "Unsupported link";
  }
}

interface RecallBot {
  id: string;
  meetingUrl: string;
  status: "scheduled" | "joining" | "recording" | "done" | "failed";
  scheduledAt: string | null;
  createdAt: string;
  callId: string | null;
}

interface SecretStatus {
  configured?: boolean;
  secrets?: Record<string, { configured: boolean }>;
}

export function RecallIntegrationCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [pendingCancel, setPendingCancel] = useState<RecallBot | null>(null);

  const { data: bots, isLoading } = useActionQuery<{ bots: RecallBot[] }>(
    "list-recall-bots",
    undefined,
    {},
  );
  const { data: secretStatus } = useActionQuery<SecretStatus>(
    "get-secret-status",
    { names: ["RECALL_AI_API_KEY"] },
    {},
  );

  const recallConfigured =
    secretStatus?.secrets?.RECALL_AI_API_KEY?.configured ??
    secretStatus?.configured ??
    false;

  const provider = useMemo(() => detectProvider(url), [url]);
  const canSchedule = provider !== "unsupported" && url.trim().length > 0;

  const schedule = useActionMutation<
    any,
    { meetingUrl: string; scheduledAt?: string | null }
  >("schedule-recall-bot");
  const cancel = useActionMutation<any, { id: string }>("cancel-recall-bot");

  async function handleSchedule() {
    if (!canSchedule) return;
    try {
      await schedule.mutateAsync({
        meetingUrl: url.trim(),
        scheduledAt: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      });
      toast.success("Bot scheduled");
      setUrl("");
      setScheduledFor("");
      qc.invalidateQueries({ queryKey: ["action", "list-recall-bots"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule failed");
    }
  }

  async function handleCancel() {
    if (!pendingCancel) return;
    try {
      await cancel.mutateAsync({ id: pendingCancel.id });
      toast.success("Bot cancelled");
      qc.invalidateQueries({ queryKey: ["action", "list-recall-bots"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setPendingCancel(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconVideoPlus className="h-4 w-4" />
          Send a meeting bot
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The bot joins your Zoom, Google Meet, or Teams call, records it, and
          drops the result into your library.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!recallConfigured && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <IconAlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <div className="font-medium text-foreground">
                Recall.ai API key required
              </div>
              <p className="mt-0.5 text-muted-foreground">
                Paste your Recall.ai key in Settings to enable the meeting bot.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => navigate("/settings/integrations")}
            >
              <IconKey className="h-3.5 w-3.5" />
              Add key
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="recall-url" className="text-xs">
            Meeting link
          </Label>
          <div className="relative">
            <IconLink className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id="recall-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://zoom.us/j/123456789 or https://meet.google.com/xxx-yyyy-zzz"
              className="pl-8"
              disabled={!recallConfigured}
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <ProviderIndicator provider={provider} urlEmpty={!url.trim()} />
            <span className="text-muted-foreground">
              Zoom · Google Meet · Teams
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="recall-when" className="text-xs">
            Join at (optional)
          </Label>
          <Input
            id="recall-when"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            disabled={!recallConfigured}
          />
          <p className="text-[11px] text-muted-foreground">
            Leave blank to join as soon as possible.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleSchedule}
          disabled={!recallConfigured || !canSchedule || schedule.isPending}
          className="w-full gap-1.5"
        >
          <IconCalendarEvent className="h-4 w-4" />
          {schedule.isPending ? "Scheduling…" : "Send bot"}
        </Button>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scheduled bots
          </div>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (bots?.bots ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No bots scheduled
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(bots?.bots ?? []).map((b) => {
                const p = detectProvider(b.meetingUrl);
                return (
                  <li
                    key={b.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <BotIcon provider={p} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-foreground">
                        {b.meetingUrl}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <StatusPill status={b.status} />
                        {b.scheduledAt && (
                          <span>
                            · {new Date(b.scheduledAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {b.callId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => navigate(`/calls/${b.callId}`)}
                      >
                        Open
                      </Button>
                    )}
                    {b.status !== "done" && b.status !== "failed" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Cancel bot"
                        onClick={() => setPendingCancel(b)}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>

      <AlertDialog
        open={!!pendingCancel}
        onOpenChange={(open) => !open && setPendingCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this bot?</AlertDialogTitle>
            <AlertDialogDescription>
              The bot won't join the meeting. You can schedule a new one later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel bot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProviderIndicator({
  provider,
  urlEmpty,
}: {
  provider: Provider;
  urlEmpty: boolean;
}) {
  if (urlEmpty) {
    return <span className="text-muted-foreground">Paste a meeting link</span>;
  }
  if (provider === "unsupported") {
    return (
      <span className="text-destructive inline-flex items-center gap-1">
        <IconAlertCircle className="h-3 w-3" />
        Not a supported meeting URL
      </span>
    );
  }
  return (
    <span className="text-foreground inline-flex items-center gap-1">
      <BotIcon provider={provider} />
      {providerLabel(provider)} detected
    </span>
  );
}

function BotIcon({ provider }: { provider: Provider }) {
  if (provider === "zoom")
    return <IconBrandZoom className="h-3.5 w-3.5 text-foreground" />;
  return <IconBuilding className="h-3.5 w-3.5 text-foreground" />;
}

function StatusPill({ status }: { status: RecallBot["status"] }) {
  const label =
    status === "scheduled"
      ? "Scheduled"
      : status === "joining"
        ? "Joining"
        : status === "recording"
          ? "Recording"
          : status === "done"
            ? "Done"
            : "Failed";
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-1.5 py-[1px] text-[9px] font-medium",
        status === "failed"
          ? "border-destructive/40 text-destructive"
          : status === "recording"
            ? "border-foreground text-foreground"
            : "border-border text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
