import { useState } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../../server/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export function meta() {
  return [{ title: "Workflows — Scheduling" }];
}

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import {
  IconBolt,
  IconDotsVertical,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail();
  if (!email) throw new Response("Unauthenticated", { status: 401 });
  const rows = await getDb()
    .select()
    .from(schema.workflows)
    .where(accessFilter(schema.workflows, schema.workflowShares));
  return { workflows: rows };
}

const TRIGGER_LABELS: Record<string, string> = {
  "new-booking": "New booking",
  "before-event": "Before event",
  "after-event": "After event",
  reschedule: "Reschedule",
  cancellation: "Cancellation",
  "no-show": "No-show",
};

export default function WorkflowsIndex() {
  const { workflows } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "",
    trigger: "before-event",
  });

  const create = async () => {
    if (!form.name) return;
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

  const toggle = async (id: string, disabled: boolean) => {
    await callAction("toggle-workflow", { id, disabled: !disabled });
    rv.revalidate();
  };

  const remove = async (id: string) => {
    await callAction("delete-workflow", { id });
    toast.success("Workflow deleted");
    rv.revalidate();
  };

  useSetHeaderActions(
    <Button onClick={() => setOpen(true)} className="cursor-pointer">
      <IconPlus className="mr-1.5 h-4 w-4" />
      New
    </Button>,
  );

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new workflow</DialogTitle>
            <DialogDescription>
              Give your workflow a name and pick a trigger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="Send reminders 1 hour before"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.currentTarget.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select
                value={form.trigger}
                onValueChange={(v) => setForm({ ...form, trigger: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconBolt className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              Create your first workflow
            </h2>
            <p className="text-sm text-muted-foreground">
              Automate reminders, thank-yous, and more for your bookings.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="mt-2">
            <IconPlus className="mr-1.5 h-4 w-4" />
            New workflow
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {workflows.map((w: any) => {
            const activeOn = Array.isArray(w.activeOnEventTypeIds)
              ? w.activeOnEventTypeIds.length
              : 0;
            const stepCount = Array.isArray(w.steps) ? w.steps.length : 0;
            return (
              <li
                key={w.id}
                className="flex items-start gap-3 p-4 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/workflows/${w.id}`}
                      className="truncate font-semibold hover:underline"
                    >
                      {w.name}
                    </Link>
                    <Badge variant="outline" className="text-[10px]">
                      {TRIGGER_LABELS[w.trigger] ?? w.trigger}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {stepCount} step{stepCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Active on {activeOn} event type{activeOn === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={!w.disabled}
                    onCheckedChange={() => toggle(w.id, !!w.disabled)}
                    aria-label={`${w.disabled ? "Enable" : "Disable"} workflow ${w.name}`}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`More options for workflow ${w.name}`}
                      >
                        <IconDotsVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/workflows/${w.id}`}>Edit</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => remove(w.id)}
                      >
                        <IconTrash className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
