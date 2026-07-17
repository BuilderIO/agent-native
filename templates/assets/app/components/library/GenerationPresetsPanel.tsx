import { useActionMutation, useT } from "@agent-native/core/client";
import {
  ASPECT_RATIOS,
  IMAGE_CATEGORIES,
  type AspectRatio,
  type ImageCategory,
} from "@shared/api";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function GenerationPresetsPanel({
  libraryId,
  presets,
}: {
  libraryId: string;
  presets: any[];
}) {
  const t = useT();
  const createPreset = useActionMutation("create-generation-preset");
  const deletePreset = useActionMutation("delete-generation-preset");
  const [open, setOpen] = useState(false);
  const [confirmPresetId, setConfirmPresetId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ImageCategory>("social");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [textPolicy, setTextPolicy] = useState(t("library.defaultTextPolicy"));
  const [includeLogo, setIncludeLogo] = useState(false);

  function reset() {
    setTitle("");
    setCategory("social");
    setAspectRatio("1:1");
    setPromptTemplate("");
    setTextPolicy(t("library.defaultTextPolicy"));
    setIncludeLogo(false);
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    createPreset.mutate(
      {
        libraryId,
        title: trimmed,
        category,
        aspectRatio,
        imageSize: "2K",
        promptTemplate: promptTemplate.trim() || undefined,
        textPolicy,
        referencePolicy: "auto",
        includeLogo,
      },
      {
        onSuccess: () => {
          toast.success(t("brandKitDetail.generationPresetCreated"));
          reset();
          setOpen(false);
        },
        onError: (error: Error) => {
          toast.error(
            error.message || t("brandKitDetail.couldNotCreatePreset"),
          );
        },
      },
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("brandKitDetail.generationPresets")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("brandKitDetail.generationPresetsDescription")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("brandKitDetail.new")}
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/brand-kits/${libraryId}/presets/${preset.id}`}
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {preset.title}
                </Link>
                <Badge variant="outline">{preset.aspectRatio}</Badge>
                {preset.includeLogo ? (
                  <Badge variant="secondary">{t("brandKitDetail.logo")}</Badge>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {preset.textPolicy || preset.description || preset.category}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/brand-kits/${libraryId}/presets/${preset.id}`}>
                  {t("brandKitDetail.edit")}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                aria-label={`${t("brandKitDetail.delete")} ${preset.title}`}
                onClick={() => setConfirmPresetId(preset.id)}
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {!presets.length ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t("brandKitDetail.noPresetsYet")}
          </p>
        ) : null}
      </div>

      <AlertDialog
        open={confirmPresetId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmPresetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("brandKitDetail.deleteGenerationPreset")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("brandKitDetail.deleteGenerationPresetDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("brandKitDetail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!confirmPresetId || deletePreset.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmPresetId) return;
                deletePreset.mutate(
                  { id: confirmPresetId },
                  {
                    onSuccess: () => {
                      setConfirmPresetId(null);
                      toast.success(
                        t("brandKitDetail.generationPresetDeleted"),
                      );
                    },
                    onError: (error: Error) => {
                      toast.error(
                        error.message ||
                          t("brandKitDetail.couldNotDeletePreset"),
                      );
                    },
                  },
                );
              }}
            >
              {t("assetDetail.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("brandKitDetail.newGenerationPreset")}</DialogTitle>
            <DialogDescription>
              {t("brandKitDetail.newGenerationPresetDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="preset-title">{t("brandKitDetail.name")}</Label>
              <Input
                id="preset-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("brandKitDetail.campaignLaunch")}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>{t("brandKitDetail.category")}</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as ImageCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t("brandKitDetail.aspectRatio")}</Label>
                <Select
                  value={aspectRatio}
                  onValueChange={(value) =>
                    setAspectRatio(value as AspectRatio)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((ratio) => (
                      <SelectItem key={ratio} value={ratio}>
                        {ratio}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preset-template">
                {t("brandKitDetail.promptTemplate")}
              </Label>
              <Textarea
                id="preset-template"
                value={promptTemplate}
                onChange={(event) => setPromptTemplate(event.target.value)}
                placeholder={t("library.promptTemplatePlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preset-text-policy">
                {t("brandKitDetail.textPolicy")}
              </Label>
              <Textarea
                id="preset-text-policy"
                value={textPolicy}
                onChange={(event) => setTextPolicy(event.target.value)}
              />
            </div>
            <label
              htmlFor="preset-include-logo"
              className="flex items-start gap-3 rounded-md border border-border p-3"
            >
              <Checkbox
                id="preset-include-logo"
                checked={includeLogo}
                onCheckedChange={(checked) => setIncludeLogo(checked === true)}
                className="mt-0.5"
              />
              <span className="grid gap-1">
                <span className="text-sm font-medium leading-none">
                  {t("brandKitDetail.compositeCanonicalLogo")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("brandKitDetail.compositeCanonicalLogoHint")}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("brandKitDetail.cancel")}
            </Button>
            <Button disabled={!title.trim()} onClick={submit}>
              {t("brandKitDetail.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
