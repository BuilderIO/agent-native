import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Flame, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatLocalDate } from "@/lib/utils";

interface Exercise {
  id: number;
  name: string;
  calories_burned: number;
  duration_minutes?: number;
  date: string;
}

const formSchema = z.object({
  name: z.string().min(1, "Exercise name is required"),
  calories_burned: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, "Must be greater than 0"),
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
      ? (value: boolean) => onOpenChange?.(value)
      : setUncontrolledOpen;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!editingExercise;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: editingExercise?.name || "",
      calories_burned: editingExercise?.calories_burned.toString() || "",
      duration_minutes: editingExercise?.duration_minutes?.toString() || "",
      date: editingExercise?.date || formatLocalDate(currentDate),
    },
  });

  const createExerciseMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/exercises", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise logged successfully" });
      setOpen(false);
      form.reset();
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to log exercise", variant: "destructive" });
    },
  });

  const updateExerciseMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest(
        "PUT",
        `/api/exercises/${editingExercise?.id}`,
        data,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({ title: "Exercise updated successfully" });
      setOpen(false);
      form.reset();
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to update exercise", variant: "destructive" });
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      form.reset();
    }
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
    const exerciseData = {
      name: data.name,
      calories_burned: data.calories_burned,
      duration_minutes: data.duration_minutes,
      date: isEditing ? editingExercise.date : formatLocalDate(currentDate),
      id: editingExercise?.id,
    };

    if (isEditing) {
      updateExerciseMutation.mutate(exerciseData);
    } else {
      createExerciseMutation.mutate(exerciseData);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 h-8 rounded-md shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Log Exercise
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
              placeholder="e.g., Running, Cycling, Gym"
              autoFocus
              enterKeyHint="next"
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
              enterKeyHint="done"
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
            disabled={
              createExerciseMutation.isPending ||
              updateExerciseMutation.isPending
            }
          >
            {createExerciseMutation.isPending ||
            updateExerciseMutation.isPending
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
