import { useLocale, useT } from "@agent-native/core/client/i18n";
import type {
  HostOverlayStatusResult,
  SendOverlayRequestResult,
} from "@shared/api";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { useSendOverlayRequest } from "@/hooks/use-host-overlay-status";
import type { useAddOverlayPerson } from "@/hooks/use-overlay-people";
import { formatRelativeTimeFromNow } from "@/lib/relative-time";

const ICON_CLASS = "h-3.5 w-3.5 shrink-0";

/**
 * Whether a booking host's real working hours are being used for this link.
 *
 * Four states. Three come from the server; the fourth (`variant="manual"`) is
 * derived on the client, because a manual raw-email host is by definition not
 * in the owner's overlay list and the status action deliberately refuses to
 * report on addresses outside it.
 *
 * The send mutation is owned by the parent so every chip shares one
 * `useMutation` instance, but its `isPending`/`variables`/`data` all reflect
 * only the most recently started call — calling `mutate()` on one chip while
 * another chip's call is still in flight detaches the shared observer from
 * that earlier call entirely, so its `onSuccess` never fires. Each chip
 * therefore tracks its own pending flag locally and reads the result from
 * the promise returned by `mutateAsync`, which resolves correctly per call
 * regardless of what the shared observer is doing.
 */
export function HostOverlayStatusIcon({
  status,
  variant,
  email,
  bookingLinkId,
  mutation,
  addPerson,
}: {
  status?: HostOverlayStatusResult;
  variant: "overlay" | "manual";
  email: string;
  bookingLinkId?: string;
  mutation: ReturnType<typeof useSendOverlayRequest>;
  addPerson: ReturnType<typeof useAddOverlayPerson>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = status?.displayName || email;
  const [localResult, setLocalResult] =
    useState<SendOverlayRequestResult | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Once the server's own status reflects a new request history (e.g. a
  // later send from another tab, or the periodic status refetch), the local
  // optimistic result is no longer the freshest source of truth for this
  // peer and must not keep masking it indefinitely.
  useEffect(() => {
    setLocalResult(null);
  }, [status?.requestSentAt]);

  if (variant === "manual") {
    const isAdding = addPerson.isPending;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("bookingLinks.workingHoursManualHostAriaLabel", {
              email,
            })}
            className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
          >
            <IconInfoCircle className={ICON_CLASS} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("bookingLinks.workingHoursManualHost", { name })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isAdding}
            onClick={() =>
              addPerson.mutate(
                { email },
                {
                  onError: () =>
                    toast.error(t("bookingLinks.overlayRequestFailed")),
                },
              )
            }
          >
            {isAdding && <Spinner className="h-3 w-3" />}
            {t("bookingLinks.addHostToMyCalendar")}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  if (!status) return null;

  if (status.reciprocal && status.hasWorkingHours) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={t("bookingLinks.workingHoursAppliedAriaLabel", {
              email,
            })}
            className="flex shrink-0 items-center text-success focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <IconCircleCheck className={ICON_CLASS} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("bookingLinks.workingHoursAppliedTooltip", {
            name,
            timezone: status.timezone ?? "",
          })}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Reciprocal but no saved schedule: nothing to request, so no action. The
  // peer has already done their part; the schedule is theirs alone to add.
  if (status.reciprocal) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={t("bookingLinks.workingHoursPendingScheduleAriaLabel", {
              email,
            })}
            className="flex shrink-0 items-center text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <IconInfoCircle className={ICON_CLASS} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("bookingLinks.workingHoursPendingScheduleTooltip", { name })}
        </TooltipContent>
      </Tooltip>
    );
  }

  const emailNotConfigured =
    localResult?.skippedReason === "email-not-configured";
  const sendInProgress = localResult?.skippedReason === "send-in-progress";
  const justSentThisSession = localResult?.emailSent === true;
  const latestRequestSentAt =
    localResult?.requestSentAt ?? status.requestSentAt ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("bookingLinks.workingHoursNotAppliedAriaLabel", {
            email,
          })}
          className="shrink-0 rounded-sm text-destructive"
        >
          <IconAlertTriangle className={ICON_CLASS} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("bookingLinks.workingHoursNotAppliedWarning", { name })}
        </p>

        {emailNotConfigured ? (
          <p className="text-xs text-destructive">
            {t("bookingLinks.overlayRequestEmailNotConfigured")}
          </p>
        ) : sendInProgress ? (
          <p className="text-xs text-muted-foreground">
            {t("bookingLinks.overlayRequestInProgress")}
          </p>
        ) : justSentThisSession ? (
          <p className="text-xs text-muted-foreground">
            {t("bookingLinks.overlayRequestSentJustNow")}
          </p>
        ) : latestRequestSentAt ? (
          <p className="text-xs text-muted-foreground">
            {t("bookingLinks.overlayRequestSentAgo", {
              time: formatRelativeTimeFromNow(
                latestRequestSentAt,
                undefined,
                locale,
              ),
            })}
          </p>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isSending}
          onClick={() => {
            setIsSending(true);
            mutation
              .mutateAsync({ email, bookingLinkId })
              .then((data) => setLocalResult(data))
              .catch(() => toast.error(t("bookingLinks.overlayRequestFailed")))
              .finally(() => setIsSending(false));
          }}
        >
          {isSending && <Spinner className="h-3 w-3" />}
          {latestRequestSentAt
            ? t("bookingLinks.resendOverlayRequest")
            : t("bookingLinks.sendOverlayRequest")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
