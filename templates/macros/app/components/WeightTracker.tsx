import { useState } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { IconScale } from "@tabler/icons-react";
import { formatLocalDate } from "@/lib/utils";
import { AddWeightDialog } from "./AddWeightDialog";
import { WeightCard } from "./WeightCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isOptimisticLogRow,
  useOptimisticLogRows,
} from "@/hooks/use-optimistic-log-rows";
import { toast } from "sonner";
import type { Weight } from "@shared/types";

interface WeightTrackerProps {
  currentDate: Date;
}

export function WeightTracker({ currentDate }: WeightTrackerProps) {
  const [editingWeight, setEditingWeight] = useState<Weight | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const dateStr = formatLocalDate(currentDate);

  const deleteWeightMutation = useActionMutation("delete-weight", {
    onSuccess: () => {
      toast.success("Weight entry deleted");
    },
    onError: () => toast.error("Failed to delete weight entry"),
  });

  const { data: rawWeights, isLoading } = useActionQuery("list-weights", {
    date: dateStr,
  });
  const serverWeights = Array.isArray(rawWeights) ? rawWeights : [];
  const { rows: weights, hasOptimisticRows } = useOptimisticLogRows(
    "weight",
    serverWeights,
    dateStr,
  );

  const todayWeight = weights[0];

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
        {isLoading && !hasOptimisticRows ? (
          <Skeleton className="h-16 w-full rounded-xl" />
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
              if (w.id) deleteWeightMutation.mutate({ id: String(w.id) });
            }}
            isDeleting={deleteWeightMutation.isPending}
            isPending={isOptimisticLogRow(todayWeight)}
          />
        )}
      </div>
    </div>
  );
}
