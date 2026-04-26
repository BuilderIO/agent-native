import { useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import { DispatchShell } from "@/components/dispatch-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export function meta() {
  return [{ title: "Destinations — Dispatch" }];
}

export default function DestinationsRoute() {
  const { data } = useActionQuery("list-destinations", {});
  const [form, setForm] = useState({
    name: "",
    platform: "slack",
    destination: "",
    threadRef: "",
    notes: "",
    text: "",
  });

  const upsert = useActionMutation("upsert-destination", {
    onSuccess: () => {
      toast.success("Destination saved");
      setForm((current) => ({
        ...current,
        name: "",
        destination: "",
        threadRef: "",
        notes: "",
      }));
    },
  });
  const remove = useActionMutation("delete-destination", {
    onSuccess: () => toast.success("Destination removed"),
  });
  const send = useActionMutation("send-platform-message", {
    onSuccess: () => toast.success("Message sent"),
  });

  return (
    <DispatchShell
      title="Destinations"
      description="Saved outbound Slack channels, Telegram chats, and thread targets."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Saved destinations
          </h2>
          <div className="mt-4 space-y-3">
            {(data || []).map((destination) => (
              <div
                key={destination.id}
                className="rounded-xl border bg-muted/30 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {destination.name}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {destination.platform} · {destination.destination}
                      {destination.threadRef
                        ? ` · thread ${destination.threadRef}`
                        : ""}
                    </div>
                    {destination.notes && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {destination.notes}
                      </p>
                    )}
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete destination?</AlertDialogTitle>
                        <AlertDialogDescription>
                          “{destination.name}” will be removed. Any saved
                          workflows or jobs that target this destination will
                          start failing on the next send.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove.mutate({ id: destination.id })}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={form.text}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        text: event.target.value,
                      }))
                    }
                    placeholder="Quick test message"
                  />
                  <Button
                    onClick={() =>
                      send.mutate({
                        destinationId: destination.id,
                        text:
                          form.text || `Test message to ${destination.name}`,
                      })
                    }
                  >
                    Send
                  </Button>
                </div>
              </div>
            ))}
            {(data?.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                No destinations saved yet. Add your first Slack channel or
                Telegram chat on the right.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Add destination
          </h2>
          <div className="mt-4 space-y-3">
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Daily digest channel"
            />
            <Select
              value={form.platform}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  platform: value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={form.destination}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  destination: event.target.value,
                }))
              }
              placeholder={
                form.platform === "slack" ? "C0123456789" : "123456789"
              }
            />
            <Input
              value={form.threadRef}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  threadRef: event.target.value,
                }))
              }
              placeholder="Optional thread or topic id"
            />
            <Textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="What should use this destination?"
            />
            <Button
              className="w-full"
              onClick={() =>
                upsert.mutate({
                  name: form.name,
                  platform: form.platform as "slack" | "telegram",
                  destination: form.destination,
                  threadRef: form.threadRef || undefined,
                  notes: form.notes || undefined,
                })
              }
              disabled={!form.name || !form.destination}
            >
              Save destination
            </Button>
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
