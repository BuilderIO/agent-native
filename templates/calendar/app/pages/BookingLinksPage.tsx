import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  IconBrandGoogle,
  IconBrandZoom,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconDotsVertical,
  IconPlus,
  IconTrash,
  IconVideo,
  IconVideoOff,
} from "@tabler/icons-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useZoomStatus, useConnectZoom } from "@/hooks/use-zoom-auth";
import {
  CustomFieldsEditor as SharedCustomFieldsEditor,
  SlugEditor,
} from "@agent-native/scheduling/react/components";
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
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { VisibilityBadge } from "@agent-native/core/client";
import { useAppHeaderControls } from "@/components/layout/AppLayout";
import {
  useBookingLinks,
  useCreateBookingLink,
  useDeleteBookingLink,
  useUpdateBookingLink,
  OPTIMISTIC_PREFIX,
} from "@/hooks/use-booking-links";
import {
  useAvailability,
  useUpdateAvailability,
} from "@/hooks/use-availability";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import { TimezoneCombobox } from "@/components/TimezoneCombobox";
import BookingsList from "./BookingsList";
import type {
  AvailabilityConfig,
  BookingLink,
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
const PREVIEW_COLLAPSED_STORAGE_KEY = "calendar.bookingLinks.previewCollapsed";

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

type Tab = "links" | "availability" | "bookings";

function createEmptyDraft(): DraftLink {
  return {
    title: "",
    slug: "",
    description: "",
    duration: 30,
    durations: [30],
    customFields: [],
    conferencing: { type: "none" },
    isActive: true,
    slugManuallyEdited: false,
  };
}

function draftFromBookingLink(link: BookingLink): DraftLink {
  const durations =
    link.durations && link.durations.length > 0
      ? link.durations
      : [link.duration];

  return {
    id: link.id,
    title: link.title,
    slug: link.slug,
    description: link.description || "",
    duration: link.duration,
    durations,
    customFields: link.customFields || [],
    conferencing: link.conferencing || { type: "none" },
    isActive: link.isActive,
    // Always lock the slug for saved links — changing a saved URL would
    // break existing shared links. Users can still edit the slug manually.
    slugManuallyEdited: true,
  };
}

function getDraftSignature(draft: DraftLink) {
  return JSON.stringify({
    title: draft.title.trim(),
    slug: slugify(draft.slug),
    description: draft.description.trim(),
    duration: draft.duration,
    durations: draft.durations,
    customFields: draft.customFields,
    conferencing: draft.conferencing,
    isActive: draft.isActive,
  });
}

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

function BookingLinksListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading meeting types">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-card px-4 py-4 sm:px-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-3 w-36" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-9 w-28 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type ProviderStatus = "connected" | "disconnected" | "not-configured";

const CONFERENCING_OPTIONS = [
  {
    type: "none",
    label: "No conferencing",
    description: "In-person, phone, or add details later",
    Icon: IconVideoOff,
  },
  {
    type: "google_meet",
    label: "Google Meet",
    description: "Auto-generate a Meet link",
    Icon: IconBrandGoogle,
  },
  {
    type: "zoom",
    label: "Zoom",
    description: "Auto-create a Zoom meeting per booking",
    Icon: IconBrandZoom,
  },
  {
    type: "custom",
    label: "Custom link",
    description: "Paste any meeting URL",
    Icon: IconLink,
  },
] satisfies Array<{
  type: ConferencingConfig["type"];
  label: string;
  description: string;
  Icon: typeof IconVideo;
}>;

function BookingConferencingSelect({
  value,
  onChange,
  zoomStatus,
  googleStatus,
  onConnectZoom,
  zoomPending,
}: {
  value: ConferencingConfig;
  onChange: (next: ConferencingConfig) => void;
  zoomStatus: ProviderStatus;
  googleStatus: ProviderStatus;
  onConnectZoom: () => void;
  zoomPending: boolean;
}) {
  const selected =
    CONFERENCING_OPTIONS.find((option) => option.type === value.type) ??
    CONFERENCING_OPTIONS[0];
  const SelectedIcon = selected.Icon;
  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-1.5">
        <IconVideo className="h-4 w-4" />
        Conferencing
      </Label>
      <Select
        value={value.type}
        onValueChange={(type) =>
          onChange({
            type: type as ConferencingConfig["type"],
            url: type === "custom" ? value.url : undefined,
          })
        }
      >
        <SelectTrigger className="h-11 py-2">
          <div className="flex min-w-0 items-center gap-2 text-left">
            <SelectedIcon className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">{selected.label}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {CONFERENCING_OPTIONS.map((option) => {
            const status =
              option.type === "zoom"
                ? zoomStatus
                : option.type === "google_meet"
                  ? googleStatus
                  : "connected";
            return (
              <SelectItem
                key={option.type}
                value={option.type}
                className="py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <option.Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{option.label}</span>
                      {status === "connected" &&
                        option.type !== "none" &&
                        option.type !== "custom" && (
                          <span className="text-[10px] text-muted-foreground">
                            Connected
                          </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {value.type === "zoom" && zoomStatus !== "connected" && (
        <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Connect Zoom</p>
              <p className="text-xs text-muted-foreground">
                {zoomStatus === "not-configured"
                  ? "Zoom is selected, but this deployment is missing Zoom OAuth credentials."
                  : "Zoom is selected. Connect your account to create a meeting for each booking."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConnectZoom}
              disabled={zoomPending}
              className="gap-1.5"
            >
              <IconBrandZoom className="h-4 w-4" />
              {zoomPending ? "Connecting..." : "Connect Zoom"}
            </Button>
          </div>
        </div>
      )}

      {value.type === "custom" && (
        <div className="space-y-1.5">
          <Label htmlFor="booking-link-meeting-url" className="text-xs">
            Meeting URL
          </Label>
          <Input
            id="booking-link-meeting-url"
            type="url"
            value={value.url ?? ""}
            onChange={(e) =>
              onChange({ type: "custom", url: e.currentTarget.value })
            }
            placeholder="https://meet.example.com/room"
          />
        </div>
      )}
    </div>
  );
}

export default function BookingLinksPage({
  selectedId = null,
}: {
  selectedId?: string | null;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "links";
  const { data: bookingLinks = [], isLoading } = useBookingLinks();
  const createBookingLink = useCreateBookingLink();
  const updateBookingLink = useUpdateBookingLink();
  const deleteBookingLink = useDeleteBookingLink();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState<DraftLink>(() => createEmptyDraft());
  const [savedDraftSignature, setSavedDraftSignature] = useState<string | null>(
    null,
  );
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(PREVIEW_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const [customDurationInput, setCustomDurationInput] = useState("");
  const [showCustomDurationInput, setShowCustomDurationInput] = useState(false);

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
  const zoomStatus = useZoomStatus();
  const connectZoom = useConnectZoom();

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PREVIEW_COLLAPSED_STORAGE_KEY,
      String(isPreviewCollapsed),
    );
  }, [isPreviewCollapsed]);

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
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to save availability",
          ),
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
      setDraft(createEmptyDraft());
      setSavedDraftSignature(null);
      return;
    }

    const nextDraft = draftFromBookingLink(selectedLink);
    setDraft(nextDraft);
    setSavedDraftSignature(getDraftSignature(nextDraft));
    setCustomDurationInput("");
    setShowCustomDurationInput(false);
  }, [selectedLink?.id, selectedLink?.updatedAt]);

  const bookingUsername = availability?.bookingUsername;

  function getBookingUrl(slug: string) {
    if (bookingUsername) {
      const host =
        typeof window !== "undefined" &&
        window.location.hostname !== "localhost"
          ? window.location.origin
          : `https://${PRODUCTION_DOMAIN}`;
      return `${host}/book/${bookingUsername}/${slug}`;
    }
    // Fallback for no username set
    if (typeof window === "undefined") return `/book/${slug}`;
    return `${window.location.origin}/book/${slug}`;
  }

  const previewUrl = getBookingUrl(draft.slug);
  const draftSignature = useMemo(() => getDraftSignature(draft), [draft]);
  const hasUnsavedChanges =
    !!selectedLink &&
    savedDraftSignature !== null &&
    draftSignature !== savedDraftSignature;

  function handleCreate() {
    const n = bookingLinks.length + 1;
    const baseTitle = n > 1 ? `Meeting ${n}` : "Meeting";
    const baseSlug = slugify(baseTitle);
    // Pre-generate an optimistic id so we can navigate instantly; the mutation
    // inserts the row into the list cache synchronously via onMutate.
    const optimisticId = `optimistic_${nanoid()}`;
    createBookingLink.mutate(
      {
        title: baseTitle,
        slug: baseSlug,
        duration: 30,
        isActive: true,
        optimisticId,
      },
      {
        onSuccess: (created) => {
          // Swap URL from optimistic id to the real one without a back-stack entry.
          navigate(`/booking-links/${created.id}`, { replace: true });
        },
        onError: () => {
          // Cache was rolled back by the hook's onError. Bring the user back.
          navigate("/booking-links", { replace: true });
          toast.error("Failed to create booking link");
        },
      },
    );
    // Navigate *immediately* — the optimistic row is already in the list cache.
    navigate(`/booking-links/${optimisticId}`);
    toast.success("Booking link created");
  }

  async function handleSave() {
    if (!draft.id) return;
    if (!hasUnsavedChanges) return;
    // Optimistic row hasn't resolved to a real ID yet — wait for it
    if (draft.id.startsWith(OPTIMISTIC_PREFIX)) {
      toast.error("Still creating — please try again in a moment");
      return;
    }
    try {
      const updated = await updateBookingLink.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        slug: slugify(draft.slug),
        description: draft.description.trim() || undefined,
        duration: draft.durations[0] ?? draft.duration,
        durations: draft.durations.length > 1 ? draft.durations : undefined,
        customFields:
          draft.customFields.length > 0 ? draft.customFields : undefined,
        conferencing: draft.conferencing,
        isActive: draft.isActive,
      });
      const nextDraft = draftFromBookingLink(updated);
      setDraft(nextDraft);
      setSavedDraftSignature(getDraftSignature(nextDraft));
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

  function addCustomDuration() {
    const minutes = Number.parseInt(customDurationInput, 10);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      toast.error("Enter a duration between 5 and 480 minutes");
      return;
    }
    setDraft((prev) => {
      const next = Array.from(new Set([...prev.durations, minutes])).sort(
        (a, b) => a - b,
      );
      return { ...prev, durations: next, duration: next[0] };
    });
    setCustomDurationInput("");
    setShowCustomDurationInput(false);
  }

  async function copyPreviewUrl(slug: string) {
    await navigator.clipboard.writeText(getBookingUrl(slug));
    toast.success("Booking link copied");
  }

  function openPreview(slug: string) {
    // For local preview, use the local path
    const localPath = bookingUsername
      ? `/book/${bookingUsername}/${slug}`
      : `/book/${slug}`;
    window.open(localPath, "_blank", "noopener,noreferrer");
  }

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  const detailHeaderControls = useMemo(() => {
    if (!selectedId) {
      return {
        left: (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            Booking links
          </h1>
        ),
        right:
          activeTab === "links" ? (
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              className="h-8 gap-2"
            >
              <IconPlus className="h-4 w-4" />
              New booking link
            </Button>
          ) : null,
      };
    }
    return {
      left: (
        <button
          type="button"
          onClick={() => navigate("/booking-links")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconChevronLeft className="h-4 w-4" />
          Back
        </button>
      ),
      right: selectedLink ? (
        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void copyPreviewUrl(draft.slug)}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Copy booking link"
                >
                  <IconCopy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openPreview(draft.slug)}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  aria-label="Open booking link"
                >
                  <IconExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open link</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSaveRef.current()}
            disabled={updateBookingLink.isPending || !hasUnsavedChanges}
            className="h-8 px-3"
          >
            {updateBookingLink.isPending
              ? "Saving..."
              : hasUnsavedChanges
                ? "Save changes"
                : "Saved"}
          </Button>
        </div>
      ) : null,
    };
  }, [
    selectedId,
    selectedLink,
    draft.slug,
    updateBookingLink.isPending,
    hasUnsavedChanges,
    navigate,
    activeTab,
  ]);
  useAppHeaderControls(detailHeaderControls);

  const hasLinks = bookingLinks.length > 0;

  // If a link is selected, show the detail/edit view
  if (selectedId) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:p-6">
        {/* Two-column layout: form left, preview right */}
        <div
          className={cn(
            "grid gap-6",
            isPreviewCollapsed
              ? "lg:grid-cols-[minmax(0,1fr)_auto]"
              : "lg:grid-cols-2",
          )}
        >
          {/* Left — Edit form */}
          <div
            className={cn(
              "space-y-8",
              isPreviewCollapsed && "mx-auto w-full max-w-4xl",
            )}
          >
            {isLoading ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-16 w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ) : selectedLink ? (
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
                    {draft.durations
                      .filter((minutes) => !DURATION_PRESETS.includes(minutes))
                      .map((minutes) => {
                        const isSelected = draft.durations.includes(minutes);
                        return (
                          <button
                            key={minutes}
                            type="button"
                            onClick={() =>
                              setDraft((prev) => {
                                if (prev.durations.length === 1) return prev;
                                const next = prev.durations.filter(
                                  (d) => d !== minutes,
                                );
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
                                : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                            )}
                          >
                            {minutes} min
                          </button>
                        );
                      })}
                    <button
                      type="button"
                      onClick={() =>
                        setShowCustomDurationInput((visible) => !visible)
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                        showCustomDurationInput
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border border-dashed text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      Custom
                    </button>
                  </div>
                  {showCustomDurationInput && (
                    <div className="flex max-w-xs items-center gap-2">
                      <Input
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        autoFocus
                        value={customDurationInput}
                        onChange={(e) => setCustomDurationInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCustomDuration();
                          }
                          if (e.key === "Escape") {
                            setShowCustomDurationInput(false);
                          }
                        }}
                        placeholder="Minutes"
                        className="h-9"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addCustomDuration}
                        disabled={!customDurationInput.trim()}
                        className="shrink-0"
                      >
                        Add
                      </Button>
                    </div>
                  )}
                  {draft.durations.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                      Bookers will choose between:{" "}
                      {draft.durations.map((d) => `${d} min`).join(", ")}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>URL</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => openPreview(draft.slug)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          aria-label="Open booking page in new tab"
                        >
                          <IconExternalLink className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open in new tab</TooltipContent>
                    </Tooltip>
                  </div>
                  {/* Editable URL parts (username / slug) — shared package component */}
                  <SlugEditor
                    hideLabel
                    host={
                      typeof window !== "undefined" &&
                      window.location.hostname !== "localhost"
                        ? window.location.host
                        : PRODUCTION_DOMAIN
                    }
                    pathPrefix="/book"
                    username={
                      bookingUsername ||
                      usernameInput ||
                      suggestedUsername ||
                      ""
                    }
                    slug={draft.slug}
                    onUsernameChange={(val) => {
                      setUsernameInput(val);
                      if (val) {
                        updateAvailability.mutate(
                          {
                            timezone,
                            weeklySchedule: schedule,
                            bufferMinutes,
                            minNoticeHours,
                            maxAdvanceDays,
                            slotDurationMinutes: slotDuration,
                            bookingPageSlug: bookingSlug,
                            bookingUsername: val,
                          },
                          {
                            onError: (error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Failed to update booking username",
                              ),
                          },
                        );
                      }
                    }}
                    onSlugChange={(val) => {
                      setDraft((prev) => ({
                        ...prev,
                        slug: val,
                        slugManuallyEdited: true,
                      }));
                    }}
                  />
                </div>

                {/* Conferencing — Zoom uses real OAuth */}
                <BookingConferencingSelect
                  value={draft.conferencing}
                  onChange={(conferencing) =>
                    setDraft((prev) => ({ ...prev, conferencing }))
                  }
                  zoomStatus={
                    zoomStatus.data?.connected
                      ? "connected"
                      : zoomStatus.data?.configured === false
                        ? "not-configured"
                        : "disconnected"
                  }
                  googleStatus={
                    googleStatus.data?.connected ? "connected" : "disconnected"
                  }
                  onConnectZoom={() =>
                    connectZoom.mutate(undefined, {
                      onError: (error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "Could not start Zoom connection",
                        ),
                    })
                  }
                  zoomPending={connectZoom.isPending}
                />

                {/* Custom fields editor — shared package component */}
                <SharedCustomFieldsEditor
                  fields={draft.customFields}
                  onChange={(fields) =>
                    setDraft((prev) => ({ ...prev, customFields: fields }))
                  }
                />

                {/* Lower-risk settings */}
                <div className="space-y-5 border-t border-border pt-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Link visibility</p>
                      <p className="text-xs text-muted-foreground">
                        Turn this off to disable the public page.
                      </p>
                    </div>
                    <Switch
                      checked={draft.isActive}
                      onCheckedChange={(checked) =>
                        setDraft((prev) => ({ ...prev, isActive: checked }))
                      }
                    />
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
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
            ) : null}
          </div>

          {/* Right — Live booking page preview */}
          {selectedLink && (
            <div className="lg:sticky lg:top-8 lg:self-start">
              {isPreviewCollapsed ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setIsPreviewCollapsed(false)}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        aria-label="Open preview"
                      >
                        <IconChevronLeft className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Open preview</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
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
                  onCollapse={() => setIsPreviewCollapsed(true)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <p className="text-sm text-muted-foreground">
        Create meeting types with public links and configure your availability.
      </p>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="links">Meeting Types</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
        </TabsList>

        <TabsContent value="links">
          <div className="space-y-6">
            {isLoading ? (
              <BookingLinksListSkeleton />
            ) : !hasLinks ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                  <IconLink className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-lg font-medium">No booking links yet</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Create a booking link to let people schedule meetings with
                  you.
                </p>
                <Button onClick={handleCreate} className="mt-6 gap-2">
                  <IconPlus className="h-4 w-4" />
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
                      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                        {/* Info — clickable to edit */}
                        <button
                          type="button"
                          onClick={() => navigate(`/booking-links/${link.id}`)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <p
                              className={cn(
                                "text-sm font-semibold truncate",
                                !link.isActive && "text-muted-foreground",
                              )}
                            >
                              {link.title}
                            </p>
                            <VisibilityBadge visibility={link.visibility} />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground truncate">
                            {durationLabel} • One-on-One
                          </p>
                          {availability && (
                            <p className="mt-0.5 text-xs text-muted-foreground truncate">
                              {formatAvailabilitySummary(availability)} •{" "}
                              {availability.timezone}
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
                                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/60 sm:px-4 sm:text-sm"
                              >
                                <IconLink className="h-3.5 w-3.5" />
                                Copy link
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPreview(link.slug);
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent/60"
                              >
                                <IconExternalLink className="h-4 w-4" />
                              </button>
                            </>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent/60"
                              >
                                <IconDotsVertical className="h-4 w-4" />
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
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Weekly Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weekly Schedule</CardTitle>
                <CardDescription>
                  Toggle days and set available hours.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <Label htmlFor="booking-links-availability-timezone">
                    Timezone
                  </Label>
                  <TimezoneCombobox
                    id="booking-links-availability-timezone"
                    value={timezone}
                    onChange={setTimezone}
                  />
                  <p className="text-xs text-muted-foreground">
                    Weekly hours like 9 AM-5 PM are interpreted in this timezone
                    before visitors see them in their own browser timezone.
                  </p>
                </div>
                {DAYS.map(({ key, label, short }) => {
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
                            className="w-28 sm:w-32"
                          />
                          <span className="text-muted-foreground">to</span>
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    /book/
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

        <TabsContent value="bookings">
          <BookingsList />
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
  onCollapse,
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
  onCollapse?: () => void;
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
            {onCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onCollapse}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  >
                    <IconChevronRight className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Collapse preview</TooltipContent>
              </Tooltip>
            )}
            {onCopy && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onCopy}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  >
                    <IconCopy className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
            )}
            {onOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onOpen}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  >
                    <IconExternalLink className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Open in new tab</TooltipContent>
              </Tooltip>
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
            <IconCalendar className="h-5 w-5 text-primary" />
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
                  <IconChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <span className="text-xs font-medium">
                  {format(viewMonth, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="p-1 rounded hover:bg-accent/60"
                >
                  <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
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
