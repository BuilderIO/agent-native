import { useLoaderData, useRevalidator } from "react-router";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { getScheduleById } from "@agent-native/scheduling/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import { IconPlus, IconTrash } from "@tabler/icons-react";

export async function loader({ params }: LoaderFunctionArgs) {
  const schedule = await getScheduleById(params.id!);
  if (!schedule) throw new Response("Not found", { status: 404 });
  return { schedule };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ScheduleEditor() {
  const { schedule } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [weekly, setWeekly] = useState(() => {
    const byDay = new Map<number, { startTime: string; endTime: string }[]>();
    for (const w of schedule.weeklyAvailability) byDay.set(w.day, w.intervals);
    return DAYS.map((_, i) => ({ day: i, intervals: byDay.get(i) ?? [] }));
  });

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
  };

  const updateInterval = (dayI: number, ivI: number, patch: any) => {
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
  };

  const removeInterval = (dayI: number, ivI: number) => {
    setWeekly((prev) =>
      prev.map((w) =>
        w.day === dayI
          ? { ...w, intervals: w.intervals.filter((_, j) => j !== ivI) }
          : w,
      ),
    );
  };

  const save = async () => {
    await callAction("update-schedule", {
      id: schedule.id,
      weeklyAvailability: weekly.filter((w) => w.intervals.length > 0),
    });
    toast.success("Saved");
    rv.revalidate();
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{schedule.name}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Timezone: {schedule.timezone}
        </p>
      </header>
      <div className="space-y-3">
        {weekly.map((w) => (
          <div key={w.day} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={w.intervals.length > 0}
                  onCheckedChange={() => toggleDay(w.day)}
                />
                <span className="w-12 font-medium">{DAYS[w.day]}</span>
              </div>
              {w.intervals.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Unavailable
                </span>
              )}
            </div>
            {w.intervals.length > 0 && (
              <div className="mt-3 space-y-2 pl-14">
                {w.intervals.map((iv, ivI) => (
                  <div key={ivI} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={iv.startTime}
                      onChange={(e) =>
                        updateInterval(w.day, ivI, {
                          startTime: e.currentTarget.value,
                        })
                      }
                      className="w-28"
                    />
                    <span>–</span>
                    <Input
                      type="time"
                      value={iv.endTime}
                      onChange={(e) =>
                        updateInterval(w.day, ivI, {
                          endTime: e.currentTarget.value,
                        })
                      }
                      className="w-28"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeInterval(w.day, ivI)}
                      aria-label="Remove interval"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => addInterval(w.day)}
                >
                  <IconPlus className="mr-1 h-3.5 w-3.5" />
                  Add interval
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
