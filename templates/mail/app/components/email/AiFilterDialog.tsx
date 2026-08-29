import { useT } from "@agent-native/core/client/i18n";
import type { AiFilterTarget } from "@shared/ai-filter";
import { IconFilter, IconInbox, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useManageAiFilter } from "@/hooks/use-ai-filter";

export function AiFilterDialog({
  open,
  onOpenChange,
  action,
  targets,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "filter" | "keep";
  targets: AiFilterTarget[];
  onComplete?: () => void;
}) {
  const t = useT();
  const manageAiFilter = useManageAiFilter();
  const [comment, setComment] = useState("");
  const isFilter = action === "filter";

  useEffect(() => {
    if (open) setComment("");
  }, [open, action]);

  const handleSubmit = () => {
    if (targets.length === 0 || manageAiFilter.isPending) return;
    manageAiFilter.mutate(
      {
        mode: action,
        targets,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast(
            isFilter
              ? t("mail.aiFilter.filteredToast", { count: targets.length })
              : t("mail.aiFilter.keptToast", { count: targets.length }),
          );
          onComplete?.();
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.aiFilter.actionFailed"),
          ),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFilter ? (
              <IconFilter className="size-4 text-primary" />
            ) : (
              <IconInbox className="size-4 text-primary" />
            )}
            {isFilter
              ? t("mail.aiFilter.filterTitle")
              : t("mail.aiFilter.keepTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <div>
            <label htmlFor="ai-filter-comment" className="sr-only">
              {isFilter
                ? t("mail.aiFilter.rememberLabel")
                : t("mail.aiFilter.correctLabel")}
            </label>
            <Textarea
              id="ai-filter-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={
                isFilter
                  ? t("mail.aiFilter.rememberPlaceholder")
                  : t("mail.aiFilter.correctPlaceholder")
              }
              rows={2}
              className="resize-none text-sm"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={manageAiFilter.isPending}
          >
            {t("settings.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={targets.length === 0}>
            {manageAiFilter.isPending && (
              <IconLoader2 className="size-4 animate-spin" />
            )}
            {isFilter
              ? t("mail.aiFilter.filterButton")
              : t("mail.aiFilter.keepButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
