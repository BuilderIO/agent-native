/**
 * BookingLinkCreateDialog — dialog prompting for Title / URL / Duration
 * when creating a new booking link (a.k.a. event type).
 *
 * The consumer owns the mutation — this component just collects the four
 * inputs and calls `onSubmit` once the user clicks Continue. It stays
 * dumb: no data fetching, no optimistic UI.
 *
 * Shadcn primitives expected in the consumer: dialog, button, input,
 * label, textarea.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface BookingLinkCreateDraft {
  title: string;
  slug: string;
  length: number;
  description: string;
}

export interface BookingLinkCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * URL prefix shown before the slug input, e.g.
   * "calendar.app/meet/alice/" or "cal.local/steve@foo.com/"
   */
  slugPrefix: string;
  /** Default duration in minutes. Defaults to 30. */
  defaultLength?: number;
  onSubmit: (draft: BookingLinkCreateDraft) => void | Promise<void>;
  /** Button label — defaults to "Continue". */
  submitLabel?: string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BookingLinkCreateDialog(props: BookingLinkCreateDialogProps) {
  const {
    open,
    onOpenChange,
    slugPrefix,
    defaultLength = 30,
    onSubmit,
    submitLabel = "Continue",
  } = props;

  const [form, setForm] = useState<BookingLinkCreateDraft>({
    title: "",
    slug: "",
    length: defaultLength,
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);

  // Reset form when the dialog reopens
  useEffect(() => {
    if (open) {
      setForm({
        title: "",
        slug: "",
        length: defaultLength,
        description: "",
      });
      setSlugEdited(false);
      setSubmitting(false);
    }
  }, [open, defaultLength]);

  async function submit() {
    if (!form.title || !form.slug) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new event type</DialogTitle>
          <DialogDescription>
            Create a new event type for people to book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="blc-title">Title</Label>
            <Input
              id="blc-title"
              placeholder="Quick chat"
              value={form.title}
              onChange={(e) => {
                const title = e.currentTarget.value;
                setForm((prev) => ({
                  ...prev,
                  title,
                  slug: slugEdited ? prev.slug : slugify(title),
                }));
              }}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blc-slug">URL</Label>
            <div className="flex rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
              <span className="flex items-center rounded-l-md bg-muted px-3 text-xs text-muted-foreground">
                {slugPrefix}
              </span>
              <Input
                id="blc-slug"
                placeholder="quick-chat"
                className="rounded-l-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                value={form.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setForm((prev) => ({
                    ...prev,
                    slug: slugify(e.currentTarget.value),
                  }));
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blc-desc">Description</Label>
            <Textarea
              id="blc-desc"
              placeholder="A short description people will see."
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.currentTarget.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blc-len">Duration</Label>
            <div className="flex items-center gap-2">
              <Input
                id="blc-len"
                type="number"
                className="w-24"
                value={form.length}
                onChange={(e) =>
                  setForm({ ...form, length: Number(e.currentTarget.value) })
                }
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!form.title || !form.slug || submitting}
          >
            {submitting ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
