import { useState } from "react";
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

export function CreateLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (library: any) => void;
}) {
  const createLibrary = useActionMutation("create-library");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function submit() {
    if (!title.trim()) return;
    createLibrary.mutate(
      { title: title.trim(), description: description.trim() || undefined },
      {
        onSuccess: (library: any) => {
          onOpenChange(false);
          setTitle("");
          setDescription("");
          onCreated?.(library);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New image library</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="library-title">Name</Label>
            <Input
              id="library-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Engineering blog heroes"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="library-description">Description</Label>
            <Textarea
              id="library-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Dark editorial illustrations, product UI fragments, restrained palette."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
