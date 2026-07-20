import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Progress } from "@agent-native/toolkit/ui/progress";
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconBolt,
  IconChartBar,
  IconChevronDown,
  IconDots,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";

import type {
  MultiFrontierProviderId,
  MultiFrontierRendererParticipant,
  MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";
import type {
  SubscriptionRateLimitMeter,
  SubscriptionStatus,
} from "../../../shared/subscription-status.js";

const PROVIDERS: readonly MultiFrontierProviderId[] = ["codex", "claude"];

const PROVIDER_COPY: Record<
  MultiFrontierProviderId,
  { label: string; subscription: string; accent: string }
> = {
  codex: {
    label: "Codex",
    subscription: "ChatGPT subscription",
    accent: "bg-sky-500",
  },
  claude: {
    label: "Claude",
    subscription: "Claude subscription",
    accent: "bg-orange-500",
  },
};

export interface MultiFrontierNotice {
  id: string;
  kind: "recovery" | "failure" | "info";
  message: string;
}

export interface MultiFrontierCreateInput {
  prompt: string;
  autoContinueAfterAgreement: boolean;
}

export function createMultiFrontierInput(
  prompt: string,
  autoContinueAfterAgreement = false,
): MultiFrontierCreateInput {
  return { prompt, autoContinueAfterAgreement };
}

export type MultiFrontierSecondaryAction =
  | "pause"
  | "resume"
  | "cancel"
  | "re-review"
  | "role-swap";

export interface MultiFrontierSecondaryActionInput {
  action: MultiFrontierSecondaryAction;
  collaborationId: string;
  nextDriverParticipantId?: string;
  reviewArtifactId?: string;
  prompt?: string;
}

export interface MultiFrontierWorkspaceProps {
  state?: MultiFrontierRendererState;
  subscriptions?: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
  notices?: readonly MultiFrontierNotice[];
  busy?: boolean;
  autoContinueAfterAgreement?: boolean;
  defaultAutoContinueAfterAgreement?: boolean;
  onConnectSubscription?: (providerId: MultiFrontierProviderId) => void;
  onRefreshSubscription?: (providerId: MultiFrontierProviderId) => void;
  onAutoContinueAfterAgreementChange?: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange?: (value: boolean) => void;
  onStart?: (collaborationId: string) => void;
  onGo?: (collaborationId: string) => void;
  onSecondaryAction?: (input: MultiFrontierSecondaryActionInput) => void;
}

export interface MultiFrontierControlState {
  canStart: boolean;
  canGo: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canSwap: boolean;
  canReReview: boolean;
}

export function agreementPolicyForWorkspace(
  state:
    | Pick<MultiFrontierRendererState, "autoContinueAfterAgreement">
    | undefined,
  draftAutoContinueAfterAgreement: boolean,
): { autoContinueAfterAgreement: boolean; isReadOnly: boolean } {
  return {
    autoContinueAfterAgreement:
      state?.autoContinueAfterAgreement ?? draftAutoContinueAfterAgreement,
    isReadOnly: state !== undefined,
  };
}

export function controlsForState(
  state?: Pick<
    MultiFrontierRendererState,
    | "phase"
    | "approvalState"
    | "autoContinueAfterAgreement"
    | "pendingCheckpointReviewArtifactId"
  >,
): MultiFrontierControlState {
  if (!state) {
    return {
      canStart: false,
      canGo: false,
      canPause: false,
      canResume: false,
      canCancel: false,
      canSwap: false,
      canReReview: false,
    };
  }

  const terminal = ["completed", "failed", "canceled"].includes(state.phase);
  return {
    canStart: state.phase === "proposing",
    canGo:
      state.phase === "awaiting_go" &&
      state.approvalState !== "rejected" &&
      state.autoContinueAfterAgreement !== true,
    canPause: !terminal && state.phase !== "paused",
    canResume: state.phase === "paused",
    canCancel: !terminal,
    canSwap:
      state.phase === "awaiting_go" || state.phase === "checkpoint_review",
    canReReview:
      state.phase === "awaiting_go" &&
      state.approvalState === "pending" &&
      Boolean(state.pendingCheckpointReviewArtifactId),
  };
}

export function usageSummary(status?: SubscriptionStatus): string {
  if (!status) return "Status unavailable";
  if (status.connectionState !== "connected") {
    return status.connectionMessage ?? "Sign in to use this participant";
  }
  if (
    status.providerId === "claude" &&
    status.telemetry.state === "unsupported"
  ) {
    return "Live plan usage is unavailable in non-interactive Claude sessions.";
  }
  if (status.telemetry.state === "stale")
    return "Usage data may be out of date";
  if (status.telemetry.state === "error") {
    return status.telemetry.error?.message ?? "Usage data could not be read";
  }
  return status.telemetry.capabilities.rateLimits
    ? "Usage is updating from the connected subscription"
    : "Plan connected";
}

export function MultiFrontierWorkspace({
  state,
  subscriptions,
  notices = [],
  busy = false,
  autoContinueAfterAgreement = false,
  defaultAutoContinueAfterAgreement = false,
  onConnectSubscription,
  onRefreshSubscription,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
  onStart,
  onGo,
  onSecondaryAction,
}: MultiFrontierWorkspaceProps) {
  const statusByProvider = subscriptions ?? state?.subscriptions ?? {};
  const allConnected = PROVIDERS.every(
    (providerId) =>
      statusByProvider[providerId]?.connectionState === "connected",
  );
  const controls = controlsForState(state);
  const isEmpty = !state;
  const agreementPolicy = agreementPolicyForWorkspace(
    state,
    autoContinueAfterAgreement,
  );

  return (
    <section
      aria-labelledby="multi-frontier-heading"
      className="flex w-full max-w-3xl flex-col gap-4"
    >
      <header className="flex items-center justify-between gap-3">
        <p id="multi-frontier-heading" className="text-sm font-medium">
          Multi-Frontier
        </p>
        {state ? <PhaseStatus phase={state.phase} round={state.round} /> : null}
      </header>

      <SubscriptionSummary
        statuses={statusByProvider}
        allConnected={allConnected}
        busy={busy}
        onConnect={onConnectSubscription}
        onRefresh={onRefreshSubscription}
        autoContinueAfterAgreement={agreementPolicy.autoContinueAfterAgreement}
        defaultAutoContinueAfterAgreement={defaultAutoContinueAfterAgreement}
        onAutoContinueAfterAgreementChange={
          agreementPolicy.isReadOnly
            ? undefined
            : onAutoContinueAfterAgreementChange
        }
        onDefaultAutoContinueAfterAgreementChange={
          onDefaultAutoContinueAfterAgreementChange
        }
      />

      {notices.length > 0 ? (
        <section aria-label="Collaboration notices" className="space-y-2">
          {notices.map((notice) => (
            <Notice key={notice.id} notice={notice} />
          ))}
        </section>
      ) : null}

      {isEmpty ? (
        <SetupPanel allConnected={allConnected} />
      ) : (
        <CollaborationPanel
          state={state}
          controls={controls}
          busy={busy}
          onStart={onStart}
          onGo={onGo}
          onSecondaryAction={onSecondaryAction}
        />
      )}
    </section>
  );
}

function SubscriptionSummary({
  statuses,
  allConnected,
  busy,
  onConnect,
  onRefresh,
  autoContinueAfterAgreement,
  defaultAutoContinueAfterAgreement,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
}: {
  statuses: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
  allConnected: boolean;
  busy: boolean;
  onConnect?: (providerId: MultiFrontierProviderId) => void;
  onRefresh?: (providerId: MultiFrontierProviderId) => void;
  autoContinueAfterAgreement: boolean;
  defaultAutoContinueAfterAgreement: boolean;
  onAutoContinueAfterAgreementChange?: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange?: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {allConnected ? "Participants ready" : "Connect subscriptions to begin"}
      </p>
      <MultiFrontierParticipantSettings
        statuses={statuses}
        busy={busy}
        autoContinueAfterAgreement={autoContinueAfterAgreement}
        defaultAutoContinueAfterAgreement={defaultAutoContinueAfterAgreement}
        onConnect={onConnect}
        onRefresh={onRefresh}
        onAutoContinueAfterAgreementChange={onAutoContinueAfterAgreementChange}
        onDefaultAutoContinueAfterAgreementChange={
          onDefaultAutoContinueAfterAgreementChange
        }
      />
    </div>
  );
}

export function MultiFrontierParticipantSettings({
  statuses,
  busy,
  autoContinueAfterAgreement,
  defaultAutoContinueAfterAgreement,
  onConnect,
  onRefresh,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
}: {
  statuses: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
  busy: boolean;
  autoContinueAfterAgreement: boolean;
  defaultAutoContinueAfterAgreement: boolean;
  onConnect?: (providerId: MultiFrontierProviderId) => void;
  onRefresh?: (providerId: MultiFrontierProviderId) => void;
  onAutoContinueAfterAgreementChange?: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange?: (value: boolean) => void;
}) {
  const allConnected = PROVIDERS.every(
    (providerId) => statuses[providerId]?.connectionState === "connected",
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={allConnected ? "outline" : "default"}
          className="code-agents-multi-frontier-participants shrink-0 whitespace-nowrap"
        >
          {allConnected ? "Participants" : "Connect"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        data-agent-native-multi-frontier-popover="true"
        className="w-[min(24rem,calc(100vw-1.5rem))] p-3"
      >
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold">Participants</p>
          <div className="grid gap-1.5">
            {PROVIDERS.map((providerId) => (
              <SubscriptionCard
                key={providerId}
                providerId={providerId}
                status={statuses[providerId]}
                busy={busy}
                onConnect={onConnect}
                onRefresh={onRefresh}
              />
            ))}
          </div>
          <RunPreferences
            busy={busy}
            autoContinueAfterAgreement={autoContinueAfterAgreement}
            defaultAutoContinueAfterAgreement={
              defaultAutoContinueAfterAgreement
            }
            onAutoContinueAfterAgreementChange={
              onAutoContinueAfterAgreementChange
            }
            onDefaultAutoContinueAfterAgreementChange={
              onDefaultAutoContinueAfterAgreementChange
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SubscriptionCard({
  providerId,
  status,
  busy,
  onConnect,
  onRefresh,
}: {
  providerId: MultiFrontierProviderId;
  status?: SubscriptionStatus;
  busy: boolean;
  onConnect?: (providerId: MultiFrontierProviderId) => void;
  onRefresh?: (providerId: MultiFrontierProviderId) => void;
}) {
  const copy = PROVIDER_COPY[providerId];
  const connected = status?.connectionState === "connected";
  const plan = status?.plan?.label ?? status?.plan?.type;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
      <div className="rounded-xl bg-muted/50 p-1">
        <p id={`${providerId}-subscription-status`} className="sr-only">
          {usageSummary(status)}
        </p>
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 text-left"
              aria-label={`${detailsOpen ? "Hide" : "Show"} ${copy.label} subscription details`}
              aria-describedby={`${providerId}-subscription-status`}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${copy.accent}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {copy.label}
              </span>
              <ConnectionBadge status={status} />
              <IconChevronDown
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-collapse)] ${detailsOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
          {!connected ? (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={busy || !onConnect}
              onClick={() => onConnect?.(providerId)}
            >
              Connect
            </Button>
          ) : null}
        </div>
        <CollapsibleContent className="px-2 pb-2 pt-1.5">
          <div className="space-y-3 border-t border-border/60 px-1 pt-2.5">
            <p className="text-xs text-muted-foreground">{copy.subscription}</p>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Plan</span>
              <span className="truncate font-medium">
                {plan ?? "Not connected"}
              </span>
            </div>
            {connected ? (
              <div className="flex items-center justify-between gap-2">
                <UsagePopover providerId={providerId} status={status} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy || !onRefresh}
                  onClick={() => onRefresh?.(providerId)}
                  aria-label={`Refresh ${copy.label} subscription status`}
                >
                  <IconRefresh aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sign in through the local CLI. No API key is needed.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function RunPreferences({
  busy,
  autoContinueAfterAgreement,
  defaultAutoContinueAfterAgreement,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
}: {
  busy: boolean;
  autoContinueAfterAgreement: boolean;
  defaultAutoContinueAfterAgreement: boolean;
  onAutoContinueAfterAgreementChange?: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange?: (value: boolean) => void;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2 text-xs text-muted-foreground"
        >
          Run preferences
          <IconChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-1 pt-1">
        <div className="space-y-3 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs">Continue automatically</Label>
            {onAutoContinueAfterAgreementChange ? (
              <Switch
                checked={autoContinueAfterAgreement}
                disabled={busy}
                onCheckedChange={onAutoContinueAfterAgreementChange}
                aria-label="Continue automatically after agreement"
              />
            ) : (
              <span className="text-xs font-medium">
                {autoContinueAfterAgreement ? "On" : "Explicit GO"}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs">Use for new runs</Label>
            <Switch
              checked={defaultAutoContinueAfterAgreement}
              disabled={busy || !onDefaultAutoContinueAfterAgreementChange}
              onCheckedChange={onDefaultAutoContinueAfterAgreementChange}
              aria-label="Continue automatically after agreement by default"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function UsagePopover({
  providerId,
  status,
}: {
  providerId: MultiFrontierProviderId;
  status: SubscriptionStatus;
}) {
  const telemetry = status.telemetry;
  const isClaudeDegraded =
    providerId === "claude" && telemetry.state === "unsupported";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`View ${PROVIDER_COPY[providerId].label} usage`}
        >
          <IconChartBar aria-hidden="true" />
          Usage
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        data-agent-native-multi-frontier-popover="true"
        className="w-80 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">
            {PROVIDER_COPY[providerId].label} usage
          </p>
          {telemetry.state === "stale" ? (
            <Badge variant="outline">Stale</Badge>
          ) : null}
        </div>
        <Separator className="my-3" />
        {isClaudeDegraded ? (
          <p className="text-sm leading-5 text-muted-foreground">
            Claude is ready to participate, but live plan usage is unavailable
            in non-interactive Claude Code sessions.
          </p>
        ) : telemetry.meters.length > 0 ? (
          <div className="space-y-3">
            {telemetry.meters.map((meter) => (
              <UsageMeter key={meter.id} meter={meter} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No usage meter is available for this connection.
          </p>
        )}
        {telemetry.contextWindow?.state === "available" ? (
          <div className="mt-3 border-t border-border pt-3">
            <UsageMeter
              meter={{
                id: "context-window",
                kind: "five-hour",
                label: "Context window",
                state: "available",
                usedPercent: telemetry.contextWindow.usedPercent,
                message: telemetry.contextWindow.message,
              }}
            />
          </div>
        ) : null}
        {telemetry.credits ? <Credits credits={telemetry.credits} /> : null}
        {telemetry.updatedAt ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Updated {formatTimestamp(telemetry.updatedAt)}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function UsageMeter({ meter }: { meter: SubscriptionRateLimitMeter }) {
  const label = meter.label ?? meterLabel(meter);
  const usedPercent = meter.usedPercent;
  if (meter.state !== "available" || usedPercent === undefined) {
    return (
      <div className="space-y-1.5" role="status">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate font-medium text-foreground">
            {label}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {meter.message ?? "Not reported"}
          </span>
        </div>
        <div
          className="h-1.5 rounded-full bg-muted"
          aria-label={`${label}: ${meter.message ?? "not reported"}`}
        />
        {meter.resetsAt ? (
          <p className="text-[11px] text-muted-foreground">
            Resets {formatTimestamp(meter.resetsAt)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {label}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {`${Math.round(usedPercent)}% used`}
        </span>
      </div>
      <Progress
        value={usedPercent}
        aria-label={`${label}: ${Math.round(usedPercent)} percent used`}
        className="h-1.5"
      />
      {meter.resetsAt ? (
        <p className="text-[11px] text-muted-foreground">
          Resets {formatTimestamp(meter.resetsAt)}
        </p>
      ) : null}
    </div>
  );
}

function Credits({
  credits,
}: {
  credits: NonNullable<SubscriptionStatus["telemetry"]["credits"]>;
}) {
  const value = credits.unlimited
    ? "Unlimited"
    : credits.balance !== undefined
      ? `${credits.balance}${credits.unit ? ` ${credits.unit}` : ""}`
      : (credits.message ?? "Unavailable");
  return (
    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
      <span className="text-muted-foreground">Usage credits</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SetupPanel({ allConnected }: { allConnected: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {allConnected
        ? "Describe the change in the composer to begin."
        : "Connect both subscriptions to begin."}
    </p>
  );
}

function CollaborationPanel({
  state,
  controls,
  busy,
  onStart,
  onGo,
  onSecondaryAction,
}: {
  state: MultiFrontierRendererState;
  controls: MultiFrontierControlState;
  busy: boolean;
  onStart?: (id: string) => void;
  onGo?: (id: string) => void;
  onSecondaryAction?: (input: MultiFrontierSecondaryActionInput) => void;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const invokeSecondaryAction = (
    action: MultiFrontierSecondaryAction,
    input: Omit<
      MultiFrontierSecondaryActionInput,
      "action" | "collaborationId"
    > = {},
  ) =>
    onSecondaryAction?.({
      action,
      collaborationId: state.collaborationId,
      ...input,
    });
  const swappableParticipants = state.participants.filter(
    (participant) => participant.participantId !== state.driverParticipantId,
  );
  const [recoveryPrompt, setRecoveryPrompt] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ParticipantBadges participants={state.participants} />
        <div className="flex items-center gap-1.5">
          {controls.canStart ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || !onStart}
              onClick={() => onStart?.(state.collaborationId)}
            >
              <IconPlayerPlay aria-hidden="true" />
              Start review
            </Button>
          ) : null}
          {controls.canGo ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || !onGo}
              onClick={() => onGo?.(state.collaborationId)}
            >
              <IconBolt aria-hidden="true" />
              GO — implement
            </Button>
          ) : null}
          {controls.canResume && !state.requiresPlanningPrompt ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || !onSecondaryAction}
              onClick={() => invokeSecondaryAction("resume")}
            >
              <IconPlayerPlay aria-hidden="true" />
              Resume
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={busy || !onSecondaryAction}
                aria-label="More collaboration actions"
              >
                <IconDots aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {controls.canPause ? (
                <DropdownMenuItem
                  onSelect={() => invokeSecondaryAction("pause")}
                >
                  <IconPlayerPause aria-hidden="true" />
                  Pause collaboration
                </DropdownMenuItem>
              ) : null}
              {controls.canSwap
                ? swappableParticipants.map((participant) => (
                    <DropdownMenuItem
                      key={participant.participantId}
                      onSelect={() =>
                        invokeSecondaryAction("role-swap", {
                          nextDriverParticipantId: participant.participantId,
                        })
                      }
                    >
                      <IconArrowsExchange aria-hidden="true" />
                      Make {PROVIDER_COPY[participant.providerId].label} driver
                    </DropdownMenuItem>
                  ))
                : null}
              {controls.canReReview &&
              state.pendingCheckpointReviewArtifactId ? (
                <DropdownMenuItem
                  onSelect={() =>
                    invokeSecondaryAction("re-review", {
                      reviewArtifactId: state.pendingCheckpointReviewArtifactId,
                    })
                  }
                >
                  <IconPlayerSkipForward aria-hidden="true" />
                  Address and re-review findings
                </DropdownMenuItem>
              ) : null}
              {(controls.canPause ||
                controls.canSwap ||
                controls.canReReview) &&
              controls.canCancel ? (
                <DropdownMenuSeparator />
              ) : null}
              {controls.canCancel ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setCancelOpen(true)}
                >
                  Cancel collaboration
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {state.phase === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          This collaboration stopped with a failure. Review its evidence before
          recovering or starting another run.
        </p>
      ) : null}
      {state.phase === "paused" ? (
        state.requiresPlanningPrompt ? (
          <div className="space-y-2" role="status">
            <p className="text-xs text-muted-foreground">
              Re-enter the original request to resume planning. It was not kept
              on disk.
            </p>
            <div className="flex gap-2">
              <Input
                value={recoveryPrompt}
                maxLength={12_000}
                onChange={(event) => setRecoveryPrompt(event.target.value)}
                aria-label="Original collaboration request"
                placeholder="Original request"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !recoveryPrompt.trim() || !onSecondaryAction}
                onClick={() =>
                  onSecondaryAction?.({
                    action: "resume",
                    collaborationId: state.collaborationId,
                    prompt: recoveryPrompt,
                  })
                }
              >
                <IconPlayerPlay aria-hidden="true" />
                Resume planning
              </Button>
            </div>
          </div>
        ) : (
          <p role="status" className="text-xs text-muted-foreground">
            Work is paused and can be resumed without replaying edits.
          </p>
        )
      ) : null}
      <Collapsible open={artifactsOpen} onOpenChange={setArtifactsOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="-ml-2">
            Evidence · {state.artifacts.length}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {state.artifacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No evidence yet.</p>
          ) : (
            <ol className="space-y-2" aria-label="Collaboration evidence">
              {state.artifacts.map((artifact) => (
                <li key={artifact.id} className="text-xs">
                  <span className="font-medium capitalize">
                    {artifact.kind}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {artifact.summary}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this collaboration?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the collaboration and records a terminal cancellation.
              Start a new collaboration to continue work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep collaboration</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy || !onSecondaryAction}
              onClick={() => invokeSecondaryAction("cancel")}
            >
              Cancel collaboration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ParticipantBadges({
  participants,
}: {
  participants: readonly MultiFrontierRendererParticipant[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {participants.map((participant) => (
        <Badge
          key={participant.participantId}
          variant="secondary"
          className="gap-1 px-1.5 py-0 text-[10px]"
        >
          <span
            className={`size-1.5 rounded-full ${PROVIDER_COPY[participant.providerId].accent}`}
            aria-hidden="true"
          />
          {PROVIDER_COPY[participant.providerId].label} · {participant.role}
        </Badge>
      ))}
    </div>
  );
}

function Notice({ notice }: { notice: MultiFrontierNotice }) {
  const destructive = notice.kind === "failure";
  return (
    <div
      role={destructive ? "alert" : "status"}
      aria-live={destructive ? "assertive" : "polite"}
      className={`flex items-start gap-2 rounded-xl p-3 text-sm ${destructive ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-muted-foreground"}`}
    >
      {destructive ? (
        <IconAlertTriangle
          className="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
      ) : (
        <IconPlayerSkipForward
          className="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
      )}
      <p>{notice.message}</p>
    </div>
  );
}

function ConnectionBadge({ status }: { status?: SubscriptionStatus }) {
  const connected = status?.connectionState === "connected";
  const text = connected
    ? "Connected"
    : status?.connectionState === "needs-sign-in"
      ? "Sign in"
      : "Unavailable";
  return (
    <Badge
      variant={connected ? "secondary" : "outline"}
      className="shrink-0 px-1.5 py-0 text-[10px]"
    >
      {text}
    </Badge>
  );
}

function PhaseStatus({
  phase,
  round,
}: {
  phase: MultiFrontierRendererState["phase"];
  round: number;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        className="size-1.5 rounded-full bg-foreground/70"
        aria-hidden="true"
      />
      {phaseLabel(phase)} · Round {round}
    </p>
  );
}

function phaseLabel(phase: MultiFrontierRendererState["phase"]): string {
  return phase.replaceAll("_", " ");
}

function meterLabel(meter: SubscriptionRateLimitMeter): string {
  if (meter.kind === "five-hour") return "5-hour window";
  if (meter.kind === "weekly") return "Weekly window";
  return meter.modelTier ? `${meter.modelTier} weekly` : "Model tier weekly";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "at an unknown time"
    : date.toLocaleString();
}
