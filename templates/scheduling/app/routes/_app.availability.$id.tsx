import { useLoaderData, useRevalidator, Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { getScheduleById } from "@agent-native/scheduling/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import {
  IconArrowLeft,
  IconCalendarPlus,
  IconCopy,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { format, parseISO } from "date-fns";

export async function loader({ params }: LoaderFunctionArgs) {
  const schedule = await getScheduleById(params.id!);
  if (!schedule) throw new Response("Not found", { status: 404 });
  return { schedule };
}

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type Interval = { startTime: string; endTime: string };
type DayRow = { day: number; intervals: Interval[] };

export default function ScheduleEditor() {
  const { schedule } = useLoaderData<typeof loader>();
  const rv = useRevalidator();

  const [name, setName] = useState(schedule.name);
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [weekly, setWeekly] = useState<DayRow[]>(() => {
    const byDay = new Map<number, Interval[]>();
    for (const w of schedule.weeklyAvailability) byDay.set(w.day, w.intervals);
    return DAY_LABELS.map((_, i) => ({
      day: i,
      intervals: byDay.get(i) ?? [],
    }));
  });
  const [overrides, setOverrides] = useState<
    { date: string; intervals: Interval[] }[]
  >(schedule.dateOverrides ?? []);
  const [savedState, setSavedState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    setSavedState("saving");
    const t = setTimeout(() => {
      void save();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekly, overrides, name, timezone, dirty]);

  const save = async () => {
    try {
      await callAction("update-schedule", {
        id: schedule.id,
        name,
        timezone,
        weeklyAvailability: weekly.filter((w) => w.intervals.length > 0),
        dateOverrides: overrides,
      });
      setSavedState("saved");
      setDirty(false);
      setTimeout(() => setSavedState("idle"), 1500);
      rv.revalidate();
    } catch (err: any) {
      toast.error(err.message);
      setSavedState("idle");
    }
  };

  const touch = () => setDirty(true);

  const toggleDay = (i: number) => {
    setWeekly((prev) =>
      prev.map((w) =>
        w.day === i
          ? {
              ...w,
              intervals:
                w.intervals.length > 0
                  ? []
                  : [{ startTime: "09:00", endTime: "17:00" }],
            }
          : w,
      ),
    );
    touch();
  };

  const updateInterval = (
    dayI: number,
    ivI: number,
    patch: Partial<Interval>,
  ) => {
    setWeekly((prev) =>
      prev.map((w) =>
        w.day === dayI
          ? {
              ...w,
              intervals: w.intervals.map((iv, j) =>
                j === ivI ? { ...iv, ...patch } : iv,
              ),
            }
          : w,
      ),
    );
    touch();
  };

  const addInterval = (dayI: number) => {
    setWeekly((prev) =>
      prev.map((w) =>
        w.day === dayI
          ? {
              ...w,
              intervals: [
                ...w.intervals,
                { startTime: "13:00", endTime: "17:00" },
              ],
            }
          : w,
      ),
    );
    touch();
  };

  const removeInterval = (dayI: number, ivI: number) => {
    setWeekly((prev) =>
      prev.map((w) =>
        w.day === dayI
          ? { ...w, intervals: w.intervals.filter((_, j) => j !== ivI) }
          : w,
      ),
    );
    touch();
  };

  const copyTimesTo = (sourceDay: number, targetDays: number[]) => {
    setWeekly((prev) =>
      prev.map((w) =>
        targetDays.includes(w.day)
          ? {
              ...w,
              intervals: [...(prev[sourceDay]?.intervals ?? [])].map((iv) => ({
                ...iv,
              })),
            }
          : w,
      ),
    );
    touch();
  };

  const addOverride = (date: string) => {
    if (overrides.find((o) => o.date === date)) return;
    setOverrides([
      ...overrides,
      { date, intervals: [{ startTime: "09:00", endTime: "17:00" }] },
    ]);
    touch();
  };

  const removeOverride = (date: string) => {
    setOverrides(overrides.filter((o) => o.date !== date));
    touch();
  };

  const toggleOverride = (date: string) => {
    setOverrides((prev) =>
      prev.map((o) =>
        o.date === date
          ? {
              ...o,
              intervals:
                o.intervals.length === 0
                  ? [{ startTime: "09:00", endTime: "17:00" }]
                  : [],
            }
          : o,
      ),
    );
    touch();
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-5">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link to="/availability">
            <IconArrowLeft className="mr-1.5 h-4 w-4" />
            Availability
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                touch();
              }}
              className="-mx-2 border-0 bg-transparent px-2 text-2xl font-semibold tracking-tight shadow-none focus-visible:bg-muted/40 focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {savedState === "saving" && <span>Saving…</span>}
            {savedState === "saved" && <span>Saved</span>}
            <div className="flex items-center gap-2">
              <Switch
                checked={schedule.isDefault}
                onCheckedChange={async (v) => {
                  if (!v) return;
                  await callAction("set-default-schedule", { id: schedule.id });
                  toast.success("Default schedule updated");
                  rv.revalidate();
                }}
              />
              <span>Set as default</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Weekly hours</CardTitle>
            <CardDescription>
              Set the times you are available each week.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekly.map((w) => (
              <DayRow
                key={w.day}
                day={w}
                onToggle={() => toggleDay(w.day)}
                onUpdate={(ivI, patch) => updateInterval(w.day, ivI, patch)}
                onAdd={() => addInterval(w.day)}
                onRemove={(ivI) => removeInterval(w.day, ivI)}
                onCopyTo={(target) => copyTimesTo(w.day, target)}
                weekly={weekly}
              />
            ))}
          </CardContent>
        </Card>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Timezone</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.currentTarget.value);
                  touch();
                }}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Used when calculating slots for visitors in other timezones.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Date overrides</CardTitle>
                <OverrideDatePicker
                  onPick={(date) => addOverride(date)}
                  existing={overrides.map((o) => o.date)}
                />
              </div>
              <CardDescription>
                Override availability on specific dates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {overrides.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No overrides. Add one for holidays or one-off availability.
                </p>
              ) : (
                overrides
                  .slice()
                  .sort((a, b) => (a.date < b.date ? -1 : 1))
                  .map((o) => (
                    <OverrideRow
                      key={o.date}
                      override={o}
                      onToggle={() => toggleOverride(o.date)}
                      onRemove={() => removeOverride(o.date)}
                      onUpdateIntervals={(intervals) => {
                        setOverrides((prev) =>
                          prev.map((x) =>
                            x.date === o.date ? { ...x, intervals } : x,
                          ),
                        );
                        touch();
                      }}
                    />
                  ))
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DayRow({
  day,
  onToggle,
  onUpdate,
  onAdd,
  onRemove,
  onCopyTo,
  weekly,
}: {
  day: DayRow;
  onToggle: () => void;
  onUpdate: (ivI: number, patch: Partial<Interval>) => void;
  onAdd: () => void;
  onRemove: (ivI: number) => void;
  onCopyTo: (targetDays: number[]) => void;
  weekly: DayRow[];
}) {
  const isActive = day.intervals.length > 0;
  return (
    <div className="flex items-start gap-4 rounded-md border border-border p-3">
      <div className="flex w-28 shrink-0 items-center gap-3 pt-1.5">
        <Switch checked={isActive} onCheckedChange={onToggle} />
        <span className="text-sm font-medium">{DAY_LABELS[day.day]}</span>
      </div>
      {isActive ? (
        <div className="flex-1 space-y-1.5">
          {day.intervals.map((iv, ivI) => (
            <div key={ivI} className="flex items-center gap-2">
              <Input
                type="time"
                value={iv.startTime}
                onChange={(e) =>
                  onUpdate(ivI, { startTime: e.currentTarget.value })
                }
                className="w-28"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="time"
                value={iv.endTime}
                onChange={(e) =>
                  onUpdate(ivI, { endTime: e.currentTarget.value })
                }
                className="w-28"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => onRemove(ivI)}
                aria-label="Remove interval"
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 pt-1.5">
          <span className="text-sm text-muted-foreground">Unavailable</span>
        </div>
      )}
      <div className="flex items-center gap-1 pt-0.5">
        {isActive && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={onAdd}
            aria-label="Add interval"
          >
            <IconPlus className="h-4 w-4" />
          </Button>
        )}
        {isActive && (
          <CopyTimesToPopover
            sourceDay={day.day}
            weekly={weekly}
            onApply={onCopyTo}
          />
        )}
      </div>
    </div>
  );
}

function CopyTimesToPopover({
  sourceDay,
  weekly,
  onApply,
}: {
  sourceDay: number;
  weekly: DayRow[];
  onApply: (days: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  // Reset when opened
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const toggle = (d: number) => {
    setSelected((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const apply = () => {
    if (selected.length > 0) onApply(selected);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Copy times to other days"
        >
          <IconCopy className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="mb-2 text-sm font-semibold">Copy times to…</div>
        <div className="space-y-2">
          {weekly.map((w) => {
            if (w.day === sourceDay) return null;
            return (
              <label
                key={w.day}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={selected.includes(w.day)}
                  onCheckedChange={() => toggle(w.day)}
                />
                <span>{DAY_LABELS[w.day]}</span>
              </label>
            );
          })}
        </div>
        <Separator className="my-3" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={selected.length === 0}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OverrideDatePicker({
  onPick,
  existing,
}: {
  onPick: (iso: string) => void;
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <IconCalendarPlus className="mr-1.5 h-4 w-4" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          onSelect={(d) => {
            if (!d) return;
            const iso = format(d, "yyyy-MM-dd");
            if (existingSet.has(iso)) {
              toast.error("Already an override for this date");
              return;
            }
            onPick(iso);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function OverrideRow({
  override,
  onToggle,
  onRemove,
  onUpdateIntervals,
}: {
  override: { date: string; intervals: Interval[] };
  onToggle: () => void;
  onRemove: () => void;
  onUpdateIntervals: (intervals: Interval[]) => void;
}) {
  const isActive = override.intervals.length > 0;
  const date = parseISO(override.date);
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {format(date, "EEE, MMM d, yyyy")}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {isActive ? "Custom hours" : "Unavailable"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Switch checked={isActive} onCheckedChange={onToggle} />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onRemove}
            aria-label="Remove override"
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {isActive && (
        <div className="mt-2 space-y-1.5">
          {override.intervals.map((iv, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                type="time"
                value={iv.startTime}
                className="h-8 w-24 text-xs"
                onChange={(e) => {
                  const next = override.intervals.map((x, j) =>
                    j === i ? { ...x, startTime: e.currentTarget.value } : x,
                  );
                  onUpdateIntervals(next);
                }}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="time"
                value={iv.endTime}
                className="h-8 w-24 text-xs"
                onChange={(e) => {
                  const next = override.intervals.map((x, j) =>
                    j === i ? { ...x, endTime: e.currentTarget.value } : x,
                  );
                  onUpdateIntervals(next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
