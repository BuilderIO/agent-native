import { useT } from "@agent-native/core/client/i18n";
import type { HostOverlayStatusResult, OverlayPerson } from "@shared/api";
import { IconTrash, IconUserPlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { HostOverlayStatusIcon } from "@/components/booking/HostOverlayStatusIcon";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useHostOverlayStatus,
  useSendOverlayRequest,
} from "@/hooks/use-host-overlay-status";
import {
  useAddOverlayPerson,
  useOverlayPeople,
  useRemoveOverlayPerson,
} from "@/hooks/use-overlay-people";

function statusLabelKey(status: HostOverlayStatusResult | undefined) {
  if (!status) return undefined;
  if (status.reciprocal && status.hasWorkingHours) {
    return "bookingLinks.workingHoursAppliedLabel" as const;
  }
  if (status.reciprocal) {
    return "bookingLinks.workingHoursPendingScheduleLabel" as const;
  }
  return "bookingLinks.workingHoursNotAppliedLabel" as const;
}

export function SharedAvailabilityPanel() {
  const t = useT();
  const [addCalendarOpen, setAddCalendarOpen] = useState(false);
  const {
    data: rawOverlayPeople,
    isPending: overlayPeopleLoading,
    isError: overlayPeopleFailed,
    refetch: refetchOverlayPeople,
  } = useOverlayPeople();
  const overlayPeople: OverlayPerson[] = Array.isArray(rawOverlayPeople)
    ? rawOverlayPeople
    : [];

  const emails = useMemo(
    () =>
      overlayPeople
        .map((person) => person.email)
        .sort((a, b) => a.localeCompare(b)),
    [overlayPeople],
  );
  const { data: statuses } = useHostOverlayStatus(
    emails,
    undefined,
    emails.length > 0,
  );
  const statusByEmail = useMemo(
    () =>
      new Map(
        (statuses ?? []).map((status) => [status.email.toLowerCase(), status]),
      ),
    [statuses],
  );

  const sendOverlayRequest = useSendOverlayRequest();
  const addOverlayPerson = useAddOverlayPerson();
  const removePerson = useRemoveOverlayPerson();

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("bookingLinks.sharedAvailability")}
          </CardTitle>
          <CardDescription>
            {t("bookingLinks.sharedAvailabilityDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overlayPeopleLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : overlayPeopleFailed ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5">
              <p className="text-sm text-destructive">
                {t("common.loadFailed")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => refetchOverlayPeople()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : overlayPeople.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("bookingLinks.sharedAvailabilityEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {overlayPeople.map((person) => {
                const status = statusByEmail.get(person.email.toLowerCase());
                const labelKey = statusLabelKey(status);
                return (
                  <li
                    key={person.email}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: person.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {person.name || person.email}
                      </div>
                      {person.name && (
                        <div className="truncate text-xs text-muted-foreground">
                          {person.email}
                        </div>
                      )}
                    </div>
                    {labelKey && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {t(labelKey)}
                      </span>
                    )}
                    <HostOverlayStatusIcon
                      status={status}
                      variant="overlay"
                      email={person.email}
                      mutation={sendOverlayRequest}
                      addPerson={addOverlayPerson}
                    />
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("bookingLinks.removePeerAriaLabel", {
                            email: person.email,
                          })}
                          className="shrink-0 rounded-sm text-muted-foreground/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="end"
                        className="w-72 space-y-2"
                      >
                        <p className="text-xs text-muted-foreground">
                          {t("bookingLinks.removePeerConfirm", {
                            name: person.name || person.email,
                          })}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={removePerson.isPending}
                          onClick={() =>
                            removePerson.mutate(person.email, {
                              onError: () =>
                                toast.error(t("settings.saveFailed")),
                            })
                          }
                        >
                          {removePerson.isPending &&
                            removePerson.variables === person.email && (
                              <Spinner className="h-3 w-3" />
                            )}
                          {t("bookingLinks.removePeerConfirmAction")}
                        </Button>
                      </PopoverContent>
                    </Popover>
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddCalendarOpen(true)}
          >
            <IconUserPlus className="h-4 w-4" />
            {t("bookingLinks.addOverlayPersonCta")}
          </Button>
        </CardContent>

        <AddCalendarDialog
          open={addCalendarOpen}
          onOpenChange={setAddCalendarOpen}
          defaultTab="people"
        />
      </Card>
    </TooltipProvider>
  );
}
