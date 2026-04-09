import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useActionMutation } from "@agent-native/core/client";
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
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { z } from "zod";
import type { Exercise } from "@shared/types";

const formSchema = z.object({
  name: z.string().min(1, "Exercise name is required"),
  calories_burned: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, "Must be > 0"),
  duration_minutes: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  date: z.string(),
});

type FormData = z.input<typeof formSchema>;

interface AddExerciseDialogProps {
  editingExercise?: Exercise | null;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  currentDate?: Date;
}

export function AddExerciseDialog({
  editingExercise,
  onOpenChange,
  isOpen: controlledOpen,
  currentDate = new Date(),
}: AddExerciseDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (v: boolean) => onOpenChange?.(v)
      : setUncontrolledOpen;
  const isEditing = !!editingExercise;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: editingExercise?.name || "",
      calories_burned: editingExercise?.calories_burned.toString() || "",
      duration_minutes: editingExercise?.duration_minutes?.toString() || "",
      date: editingExercise?.date || formatLocalDate(currentDate),
    },
  });

  const createMutation = useActionMutation("log-exercise", {
    onSuccess: () => {
      toast.success("Exercise logged");
      setOpen(false);
      form.reset();
    },
  });

  const updateMutation = useActionMutation("update-exercise", {
    onSuccess: () => {
      toast.success("Exercise updated");
      setOpen(false);
      form.reset();
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) form.reset();
  };

  useEffect(() => {
    if (editingExercise) {
      form.reset({
        name: editingExercise.name,
        calories_burned: editingExercise.calories_burned.toString(),
        duration_minutes: editingExercise.duration_minutes?.toString() || "",
        date: editingExercise.date,
      });
    }
  }, [editingExercise, form]);

  const onSubmit = (data: FormData) => {
    const date = isEditing
      ? editingExercise!.date
      : formatLocalDate(currentDate);
    if (isEditing) {
      updateMutation.mutate({
        id: String(editingExercise!.id),
        name: data.name,
        calories_burned: String(data.calories_burned),
        duration_minutes: data.duration_minutes
          ? String(data.duration_minutes)
          : undefined,
        date,
      });
    } else {
      createMutation.mutate({
        name: data.name,
        calories_burned: String(data.calories_burned),
        duration_minutes: data.duration_minutes
          ? String(data.duration_minutes)
          : undefined,
        date,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 h-8 rounded-md shadow-sm">
            <IconPlus className="h-3.5 w-3.5" /> Log Exercise
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px] gap-6">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Exercise" : "Log Exercise"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exercise-name">Exercise</Label>
            <Input
              id="exercise-name"
              {...form.register("name")}
              placeholder="e.g., Running, Cycling"
              autoFocus
              autoComplete="off"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="calories-burned">Calories Burned</Label>
            <Input
              id="calories-burned"
              type="number"
              inputMode="numeric"
              {...form.register("calories_burned")}
              placeholder="kcal"
            />
            {form.formState.errors.calories_burned && (
              <p className="text-sm text-destructive">
                {form.formState.errors.calories_burned.message}
              </p>
            )}
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
                : "Log Exercise"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
