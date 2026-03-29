import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  Link2,
  Plus,
  TimerReset,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useBookingLinks,
  useCreateBookingLink,
  useDeleteBookingLink,
  useUpdateBookingLink,
} from "@/hooks/use-booking-links";

const DURATION_PRESETS = [15, 30, 45, 60];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type DraftLink = {
  id?: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  isActive: boolean;
};

export default function BookingLinksPage() {
  const { data: bookingLinks = [], isLoading } = useBookingLinks();
  const createBookingLink = useCreateBookingLink();
  const updateBookingLink = useUpdateBookingLink();
  const deleteBookingLink = useDeleteBookingLink();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLink>({
    title: "",
    slug: "",
    description: "",
    duration: 30,
    isActive: true,
  });

  useEffect(() => {
    if (!bookingLinks.length) return;
    if (!selectedId || !bookingLinks.some((link) => link.id === selectedId)) {
      setSelectedId(bookingLinks[0].id);
    }
  }, [bookingLinks, selectedId]);

  const selectedLink = useMemo(
    () => bookingLinks.find((link) => link.id === selectedId) ?? null,
    [bookingLinks, selectedId],
  );

  useEffect(() => {
    if (!selectedLink) {
      setDraft({
        title: "",
        slug: "",
        description: "",
        duration: 30,
        isActive: true,
      });
      return;
    }

    setDraft({
      id: selectedLink.id,
      title: selectedLink.title,
      slug: selectedLink.slug,
      description: selectedLink.description || "",
      duration: selectedLink.duration,
      isActive: selectedLink.isActive,
    });
  }, [selectedLink]);

  const previewUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/book/${draft.slug}`;

  async function handleCreate() {
    const baseTitle = `New ${bookingLinks.length + 1 > 1 ? "Meeting Link" : "Meeting"}`;
    const baseSlug = slugify(`meeting-${bookingLinks.length + 1}`);
    try {
      const created = await createBookingLink.mutateAsync({
        title: baseTitle,
        slug: baseSlug,
        description: "A new public booking page.",
        duration: 30,
        isActive: true,
      });
      setSelectedId(created.id);
      toast.success("Booking link created");
    } catch {
      toast.error("Failed to create booking link");
    }
  }

  async function handleSave() {
    if (!draft.id) return;
    try {
      await updateBookingLink.mutateAsync({
        id: draft.id,
        title: draft.title.trim(),
        slug: slugify(draft.slug),
        description: draft.description.trim(),
        duration: draft.duration,
        isActive: draft.isActive,
      });
      toast.success("Booking link updated");
    } catch {
      toast.error("Failed to update booking link");
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    if (!window.confirm("Delete this booking link?")) return;
    try {
      await deleteBookingLink.mutateAsync(draft.id);
      setSelectedId(null);
      toast.success("Booking link deleted");
    } catch {
      toast.error("Failed to delete booking link");
    }
  }

  async function copyPreviewUrl(slug: string) {
    const url = `${window.location.origin}/book/${slug}`;
    await navigator.clipboard.writeText(url);
    toast.success("Booking link copied");
  }

  function openPreview(slug: string) {
    window.open(`/book/${slug}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booking Links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create named meeting types with their own duration and public link,
            then preview or share each one.
          </p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New booking link
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle className="text-lg">Meeting Types</CardTitle>
            <CardDescription>One public URL per meeting type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading links...</p>
            ) : bookingLinks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <p className="font-medium">No booking links yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first link to publish a schedulable meeting type.
                </p>
              </div>
            ) : (
              bookingLinks.map((link) => {
                const isSelected = link.id === selectedId;
                return (
                  <div
                    key={link.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(link.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(link.id);
                      }
                    }}
                    className={cn(
                      "w-full cursor-pointer rounded-2xl border p-4 text-left transition-all",
                      isSelected
                        ? "border-primary/25 bg-primary/[0.06] shadow-sm"
                        : "border-border/70 bg-card hover:border-border hover:bg-muted/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{link.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              /book/{link.slug}
                            </p>
                          </div>
                        </div>
                      </div>
                      <Badge variant={link.isActive ? "default" : "secondary"}>
                        {link.isActive ? "Live" : "Hidden"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <TimerReset className="h-3.5 w-3.5" />
                      {link.duration} minutes
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(link.slug);
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Preview
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyPreviewUrl(link.slug);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy link
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/60 bg-muted/20">
            <CardTitle className="text-lg">Configure Link</CardTitle>
            <CardDescription>
              Give the link a public name, choose its duration, and preview the
              exact URL people will use to book you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            {!selectedLink ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <p className="font-medium">Select a booking link</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a link on the left to edit it, or create a new one.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="booking-link-title">Link name</Label>
                    <Input
                      id="booking-link-title"
                      value={draft.title}
                      onChange={(e) => {
                        const title = e.target.value;
                        setDraft((prev) => ({
                          ...prev,
                          title,
                          slug:
                            prev.slug === slugify(prev.title)
                              ? slugify(title)
                              : prev.slug,
                        }));
                      }}
                      placeholder="30 Minute Intro"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="booking-link-slug">URL slug</Label>
                    <Input
                      id="booking-link-slug"
                      value={draft.slug}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          slug: slugify(e.target.value),
                        }))
                      }
                      placeholder="intro-call"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="booking-link-description">Description</Label>
                  <Textarea
                    id="booking-link-description"
                    rows={3}
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="A quick intro call to learn about your goals."
                  />
                </div>

                <div className="space-y-3">
                  <Label>Meeting duration</Label>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_PRESETS.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, duration: minutes }))
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          draft.duration === minutes
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/60",
                        )}
                      >
                        {minutes} min
                      </button>
                    ))}
                    <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5">
                      <span className="text-sm text-muted-foreground">
                        Custom
                      </span>
                      <Input
                        type="number"
                        min={5}
                        max={240}
                        value={draft.duration}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            duration: Number(e.target.value),
                          }))
                        }
                        className="h-7 w-20 border-none bg-transparent px-0 text-sm focus-visible:ring-0"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Link visibility</p>
                    <p className="text-xs text-muted-foreground">
                      Turn this off to disable the public booking page.
                    </p>
                  </div>
                  <Switch
                    checked={draft.isActive}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, isActive: checked }))
                    }
                  />
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Preview link
                  </p>
                  <p className="mt-2 break-all text-sm font-medium">
                    {previewUrl || `/book/${draft.slug}`}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This public page will show “{draft.title || "Your meeting"}”
                    and offer {draft.duration}-minute slots.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="gap-2"
                      onClick={() => openPreview(draft.slug)}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => void copyPreviewUrl(draft.slug)}
                    >
                      <Copy className="h-4 w-4" />
                      Copy link
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="gap-2"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete link
                  </Button>
                  <Button type="button" onClick={handleSave}>
                    Save changes
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
