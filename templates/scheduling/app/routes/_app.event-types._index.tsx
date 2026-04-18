import { useLoaderData, Link, useRevalidator } from "react-router";
import { useState } from "react";
import { listEventTypes } from "@agent-native/scheduling/server";
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
import { toast } from "sonner";
import { callAction } from "@/lib/api";
import {
  IconPlus,
  IconClock,
  IconCopy,
  IconDotsVertical,
} from "@tabler/icons-react";

export async function loader() {
  const email = getRequestUserEmail() ?? "local@localhost";
  const eventTypes = await listEventTypes({
    ownerEmail: email,
    includeHidden: true,
  });
  return { eventTypes, ownerEmail: email };
}

export default function EventTypesPage() {
  const { eventTypes, ownerEmail } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", slug: "", length: 30 });

  const create = async () => {
    if (!form.title || !form.slug) return;
    await callAction("create-event-type", form);
    toast.success("Event type created");
    setOpen(false);
    setForm({ title: "", slug: "", length: 30 });
    rv.revalidate();
  };

  const copyLink = (slug: string) => {
    const url = `${location.origin}/${ownerEmail}/${slug}`;
    navigator.clipboard?.writeText(url);
    toast.success("Link copied");
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Event Types</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Definitions people can book. Share a link to your availability.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <IconPlus className="mr-2 h-4 w-4" />
              New event type
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New event type</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.currentTarget.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="slug">URL slug</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      slug: e.currentTarget.value.toLowerCase(),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  /{ownerEmail}/{form.slug || "..."}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="length">Duration (minutes)</Label>
                <Input
                  id="length"
                  type="number"
                  value={form.length}
                  onChange={(e) =>
                    setForm({ ...form, length: Number(e.currentTarget.value) })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} disabled={!form.title || !form.slug}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {eventTypes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No event types yet. Create one to share a booking link.
        </div>
      ) : (
        <ul className="space-y-2">
          {eventTypes.map((et: any) => (
            <li
              key={et.id}
              className="flex items-start justify-between rounded-md border border-border bg-card p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/event-types/${et.id}`}
                    className="font-medium hover:underline"
                  >
                    {et.title}
                  </Link>
                  {et.hidden && <Badge variant="secondary">Hidden</Badge>}
                  <Badge variant="outline" className="text-xs">
                    <IconClock className="mr-1 h-3 w-3" />
                    {et.length}m
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  /{ownerEmail}/{et.slug}
                </div>
                {et.description && (
                  <div className="mt-2 text-sm text-muted-foreground">
                    {et.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Copy booking link"
                  onClick={() => copyLink(et.slug)}
                >
                  <IconCopy className="h-4 w-4" />
                </Button>
                <Button asChild size="icon" variant="ghost">
                  <Link to={`/event-types/${et.id}`} aria-label="Edit">
                    <IconDotsVertical className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
