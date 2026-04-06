import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { weightSchema, Weight } from "@shared/api";
import { healthKitService, isNativeApp } from "@/lib/healthkit";
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
import { Plus, Scale } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { formatLocalDate } from "@/lib/utils";

// Schema for the form to handle string input
const formSchema = weightSchema.extend({
  weight: z.string().transform((val) => parseFloat(val)),
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
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen =
    controlledOpen !== undefined
      ? (value: boolean) => onOpenChange?.(value)
      : setUncontrolledOpen;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!editingWeight;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      weight: editingWeight?.weight?.toString() || "",
      date: editingWeight?.date || formatLocalDate(currentDate || new Date()),
      notes: editingWeight?.notes || "",
    },
  });

  const createWeightMutation = useMutation({
    mutationFn: async (data: Weight) => {
      return await apiRequest("POST", "/api/weights", data);
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights/history"] });

      // Sync to Apple Health if available
      if (isNativeApp()) {
        try {
          const saved = await healthKitService.saveWeight(variables.weight, variables.date);
          if (saved) {
            toast({ title: "Weight logged & synced to Apple Health" });
          } else {
            toast({ title: "Weight logged successfully" });
          }
        } catch {
          toast({ title: "Weight logged successfully" });
        }
      } else {
        toast({ title: "Weight logged successfully" });
      }

      setOpen(false);
      form.reset();
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to log weight", variant: "destructive" });
    },
  });

  const updateWeightMutation = useMutation({
    mutationFn: async (data: Weight) => {
      return await apiRequest("PUT", `/api/weights/${editingWeight?.id}`, data);
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights/history"] });

      // Sync to Apple Health if available
      if (isNativeApp()) {
        try {
          const saved = await healthKitService.saveWeight(variables.weight, variables.date);
          if (saved) {
            toast({ title: "Weight updated & synced to Apple Health" });
          } else {
            toast({ title: "Weight updated successfully" });
          }
        } catch {
          toast({ title: "Weight updated successfully" });
        }
      } else {
        toast({ title: "Weight updated successfully" });
      }

      setOpen(false);
      form.reset();
      onOpenChange?.(false);
    },
    onError: () => {
      toast({ title: "Failed to update weight", variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    const weightData = {
      ...data,
      date: isEditing
        ? editingWeight.date
        : formatLocalDate(currentDate || new Date()),
      id: editingWeight?.id,
    } as unknown as Weight;

    if (isEditing) {
      updateWeightMutation.mutate(weightData);
    } else {
      createWeightMutation.mutate(weightData);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      form.reset();
    }
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
            <Plus className="h-3.5 w-3.5" /> Log Weight
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[350px] gap-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
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
              placeholder="e.g., Morning weigh-in, after workout..."
              className="min-h-[60px]"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={
              createWeightMutation.isPending || updateWeightMutation.isPending
            }
          >
            {createWeightMutation.isPending || updateWeightMutation.isPending
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
