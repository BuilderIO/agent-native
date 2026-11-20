import { useT } from "@agent-native/core/client/i18n";
import {
  TEMPLATE_IDS,
  templateOutline,
  type TemplateId,
} from "@shared/form-templates";
import { useMemo, useState } from "react";

import { TemplateThumbnail } from "@/components/templates/TemplateThumbnail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { templateDescriptionKey, templateNameKey } from "./template-keys";

export function TemplateDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: TemplateId) => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<TemplateId>(TEMPLATE_IDS[0]);
  const outline = useMemo(() => templateOutline(selected), [selected]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("forms.start.useTemplate")}</DialogTitle>
          <DialogDescription>
            {t("forms.templates.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid h-[460px] grid-cols-[230px_1fr] gap-4">
          <div role="listbox" className="flex flex-col gap-1 overflow-y-auto">
            {TEMPLATE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected === id}
                onClick={() => setSelected(id)}
                className={cn(
                  "rounded-md px-3 py-2 text-left hover:bg-accent/60",
                  selected === id && "bg-accent",
                )}
              >
                <span className="block text-sm font-medium">
                  {t(templateNameKey(id))}
                </span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {t(templateDescriptionKey(id))}
                </span>
              </button>
            ))}
          </div>
          <div
            aria-label={t("forms.templates.previewLabel")}
            className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-muted/30 p-5"
          >
            <TemplateThumbnail
              key={selected}
              id={selected}
              className="shrink-0"
            />
            <p className="text-xl leading-7 font-bold">{outline.title}</p>
            <p className="text-xs font-medium text-muted-foreground">
              {t("forms.templates.questionCount", {
                count: outline.questions.length,
              })}
            </p>
            <ol className="flex flex-col gap-2">
              {outline.questions.map((question, index) => (
                <li
                  key={index}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {question.title}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("forms.editor.cancel")}
          </Button>
          <Button onClick={() => onPick(selected)}>
            {t("forms.templates.useTemplate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
