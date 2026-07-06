import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Switch } from "@agent-native/toolkit/ui/switch";
import type { AvailabilityConfig, DaySchedule } from "@shared/api";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { CloudUpgrade } from "@/components/CloudUpgrade";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import {
  useAvailability,
  useUpdateAvailability,
} from "@/hooks/use-availability";
import { useDbStatus } from "@/hooks/use-db-status";
import { copyTextToClipboard } from "@/lib/clipboard";

type DayName = keyof AvailabilityConfig["weeklySchedule"];

const DAYS: { key: DayName }[] = [
  { key: "monday" },
  { key: "tuesday" },
  { key: "wednesday" },
  { key: "thursday" },
  { key: "friday" },
  { key: "saturday" },
  { key: "sunday" },
];

const DEFAULT_SCHEDULE: DaySchedule = {
  enabled: false,
  slots: [{ start: "09:00", end: "17:00" }],
};

export default function AvailabilitySettings() {
  const t = useT();
  const { data: availability } = useAvailability();
  const updateAvailability = useUpdateAvailability();

  const [schedule, setSchedule] = useState<
    AvailabilityConfig["weeklySchedule"]
  >({
    monday: { ...DEFAULT_SCHEDULE, enabled: true },
    tuesday: { ...DEFAULT_SCHEDULE, enabled: true },
    wednesday: { ...DEFAULT_SCHEDULE, enabled: true },
    thursday: { ...DEFAULT_SCHEDULE, enabled: true },
    friday: { ...DEFAULT_SCHEDULE, enabled: true },
    saturday: { ...DEFAULT_SCHEDULE },
    sunday: { ...DEFAULT_SCHEDULE },
  });
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [minNoticeHours, setMinNoticeHours] = useState(1);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(60);
  const [slotDuration, setSlotDuration] = useState(30);
  const [bookingSlug, setBookingSlug] = useState("meeting");
  const [timezone, setTimezone] = useState("America/New_York");
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  async function handleCopyBookingLink() {
    if (isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    const url = `${window.location.origin}/book/${bookingSlug}`;
    if (await copyTextToClipboard(url)) {
      toast.success(t("bookingLinks.bookingLinkCopied"));
      return;
    }
    toast.error(t("common.clipboardUnavailable"));
  }

  useEffect(() => {
    if (availability) {
      setSchedule(availability.weeklySchedule);
      setBufferMinutes(availability.bufferMinutes);
      setMinNoticeHours(availability.minNoticeHours);
      setMaxAdvanceDays(availability.maxAdvanceDays);
      setSlotDuration(availability.slotDurationMinutes);
      setBookingSlug(availability.bookingPageSlug);
      setTimezone(availability.timezone);
    }
  }, [availability]);

  function updateDay(day: DayName, updates: Partial<DaySchedule>) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], ...updates },
    }));
  }

  function updateDaySlot(day: DayName, field: "start" | "end", value: string) {
    setSchedule((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        slots: [{ ...prev[day].slots[0], [field]: value }],
      },
    }));
  }

  function handleSave() {
    updateAvailability.mutate(
      {
        timezone,
        weeklySchedule: schedule,
        bufferMinutes,
        minNoticeHours,
        maxAdvanceDays,
        slotDurationMinutes: slotDuration,
        bookingPageSlug: bookingSlug,
      },
      {
        onSuccess: () => toast.success(t("bookingLinks.availabilitySaved")),
        onError: () => toast.error(t("bookingLinks.availabilitySaveFailed")),
      },
    );
  }

  function dayLabel(day: DayName) {
    switch (day) {
      case "monday":
        return t("bookingLinks.days.monday");
      case "tuesday":
        return t("bookingLinks.days.tuesday");
      case "wednesday":
        return t("bookingLinks.days.wednesday");
      case "thursday":
        return t("bookingLinks.days.thursday");
      case "friday":
        return t("bookingLinks.days.friday");
      case "saturday":
        return t("bookingLinks.days.saturday");
      case "sunday":
        return t("bookingLinks.days.sunday");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 pb-12">
      <div>
        <h1 className="text-2xl font-semibold">
          {t("bookingLinks.availability")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("bookingLinks.availabilityDescription")}
        </p>
      </div>

      {/* Weekly Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("bookingLinks.weeklySchedule")}
          </CardTitle>
          <CardDescription>
            {t("bookingLinks.weeklyScheduleDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <Label htmlFor="availability-timezone">
              {t("eventForm.timezone")}
            </Label>
            <TimezoneCombobox
              id="availability-timezone"
              value={timezone}
              onChange={setTimezone}
            />
            <p className="text-xs text-muted-foreground">
              {t("bookingLinks.timezoneHelp")}
            </p>
          </div>
          {DAYS.map(({ key }) => {
            const day = schedule[key];
            const slot = day.slots[0] ?? { start: "09:00", end: "17:00" };
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-3 sm:gap-4 sm:px-4"
              >
                <div className="flex items-center gap-3 w-28 sm:w-40">
                  <Switch
                    checked={day.enabled}
                    onCheckedChange={(checked) =>
                      updateDay(key, { enabled: checked })
                    }
                  />
                  <span className="text-sm font-medium">{dayLabel(key)}</span>
                </div>

                {day.enabled ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={slot.start}
                      onChange={(e) =>
                        updateDaySlot(key, "start", e.target.value)
                      }
                      className="w-28 sm:w-32"
                    />
                    <span className="text-muted-foreground">
                      {t("bookingLinks.to")}
                    </span>
                    <Input
                      type="time"
                      value={slot.end}
                      onChange={(e) =>
                        updateDaySlot(key, "end", e.target.value)
                      }
                      className="w-28 sm:w-32"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("bookingLinks.unavailable")}
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Booking Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t("bookingLinks.bookingRules")}
          </CardTitle>
          <CardDescription>
            {t("bookingLinks.bookingRulesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("bookingLinks.bufferBetweenEvents")}</Label>
              <Input
                type="number"
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("bookingLinks.minimumNotice")}</Label>
              <Input
                type="number"
                value={minNoticeHours}
                onChange={(e) => setMinNoticeHours(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("bookingLinks.maxAdvanceBooking")}</Label>
              <Input
                type="number"
                value={maxAdvanceDays}
                onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("bookingLinks.slotDuration")}</Label>
              <Input
                type="number"
                value={slotDuration}
                onChange={(e) => setSlotDuration(Number(e.target.value))}
                min={5}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("bookingLinks.bookingPageSlug")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/book/</span>
              <Input
                value={bookingSlug}
                onChange={(e) => setBookingSlug(e.target.value)}
                placeholder="meeting"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("bookingLinks.shareBookingLink")}</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyBookingLink()}
            >
              {t("bookingLinks.copyBookingLink")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={updateAvailability.isPending}
        className="w-full"
      >
        {updateAvailability.isPending
          ? t("common.saving")
          : t("bookingLinks.saveAvailability")}
      </Button>

      {showCloudUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <CloudUpgrade
            title={t("bookingLinks.shareBookingLink")}
            description={t("bookingLinks.cloudUpgradeDescription")}
            onClose={() => setShowCloudUpgrade(false)}
          />
        </div>
      )}
    </div>
  );
}
