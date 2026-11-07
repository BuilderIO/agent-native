import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const fieldId = useId();
  const screens = t("designEditor.templateSnapshotScreens", {
    count: screenCount,
  });

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setCategory("other");
  }, [defaultDescription, defaultTitle, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        aria-describedby={undefined}
        closeLabel={t("designEditor.close")}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || saving) return;
            const trimmedDescription = description.trim();
            void onSave({
              title: title.trim(),
              ...(trimmedDescription
                ? { description: trimmedDescription }
                : {}),
              category,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("designEditor.saveTemplateTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-name`}>
                {t("designEditor.templateName")}
              </Label>
              <Input
                id={`${fieldId}-name`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-description`}>
                {t("designEditor.templateDescription")}
              </Label>
              <Textarea
                id={`${fieldId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-category`}>
                {t("designEditor.templateCategory")}
              </Label>
              <Select
                value={category}
                onValueChange={(value) =>
                  setCategory(value as TemplateCategory)
                }
              >
                <SelectTrigger id={`${fieldId}-category`}>
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
            <p className="text-xs text-muted-foreground">
              {lockedLayerCount > 0
                ? t("designEditor.templateSnapshotSummaryWithLocks", {
                    screens,
                    locks: t("designEditor.templateSnapshotLocks", {
                      count: lockedLayerCount,
                    }),
                  })
                : t("designEditor.templateSnapshotSummaryScreens", {
                    screens,
                  })}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("home.cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? <Spinner className="size-4" /> : null}
              {t("designEditor.saveTemplate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
