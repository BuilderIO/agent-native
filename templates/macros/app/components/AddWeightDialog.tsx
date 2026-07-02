import { useActionMutation, useT } from "@agent-native/core/client";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Weight } from "@shared/types";
import { IconPlus, IconScale } from "@tabler/icons-react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatLocalDate } from "@/lib/utils";

const formSchema = z.object({
  weight: z.string().transform((val) => parseFloat(val)),
  date: z.string(),
  notes: z.string().optional(),
});

type FormData = z.input<typeof formSchema>;

interface AddWeightDialogProps {
  editingWeight?: Weight | null;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  currentDate?: Date;
}

export function AddWeightDialog({
  editingWeight,
  onOpenChange,
  isOpen: controlledOpen,
  currentDate,
}: AddWeightDialogProps) {
  const t = useT();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (v: boolean) => onOpenChange?.(v)
      : setUncontrolledOpen;
  const isEditing = !!editingWeight;

  const form = useForm<FormData>({
    // zod resolves at multiple minor versions across the workspace; cast the
    // schema so @hookform/resolvers v5's zod-v4 overload doesn't reject a
    // v4.3-internal schema under CI's frozen lockfile. Runtime is unaffected.
    resolver: zodResolver(formSchema as any) as any,
    defaultValues: {
      weight: editingWeight?.weight?.toString() || "",
      date: editingWeight?.date || formatLocalDate(currentDate || new Date()),
      notes: editingWeight?.notes || "",
    },
  });

  const createMutation = useActionMutation("log-weight", {
    onSuccess: () => {
      toast.success(t("weight.logged"));
      setOpen(false);
      form.reset();
    },
    onError: () => toast.error(t("weight.logFailed")),
  });

  const updateMutation = useActionMutation("update-weight", {
    onSuccess: () => {
      toast.success(t("weight.updated"));
      setOpen(false);
      form.reset();
    },
    onError: () => toast.error(t("weight.updateFailed")),
  });

  const onSubmit = (data: FormData) => {
    const date = isEditing
      ? editingWeight!.date
      : formatLocalDate(currentDate || new Date());
    if (isEditing) {
      updateMutation.mutate({
        id: String(editingWeight!.id),
        weight: String(data.weight),
        date,
        notes: data.notes || undefined,
      });
    } else {
      createMutation.mutate({
        weight: String(data.weight),
        date,
        notes: data.notes || undefined,
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) form.reset();
  };

  useEffect(() => {
    if (editingWeight) {
      form.reset({
        weight: editingWeight.weight.toString(),
        date: editingWeight.date,
        notes: editingWeight.notes || "",
      });
    } else if (currentDate) {
      form.setValue("date", formatLocalDate(currentDate));
    }
  }, [editingWeight, currentDate, form]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 h-8 rounded-md shadow-sm">
            <IconPlus className="h-3.5 w-3.5" /> {t("weight.log")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[350px] gap-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconScale className="h-5 w-5" />
            {isEditing ? t("weight.edit") : t("weight.log")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing
              ? t("weight.updateDescription")
              : t("weight.logDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="weight">{t("weight.weightLbs")}</Label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              {...form.register("weight")}
              placeholder={t("weight.weightPlaceholder")}
              autoFocus
            />
            {form.formState.errors.weight && (
              <p className="text-sm text-destructive">
                {form.formState.errors.weight.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">{t("weight.notesOptional")}</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder={t("weight.notesPlaceholder")}
              className="min-h-[60px]"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending
              ? t("common.saving")
              : isEditing
                ? t("common.saveChanges")
                : t("weight.log")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
