import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useActionMutation } from "@agent-native/core/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditableLibrary = {
  id: string;
  title: string;
  description?: string | null;
};

export function EditLibraryDialog({
  library,
  open,
  onOpenChange,
}: {
  library: EditableLibrary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateLibrary = useActionMutation("update-library");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open && library) {
      setTitle(library.title ?? "");
      setDescription(library.description ?? "");
    }
  }, [open, library]);

  const id = library?.id;
  const trimmedTitle = title.trim();
  const dirty =
    !!library &&
    (trimmedTitle !== (library.title ?? "").trim() ||
      description.trim() !== (library.description ?? "").trim());

  function submit() {
    if (!id || !trimmedTitle) return;
    updateLibrary.mutate(
      {
        id,
        title: trimmedTitle,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Brand kit updated");
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to update brand kit",
          );
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit brand kit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-library-title">Name</Label>
            <Input
              id="edit-library-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Brand kit name"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-library-description">Description</Label>
            <Textarea
              id="edit-library-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the visual direction or contents of this brand kit."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!trimmedTitle || !dirty || updateLibrary.isPending}
          >
            {updateLibrary.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
