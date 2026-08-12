import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type TemplateCategory =
  | "ad"
  | "one-pager"
  | "landing-page"
  | "social"
  | "presentation"
  | "other";

export function SaveTemplateDialog({
  open,
  onOpenChange,
  defaultTitle,
  defaultDescription,
  screenCount,
  lockedLayerCount,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  defaultDescription: string;
  screenCount: number;
  lockedLayerCount: number;
  saving: boolean;
  onSave: (values: {
    title: string;
    description?: string;
    category: TemplateCategory;
  }) => Promise<void>;
}) {
  const t = useT();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [category, setCategory] = useState<TemplateCategory>("other");

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setCategory("other");
  }, [defaultDescription, defaultTitle, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("designEditor.saveAsTemplate")}</DialogTitle>
          <DialogDescription>
            {t("designEditor.saveTemplateDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">
              {t("designEditor.templateName")}
            </span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">
              {t("designEditor.templateDescription")}
            </span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="font-medium">
              {t("designEditor.templateCategory")}
            </span>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as TemplateCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(
                    [
                      "ad",
                      "social",
                      "one-pager",
                      "landing-page",
                      "presentation",
                      "other",
                    ] as const
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`templatesPage.categories.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
            {t("designEditor.templateSnapshotSummary", {
              screens: screenCount,
              locks: lockedLayerCount,
            })}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("home.cancel")}
          </Button>
          <Button
            onClick={() =>
              void onSave({
                title: title.trim(),
                description: description.trim() || undefined,
                category,
              })
            }
            disabled={!title.trim() || saving}
          >
            {saving ? <Spinner className="size-4" /> : null}
            {t("designEditor.saveTemplate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
