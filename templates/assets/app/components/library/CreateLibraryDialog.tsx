import { useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import { LibraryPresetGrid } from "./LibraryPresetGrid";
import type { LibraryPreset } from "../../../shared/library-presets";

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
  const createFromPreset = useActionMutation("create-library-from-preset");
  const { data: presetData } = useActionQuery("list-library-presets", {});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);
  const presets = ((presetData as any)?.presets ?? []) as LibraryPreset[];

  function submit() {
    if (!title.trim()) return;
    createLibrary.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        customInstructions: customInstructions.trim() || undefined,
      },
      {
        onSuccess: (library: any) => {
          onOpenChange(false);
          setTitle("");
          setDescription("");
          setCustomInstructions("");
          onCreated?.(library);
        },
      },
    );
  }

  function createPresetLibrary(presetId: string) {
    setCreatingPresetId(presetId);
    createFromPreset.mutate(
      { presetId },
      {
        onSuccess: (library: any) => {
          setCreatingPresetId(null);
          onOpenChange(false);
          onCreated?.(library);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || "Could not create preset brand kit.");
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New brand kit</DialogTitle>
          <DialogDescription>
            Start from a built-in style preset or create a blank brand kit for
            your own references.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Start from a style preset</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create an editable brand kit with built-in generation guidance.
              </p>
            </div>
            <LibraryPresetGrid
              presets={presets}
              creatingId={creatingPresetId}
              onCreate={createPresetLibrary}
              compact
            />
          </div>

          <Separator />

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
          <div className="space-y-2">
            <Label htmlFor="library-instructions">Custom instructions</Label>
            <Textarea
              id="library-instructions"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder="Always keep product UI legible, avoid literal text unless requested, prefer quiet editorial compositions."
              className="min-h-24"
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
