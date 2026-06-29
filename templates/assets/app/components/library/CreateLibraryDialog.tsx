import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

import type { LibraryPreset } from "../../../shared/library-presets";
import { LibraryPresetGrid } from "./LibraryPresetGrid";

export function CreateLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (library: any) => void;
}) {
  const t = useT();
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
          toast.error(error.message || t("brandKits.presetCreateFailed"));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("brandKits.createDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("brandKits.createDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">
                {t("brandKits.startFromPreset")}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("brandKits.startFromPresetDescription")}
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
            <Label htmlFor="library-title">{t("brandKitDetail.name")}</Label>
            <Input
              id="library-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("brandKits.titlePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="library-description">
              {t("assetDetail.description")}
            </Label>
            <Textarea
              id="library-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("brandKits.descriptionPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="library-instructions">
              {t("brandKitDetail.customInstructions")}
            </Label>
            <Textarea
              id="library-instructions"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder={t("brandKits.instructionsPlaceholder")}
              className="min-h-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("brandKitDetail.cancel")}
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            {t("brandKitDetail.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
