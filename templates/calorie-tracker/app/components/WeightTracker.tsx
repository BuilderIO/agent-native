import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IconScale, IconAlertTriangle } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { formatLocalDate } from "@/lib/utils";
import { AddWeightDialog } from "./AddWeightDialog";
import { WeightCard } from "./WeightCard";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Weight } from "@shared/types";

interface WeightTrackerProps {
  currentDate: Date;
}

export function WeightTracker({ currentDate }: WeightTrackerProps) {
  const [editingWeight, setEditingWeight] = useState<Weight | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const dateStr = formatLocalDate(currentDate);

  const deleteWeightMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/weights/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weights"] });
      queryClient.invalidateQueries({ queryKey: ["weights-history"] });
      toast.success("Weight entry deleted");
    },
  });

  const {
    data: weights,
    isLoading,
    isError,
  } = useQuery<Weight[]>({
    queryKey: ["weights", dateStr],
    queryFn: () => apiFetch(`/api/weights?date=${dateStr}`),
  });

  const todayWeight = weights?.[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Weight
        </h2>
        {!todayWeight && !isLoading && (
          <AddWeightDialog currentDate={currentDate} />
        )}
        {editingWeight && (
          <AddWeightDialog
            editingWeight={editingWeight}
            isOpen={editDialogOpen}
            onOpenChange={(open) => {
              setEditDialogOpen(open);
              if (!open) setEditingWeight(null);
            }}
            currentDate={currentDate}
          />
        )}
      </div>
      <div className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-red-500/[0.03] border border-dashed border-red-500/20">
            <div className="p-3 rounded-full bg-red-500/10 mb-3">
              <IconAlertTriangle className="h-5 w-5 text-red-400/70" />
            </div>
            <p className="text-sm text-red-400/80">Failed to load weight</p>
          </div>
        ) : !todayWeight ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
            <div className="p-3 rounded-full bg-blue-500/10 mb-3">
              <IconScale className="h-5 w-5 text-blue-500/50" />
            </div>
            <p className="text-sm text-muted-foreground">No weight logged</p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Track your weight daily
            </p>
          </div>
        ) : (
          <WeightCard
            weight={todayWeight}
            onEdit={(w) => {
              setEditingWeight(w);
              setEditDialogOpen(true);
            }}
            onDelete={(w) => {
              if (w.id) deleteWeightMutation.mutate(w.id);
            }}
            isDeleting={deleteWeightMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}
