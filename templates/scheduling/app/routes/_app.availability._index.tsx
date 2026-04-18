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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import { IconPlus } from "@tabler/icons-react";

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
    await callAction("create-schedule", form);
    toast.success("Schedule created");
    setOpen(false);
    setForm({ name: "", timezone: form.timezone });
    rv.revalidate();
  };
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Availability
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly hours and date overrides that event types reference.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="mr-2 h-4 w-4" />
              New schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New schedule</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.currentTarget.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Timezone</Label>
                <Input
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
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>
      {schedules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No schedules yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s: any) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border border-border p-4"
            >
              <div>
                <Link
                  to={`/availability/${s.id}`}
                  className="font-medium hover:underline"
                >
                  {s.name}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.timezone}
                </div>
              </div>
              {s.isDefault && <Badge>Default</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
