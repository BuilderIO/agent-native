import { useLoaderData, useRevalidator } from "react-router";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { getEventTypeById } from "@agent-native/scheduling/server";
import { callAction } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export async function loader({ params }: LoaderFunctionArgs) {
  const eventType = await getEventTypeById(params.id!);
  if (!eventType) throw new Response("Not found", { status: 404 });
  return { eventType };
}

export default function EventTypeEditor() {
  const { eventType } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [form, setForm] = useState(eventType);
  const [saving, setSaving] = useState(false);

  const save = async (patch: any) => {
    setSaving(true);
    try {
      await callAction("update-event-type", { id: eventType.id, ...patch });
      toast.success("Saved");
      rv.revalidate();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{eventType.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          /{eventType.ownerEmail}/{eventType.slug}
        </p>
      </header>
      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="limits">Limits</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          <TabsTrigger value="apps">Apps</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-4 pt-4">
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(e) =>
                setForm({ ...form, title: e.currentTarget.value })
              }
              onBlur={() => save({ title: form.title })}
            />
          </Field>
          <Field label="Slug">
            <Input
              value={form.slug}
              onChange={(e) =>
                setForm({ ...form, slug: e.currentTarget.value })
              }
              onBlur={() => save({ slug: form.slug })}
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={form.description ?? ""}
              onChange={(e) =>
                setForm({ ...form, description: e.currentTarget.value })
              }
              onBlur={() => save({ description: form.description })}
            />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              value={form.length}
              onChange={(e) =>
                setForm({ ...form, length: Number(e.currentTarget.value) })
              }
              onBlur={() => save({ length: form.length })}
            />
          </Field>
          <Field label="Scheduling type">
            <Select
              value={form.schedulingType}
              onValueChange={(v) => save({ schedulingType: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="collective">Collective (team)</SelectItem>
                <SelectItem value="round-robin">Round-robin (team)</SelectItem>
                <SelectItem value="managed">Managed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </TabsContent>

        <TabsContent value="availability" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Using default schedule. Pick a specific schedule at /availability.
          </p>
        </TabsContent>

        <TabsContent value="limits" className="space-y-4 pt-4">
          <Field label="Minimum booking notice (minutes)">
            <Input
              type="number"
              value={form.minimumBookingNotice}
              onChange={(e) =>
                setForm({
                  ...form,
                  minimumBookingNotice: Number(e.currentTarget.value),
                })
              }
              onBlur={() =>
                save({ minimumBookingNotice: form.minimumBookingNotice })
              }
            />
          </Field>
          <Field label="Before-event buffer (minutes)">
            <Input
              type="number"
              value={form.beforeEventBuffer}
              onChange={(e) =>
                setForm({
                  ...form,
                  beforeEventBuffer: Number(e.currentTarget.value),
                })
              }
              onBlur={() => save({ beforeEventBuffer: form.beforeEventBuffer })}
            />
          </Field>
          <Field label="After-event buffer (minutes)">
            <Input
              type="number"
              value={form.afterEventBuffer}
              onChange={(e) =>
                setForm({
                  ...form,
                  afterEventBuffer: Number(e.currentTarget.value),
                })
              }
              onBlur={() => save({ afterEventBuffer: form.afterEventBuffer })}
            />
          </Field>
          <Field label="Booking window (rolling days)">
            <Input
              type="number"
              value={form.periodDays ?? 60}
              onChange={(e) =>
                setForm({ ...form, periodDays: Number(e.currentTarget.value) })
              }
              onBlur={() => save({ periodDays: form.periodDays })}
            />
          </Field>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <Label>Requires confirmation</Label>
            <Switch
              checked={form.requiresConfirmation}
              onCheckedChange={(v) => save({ requiresConfirmation: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Disable guests</Label>
            <Switch
              checked={form.disableGuests}
              onCheckedChange={(v) => save({ disableGuests: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Hide from public profile</Label>
            <Switch
              checked={form.hidden}
              onCheckedChange={(v) => save({ hidden: v })}
            />
          </div>
          <Field label="Redirect URL after booking">
            <Input
              value={form.successRedirectUrl ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  successRedirectUrl: e.currentTarget.value,
                })
              }
              onBlur={() =>
                save({ successRedirectUrl: form.successRedirectUrl || null })
              }
            />
          </Field>
        </TabsContent>

        <TabsContent value="apps" className="pt-4">
          <p className="text-sm text-muted-foreground">
            Location picker coming soon. Default: Cal Video.
          </p>
        </TabsContent>

        <TabsContent value="workflows" className="pt-4">
          <p className="text-sm text-muted-foreground">
            Attach workflows from{" "}
            <a href="/workflows" className="underline">
              Workflows
            </a>
            .
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
