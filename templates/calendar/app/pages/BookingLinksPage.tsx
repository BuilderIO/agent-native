import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  TimerReset,
  Trash2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useBookingLinks,
  useCreateBookingLink,
  useDeleteBookingLink,
  useUpdateBookingLink,
} from "@/hooks/use-booking-links";
import {
  useAvailability,
  useUpdateAvailability,
} from "@/hooks/use-availability";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import type { AvailabilityConfig, DaySchedule } from "@shared/api";

const DURATION_PRESETS = [15, 30, 45, 60];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PRODUCTION_DOMAIN = "calendar.agent-native.com";

type DraftLink = {
  id?: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  durations: number[];
  isActive: boolean;
  /** Whether the user has manually edited the slug (vs auto-generated) */
  slugManuallyEdited: boolean;
};

type DayName = keyof AvailabilityConfig["weeklySchedule"];

const DAYS: { key: DayName; label: string; short: string }[] = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

const DEFAULT_SCHEDULE: DaySchedule = {
  enabled: false,
  slots: [{ start: "09:00", end: "17:00" }],
};

type Tab = "links" | "availability";

export default function BookingLinksPage() {
  const { data: bookingLinks = [], isLoading } = useBookingLinks();
  const createBookingLink = useCreateBookingLink();
  const updateBookingLink = useUpdateBookingLink();
  const deleteBookingLink = useDeleteBookingLink();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("links");
  const [draft, setDraft] = useState<DraftLink>({
    title: "",
    slug: "",
    description: "",
    duration: 30,
    durations: [30],
    isActive: true,
    slugManuallyEdited: false,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Availability state
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
  const [usernameInput, setUsernameInput] = useState("");
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  useEffect(() => {
    if (availability) {
      setSchedule(availability.weeklySchedule);
      setBufferMinutes(availability.bufferMinutes);
      setMinNoticeHours(availability.minNoticeHours);
      setMaxAdvanceDays(availability.maxAdvanceDays);
      setSlotDuration(availability.slotDurationMinutes);
      setBookingSlug(availability.bookingPageSlug);
      setTimezone(availability.timezone);
      setUsernameInput(availability.bookingUsername ?? "");
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

  function handleSaveAvailability() {
    updateAvailability.mutate(
      {
        timezone,
        weeklySchedule: schedule,
        bufferMinutes,
        minNoticeHours,
        maxAdvanceDays,
        slotDurationMinutes: slotDuration,
        bookingPageSlug: bookingSlug,
        bookingUsername: usernameInput.trim() || undefined,
      },
      {
        onSuccess: () => toast.success("Availability saved"),
        onError: () => toast.error("Failed to save availability"),
      },
    );
  }

  useEffect(() => {
    if (!bookingLinks.length) return;
    if (!selectedId || !bookingLinks.some((link) => link.id === selectedId)) {
      setSelectedId(bookingLinks[0].id);
    }
  }, [bookingLinks, selectedId]);

  const selectedLink = useMemo(
    () => bookingLinks.find((link) => link.id === selectedId) ?? null,
    [bookingLinks, selectedId],
  );

  useEffect(() => {
    if (!selectedLink) {
      setDraft({
        title: "",
        slug: "",
        description: "",
        duration: 30,
        durations: [30],
        isActive: true,
        slugManuallyEdited: false,
      });
      setShowAdvanced(false);
      return;
    }

    const durations =
      selectedLink.durations && selectedLink.durations.length > 0
        ? selectedLink.durations
        : [selectedLink.duration];
    setDraft({
      id: selectedLink.id,
      title: selectedLink.title,
      slug: selectedLink.slug,
      description: selectedLink.description || "",
      duration: selectedLink.duration,
      durations,
      isActive: selectedLink.isActive,
      slugManuallyEdited: true, // existing links have established slugs
    });
    // Show advanced section if link has a description or custom slug
    setShowAdvanced(!!selectedLink.description);
  }, [selectedLink]);

  const bookingUsername = availability?.bookingUsername;

  function getBookingUrl(slug: string) {
    if (bookingUsername) {
      const host =
        typeof window !== "undefined" &&
        window.location.hostname !== "localhost"
          ? window.location.origin
          : `https://${PRODUCTION_DOMAIN}`;
      return `${host}/meet/${bookingUsername}/${slug}`;
    }
    // Fallback for no username set
    if (typeof window === "undefined") return `/book/${slug}`;
    return `${window.location.origin}/book/${slug}`;
  }

  const previewUrl = getBookingUrl(draft.slug);

  async function handleCreate() {
    const baseTitle = `New ${bookingLinks.length + 1 > 1 ? "Meeting Link" : "Meeting"}`;
    const baseSlug = slugify(`meeting-${bookingLinks.length + 1}`);
    try {
      const created = await createBookingLink.mutateAsync({
        title: baseTitle,
        slug: baseSlug,
        duration: 30,
        isActive: true,
      });
      setSelectedId(created.id);
      setActiveTab("links");
      toast.success("Booking link created");
    } catch {
      toast.error("Failed to create booking link");
    }
  }

  async function handleSave() {
    if (!draft.id) return;
    try {
      await updateBookingLink.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        slug: slugify(draft.slug),
        description: draft.description.trim() || undefined,
        duration: draft.durations[0] ?? draft.duration,
        durations: draft.durations.length > 1 ? draft.durations : undefined,
        isActive: draft.isActive,
      });
      toast.success("Booking link updated");
    } catch {
      toast.error("Failed to update booking link");
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    if (!window.confirm("Delete this booking link?")) return;
    try {
      await deleteBookingLink.mutateAsync(draft.id);
      setSelectedId(null);
      toast.success("Booking link deleted");
    } catch {
      toast.error("Failed to delete booking link");
    }
  }

  async function copyPreviewUrl(slug: string) {
    await navigator.clipboard.writeText(getBookingUrl(slug));
    toast.success("Booking link copied");
  }

  function openPreview(slug: string) {
    // For local preview, use the local path
    const localPath = bookingUsername
      ? `/meet/${bookingUsername}/${slug}`
      : `/book/${slug}`;
    window.open(localPath, "_blank", "noopener,noreferrer");
  }

  const hasLinks = bookingLinks.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booking Links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create meeting types with public links and configure your
            availability.
          </p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New booking link
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("links")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
            activeTab === "links"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Meeting Types
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("availability")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
            activeTab === "availability"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Availability
          </span>
        </button>
      </div>

      {activeTab === "links" && (
        <>
          {!hasLinks && !isLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-lg font-medium">No booking links yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Create a booking link to let people schedule meetings with you.
              </p>
              <Button onClick={handleCreate} className="mt-6 gap-2">
                <Plus className="h-4 w-4" />
                Create your first link
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="overflow-hidden">
                <CardHeader className="border-b border-border/60 bg-muted/20">
                  <CardTitle className="text-lg">Meeting Types</CardTitle>
                  <CardDescription>
                    One public URL per meeting type.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading links...
                    </p>
                  ) : (
                    bookingLinks.map((link) => {
                      const isSelected = link.id === selectedId;
                      return (
                        <div
                          key={link.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(link.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(link.id);
                            }
                          }}
                          className={cn(
                            "w-full cursor-pointer rounded-2xl border p-4 text-left transition-all",
                            isSelected
                              ? "border-primary/25 bg-primary/[0.06] shadow-sm"
                              : "border-border/70 bg-card hover:border-border hover:bg-muted/20",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
                                  <Link2 className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {link.title}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {bookingUsername
                                      ? `/meet/${bookingUsername}/${link.slug}`
                                      : `/book/${link.slug}`}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <Badge
                              variant={link.isActive ? "default" : "secondary"}
                            >
                              {link.isActive ? "Live" : "Hidden"}
                            </Badge>
                          </div>
                          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <TimerReset className="h-3.5 w-3.5" />
                            {link.duration} minutes
                          </div>
                          <div className="mt-4 flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPreview(link.slug);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Preview
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyPreviewUrl(link.slug);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy link
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-border/60 bg-muted/20">
                  <CardTitle className="text-lg">Configure Link</CardTitle>
                  <CardDescription>
                    Set the meeting name, choose durations, and share the link.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 p-6">
                  {!selectedLink ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Select a link on the left to configure it.
                    </p>
                  ) : (
                    <>
                      {/* Title */}
                      <div className="space-y-2">
                        <Label htmlFor="booking-link-title">Meeting name</Label>
                        <Input
                          id="booking-link-title"
                          value={draft.title}
                          onChange={(e) => {
                            const title = e.target.value;
                            setDraft((prev) => ({
                              ...prev,
                              title,
                              slug: prev.slugManuallyEdited
                                ? prev.slug
                                : slugify(title),
                            }));
                          }}
                          placeholder="Quick Chat"
                        />
                      </div>

                      {/* Duration options — multi-select */}
                      <div className="space-y-3">
                        <Label>Duration options</Label>
                        <p className="text-xs text-muted-foreground">
                          Select one or more — bookers will choose when
                          scheduling.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {DURATION_PRESETS.map((minutes) => {
                            const isSelected =
                              draft.durations.includes(minutes);
                            return (
                              <button
                                key={minutes}
                                type="button"
                                onClick={() =>
                                  setDraft((prev) => {
                                    const next = isSelected
                                      ? prev.durations.filter(
                                          (d) => d !== minutes,
                                        )
                                      : [...prev.durations, minutes].sort(
                                          (a, b) => a - b,
                                        );
                                    // Must keep at least one
                                    if (next.length === 0) return prev;
                                    return {
                                      ...prev,
                                      durations: next,
                                      duration: next[0],
                                    };
                                  })
                                }
                                className={cn(
                                  "rounded-full border px-3 py-1.5 text-sm",
                                  isSelected
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/60",
                                )}
                              >
                                {minutes} min
                              </button>
                            );
                          })}
                        </div>
                        {draft.durations.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            Bookers will choose between:{" "}
                            {draft.durations.map((d) => `${d} min`).join(", ")}
                          </p>
                        )}
                      </div>

                      {/* Visibility toggle */}
                      <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">Link visibility</p>
                          <p className="text-xs text-muted-foreground">
                            Turn this off to disable the public booking page.
                          </p>
                        </div>
                        <Switch
                          checked={draft.isActive}
                          onCheckedChange={(checked) =>
                            setDraft((prev) => ({ ...prev, isActive: checked }))
                          }
                        />
                      </div>

                      {/* Preview link */}
                      <div className="rounded-2xl border border-border bg-muted/20 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Booking link
                        </p>
                        <p className="mt-2 break-all text-sm font-medium">
                          {previewUrl}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-2"
                            onClick={() => openPreview(draft.slug)}
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open preview
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => void copyPreviewUrl(draft.slug)}
                          >
                            <Copy className="h-4 w-4" />
                            Copy link
                          </Button>
                        </div>
                      </div>

                      {/* Advanced section (slug, description) */}
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4",
                            showAdvanced && "rotate-180",
                          )}
                        />
                        Advanced options
                      </button>

                      {showAdvanced && (
                        <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4">
                          <div className="space-y-2">
                            <Label htmlFor="booking-link-slug">URL slug</Label>
                            {draft.id &&
                              selectedLink &&
                              selectedLink.slug !== slugify(draft.slug) && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                                  <p className="text-xs text-amber-600 dark:text-amber-400">
                                    Changing the slug will break any existing
                                    shared links.
                                  </p>
                                </div>
                              )}
                            <Input
                              id="booking-link-slug"
                              value={draft.slug}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  slug: slugify(e.target.value),
                                  slugManuallyEdited: true,
                                }))
                              }
                              placeholder="intro-call"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="booking-link-description">
                              Description{" "}
                              <span className="text-muted-foreground font-normal">
                                (optional)
                              </span>
                            </Label>
                            <Textarea
                              id="booking-link-description"
                              rows={2}
                              value={draft.description}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  description: e.target.value,
                                }))
                              }
                              placeholder="Shown on the booking page"
                            />
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
                        <Button
                          type="button"
                          variant="destructive"
                          className="gap-2"
                          onClick={handleDelete}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete link
                        </Button>
                        <Button type="button" onClick={handleSave}>
                          Save changes
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {activeTab === "availability" && (
        <div className="max-w-2xl space-y-6">
          {/* Weekly Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Weekly Schedule</CardTitle>
              <CardDescription>
                Toggle days and set available hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {DAYS.map(({ key, label, short }) => {
                const day = schedule[key];
                const slot = day.slots[0] ?? { start: "09:00", end: "17:00" };
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-border px-4 py-3"
                  >
                    <div className="flex items-center gap-3 w-40">
                      <Switch
                        checked={day.enabled}
                        onCheckedChange={(checked) =>
                          updateDay(key, { enabled: checked })
                        }
                      />
                      <span className="text-sm font-medium">
                        <span className="hidden sm:inline">{label}</span>
                        <span className="sm:hidden">{short}</span>
                      </span>
                    </div>

                    {day.enabled ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={slot.start}
                          onChange={(e) =>
                            updateDaySlot(key, "start", e.target.value)
                          }
                          className="w-32"
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={slot.end}
                          onChange={(e) =>
                            updateDaySlot(key, "end", e.target.value)
                          }
                          className="w-32"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Unavailable
                      </span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Booking Rules */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Booking Rules</CardTitle>
              <CardDescription>
                Configure buffer time, notice periods, and slot settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Buffer between events (min)</Label>
                  <Input
                    type="number"
                    value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(Number(e.target.value))}
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Minimum notice (hours)</Label>
                  <Input
                    type="number"
                    value={minNoticeHours}
                    onChange={(e) => setMinNoticeHours(Number(e.target.value))}
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max advance booking (days)</Label>
                  <Input
                    type="number"
                    value={maxAdvanceDays}
                    onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                    min={1}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Slot duration (minutes)</Label>
                  <Input
                    type="number"
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(Number(e.target.value))}
                    min={5}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Booking username</Label>
                <p className="text-xs text-muted-foreground">
                  Your unique handle for booking URLs, e.g. {PRODUCTION_DOMAIN}
                  /meet/
                  <strong>{usernameInput || "your-name"}</strong>/meeting-slug
                </p>
                <Input
                  value={usernameInput}
                  onChange={(e) =>
                    setUsernameInput(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    )
                  }
                  placeholder="your-name"
                />
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={handleSaveAvailability}
            disabled={updateAvailability.isPending}
            className="w-full"
          >
            {updateAvailability.isPending ? "Saving..." : "Save Availability"}
          </Button>
        </div>
      )}

      {showCloudUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <CloudUpgrade
            title="Share Booking Link"
            description="To share your booking page publicly, connect a cloud database so bookings can be received from anywhere."
            onClose={() => setShowCloudUpgrade(false)}
          />
        </div>
      )}
    </div>
  );
}
