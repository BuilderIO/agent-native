import { useT } from "@agent-native/core/client";
import { IconLoader2 } from "@tabler/icons-react";
import { FormEvent, useState } from "react";
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
import { useCreateSpace } from "@/hooks/use-library";
import { cn } from "@/lib/utils";

const SPACE_COLORS = [
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#4F46E5",
  "#18181B",
];

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  onCreated?: (space: any) => void;
}

export function CreateSpaceDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: CreateSpaceDialogProps) {
  const t = useT();
  const createSpace = useCreateSpace();
  const [name, setName] = useState("");
  const [color, setColor] = useState(SPACE_COLORS[0]);

  function reset() {
    setName("");
    setColor(SPACE_COLORS[0]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createSpace.isPending) return;

    createSpace.mutate(
      {
        name: trimmed,
        color,
        iconEmoji: null,
        ...(organizationId ? { organizationId } : {}),
      },
      {
        onSuccess: (space) => {
          toast.success(t("createSpaceDialog.spaceCreated"));
          reset();
          onOpenChange(false);
          onCreated?.(space);
        },
        onError: (err: any) => {
          toast.error(err?.message ?? t("createSpaceDialog.createFailed"));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createSpaceDialog.newSpace")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("createSpaceDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">{t("createSpaceDialog.name")}</Label>
            <Input
              id="space-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Engineering"
              disabled={createSpace.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("createSpaceDialog.color")}</Label>
            <div className="grid grid-cols-8 gap-2">
              {SPACE_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={t("createSpaceDialog.useColor", {
                    color: value,
                  })}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className={cn(
                    "h-8 w-8 rounded-md border border-border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    color === value && "ring-2 ring-ring ring-offset-2",
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createSpace.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createSpace.isPending}
            >
              {createSpace.isPending && (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              )}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
