/**
 * Conferencing settings — pick a default video provider for new event types.
 */
import { useEffect, useState } from "react";
import { callAction } from "@/lib/api";
import { appPath } from "@agent-native/core/client";

export function meta() {
  return [{ title: "Conferencing — Scheduling" }];
}

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IconBrandGoogle,
  IconBrandZoom,
  IconBrandTeams,
  IconCheck,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";

interface Credential {
  id: string;
  type: string;
  externalEmail?: string | null;
  displayName?: string | null;
  invalid: boolean;
  isDefault: boolean;
}

const TYPE_META: Record<string, { label: string; Icon: any }> = {
  zoom_video: { label: "Zoom", Icon: IconBrandZoom },
  google_meet: { label: "Google Meet", Icon: IconBrandGoogle },
  teams_video: { label: "Microsoft Teams", Icon: IconBrandTeams },
};

export default function ConferencingSettings() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);

  useEffect(() => {
    callAction<{ installed: Credential[] }>("list-calendar-integrations")
      .then((res) => setCredentials(res.installed ?? []))
      .catch(() => setCredentials([]));
  }, []);

  const video = (credentials ?? []).filter((c) =>
    Object.keys(TYPE_META).includes(c.type),
  );
  const defaultId = video.find((c) => c.isDefault)?.id ?? null;

  const setDefault = async (credentialId: string) => {
    // Optimistic: update local state immediately, then fire.
    setCredentials((prev) =>
      (prev ?? []).map((c) => ({
        ...c,
        isDefault: c.id === credentialId,
      })),
    );
    try {
      await callAction("set-default-conferencing-app", { credentialId });
      toast.success("Default conferencing updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update");
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Conferencing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The default video provider is used for new event types. You can
          override per event type in the Apps tab.
        </p>
      </header>

      {credentials === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : video.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconVideo className="h-4 w-4" />
              No conferencing apps connected
            </CardTitle>
            <CardDescription>
              Connect Zoom, Google Meet, or Microsoft Teams from the
              <a
                href={appPath("/apps")}
                className="ml-1 underline underline-offset-2"
              >
                Integrations
              </a>{" "}
              page.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {video.map((c) => {
            const meta = TYPE_META[c.type];
            const Icon = meta?.Icon ?? IconVideo;
            const isDefault = c.id === defaultId;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{meta?.label ?? c.type}</div>
                      {isDefault && (
                        <Badge variant="default" className="h-5 text-[10px]">
                          <IconCheck className="mr-1 h-3 w-3" />
                          Default
                        </Badge>
                      )}
                      {c.invalid && (
                        <Badge
                          variant="destructive"
                          className="h-5 text-[10px]"
                        >
                          Reconnect
                        </Badge>
                      )}
                    </div>
                    {c.externalEmail && (
                      <div className="text-xs text-muted-foreground">
                        {c.externalEmail}
                      </div>
                    )}
                  </div>
                </div>
                {!isDefault && !c.invalid && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDefault(c.id)}
                  >
                    Set as default
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
