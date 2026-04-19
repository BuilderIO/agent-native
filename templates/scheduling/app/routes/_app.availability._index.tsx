import { useLoaderData, useRevalidator, Link } from "react-router";
import { useState } from "react";
import { listSchedules } from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import {
  IconClock,
  IconDotsVertical,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail() ?? "local@localhost";
  const schedules = await listSchedules(email);
  return { schedules };
}

export default function AvailabilityList() {
  const { schedules } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const create = async () => {
    if (!form.name) return;
    await callAction("create-schedule", form);
    toast.success("Schedule created");
    setOpen(false);
    setForm({ ...form, name: "" });
    rv.revalidate();
  };

  const setDefault = async (id: string) => {
    await callAction("set-default-schedule", { id });
    toast.success("Default schedule updated");
    rv.revalidate();
  };

  const remove = async (id: string) => {
    await callAction("delete-schedule", { id });
    toast.success("Schedule deleted");
    rv.revalidate();
  };

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Availability
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure times when you are available for bookings.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="mr-1.5 h-4 w-4" />
              New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a new schedule</DialogTitle>
              <DialogDescription>
                Create a new schedule for your availability.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="s-name">Name</Label>
                <Input
                  id="s-name"
                  placeholder="Working hours"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.currentTarget.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-tz">Timezone</Label>
                <Input
                  id="s-tz"
                  value={form.timezone}
                  onChange={(e) =>
                    setForm({ ...form, timezone: e.currentTarget.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} disabled={!form.name}>
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconClock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Create a schedule</h2>
            <p className="text-sm text-muted-foreground">
              A schedule tells your event types when to offer slots.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="mt-2">
            <IconPlus className="mr-1.5 h-4 w-4" />
            New schedule
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {schedules.map((s: any) => (
            <li
              key={s.id}
              className="flex items-start gap-3 p-4 hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/availability/${s.id}`}
                    className="truncate font-semibold hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.isDefault && (
                    <Badge
                      variant="secondary"
                      className="inline-flex items-center gap-1 text-[10px]"
                    >
                      <IconStarFilled className="h-2.5 w-2.5" />
                      Default
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {summarizeWeek(s.weeklyAvailability ?? [])} · {s.timezone}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="More"
                  >
                    <IconDotsVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/availability/${s.id}`}>Edit</Link>
                  </DropdownMenuItem>
                  {!s.isDefault && (
                    <DropdownMenuItem onClick={() => setDefault(s.id)}>
                      <IconStar className="mr-2 h-4 w-4" />
                      Set as default
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => remove(s.id)}
                  >
                    <IconTrash className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function summarizeWeek(weekly: { day: number; intervals: any[] }[]): string {
  if (!weekly || weekly.length === 0) return "Not configured";
  const active = new Set(
    weekly.filter((w) => w.intervals?.length > 0).map((w) => w.day),
  );
  if (active.size === 0) return "No hours set";
  return DAY_LABELS.map((d, i) => (active.has(i) ? d : d.toLowerCase())).join(
    " ",
  );
}
