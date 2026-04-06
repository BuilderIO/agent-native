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
import { IconPlus, IconChevronDown } from "@tabler/icons-react";
import { toast } from "sonner";
import { z } from "zod";
import type { Meal } from "@shared/types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  calories: z.string().transform((val) => parseInt(val, 10)),
  protein: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  carbs: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  fat: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
  date: z.string(),
  notes: z.string().optional(),
});

type FormData = z.input<typeof formSchema>;

interface AddMealDialogProps {
  editingMeal?: Meal | null;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  currentDate?: Date;
}

export function AddMealDialog({
  editingMeal,
  onOpenChange,
  isOpen: controlledOpen,
  currentDate = new Date(),
}: AddMealDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (v: boolean) => onOpenChange?.(v)
      : setUncontrolledOpen;
  const [showMacros, setShowMacros] = useState(false);
  const queryClient = useQueryClient();
  const isEditing = !!editingMeal;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: editingMeal?.name || "",
      calories: editingMeal?.calories.toString() || "",
      protein: editingMeal?.protein?.toString() || "",
      carbs: editingMeal?.carbs?.toString() || "",
      fat: editingMeal?.fat?.toString() || "",
      date: editingMeal?.date || formatLocalDate(currentDate),
      notes: editingMeal?.notes || "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/meals", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meals"] });
      toast.success("Meal added");
      setOpen(false);
      form.reset();
      setShowMacros(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/api/meals/${editingMeal?.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meals"] });
      toast.success("Meal updated");
      setOpen(false);
      form.reset();
      setShowMacros(false);
    },
  });

  const onSubmit = (data: FormData) => {
    const mealData = {
      ...data,
      date: isEditing ? editingMeal!.date : formatLocalDate(currentDate),
    };
    if (isEditing) updateMutation.mutate(mealData);
    else createMutation.mutate(mealData);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      form.reset();
      setShowMacros(false);
    }
  };

  useEffect(() => {
    if (editingMeal) {
      form.reset({
        name: editingMeal.name,
        calories: editingMeal.calories.toString(),
        protein: editingMeal.protein?.toString() || "",
        carbs: editingMeal.carbs?.toString() || "",
        fat: editingMeal.fat?.toString() || "",
        date: editingMeal.date,
        notes: editingMeal.notes || "",
      });
      setShowMacros(
        (editingMeal.protein ?? 0) > 0 ||
          (editingMeal.carbs ?? 0) > 0 ||
          (editingMeal.fat ?? 0) > 0,
      );
    }
  }, [editingMeal, form]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5 h-8 rounded-md shadow-sm">
            <IconPlus className="h-3.5 w-3.5" /> Add Meal
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px] gap-6">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Meal" : "Add New Meal"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Meal Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="e.g., Oatmeal"
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
            <Label htmlFor="calories">Calories</Label>
            <Input
              id="calories"
              type="number"
              inputMode="numeric"
              {...form.register("calories")}
              placeholder="kcal"
            />
            {form.formState.errors.calories && (
              <p className="text-sm text-destructive">
                {form.formState.errors.calories.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowMacros(!showMacros)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconChevronDown
              className={`h-4 w-4 transition-transform ${showMacros ? "rotate-180" : ""}`}
            />
            Add Nutrition Details
          </button>
          {showMacros && (
            <div className="pt-2 border-t space-y-4 bg-secondary/30 -mx-6 px-6 py-4 rounded">
              <p className="text-xs font-medium text-muted-foreground">
                Optional
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="protein">Protein (g)</Label>
                  <Input
                    id="protein"
                    type="number"
                    inputMode="numeric"
                    {...form.register("protein")}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="carbs">Carbs (g)</Label>
                  <Input
                    id="carbs"
                    type="number"
                    inputMode="numeric"
                    {...form.register("carbs")}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fat">Fat (g)</Label>
                  <Input
                    id="fat"
                    type="number"
                    inputMode="numeric"
                    {...form.register("fat")}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending
              ? "Saving..."
              : isEditing
                ? "Save Changes"
                : "Save Meal"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
