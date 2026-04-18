import { useLoaderData, useRevalidator, Link } from "react-router";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { getEventTypeById } from "@agent-native/scheduling/server";
import { callAction } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconBrandGoogle,
  IconBrandZoom,
  IconBrandTeams,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconMapPin,
  IconPhone,
  IconPlus,
  IconTrash,
  IconUser,
  IconVideo,
  IconX,
} from "@tabler/icons-react";

export async function loader({ params }: LoaderFunctionArgs) {
  const eventType = await getEventTypeById(params.id!);
  if (!eventType) throw new Response("Not found", { status: 404 });
  return { eventType };
}

export default function EventTypeEditor() {
  const { eventType } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [form, setForm] = useState<any>(eventType);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);

  const save = async (patch: any) => {
    setSavingMessage("Saving…");
    try {
      await callAction("update-event-type", { id: eventType.id, ...patch });
      setSavingMessage("Saved");
      setTimeout(() => setSavingMessage(null), 1500);
      rv.revalidate();
    } catch (err: any) {
      toast.error(err.message);
      setSavingMessage(null);
    }
  };

  const publicUrl = `/${eventType.ownerEmail}/${form.slug}`;

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <header className="mb-5">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link to="/event-types">
            <IconArrowLeft className="mr-1.5 h-4 w-4" />
            Event Types
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {form.title}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                {publicUrl}
              </code>
              <button
                type="button"
                className="rounded p-1 hover:bg-muted"
                onClick={() => {
                  navigator.clipboard?.writeText(location.origin + publicUrl);
                  toast.success("Link copied");
                }}
                aria-label="Copy URL"
              >
                <IconCopy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {savingMessage && (
              <span className="text-xs text-muted-foreground">
                {savingMessage}
              </span>
            )}
            <Button asChild variant="outline" size="sm">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <IconExternalLink className="mr-1.5 h-4 w-4" />
                Preview
              </a>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Tabs defaultValue="setup" className="min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="limits">Limits</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
          </TabsList>

          {/* ============================ SETUP ============================ */}
          <TabsContent value="setup" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Event details</CardTitle>
                <CardDescription>
                  This information will be shown on your public booking page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <TwoCol
                  label="Title"
                  hint="Shown in the URL and on booking page."
                >
                  <Input
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.currentTarget.value })
                    }
                    onBlur={() => save({ title: form.title })}
                  />
                </TwoCol>
                <TwoCol
                  label="URL"
                  hint="The unique URL that visitors will use to book."
                >
                  <div className="flex rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                    <span className="flex items-center rounded-l-md bg-muted px-3 text-xs text-muted-foreground">
                      /{eventType.ownerEmail}/
                    </span>
                    <Input
                      value={form.slug}
                      className="border-0 rounded-l-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          slug: e.currentTarget.value
                            .toLowerCase()
                            .replace(/\s+/g, "-"),
                        })
                      }
                      onBlur={() => save({ slug: form.slug })}
                    />
                  </div>
                </TwoCol>
                <TwoCol
                  label="Description"
                  hint="A short description. Markdown is supported."
                >
                  <Textarea
                    rows={3}
                    placeholder="Tell visitors what this event is about."
                    value={form.description ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, description: e.currentTarget.value })
                    }
                    onBlur={() =>
                      save({ description: form.description || null })
                    }
                  />
                </TwoCol>
                <Separator />
                <TwoCol
                  label="Duration"
                  hint="How long is this event? Add more for the visitor to pick."
                >
                  <DurationsEditor
                    value={form}
                    onChange={(patch) => {
                      setForm({ ...form, ...patch });
                      save(patch);
                    }}
                  />
                </TwoCol>
                <Separator />
                <TwoCol
                  label="Location"
                  hint="Where this event will take place. Visitors will see this."
                >
                  <LocationEditor
                    value={form}
                    onChange={(patch) => {
                      setForm({ ...form, ...patch });
                      save(patch);
                    }}
                  />
                </TwoCol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========================= AVAILABILITY ======================== */}
          <TabsContent value="availability" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Availability</CardTitle>
                <CardDescription>
                  Choose a schedule or set a per-event override.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <TwoCol label="Schedule">
                  <div className="flex items-center gap-2">
                    <Select
                      value={form.scheduleId ?? "default"}
                      onValueChange={(v) => {
                        const next = v === "default" ? null : v;
                        setForm({ ...form, scheduleId: next });
                        save({ scheduleId: next });
                      }}
                    >
                      <SelectTrigger className="max-w-xs">
                        <SelectValue placeholder="Default schedule" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          Default schedule
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/availability">Manage schedules</Link>
                    </Button>
                  </div>
                </TwoCol>
                <Separator />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label>Override availability for this event</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Adds a schedule that only applies to this event type.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled>
                    <IconPlus className="mr-1.5 h-4 w-4" />
                    Add override
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================ LIMITS =========================== */}
          <TabsContent value="limits" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Booking limits</CardTitle>
                <CardDescription>
                  Fine-tune when and how often people can book.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <TwoCol
                  label="Before event"
                  hint="Buffer before each event starts."
                >
                  <DurationWithUnit
                    minutes={form.beforeEventBuffer ?? 0}
                    onChange={(v) => {
                      setForm({ ...form, beforeEventBuffer: v });
                      save({ beforeEventBuffer: v });
                    }}
                  />
                </TwoCol>
                <TwoCol
                  label="After event"
                  hint="Buffer after each event ends."
                >
                  <DurationWithUnit
                    minutes={form.afterEventBuffer ?? 0}
                    onChange={(v) => {
                      setForm({ ...form, afterEventBuffer: v });
                      save({ afterEventBuffer: v });
                    }}
                  />
                </TwoCol>
                <TwoCol
                  label="Minimum notice"
                  hint="Shortest notice someone can book you."
                >
                  <DurationWithUnit
                    minutes={form.minimumBookingNotice ?? 0}
                    onChange={(v) => {
                      setForm({ ...form, minimumBookingNotice: v });
                      save({ minimumBookingNotice: v });
                    }}
                  />
                </TwoCol>
                <TwoCol
                  label="Time-slot interval"
                  hint="Slot granularity on the booking page."
                >
                  <Select
                    value={String(form.slotInterval ?? 0)}
                    onValueChange={(v) => {
                      const next = Number(v) || null;
                      setForm({ ...form, slotInterval: next });
                      save({ slotInterval: next });
                    }}
                  >
                    <SelectTrigger className="max-w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Use event duration</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </TwoCol>
                <Separator />
                <TwoCol
                  label="Booking window"
                  hint="How far in advance people can book."
                >
                  <BookingWindowEditor
                    value={form}
                    onChange={(patch) => {
                      setForm({ ...form, ...patch });
                      save(patch);
                    }}
                  />
                </TwoCol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* =========================== ADVANCED ========================== */}
          <TabsContent value="advanced" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Advanced</CardTitle>
                <CardDescription>
                  Powerful controls for your event.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <TwoCol
                  label="Event name"
                  hint="Custom calendar name. Use {attendee} and {host}."
                >
                  <Input
                    placeholder="e.g. {attendee} + {host} — {title}"
                    value={form.eventName ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, eventName: e.currentTarget.value })
                    }
                    onBlur={() => save({ eventName: form.eventName || null })}
                  />
                </TwoCol>
                <TwoCol
                  label="Success redirect"
                  hint="Where visitors go after booking. Optional."
                >
                  <Input
                    placeholder="https://..."
                    value={form.successRedirectUrl ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        successRedirectUrl: e.currentTarget.value,
                      })
                    }
                    onBlur={() =>
                      save({
                        successRedirectUrl: form.successRedirectUrl || null,
                      })
                    }
                  />
                </TwoCol>
                <Separator />
                <SwitchRow
                  label="Requires confirmation"
                  description="The host has to confirm each booking manually."
                  checked={!!form.requiresConfirmation}
                  onChange={(v) => {
                    setForm({ ...form, requiresConfirmation: v });
                    save({ requiresConfirmation: v });
                  }}
                />
                <SwitchRow
                  label="Disable guests"
                  description="Attendees cannot add other guests to the booking."
                  checked={!!form.disableGuests}
                  onChange={(v) => {
                    setForm({ ...form, disableGuests: v });
                    save({ disableGuests: v });
                  }}
                />
                <SwitchRow
                  label="Hide notes in calendar"
                  description="Keep attendee notes private from calendar events."
                  checked={!!form.hideCalendarNotes}
                  onChange={(v) => {
                    setForm({ ...form, hideCalendarNotes: v });
                    save({ hideCalendarNotes: v });
                  }}
                />
                <SwitchRow
                  label="Lock timezone on booking page"
                  description="Don't let visitors change the booking timezone."
                  checked={!!form.lockTimeZoneToggle}
                  onChange={(v) => {
                    setForm({ ...form, lockTimeZoneToggle: v });
                    save({ lockTimeZoneToggle: v });
                  }}
                />
                <SwitchRow
                  label="Hide from public profile"
                  description="The event type won't appear on your profile page."
                  checked={!!form.hidden}
                  onChange={(v) => {
                    setForm({ ...form, hidden: v });
                    save({ hidden: v });
                  }}
                />
                <Separator />
                <TwoCol
                  label="Private links"
                  hint="Single-use or expiring URLs."
                >
                  <PrivateLinksEditor eventTypeId={eventType.id} />
                </TwoCol>
                <TwoCol
                  label="Offer seats"
                  hint="Allow multiple attendees to share the same slot."
                >
                  <SeatsEditor
                    value={form}
                    onChange={(patch) => {
                      setForm({ ...form, ...patch });
                      save(patch);
                    }}
                  />
                </TwoCol>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================ APPS ============================ */}
          <TabsContent value="apps" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Apps</CardTitle>
                <CardDescription>
                  Change the default location and connect extra apps for this
                  event.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AppsGrid
                  selected={form.locations?.[0]?.kind}
                  onPick={(kind) => {
                    const locations = [{ kind }];
                    setForm({ ...form, locations });
                    save({ locations });
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========================== WORKFLOWS ========================= */}
          <TabsContent value="workflows" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Workflows</CardTitle>
                <CardDescription>
                  Send reminders, confirmations, or custom automations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  <p>No workflows are attached to this event type.</p>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/workflows">Manage workflows</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ========================== PREVIEW PANEL ========================= */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            <PreviewCard
              url={publicUrl}
              title={form.title}
              description={form.description}
              durations={
                Array.isArray(form.durations) && form.durations.length
                  ? form.durations
                  : [form.length]
              }
              location={form.locations?.[0]?.kind}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function TwoCol({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[200px_1fr] md:items-start md:gap-6">
      <div className="pt-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label>{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

function DurationsEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (patch: any) => void;
}) {
  const durations: number[] = useMemo(() => {
    if (Array.isArray(value.durations) && value.durations.length > 0) {
      return value.durations;
    }
    return [value.length ?? 30];
  }, [value.durations, value.length]);
  const [inputMinutes, setInputMinutes] = useState(15);

  const addDuration = () => {
    if (!inputMinutes || inputMinutes <= 0) return;
    if (durations.includes(inputMinutes)) return;
    const next = [...durations, inputMinutes].sort((a, b) => a - b);
    onChange({ durations: next, length: next[0] });
  };

  const removeDuration = (mins: number) => {
    const next = durations.filter((d) => d !== mins);
    if (next.length === 0) return;
    onChange({ durations: next, length: next[0] });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {durations.map((d) => (
          <span
            key={d}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium"
          >
            {d}m
            {durations.length > 1 && (
              <button
                type="button"
                onClick={() => removeDuration(d)}
                className="rounded hover:bg-background"
                aria-label={`Remove ${d} minutes`}
              >
                <IconX className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          className="w-24"
          value={inputMinutes}
          onChange={(e) => setInputMinutes(Number(e.currentTarget.value))}
        />
        <span className="text-sm text-muted-foreground">minutes</span>
        <Button size="sm" variant="outline" onClick={addDuration}>
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

function LocationEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (patch: any) => void;
}) {
  const current: string = value.locations?.[0]?.kind ?? "cal-video";
  const options = [
    { kind: "cal-video", label: "Cal Video", Icon: IconVideo },
    { kind: "google-meet", label: "Google Meet", Icon: IconBrandGoogle },
    { kind: "zoom", label: "Zoom", Icon: IconBrandZoom },
    { kind: "teams", label: "Microsoft Teams", Icon: IconBrandTeams },
    { kind: "phone", label: "Phone call", Icon: IconPhone },
    { kind: "in-person", label: "In person", Icon: IconMapPin },
    { kind: "attendee-phone", label: "Attendee phone", Icon: IconUser },
    { kind: "link", label: "Custom link", Icon: IconLink },
  ];
  return (
    <Select
      value={current}
      onValueChange={(kind) => onChange({ locations: [{ kind }] })}
    >
      <SelectTrigger className="max-w-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.kind} value={o.kind}>
            <span className="flex items-center gap-2">
              <o.Icon className="h-4 w-4" />
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DurationWithUnit({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (v: number) => void;
}) {
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">(() => {
    if (minutes % (60 * 24) === 0 && minutes >= 60 * 24) return "days";
    if (minutes % 60 === 0 && minutes >= 60) return "hours";
    return "minutes";
  });
  const displayed =
    unit === "days"
      ? minutes / (60 * 24)
      : unit === "hours"
        ? minutes / 60
        : minutes;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        className="w-24"
        value={displayed}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          const factor = unit === "days" ? 60 * 24 : unit === "hours" ? 60 : 1;
          onChange(n * factor);
        }}
      />
      <Select value={unit} onValueChange={(v) => setUnit(v as any)}>
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minutes">Minutes</SelectItem>
          <SelectItem value="hours">Hours</SelectItem>
          <SelectItem value="days">Days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function BookingWindowEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (patch: any) => void;
}) {
  return (
    <div className="space-y-2">
      <Select
        value={value.periodType ?? "rolling"}
        onValueChange={(t) => onChange({ periodType: t })}
      >
        <SelectTrigger className="max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unlimited">Indefinitely</SelectItem>
          <SelectItem value="rolling">Rolling N days</SelectItem>
          <SelectItem value="range">Specific date range</SelectItem>
        </SelectContent>
      </Select>
      {(value.periodType ?? "rolling") === "rolling" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="w-24"
            value={value.periodDays ?? 60}
            onChange={(e) =>
              onChange({ periodDays: Number(e.currentTarget.value) })
            }
          />
          <span className="text-sm text-muted-foreground">
            days into the future
          </span>
        </div>
      )}
      {value.periodType === "range" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={value.periodStartDate ?? ""}
            onChange={(e) =>
              onChange({ periodStartDate: e.currentTarget.value || null })
            }
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={value.periodEndDate ?? ""}
            onChange={(e) =>
              onChange({ periodEndDate: e.currentTarget.value || null })
            }
          />
        </div>
      )}
    </div>
  );
}

function SeatsEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (patch: any) => void;
}) {
  const enabled = value.seatsPerTimeSlot != null && value.seatsPerTimeSlot > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange({ seatsPerTimeSlot: v ? 2 : null })}
        />
        <span className="text-sm text-muted-foreground">
          Allow multiple attendees per slot
        </span>
      </div>
      {enabled && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="w-24"
            value={value.seatsPerTimeSlot ?? 2}
            onChange={(e) =>
              onChange({ seatsPerTimeSlot: Number(e.currentTarget.value) })
            }
          />
          <span className="text-sm text-muted-foreground">seats per slot</span>
        </div>
      )}
    </div>
  );
}

function PrivateLinksEditor({ eventTypeId }: { eventTypeId: string }) {
  const [links, setLinks] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  const generate = async () => {
    setCreating(true);
    try {
      const res = await callAction("add-private-link", { eventTypeId });
      if (res?.link) setLinks([res.link, ...links]);
      toast.success("Private link created");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (hash: string) => {
    // The scheduling package exposes private links at /d/:hash/:slug
    navigator.clipboard?.writeText(`${location.origin}/d/${hash}`);
    toast.success("Private link copied");
  };

  const revoke = async (id: string) => {
    await callAction("revoke-private-link", { id });
    setLinks(links.filter((l) => l.id !== id));
    toast.success("Link revoked");
  };

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={generate}
        disabled={creating}
      >
        <IconPlus className="mr-1.5 h-3.5 w-3.5" />
        Generate private link
      </Button>
      {links.length > 0 && (
        <ul className="space-y-1 text-xs">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-md border border-border p-2"
            >
              <code className="flex-1 truncate">/d/{l.hash}</code>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => copyLink(l.hash)}
              >
                <IconCopy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => revoke(l.id)}
              >
                <IconTrash className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppsGrid({
  selected,
  onPick,
}: {
  selected?: string;
  onPick: (kind: string) => void;
}) {
  const apps = [
    {
      kind: "cal-video",
      name: "Cal Video",
      description: "Free, built-in video conferencing.",
      Icon: IconVideo,
    },
    {
      kind: "google-meet",
      name: "Google Meet",
      description: "Auto-generated Meet links.",
      Icon: IconBrandGoogle,
    },
    {
      kind: "zoom",
      name: "Zoom",
      description: "Sync Zoom meetings on booking.",
      Icon: IconBrandZoom,
    },
    {
      kind: "teams",
      name: "Microsoft Teams",
      description: "Create a Teams meeting per booking.",
      Icon: IconBrandTeams,
    },
    {
      kind: "phone",
      name: "Phone call",
      description: "Call using a phone number you enter.",
      Icon: IconPhone,
    },
    {
      kind: "in-person",
      name: "In person",
      description: "Share an address or venue.",
      Icon: IconMapPin,
    },
    {
      kind: "attendee-phone",
      name: "Attendee phone",
      description: "Collect the attendee's number.",
      Icon: IconUser,
    },
    {
      kind: "link",
      name: "Custom link",
      description: "Paste your own meeting URL.",
      Icon: IconLink,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {apps.map((a) => {
        const isSelected = selected === a.kind;
        return (
          <button
            key={a.kind}
            type="button"
            onClick={() => onPick(a.kind)}
            className={
              "flex items-start gap-3 rounded-md border p-3 text-left hover:bg-muted/40 " +
              (isSelected ? "border-foreground bg-muted/30" : "border-border")
            }
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <a.Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{a.name}</span>
                {isSelected && (
                  <Badge variant="secondary" className="text-[10px]">
                    Default
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {a.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PreviewCard({
  url,
  title,
  description,
  durations,
  location,
}: {
  url: string;
  title: string;
  description?: string | null;
  durations: number[];
  location?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <IconExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <div className="space-y-2">
        <div className="font-semibold">{title}</div>
        {description && (
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {durations.map((d) => (
            <Badge key={d} variant="secondary" className="text-[10px]">
              {d}m
            </Badge>
          ))}
          {location && (
            <Badge variant="outline" className="text-[10px]">
              {locationLabel(location)}
            </Badge>
          )}
        </div>
      </div>
      <Separator className="my-3" />
      <code className="block truncate text-[11px] text-muted-foreground">
        {url}
      </code>
    </div>
  );
}

function locationLabel(kind: string): string {
  switch (kind) {
    case "cal-video":
      return "Cal Video";
    case "google-meet":
      return "Google Meet";
    case "zoom":
      return "Zoom";
    case "teams":
      return "Teams";
    case "phone":
      return "Phone";
    case "in-person":
      return "In person";
    case "attendee-phone":
      return "Attendee phone";
    case "link":
      return "Custom link";
    default:
      return kind;
  }
}
