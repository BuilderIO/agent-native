import { useLoaderData, useRevalidator, Link } from "react-router";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { getEventTypeById } from "@agent-native/scheduling/server";

export function meta() {
  return [{ title: "Edit event type — Scheduling" }];
}

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
import { AgentToggleButton } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconBrandGoogle,
  IconBrandTeams,
  IconBrandZoom,
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
import {
  ConferencingSelector,
  type ConferencingValue,
  CustomFieldsEditor,
  DurationPicker,
  SlugEditor,
} from "@agent-native/scheduling/react/components";

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
            <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
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
                  hint="Click to edit — changes apply immediately."
                >
                  <SlugEditor
                    host={
                      typeof window !== "undefined"
                        ? window.location.host
                        : "scheduling.app"
                    }
                    username={eventType.ownerEmail}
                    slug={form.slug}
                    onSlugChange={(slug) => {
                      setForm({ ...form, slug });
                      save({ slug });
                    }}
                    hideLabel
                  />
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
                  <DurationPicker
                    value={
                      Array.isArray(form.durations) && form.durations.length
                        ? form.durations
                        : [form.length ?? 30]
                    }
                    onChange={(durations) => {
                      const patch = {
                        durations,
                        length: durations[0],
                      };
                      setForm({ ...form, ...patch });
                      save(patch);
                    }}
                  />
                </TwoCol>
                <Separator />
                <TwoCol
                  label="Conferencing"
                  hint="How you'll meet attendees. Zoom auto-creates a meeting per booking."
                >
                  <ConferencingSelector
                    value={locationToConferencing(form.locations?.[0]?.kind)}
                    onChange={(next) => {
                      const locations = [conferencingToLocation(next)];
                      setForm({ ...form, locations });
                      save({ locations });
                    }}
                    hideLabel
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
                  label="Booking form"
                  hint="Custom fields shown to the booker on the booking page."
                >
                  <CustomFieldsEditor
                    fields={
                      Array.isArray(form.customFields) ? form.customFields : []
                    }
                    onChange={(fields) => {
                      setForm({ ...form, customFields: fields });
                      save({ customFields: fields });
                    }}
                    hideLabel
                  />
                </TwoCol>
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

/**
 * Map scheduling's `locations: [{kind}]` representation to the shared
 * ConferencingSelector's `{type, url?}` shape. Kinds outside the four
 * canonical conferencing options collapse to "none".
 */
function locationToConferencing(kind?: string): ConferencingValue {
  if (kind === "google-meet") return { type: "google_meet" };
  if (kind === "zoom") return { type: "zoom" };
  if (kind === "link") return { type: "custom" };
  return { type: "none" };
}

function conferencingToLocation(v: ConferencingValue): {
  kind: string;
  url?: string;
} {
  if (v.type === "google_meet") return { kind: "google-meet" };
  if (v.type === "zoom") return { kind: "zoom" };
  if (v.type === "custom") return { kind: "link", url: v.url };
  return { kind: "in-person" };
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
    case "builtin-video":
      return "Video call";
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
