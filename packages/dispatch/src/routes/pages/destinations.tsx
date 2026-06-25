import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { useState } from "react";
import { toast } from "sonner";

import { DispatchShell } from "@/components/dispatch-shell";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function meta() {
  return [{ title: "Destinations — Dispatch" }];
}

function QuickSendRow({
  destination,
}: {
  destination: { id: string; name: string };
}) {
  const t = useT();
  const [text, setText] = useState("");
  const send = useActionMutation("send-platform-message", {
    onSuccess: () => {
      toast.success(t("dispatch.pages.messageSent"));
      setText("");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t("dispatch.pages.unableToSendMessage"),
      );
    },
  });
  return (
    <div className="mt-3 flex gap-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("dispatch.pages.quickTestMessage")}
      />
      <Button
        onClick={() =>
          send.mutate({
            destinationId: destination.id,
            text: text || `Test message to ${destination.name}`,
          })
        }
        disabled={send.isPending}
      >
        {t("dispatch.pages.send")}
      </Button>
    </div>
  );
}

export default function DestinationsRoute() {
  const t = useT();
  const { data } = useActionQuery("list-destinations", {});
  const [form, setForm] = useState({
    name: "",
    platform: "slack",
    destination: "",
    threadRef: "",
    notes: "",
  });

  const upsert = useActionMutation("upsert-destination", {
    onSuccess: () => {
      toast.success(t("dispatch.pages.destinationSaved"));
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
    onSuccess: () => toast.success(t("dispatch.pages.destinationRemoved")),
  });

  return (
    <DispatchShell
      title={t("dispatch.nav.destinations")}
      description={t("dispatch.pages.destinationsDescription")}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            {t("dispatch.pages.savedDestinations")}
          </h2>
          <div className="mt-4 space-y-3">
            {(data || []).map((destination: any) => (
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
                        {t("dispatch.pages.delete")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("dispatch.pages.deleteDestinationTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("dispatch.pages.deleteDestinationDescription", {
                            name: destination.name,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t("dispatch.pages.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove.mutate({ id: destination.id })}
                        >
                          {t("dispatch.pages.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <QuickSendRow destination={destination} />
              </div>
            ))}
            {(data?.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                {t("dispatch.pages.noDestinations")}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">
            {t("dispatch.pages.addDestination")}
          </h2>
          <div className="mt-4 space-y-3">
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t("dispatch.pages.dailyDigestChannel")}
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
                <SelectItem value="email">Email</SelectItem>
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
                form.platform === "slack"
                  ? "C0123456789"
                  : form.platform === "email"
                    ? "teammate+qa@agent-native.test"
                    : "123456789"
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
              placeholder={t("dispatch.pages.optionalThreadOrTopicId")}
            />
            <Textarea
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder={t("dispatch.pages.destinationNotes")}
            />
            <Button
              className="w-full"
              onClick={() =>
                upsert.mutate({
                  name: form.name,
                  platform: form.platform as "slack" | "telegram" | "email",
                  destination: form.destination,
                  threadRef: form.threadRef || undefined,
                  notes: form.notes || undefined,
                })
              }
              disabled={!form.name || !form.destination}
            >
              {t("dispatch.pages.saveDestination")}
            </Button>
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
