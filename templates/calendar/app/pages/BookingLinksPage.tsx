import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  GripVertical,
  Link2,
  MoreVertical,
  Plus,
  Trash2,
  AlertTriangle,
  ListChecks,
  Video,
} from "lucide-react";
import { nanoid } from "nanoid";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type {
  AvailabilityConfig,
  ConferencingConfig,
  CustomField,
  DaySchedule,
} from "@shared/api";

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
  customFields: CustomField[];
  conferencing: ConferencingConfig;
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

/** Format "09:00" → "9 am", "17:00" → "5 pm" */
function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m
    ? `${hour}:${String(m).padStart(2, "0")} ${suffix}`
    : `${hour} ${suffix}`;
}

/** Summarize availability, e.g. "Weekdays, 9 am - 5 pm" */
function formatAvailabilitySummary(config: AvailabilityConfig) {
  const ws = config.weeklySchedule;
  const weekdayKeys: DayName[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ];
  const weekendKeys: DayName[] = ["saturday", "sunday"];
  const allDays: DayName[] = [...weekdayKeys, ...weekendKeys];

  const enabledDays = allDays.filter((d) => ws[d].enabled);
  if (enabledDays.length === 0) return "No availability set";

  // Determine day label
  const weekdaysOn = weekdayKeys.every((d) => ws[d].enabled);
  const weekendsOn = weekendKeys.every((d) => ws[d].enabled);
  const weekdaysOff = weekdayKeys.every((d) => !ws[d].enabled);
  const weekendsOff = weekendKeys.every((d) => !ws[d].enabled);

  let dayLabel: string;
  if (weekdaysOn && weekendsOn) dayLabel = "Every day";
  else if (weekdaysOn && weekendsOff) dayLabel = "Weekdays";
  else if (weekdaysOff && weekendsOn) dayLabel = "Weekends";
  else {
    const shortNames: Record<DayName, string> = {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    };
    dayLabel = enabledDays.map((d) => shortNames[d]).join(", ");
  }

  // Find common time range
  const slot = ws[enabledDays[0]].slots[0];
  if (!slot) return dayLabel;

  return `${dayLabel}, ${formatTime12(slot.start)} - ${formatTime12(slot.end)}`;
}

export default function BookingLinksPage({
  selectedId = null,
}: {
  selectedId?: string | null;
}) {
  const navigate = useNavigate();
  const { data: bookingLinks = [], isLoading } = useBookingLinks();
  const createBookingLink = useCreateBookingLink();
  const updateBookingLink = useUpdateBookingLink();
  const deleteBookingLink = useDeleteBookingLink();
  const [activeTab, setActiveTab] = useState<Tab>("links");
  const [draft, setDraft] = useState<DraftLink>({
    title: "",
    slug: "",
    description: "",
    duration: 30,
    durations: [30],
    customFields: [],
    conferencing: { type: "none" },
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

  // Navigate back to list if the selected link was deleted
  useEffect(() => {
    if (
      selectedId &&
      !isLoading &&
      !bookingLinks.some((link) => link.id === selectedId)
    ) {
      navigate("/booking-links", { replace: true });
    }
  }, [bookingLinks, selectedId, isLoading, navigate]);

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
        customFields: [],
        conferencing: { type: "none" },
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
      customFields: selectedLink.customFields || [],
      conferencing: selectedLink.conferencing || { type: "none" },
      isActive: selectedLink.isActive,
      // Always lock the slug for saved links — changing a saved URL would
      // break existing shared links. Users can still edit the slug manually.
      slugManuallyEdited: true,
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
      navigate(`/booking-links/${created.id}`);
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
        customFields:
          draft.customFields.length > 0 ? draft.customFields : undefined,
        conferencing:
          draft.conferencing.type !== "none" ? draft.conferencing : undefined,
        isActive: draft.isActive,
      });
      navigate("/booking-links");
      toast.success("Booking link updated");
    } catch {
      toast.error("Failed to update booking link");
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    try {
      await deleteBookingLink.mutateAsync(draft.id);
      navigate("/booking-links");
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
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {/* Top bar: back + save */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/booking-links")}
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
                <div className="flex items-center justify-between">
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

                {/* Editable URL parts (username / slug) */}
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
                />

                {/* Conferencing */}
                <ConferencingEditor
                  config={draft.conferencing}
                  onChange={(conferencing) =>
                    setDraft((prev) => ({ ...prev, conferencing }))
                  }
                  googleConnected={googleStatus.data?.connected ?? false}
                />

                {/* Custom fields editor */}
                <CustomFieldsEditor
                  fields={draft.customFields}
                  onChange={(fields) =>
                    setDraft((prev) => ({ ...prev, customFields: fields }))
                  }
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
                customFields={draft.customFields}
                isActive={draft.isActive}
                availability={availability ?? undefined}
                bookingUrl={previewUrl}
                onCopy={() => void copyPreviewUrl(draft.slug)}
                onOpen={() => openPreview(draft.slug)}
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="links">Meeting Types</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
        </TabsList>

        <TabsContent value="links">
          <div className="space-y-6">
            {!hasLinks && !isLoading ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                  <Link2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-lg font-medium">No booking links yet</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Create a booking link to let people schedule meetings with
                  you.
                </p>
                <Button onClick={handleCreate} className="mt-6 gap-2">
                  <Plus className="h-4 w-4" />
                  Create your first link
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {bookingLinks.map((link) => {
                  const durations =
                    link.durations && link.durations.length > 0
                      ? link.durations
                      : [link.duration];
                  const durationLabel = durations
                    .map((d) => (d >= 60 ? `${d / 60} hr` : `${d} min`))
                    .join(", ");

                  return (
                    <div
                      key={link.id}
                      className={cn(
                        "rounded-lg border text-left hover:bg-accent/40 cursor-pointer",
                        link.isActive
                          ? "border-border bg-card"
                          : "border-transparent bg-muted/60",
                      )}
                    >
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Info — clickable to edit */}
                        <button
                          type="button"
                          onClick={() => navigate(`/booking-links/${link.id}`)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p
                            className={cn(
                              "text-sm font-semibold truncate",
                              !link.isActive && "text-muted-foreground",
                            )}
                          >
                            {link.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            {durationLabel} • One-on-One
                          </p>
                          {availability && (
                            <p className="mt-0.5 text-xs text-muted-foreground truncate">
                              {formatAvailabilitySummary(availability)}
                            </p>
                          )}
                        </button>

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-2">
                          {link.isActive && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyPreviewUrl(link.slug);
                                }}
                                className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-accent/60"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                Copy link
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPreview(link.slug);
                                }}
                                className="flex items-center justify-center rounded-full border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-accent/60"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </button>
                            </>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center justify-center rounded-full border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-accent/60"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  navigate(`/booking-links/${link.id}`)
                                }
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  updateBookingLink.mutate(
                                    {
                                      id: link.id,
                                      title: link.title,
                                      slug: link.slug,
                                      duration: link.duration,
                                      durations: link.durations,
                                      description: link.description,
                                      customFields: link.customFields,
                                      conferencing: link.conferencing,
                                      color: link.color,
                                      isActive: !link.isActive,
                                    },
                                    {
                                      onSuccess: () =>
                                        toast.success(
                                          `${link.title} ${link.isActive ? "disabled" : "enabled"}`,
                                        ),
                                    },
                                  );
                                }}
                              >
                                {link.isActive ? "Disable" : "Enable"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="availability">
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
                      onChange={(e) =>
                        setMinNoticeHours(Number(e.target.value))
                      }
                      min={0}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max advance booking (days)</Label>
                    <Input
                      type="number"
                      value={maxAdvanceDays}
                      onChange={(e) =>
                        setMaxAdvanceDays(Number(e.target.value))
                      }
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
                    Your unique handle for booking URLs, e.g.{" "}
                    {PRODUCTION_DOMAIN}
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
        </TabsContent>
      </Tabs>

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
}: {
  username: string;
  slug: string;
  onUsernameChange: (val: string) => void;
  onSlugChange: (val: string) => void;
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
    <div className="space-y-2">
      <Label>URL</Label>
      {/* Interactive URL — click username or slug to edit inline */}
      <div className="flex flex-wrap items-center gap-0 text-sm font-mono break-all rounded-lg border border-border bg-muted/20 px-3 py-2">
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
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 py-0 font-mono text-sm w-auto min-w-[3ch]"
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
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 py-0 font-mono text-sm w-auto min-w-[3ch]"
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
    </div>
  );
}

function BookingPreview({
  title,
  description,
  durations,
  customFields = [],
  isActive,
  availability,
  bookingUrl,
  onCopy,
  onOpen,
}: {
  title: string;
  description: string;
  durations: number[];
  customFields?: CustomField[];
  isActive: boolean;
  availability?: AvailabilityConfig;
  bookingUrl?: string;
  onCopy?: () => void;
  onOpen?: () => void;
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
  const [forcedStep, setForcedStep] = useState<Step | null>(null);

  let naturalStep: Step = "date";
  if (hasDurationChoice && selectedDuration === null) naturalStep = "duration";
  else if (!selectedDate) naturalStep = "date";
  else if (!selectedSlot) naturalStep = "time";
  else naturalStep = "info";

  const step = forcedStep ?? naturalStep;

  const steps: Step[] = hasDurationChoice
    ? ["duration", "date", "time", "info"]
    : ["date", "time", "info"];

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      {/* Preview header bar */}
      <div className="border-b border-border/60 bg-muted/30 px-4 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Preview
          </span>
          <div className="flex items-center gap-1">
            {!isActive && (
              <Badge variant="secondary" className="text-[10px]">
                Hidden
              </Badge>
            )}
            {onCopy && (
              <button
                type="button"
                onClick={onCopy}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
                title="Copy link"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {bookingUrl && (
          <p className="text-[11px] font-mono text-muted-foreground truncate">
            {bookingUrl.replace(/^https?:\/\//, "")}
          </p>
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
                  if (s === step) return;
                  // Navigate back: clear state so natural step resets
                  if (s === "duration") {
                    setSelectedDuration(null);
                    setSelectedDate(null);
                    setSelectedSlot(null);
                    setForcedStep(null);
                  } else if (s === "date") {
                    setSelectedDate(null);
                    setSelectedSlot(null);
                    setForcedStep(null);
                  } else if (s === "time") {
                    setSelectedSlot(null);
                    setForcedStep(null);
                  } else {
                    // Navigate forward: force the step
                    setForcedStep(s);
                  }
                }}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium cursor-pointer",
                  step === s
                    ? "bg-primary text-primary-foreground"
                    : steps.indexOf(step) > i
                      ? "bg-primary/20 text-primary hover:bg-primary/30"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
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
                  onClick={() => {
                    setSelectedDuration(mins);
                    setForcedStep(null);
                  }}
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
                        setForcedStep(null);
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
        {step === "time" && (
          <div className="space-y-2">
            {selectedDate && (
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {format(selectedDate, "EEEE, MMM d")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(null);
                    setSelectedSlot(null);
                    setForcedStep(null);
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Change date
                </button>
              </div>
            )}
            {!selectedDate && (
              <p className="text-xs font-medium text-center text-muted-foreground">
                Available Times
              </p>
            )}
            {timeSlots.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {timeSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => {
                      setSelectedSlot(slot);
                      setForcedStep(null);
                    }}
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
        {step === "info" && (
          <div className="space-y-3">
            {selectedDate && selectedSlot ? (
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {format(selectedDate, "EEEE, MMM d")} at {selectedSlot}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlot(null);
                    setForcedStep(null);
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Change time
                </button>
              </div>
            ) : (
              <p className="text-xs font-medium text-center text-muted-foreground">
                Booking Details
              </p>
            )}
            <div className="space-y-2">
              <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50">
                Name
              </div>
              <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50">
                Email
              </div>
              {customFields.map((field) => (
                <div
                  key={field.id}
                  className={cn(
                    "rounded-md border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/50",
                    field.type === "textarea" && "h-14",
                    field.type === "checkbox" && "flex items-center gap-1.5",
                  )}
                >
                  {field.type === "checkbox" && (
                    <div className="h-3 w-3 rounded-sm border border-border/60 shrink-0" />
                  )}
                  <span>
                    {field.label}
                    {!field.required && " (optional)"}
                  </span>
                  {field.required && (
                    <span className="text-destructive/50">*</span>
                  )}
                </div>
              ))}
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

// ---------------------------------------------------------------------------
// Custom fields editor — add/edit/remove custom form fields per booking link
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Conferencing editor — configure meeting links per booking link
// ---------------------------------------------------------------------------

const CONFERENCING_OPTIONS: {
  type: ConferencingConfig["type"];
  label: string;
  description: string;
}[] = [
  { type: "none", label: "No conferencing", description: "In-person or other" },
  {
    type: "google_meet",
    label: "Google Meet",
    description: "Auto-generate a Meet link",
  },
  {
    type: "zoom",
    label: "Zoom",
    description: "Use your personal meeting link",
  },
  {
    type: "custom",
    label: "Custom link",
    description: "Any meeting URL",
  },
];

function ConferencingEditor({
  config,
  onChange,
  googleConnected,
}: {
  config: ConferencingConfig;
  onChange: (config: ConferencingConfig) => void;
  googleConnected: boolean;
}) {
  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1.5">
        <Video className="h-4 w-4" />
        Conferencing
      </Label>

      <div className="grid grid-cols-2 gap-1.5">
        {CONFERENCING_OPTIONS.map((opt) => {
          const isSelected = config.type === opt.type;
          const isDisabled = opt.type === "google_meet" && !googleConnected;
          return (
            <button
              key={opt.type}
              type="button"
              disabled={isDisabled}
              onClick={() =>
                onChange({
                  type: opt.type,
                  url:
                    opt.type === "zoom" || opt.type === "custom"
                      ? config.url
                      : undefined,
                })
              }
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border/60 hover:bg-accent/60 hover:border-primary/30",
                isDisabled && "opacity-40 cursor-not-allowed",
              )}
            >
              <p className={cn("font-medium", isSelected && "text-primary")}>
                {opt.label}
              </p>
              <p className="text-muted-foreground">{opt.description}</p>
              {isDisabled && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Connect Google Calendar first
                </p>
              )}
            </button>
          );
        })}
      </div>

      {(config.type === "zoom" || config.type === "custom") && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            {config.type === "zoom"
              ? "Personal Zoom meeting link"
              : "Meeting URL"}
          </Label>
          <Input
            type="url"
            value={config.url || ""}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder={
              config.type === "zoom"
                ? "https://zoom.us/j/1234567890"
                : "https://meet.example.com/room"
            }
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom fields editor — add/edit/remove custom form fields per booking link
// ---------------------------------------------------------------------------

const FIELD_TYPE_LABELS: Record<CustomField["type"], string> = {
  text: "Short text",
  email: "Email",
  url: "URL",
  tel: "Phone",
  textarea: "Long text",
  select: "Dropdown",
  checkbox: "Checkbox",
};

const FIELD_PRESETS: {
  label: string;
  type: CustomField["type"];
  placeholder?: string;
  pattern?: string;
  patternError?: string;
}[] = [
  {
    label: "LinkedIn Profile",
    type: "url",
    placeholder: "https://linkedin.com/in/yourname",
    pattern: "^https?://(www\\.)?linkedin\\.com/in/.+",
    patternError: "Please enter a valid LinkedIn profile URL",
  },
  {
    label: "Company",
    type: "text",
    placeholder: "Your company name",
  },
  {
    label: "Phone Number",
    type: "tel",
    placeholder: "+1 (555) 123-4567",
  },
  {
    label: "Website",
    type: "url",
    placeholder: "https://example.com",
  },
];

function CustomFieldsEditor({
  fields,
  onChange,
}: {
  fields: CustomField[];
  onChange: (fields: CustomField[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  function addField(
    partial?: Partial<CustomField> & {
      label: string;
      type: CustomField["type"];
    },
  ) {
    const field: CustomField = {
      id: nanoid(8),
      label: partial?.label || "New Field",
      type: partial?.type || "text",
      required: partial?.required ?? true,
      placeholder: partial?.placeholder,
      pattern: partial?.pattern,
      patternError: partial?.patternError,
      options: partial?.options,
    };
    onChange([...fields, field]);
    setEditingId(field.id);
    setShowPresets(false);
  }

  function updateField(id: string, updates: Partial<CustomField>) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function removeField(id: string) {
    onChange(fields.filter((f) => f.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function moveField(id: string, dir: -1 | 1) {
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <ListChecks className="h-4 w-4" />
          Custom fields
        </Label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowPresets((p) => !p)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                showPresets && "rotate-180",
              )}
            />
            Presets
          </button>
          <button
            type="button"
            onClick={() => addField()}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>

      {showPresets && (
        <div className="grid grid-cols-2 gap-1.5">
          {FIELD_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => addField(preset)}
              className="rounded-lg border border-border/60 px-3 py-2 text-left text-xs hover:bg-accent/60 hover:border-primary/30"
            >
              <p className="font-medium">{preset.label}</p>
              <p className="text-muted-foreground">
                {FIELD_TYPE_LABELS[preset.type]}
              </p>
            </button>
          ))}
        </div>
      )}

      {fields.length === 0 && !showPresets && (
        <p className="text-xs text-muted-foreground">
          Add custom fields to collect information from bookers — e.g. LinkedIn
          profile, company name, phone number.
        </p>
      )}

      <div className="space-y-2">
        {fields.map((field) => {
          const isEditing = editingId === field.id;
          return (
            <div
              key={field.id}
              className="rounded-lg border border-border overflow-hidden"
            >
              {/* Field summary row */}
              <button
                type="button"
                onClick={() => setEditingId(isEditing ? null : field.id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40"
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">
                    {field.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {FIELD_TYPE_LABELS[field.type]}
                    {field.required ? " · Required" : " · Optional"}
                    {field.pattern ? " · Pattern" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveField(field.id, -1);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-foreground"
                    title="Move up"
                  >
                    <ChevronLeft className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveField(field.id, 1);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-foreground"
                    title="Move down"
                  >
                    <ChevronRight className="h-3 w-3 rotate-90" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeField(field.id);
                    }}
                    className="p-0.5 text-muted-foreground/40 hover:text-destructive"
                    title="Remove field"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </button>

              {/* Expanded editor */}
              {isEditing && (
                <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={field.label}
                        onChange={(e) =>
                          updateField(field.id, { label: e.target.value })
                        }
                        placeholder="Field label"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type</Label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(field.id, {
                            type: e.target.value as CustomField["type"],
                          })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {(
                          Object.entries(FIELD_TYPE_LABELS) as [
                            CustomField["type"],
                            string,
                          ][]
                        ).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Placeholder</Label>
                    <Input
                      value={field.placeholder || ""}
                      onChange={(e) =>
                        updateField(field.id, {
                          placeholder: e.target.value || undefined,
                        })
                      }
                      placeholder="Placeholder text"
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Required</Label>
                    <Switch
                      checked={field.required}
                      onCheckedChange={(checked) =>
                        updateField(field.id, { required: checked })
                      }
                    />
                  </div>

                  {field.type === "select" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Options{" "}
                        <span className="text-muted-foreground font-normal">
                          (one per line)
                        </span>
                      </Label>
                      <Textarea
                        value={(field.options || []).join("\n")}
                        onChange={(e) => {
                          const options = e.target.value
                            .split("\n")
                            .filter((o) => o.trim());
                          updateField(field.id, { options });
                        }}
                        placeholder={"Option 1\nOption 2\nOption 3"}
                        rows={3}
                        className="text-sm"
                      />
                    </div>
                  )}

                  {field.type !== "checkbox" && field.type !== "select" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Validation pattern{" "}
                        <span className="text-muted-foreground font-normal">
                          (regex, optional)
                        </span>
                      </Label>
                      <Input
                        value={field.pattern || ""}
                        onChange={(e) =>
                          updateField(field.id, {
                            pattern: e.target.value || undefined,
                          })
                        }
                        placeholder="e.g. ^https?://(www\.)?linkedin\.com/in/.+"
                        className="h-8 text-sm font-mono"
                      />
                      {field.pattern && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Error message{" "}
                            <span className="text-muted-foreground font-normal">
                              (shown when pattern doesn't match)
                            </span>
                          </Label>
                          <Input
                            value={field.patternError || ""}
                            onChange={(e) =>
                              updateField(field.id, {
                                patternError: e.target.value || undefined,
                              })
                            }
                            placeholder="e.g. Please enter a valid LinkedIn URL"
                            className="h-8 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
