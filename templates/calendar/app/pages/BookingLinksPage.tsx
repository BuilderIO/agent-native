import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Clock,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  isBefore,
  addDays,
  addMonths,
  subMonths,
  format,
  startOfDay,
  getDay,
} from "date-fns";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  const googleStatus = useGoogleAuthStatus();

  // Derive a default username from the Google email (e.g. "steve" from "steve@builder.io")
  const suggestedUsername = useMemo(() => {
    const email = googleStatus.data?.accounts?.[0]?.email;
    if (!email) return "";
    const local = email.split("@")[0];
    // Convert "sewell.steve" → "sewell-steve"
    return local.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  }, [googleStatus.data]);

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

  // Clear selection if the selected link was deleted
  useEffect(() => {
    if (
      selectedId &&
      bookingLinks.length > 0 &&
      !bookingLinks.some((link) => link.id === selectedId)
    ) {
      setSelectedId(null);
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
      // Only lock the slug if the user previously customized it
      // (i.e. the saved slug doesn't match what the title would generate).
      // Freshly created links keep auto-deriving until the user edits the slug.
      slugManuallyEdited: selectedLink.slug !== slugify(selectedLink.title),
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
    const n = bookingLinks.length + 1;
    const baseTitle = n > 1 ? `Meeting ${n}` : "Meeting";
    const baseSlug = slugify(baseTitle);
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
      setSelectedId(null);
      toast.success("Booking link updated");
    } catch {
      toast.error("Failed to update booking link");
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
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

  // If a link is selected, show the detail/edit view
  if (selectedId) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Top bar: back + save */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          {selectedLink && (
            <Button type="button" onClick={handleSave}>
              Save changes
            </Button>
          )}
        </div>

        {/* Two-column layout: form left, preview right */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left — Edit form */}
          <div className="space-y-5">
            {!selectedLink ? (
              <Card>
                <CardContent className="py-12">
                  <p className="text-center text-sm text-muted-foreground">
                    Loading...
                  </p>
                </CardContent>
              </Card>
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

                {/* Description */}
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

                {/* Duration options — multi-select */}
                <div className="space-y-3">
                  <Label>Duration options</Label>
                  <p className="text-xs text-muted-foreground">
                    Select one or more — bookers will choose when scheduling.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_PRESETS.map((minutes) => {
                      const isSelected = draft.durations.includes(minutes);
                      return (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() =>
                            setDraft((prev) => {
                              const next = isSelected
                                ? prev.durations.filter((d) => d !== minutes)
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

                {/* Interactive booking link */}
                <EditableBookingUrl
                  username={
                    bookingUsername || usernameInput || suggestedUsername || ""
                  }
                  slug={draft.slug}
                  onUsernameChange={(val) => {
                    const clean = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
                    setUsernameInput(clean);
                    // Persist username to availability config
                    if (clean) {
                      updateAvailability.mutate({
                        timezone,
                        weeklySchedule: schedule,
                        bufferMinutes,
                        minNoticeHours,
                        maxAdvanceDays,
                        slotDurationMinutes: slotDuration,
                        bookingPageSlug: bookingSlug,
                        bookingUsername: clean,
                      });
                    }
                  }}
                  onSlugChange={(val) => {
                    const clean = slugify(val);
                    setDraft((prev) => ({
                      ...prev,
                      slug: clean,
                      slugManuallyEdited: true,
                    }));
                  }}
                  onCopy={() => void copyPreviewUrl(draft.slug)}
                  onOpen={() => openPreview(draft.slug)}
                />

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete booking link</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove{" "}
                          <span className="font-medium text-foreground">
                            {draft.title}
                          </span>{" "}
                          and its public booking page. This can't be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </div>

          {/* Right — Live booking page preview */}
          {selectedLink && (
            <div className="lg:sticky lg:top-8 lg:self-start">
              <BookingPreview
                title={draft.title}
                description={draft.description}
                durations={draft.durations}
                isActive={draft.isActive}
                availability={availability ?? undefined}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

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
            <div className="space-y-3">
              {bookingLinks.map((link) => {
                const linkUrl = getBookingUrl(link.slug);
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => setSelectedId(link.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Link2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {link.title}
                          </span>
                          <Badge
                            variant={link.isActive ? "default" : "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {link.isActive ? "Live" : "Hidden"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {linkUrl.replace(/^https?:\/\//, "")}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
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

// ---------------------------------------------------------------------------
// Inline booking page preview — mirrors BookingPage layout, updates live
// ---------------------------------------------------------------------------

const WEEKDAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_MAP: Record<number, DayName> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

function EditableBookingUrl({
  username,
  slug,
  onUsernameChange,
  onSlugChange,
  onCopy,
  onOpen,
}: {
  username: string;
  slug: string;
  onUsernameChange: (val: string) => void;
  onSlugChange: (val: string) => void;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const [editingField, setEditingField] = useState<"username" | "slug" | null>(
    null,
  );
  const [editValue, setEditValue] = useState("");

  function startEdit(field: "username" | "slug") {
    setEditingField(field);
    setEditValue(field === "username" ? username : slug);
  }

  function commitEdit() {
    if (!editingField) return;
    const val = editValue.trim();
    if (val) {
      if (editingField === "username") onUsernameChange(val);
      else onSlugChange(val);
    }
    setEditingField(null);
  }

  const host =
    typeof window !== "undefined" && window.location.hostname !== "localhost"
      ? window.location.host
      : PRODUCTION_DOMAIN;

  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Booking link
      </p>

      {/* Interactive URL — click username or slug to edit inline */}
      <div className="flex flex-wrap items-baseline gap-0 text-sm font-mono leading-relaxed break-all">
        <span className="text-muted-foreground">{host}/meet/</span>

        {editingField === "username" ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) =>
              setEditValue(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditingField(null);
            }}
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 font-mono text-sm w-auto min-w-[3ch]"
            style={{ width: `${Math.max(3, editValue.length)}ch` }}
          />
        ) : (
          <button
            type="button"
            onClick={() => startEdit("username")}
            className={cn(
              "inline font-mono rounded px-0.5 -mx-0.5",
              username
                ? "text-foreground hover:bg-primary/10 hover:text-primary"
                : "text-primary/60 bg-primary/5 border border-dashed border-primary/30 hover:bg-primary/10",
            )}
            title="Click to edit username"
          >
            {username || "your-name"}
          </button>
        )}

        <span className="text-muted-foreground">/</span>

        {editingField === "slug" ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) =>
              setEditValue(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditingField(null);
            }}
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 font-mono text-sm w-auto min-w-[3ch]"
            style={{ width: `${Math.max(3, editValue.length)}ch` }}
          />
        ) : (
          <button
            type="button"
            onClick={() => startEdit("slug")}
            className="inline font-mono text-foreground rounded px-0.5 -mx-0.5 hover:bg-primary/10 hover:text-primary"
            title="Click to edit slug"
          >
            {slug || "meeting"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={onCopy}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy link
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-2"
          onClick={onOpen}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open in new tab
        </Button>
      </div>
    </div>
  );
}

function BookingPreview({
  title,
  description,
  durations,
  isActive,
  availability,
}: {
  title: string;
  description: string;
  durations: number[];
  isActive: boolean;
  availability?: AvailabilityConfig;
}) {
  const displayTitle = title.trim() || "Untitled Meeting";
  const hasDurationChoice = durations.length > 1;
  const primaryDuration = durations[0] ?? 30;

  const today = startOfDay(new Date());
  const maxDate = addDays(today, availability?.maxAdvanceDays ?? 60);

  // Interactive state
  const [viewMonth, setViewMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Reset selections when durations change
  useEffect(() => {
    setSelectedDuration(null);
    setSelectedSlot(null);
  }, [durations.join(",")]);

  // Calendar data for viewed month
  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });

  function isDayDisabled(day: Date) {
    if (isBefore(day, today)) return true;
    if (isBefore(maxDate, day)) return true;
    if (availability) {
      const dayName = DAY_MAP[getDay(day)];
      if (!availability.weeklySchedule[dayName]?.enabled) return true;
    }
    return false;
  }

  // Generate realistic time slots based on availability
  const timeSlots = useMemo(() => {
    if (!selectedDate || !availability) {
      return ["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"];
    }
    const dayName = DAY_MAP[getDay(selectedDate)];
    const daySchedule = availability.weeklySchedule[dayName];
    if (!daySchedule?.enabled) return [];
    const slot = daySchedule.slots[0];
    if (!slot) return [];

    const dur = selectedDuration ?? primaryDuration;
    const [startH, startM] = slot.start.split(":").map(Number);
    const [endH, endM] = slot.end.split(":").map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;
    const slots: string[] = [];
    for (let m = startMin; m + dur <= endMin; m += dur) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push(`${h12}:${mm.toString().padStart(2, "0")} ${ampm}`);
    }
    return slots;
  }, [selectedDate, selectedDuration, primaryDuration, availability]);

  // Determine which step to show
  type Step = "duration" | "date" | "time" | "info";
  let step: Step = "date";
  if (hasDurationChoice && selectedDuration === null) step = "duration";
  else if (!selectedDate) step = "date";
  else if (!selectedSlot) step = "time";
  else step = "info";

  const steps: Step[] = hasDurationChoice
    ? ["duration", "date", "time", "info"]
    : ["date", "time", "info"];

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      {/* Preview header bar */}
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Preview
        </span>
        {!isActive && (
          <Badge variant="secondary" className="text-[10px]">
            Hidden
          </Badge>
        )}
      </div>

      {/* Interactive booking page preview */}
      <div
        className={cn(
          "p-6 space-y-5",
          !isActive && "opacity-50 pointer-events-none",
        )}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <h3 className="text-lg font-semibold leading-tight">
            {displayTitle}
          </h3>
          {description.trim() && (
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
              {description}
            </p>
          )}
          {!hasDurationChoice && (
            <span className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {primaryDuration} minute meeting
            </span>
          )}
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  // Allow clicking back to previous steps
                  if (s === "duration") {
                    setSelectedDuration(null);
                    setSelectedDate(null);
                    setSelectedSlot(null);
                  } else if (s === "date") {
                    setSelectedDate(null);
                    setSelectedSlot(null);
                  } else if (s === "time") {
                    setSelectedSlot(null);
                  }
                }}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium",
                  step === s
                    ? "bg-primary text-primary-foreground"
                    : steps.indexOf(step) > i
                      ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </button>
              {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>

        {/* Duration step */}
        {step === "duration" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-center text-muted-foreground">
              Choose a Duration
            </p>
            <div className="space-y-1.5">
              {durations.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSelectedDuration(mins)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:border-primary/30"
                >
                  {mins} minutes
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Date step */}
        {step === "date" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-center text-muted-foreground">
              Select a Date
            </p>
            <div className="rounded-lg border border-border/60 p-3">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => subMonths(m, 1))}
                  className="p-1 rounded hover:bg-accent/60"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <span className="text-xs font-medium">
                  {format(viewMonth, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="p-1 rounded hover:bg-accent/60"
                >
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-0.5">
                {WEEKDAY_HEADERS.map((d) => (
                  <div
                    key={d}
                    className="py-0.5 text-center text-[10px] font-medium text-muted-foreground/60"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7 gap-px">
                {calDays.map((day) => {
                  const inMonth = isSameMonth(day, viewMonth);
                  const disabled = isDayDisabled(day);
                  const isTodayMark = isToday(day);

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={!inMonth || disabled}
                      onClick={() => {
                        setSelectedDate(day);
                        setSelectedSlot(null);
                      }}
                      className={cn(
                        "flex h-7 items-center justify-center rounded text-[11px]",
                        !inMonth && "opacity-0 pointer-events-none",
                        inMonth && disabled && "text-muted-foreground/30",
                        inMonth &&
                          !disabled &&
                          "text-muted-foreground cursor-pointer hover:bg-accent/60",
                        isTodayMark &&
                          !disabled &&
                          "border border-primary/40 text-foreground font-medium",
                      )}
                    >
                      {format(day, "d")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Time step */}
        {step === "time" && selectedDate && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {format(selectedDate, "EEEE, MMM d")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedSlot(null);
                }}
                className="text-[11px] text-primary hover:underline"
              >
                Change date
              </button>
            </div>
            {timeSlots.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {timeSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-center text-[11px] cursor-pointer",
                      selectedSlot === slot
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:bg-accent/60 hover:border-primary/30",
                    )}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground py-4">
                No availability on this day
              </p>
            )}
          </div>
        )}

        {/* Info step (preview only — just shows the form shape) */}
        {step === "info" && selectedDate && selectedSlot && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {format(selectedDate, "EEEE, MMM d")} at {selectedSlot}
              </p>
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="text-[11px] text-primary hover:underline"
              >
                Change time
              </button>
            </div>
            <div className="space-y-2">
              <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50">
                Name
              </div>
              <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50">
                Email
              </div>
              <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50 h-14">
                Notes (optional)
              </div>
            </div>
            <div className="rounded-md bg-primary/10 border border-primary/20 px-3 py-2 text-center text-[11px] font-medium text-primary">
              Confirm Booking
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
