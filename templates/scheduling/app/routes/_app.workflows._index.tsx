import { useState } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import { eq } from "drizzle-orm";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../../server/db";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import { IconPlus } from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail() ?? "local@localhost";
  const rows = await getDb()
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.ownerEmail, email));
  return { workflows: rows };
}

export default function WorkflowsIndex() {
  const { workflows } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "",
    trigger: "before-event",
  });
  const create = async () => {
    await callAction("create-workflow", {
      name: form.name,
      trigger: form.trigger,
      activeOnEventTypeIds: [],
      steps: [
        {
          action: "email-attendee",
          offsetMinutes: 60,
          emailSubject: "Reminder: {eventName}",
          emailBody:
            "Hi {attendeeName}, this is a reminder about {eventName} at {startTime}. See you there!",
        },
      ],
    });
    toast.success("Workflow created");
    setOpen(false);
    setForm({ name: "", trigger: "before-event" });
    rv.revalidate();
  };
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send reminders, follow-ups, and webhooks on booking lifecycle
            events.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="mr-2 h-4 w-4" />
              New workflow
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New workflow</DialogTitle>
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
                <Label>Trigger</Label>
                <Select
                  value={form.trigger}
                  onValueChange={(v) => setForm({ ...form, trigger: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new-booking">New booking</SelectItem>
                    <SelectItem value="before-event">Before event</SelectItem>
                    <SelectItem value="after-event">After event</SelectItem>
                    <SelectItem value="reschedule">Reschedule</SelectItem>
                    <SelectItem value="cancellation">Cancellation</SelectItem>
                    <SelectItem value="no-show">No-show</SelectItem>
                  </SelectContent>
                </Select>
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
      {workflows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No workflows yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {workflows.map((w: any) => (
            <li
              key={w.id}
              className="flex items-center justify-between rounded-md border border-border p-4"
            >
              <div>
                <Link
                  to={`/workflows/${w.id}`}
                  className="font-medium hover:underline"
                >
                  {w.name}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  Trigger: {w.trigger}
                </div>
              </div>
              <Badge variant={w.disabled ? "secondary" : "default"}>
                {w.disabled ? "Disabled" : "Active"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
