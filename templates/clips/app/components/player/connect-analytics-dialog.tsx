import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { IconLayoutDashboard, IconMessageCircle } from "@tabler/icons-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";

export type AnalyticsDestination = "analysis" | "dashboard";

export interface AnalyticsInsightSnapshot {
  views: number;
  uniqueViewers: number | null;
  completionRate: number | null;
  reactions: number;
  ctaConversionRate: number | null;
  hasDropOff: boolean;
}

export interface AnalyticsHandoffInput extends AnalyticsInsightSnapshot {
  destination: AnalyticsDestination;
  recordingId: string;
  recordingTitle?: string;
}

export interface AnalyticsHandoff {
  message: string;
  context: string;
}

/**
 * Keep the handoff compact and declarative. Analytics owns source selection and
 * query execution; Clips only supplies the recording identity and the visible
 * snapshot that motivated the request.
 */
export function buildAnalyticsHandoff(
  input: AnalyticsHandoffInput,
): AnalyticsHandoff {
  const title = input.recordingTitle?.trim() || "this clip";
  const message =
    input.destination === "dashboard"
      ? `Help me add the Clips recording “${title}” to a new or existing Agent-Native Analytics dashboard.`
      : `Help me understand the insights for the Clips recording “${title}”.`;
  const destinationInstructions =
    input.destination === "dashboard"
      ? "Let the user choose an existing dashboard or create a new private dashboard, then add this clip as a source."
      : "Start a conversational analysis of this clip's performance and help the user explore follow-up questions.";

  return {
    message,
    context: JSON.stringify({
      sourceApp: "clips",
      sourceSurface: "recording_insights",
      recordingId: input.recordingId,
      recordingTitle: input.recordingTitle?.trim() || null,
      destination: input.destination,
      snapshot: {
        views: input.views,
        uniqueViewers: input.uniqueViewers,
        completionRate: input.completionRate,
        reactions: input.reactions,
        ctaConversionRate: input.ctaConversionRate,
        hasDropOff: input.hasDropOff,
      },
      instructions: `Delegate this request to the Analytics app via call-agent. ${destinationInstructions} Analytics owns source selection and query execution. Do not expose viewer identities or raw SQL.`,
    }),
  };
}

export interface ConnectAnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Activates a route-owned Agent surface instead of the workspace rail. */
  onOpenAgent?: () => void;
  recordingId: string;
  recordingTitle?: string;
  snapshot: AnalyticsInsightSnapshot;
}

export function ConnectAnalyticsDialog({
  open,
  onOpenChange,
  onOpenAgent,
  recordingId,
  recordingTitle,
  snapshot,
}: ConnectAnalyticsDialogProps) {
  const t = useT();

  const handoff = (destination: AnalyticsDestination) => {
    const payload = buildAnalyticsHandoff({
      ...snapshot,
      destination,
      recordingId,
      recordingTitle,
    });

    trackEvent("analytics_connect_started", {
      surface: "recording_insights",
      destination,
    });
    onOpenAgent?.();
    sendToAgentChat({
      message: payload.message,
      context: payload.context,
      submit: true,
      newTab: true,
      openSidebar: !onOpenAgent,
      background: false,
      usageLabel: `clips:analytics-${destination}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg gap-5 p-5 sm:p-6">
        <DialogHeader className="pe-8 text-start">
          <DialogTitle>
            {t("recordingInsights.connectAnalyticsTitle")}
          </DialogTitle>
        </DialogHeader>

        <ItemGroup className="overflow-hidden rounded-lg border border-border">
          <DestinationAction
            icon={<IconMessageCircle />}
            label={t("recordingInsights.exploreWithAgent")}
            actionLabel={t("recordingInsights.startChatAction")}
            onClick={() => handoff("analysis")}
          />
          <ItemSeparator />
          <DestinationAction
            icon={<IconLayoutDashboard />}
            label={t("recordingInsights.trackInDashboard")}
            actionLabel={t("recordingInsights.chooseDashboardAction")}
            onClick={() => handoff("dashboard")}
          />
        </ItemGroup>
      </DialogContent>
    </Dialog>
  );
}

function DestinationAction({
  actionLabel,
  icon,
  label,
  onClick,
}: {
  actionLabel: string;
  icon: ReactElement;
  label: string;
  onClick: () => void;
}) {
  return (
    <Item size="sm" className="rounded-none">
      <ItemMedia
        variant="icon"
        aria-hidden="true"
        className="text-muted-foreground"
      >
        {icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <Button type="button" variant="outline" size="sm" onClick={onClick}>
          {actionLabel}
        </Button>
      </ItemActions>
    </Item>
  );
}
