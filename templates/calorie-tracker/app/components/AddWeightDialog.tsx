import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { formatLocalDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconPlus, IconScale } from "@tabler/icons-react";
import { toast } from "sonner";
import { z } from "zod";
import type { Weight } from "@shared/types";

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
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open =
    controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (v: boolean) => onOpenChange?.(v)
      : setUncontrolledOpen;
  const queryClient = useQueryClient();
  const isEditing = !!editingWeight;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      weight: editingWeight?.weight?.toString() || "",
      date:
        editingWeight?.date ||
        formatLocalDate(currentDate || new Date()),
      notes: editingWeight?.notes || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/weights", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weights"] });
      queryClient.invalidateQueries({ queryKey: ["weights-history"] });
      toast.success("Weight logged");
      setOpen(false);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/weights/${editingWeight?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weights"] });
      queryClient.invalidateQueries({ queryKey: ["weights-history"] });
      toast.success("Weight updated");
      setOpen(false);
      form.reset();
    },
  });

  const onSubmit = (data: FormData) => {
    const weightData = {
      ...data,
      date: isEditing
        ? editingWeight!.date
        : formatLocalDate(currentDate || new Date()),
    };
    if (isEditing) updateMutation.mutate(weightData);
    else createMutation.mutate(weightData);
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
            <IconPlus className="h-3.5 w-3.5" /> Log Weight
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[350px] gap-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconScale className="h-5 w-5" />
            {isEditing ? "Edit Weight" : "Log Weight"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="weight">Weight (lbs)</Label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              {...form.register("weight")}
              placeholder="e.g., 165.5"
              autoFocus
            />
            {form.formState.errors.weight && (
              <p className="text-sm text-destructive">
                {form.formState.errors.weight.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="e.g., Morning weigh-in..."
              className="min-h-[60px]"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending
              ? "Saving..."
              : isEditing
                ? "Save Changes"
                : "Log Weight"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
