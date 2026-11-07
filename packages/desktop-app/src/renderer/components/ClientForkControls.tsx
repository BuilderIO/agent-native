import { setClientAppState } from "@agent-native/core/client/hooks";
import {
  createAgentNativeWebMcpRegistration,
  defineClientAction,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { IconDots } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type {
  ClientForkRequest,
  ClientForkStatus,
} from "../../../shared/client-forks.js";

function desktopApi(): Partial<Window["electronAPI"]> | undefined {
  return (window as Partial<Window>).electronAPI;
}

export default function ClientForkControls({
  appId,
  reload,
  active,
}: {
  appId: string;
  reload: () => void;
  active: boolean;
}) {
  const t = useT();
  const [status, setStatus] = useState<ClientForkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function execute(operation: ClientForkRequest["operation"]) {
    setBusy(true);
    try {
      const result = await window.electronAPI.clientForks({ appId, operation });
      if (!result.ok)
        throw new Error(
          result.error === "clientFork.gitRequired"
            ? t("clientFork.gitRequired")
            : result.error,
        );
      setStatus(result.status);
      setError(null);
      if (["original", "activate", "undo"].includes(operation)) reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!desktopApi()?.clientForks) return;
    void execute("status");
    const unsubscribe = desktopApi()?.appConfig?.onRuntimeStatus((next) => {
      if (next.appId === appId) void execute("status");
    });
    return unsubscribe;
  }, [appId]);
  useEffect(() => {
    if (!active || !status?.buildPath) return;
    void setClientAppState(`desktop-client-fork:${appId}`, {
      appId,
      profile: status.enabled ? "my-version" : "original",
      baseSha: status.baseSha,
      hostedSha: status.hostedSha,
      needsRepair: Boolean(status.error),
    }).catch((failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, [active, appId, status]);
  useEffect(() => {
    if (!active || !desktopApi()?.clientForks) return;
    const registration = createAgentNativeWebMcpRegistration({
      actions: [
        defineClientAction<{ operation: ClientForkRequest["operation"] }>({
          name: "manage-desktop-client-fork",
          description:
            "Inspect, build, update, undo, or switch this app's personal source client in Desktop. Server behavior remains hosted.",
          inputSchema: {
            type: "object",
            properties: {
              operation: {
                type: "string",
                enum: [
                  "status",
                  "build",
                  "original",
                  "activate",
                  "update",
                  "undo",
                ],
              },
            },
            required: ["operation"],
            additionalProperties: false,
          },
          run: async ({ operation }) => {
            const result = await window.electronAPI.clientForks({
              appId,
              operation,
            });
            if (!result.ok)
              throw new Error(
                result.error === "clientFork.gitRequired"
                  ? t("clientFork.gitRequired")
                  : result.error,
              );
            setStatus(result.status);
            if (["original", "activate", "undo"].includes(operation)) reload();
            return {
              appId,
              enabled: result.status.enabled,
              baseSha: result.status.baseSha,
              needsRepair: Boolean(result.status.error),
            };
          },
        }),
      ],
    });
    void registration
      .start()
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
    return () => registration.stop();
  }, [active, appId, reload]);
  const diagnostic = error ?? status?.error;
  const errorMessage =
    diagnostic === "clientFork.gitRequired"
      ? t("clientFork.gitRequired")
      : diagnostic;
  if (!status?.phase && !status?.buildPath && !status?.error && !error)
    return null;
  return (
    <div className="absolute right-2 top-2 z-20 flex max-w-sm items-center gap-1 rounded-md border border-border bg-background p-1 shadow-sm">
      {status?.phase && status.phase !== "error" ? (
        <span role="status" className="px-2 text-xs text-muted-foreground">
          {t(`clientFork.${status.phase}`)}
        </span>
      ) : null}
      <Button
        size="sm"
        variant={status?.enabled ? "ghost" : "secondary"}
        disabled={busy}
        onClick={() => void execute("original")}
      >
        {t("clientFork.original")}
      </Button>
      <Button
        size="sm"
        variant={status?.enabled ? "secondary" : "ghost"}
        disabled={busy || !status?.buildPath}
        onClick={() => void execute("activate")}
      >
        {t("clientFork.mine")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("clientFork.manage")}
          >
            <IconDots size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>
            {t("clientFork.base", { sha: status?.baseSha.slice(0, 8) ?? "" })}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => void execute("build")}
          >
            {t("clientFork.build")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => void execute("update")}
          >
            {t("clientFork.update")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || !status?.previousBuildPath}
            onSelect={() => void execute("undo")}
          >
            {t("clientFork.undo")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error || status?.error ? (
        <span
          role="alert"
          className="max-w-48 truncate text-xs text-destructive"
          title={errorMessage ?? ""}
        >
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
