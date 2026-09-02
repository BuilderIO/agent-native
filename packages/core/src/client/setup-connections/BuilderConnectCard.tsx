import {
  ActionButton,
  DesignSystemErrorBoundary,
  Status,
  Surface,
} from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconCheck,
  IconDotsVertical,
  IconLoader2,
  IconPlugConnected,
  IconRefresh,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { BuilderConnectPopover } from "../settings/BuilderConnectPopover.js";
import type {
  BuilderConnectFlow,
  BuilderStatus,
} from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import {
  useBuilderConnectCardController,
  type BuilderConnectCardControllerOptions,
  type BuilderConnectCardViewModel,
} from "./useBuilderConnectCardController.js";

export interface BuilderConnectCardProps extends BuilderConnectCardControllerOptions {
  className?: string;
  render?: (context: BuilderConnectCardRenderContext) => ReactNode;
  showManage?: boolean;
}

export interface BuilderConnectCardRenderContext {
  viewModel: BuilderConnectCardViewModel;
  className?: string;
}

export interface DefaultBuilderConnectCardViewProps {
  viewModel: BuilderConnectCardViewModel;
  className?: string;
  showManage?: boolean;
  trackingSource?: string;
}

export interface BuilderConnectionMenuProps {
  flow: BuilderConnectFlow;
  credentialSource?: BuilderStatus["credentialSource"] | null;
  trackingSource?: string;
  trackingFlow?: string;
}

function DisconnectBuilderButton({
  flow,
  credentialSource,
  onDisconnected,
}: {
  flow: BuilderConnectFlow;
  credentialSource?: BuilderStatus["credentialSource"] | null;
  onDisconnected: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "armed" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = credentialSource ?? flow.credentialSource;

  const clearArmedTimer = useCallback(() => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearArmedTimer();
  }, [clearArmedTimer]);

  const performDisconnect = useCallback(async () => {
    setPhase("busy");
    setErr(null);
    clearArmedTimer();
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/builder/disconnect"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const text = await res.text();
      let body: { ok?: boolean; error?: string } = {};
      if (text) {
        try {
          body = JSON.parse(text);
          // coercion-ok: a non-JSON error response still fails on its HTTP status.
        } catch {
          // The endpoint can return an HTML error page when unavailable.
        }
      }
      if (!res.ok) {
        throw new Error(
          body.error ||
            `Failed (${res.status}). Is your dev server up to date?`,
        );
      }
      if (body.ok !== true) {
        throw new Error(body.error || "Disconnect did not confirm success");
      }
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      setPhase("idle");
      onDisconnected();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Disconnect failed");
      setPhase("idle");
    }
  }, [clearArmedTimer, onDisconnected]);

  const handleDisconnectClick = useCallback(() => {
    if (phase === "busy") return;
    if (phase === "idle") {
      setPhase("armed");
      setErr(null);
      clearArmedTimer();
      armedTimerRef.current = setTimeout(() => {
        setPhase("idle");
        armedTimerRef.current = null;
      }, 4000);
      return;
    }
    void performDisconnect();
  }, [clearArmedTimer, performDisconnect, phase]);

  const handleCancel = useCallback(() => {
    clearArmedTimer();
    setPhase("idle");
  }, [clearArmedTimer]);

  if (source === "env") return null;

  if (phase === "armed") {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleDisconnectClick}
          className="flex w-full items-center rounded-md px-2.5 py-2 text-start text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          {t("common.confirmDisconnect", {
            defaultValue: "Confirm disconnect",
          })}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="flex w-full items-center rounded-md px-2.5 py-2 text-start text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDisconnectClick}
        disabled={phase === "busy"}
        aria-busy={phase === "busy"}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-xs text-destructive hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-60"
      >
        {phase === "busy" ? (
          <IconLoader2 size={14} className="animate-spin" />
        ) : null}
        {phase === "busy"
          ? t("common.disconnecting", { defaultValue: "Disconnecting…" })
          : t("common.disconnect", { defaultValue: "Disconnect" })}
      </button>
      {err ? (
        <p className="px-2.5 py-1 text-[10px] text-destructive">{err}</p>
      ) : null}
    </>
  );
}

export function BuilderConnectionMenu({
  flow,
  credentialSource,
  trackingSource = "builder_connection_menu",
  trackingFlow = "connect_llm",
}: BuilderConnectionMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const source = credentialSource ?? flow.credentialSource;
  const canDisconnect = source !== "env";
  const manageLabel = t("settings.builderConnection.manage", {
    defaultValue: "Manage Builder.io connection",
  });

  const handleReconnect = useCallback(() => {
    setOpen(false);
    flow.start({
      trackingSource,
      trackingFlow,
      provisionAccount: false,
    });
  }, [flow, trackingFlow, trackingSource]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={manageLabel}
          title={manageLabel}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <IconDotsVertical size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-52 p-1.5"
        aria-label={manageLabel}
      >
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={handleReconnect}
            disabled={flow.connecting}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-xs text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-60"
          >
            <IconRefresh size={14} />
            {flow.connecting
              ? t("agentChat.recovery.connectingBuilder")
              : source === "env"
                ? t("agentChat.setup.connectBuilder")
                : t("agentChat.recovery.reconnectBuilder")}
          </button>
          {canDisconnect ? (
            <DisconnectBuilderButton
              flow={flow}
              credentialSource={source}
              onDisconnected={() => setOpen(false)}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DefaultBuilderConnectCardView({
  viewModel,
  className,
  showManage = false,
  trackingSource,
}: DefaultBuilderConnectCardViewProps) {
  const action = viewModel.action;
  const statusTone =
    viewModel.status.kind === "connected"
      ? "success"
      : viewModel.status.kind === "checking"
        ? "info"
        : "neutral";

  return (
    <Surface
      as="section"
      elevation="low"
      padding="none"
      className={cn(
        "rounded-lg border border-border bg-background p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
            viewModel.configured
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {viewModel.configured ? (
            <IconCheck className="size-4" />
          ) : (
            <IconPlugConnected className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {viewModel.title}
              </h2>
              <Status
                tone={statusTone}
                size="compact"
                className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {viewModel.status.label}
              </Status>
            </div>
            {showManage && viewModel.configured && viewModel.connectFlow ? (
              <BuilderConnectionMenu
                flow={viewModel.connectFlow}
                trackingSource={trackingSource}
              />
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {viewModel.description}
          </p>
          {viewModel.error ? (
            <p className="mt-2 text-xs text-destructive">{viewModel.error}</p>
          ) : null}
          {action ? (
            <div className="mt-3">
              {viewModel.connectFlow ? (
                <BuilderConnectPopover
                  flow={viewModel.connectFlow}
                  onConnect={action.onPress}
                >
                  <ActionButton
                    type="button"
                    intent="primary"
                    size="compact"
                    pending={action.pending}
                    disabled={action.disabled}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                    leadingIcon={<IconPlugConnected className="size-3.5" />}
                  >
                    {action.label}
                  </ActionButton>
                </BuilderConnectPopover>
              ) : (
                <ActionButton
                  type="button"
                  intent="primary"
                  size="compact"
                  pending={action.pending}
                  disabled={action.disabled}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
                  leadingIcon={<IconPlugConnected className="size-3.5" />}
                  onPress={() => action.onPress()}
                >
                  {action.label}
                </ActionButton>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

export function BuilderConnectCard({
  title,
  description,
  trackingSource,
  className,
  onConnected,
  render,
  showManage = false,
}: BuilderConnectCardProps) {
  const viewModel = useBuilderConnectCardController({
    title,
    description,
    trackingSource,
    onConnected,
  });

  const fallback = (
    <DefaultBuilderConnectCardView
      viewModel={viewModel}
      className={className}
      showManage={showManage}
      trackingSource={trackingSource}
    />
  );
  return render ? (
    <DesignSystemErrorBoundary
      component="BuilderConnectCard"
      fallback={fallback}
    >
      <BuilderConnectCardCustomView
        render={render}
        viewModel={viewModel}
        className={className}
      />
    </DesignSystemErrorBoundary>
  ) : (
    fallback
  );
}

function BuilderConnectCardCustomView({
  render,
  viewModel,
  className,
}: Required<Pick<BuilderConnectCardProps, "render">> &
  BuilderConnectCardRenderContext) {
  return render({ viewModel, className });
}
