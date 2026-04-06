import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Scale } from "lucide-react";
import { Weight } from "@shared/api";
import { apiRequest } from "@/lib/queryClient";
import { formatLocalDate } from "@/lib/utils";
import { AddWeightDialog } from "./AddWeightDialog";
import { WeightCard } from "./WeightCard";
import { Skeleton } from "@/components/ui/skeleton";

interface WeightTrackerProps {
  currentDate: Date;
}

export function WeightTracker({ currentDate }: WeightTrackerProps) {
  const [editingWeight, setEditingWeight] = useState<Weight | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const dateStr = formatLocalDate(currentDate);

  const deleteWeightMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/weights/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights/history"] });
      toast({ title: "Weight entry deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete weight", variant: "destructive" });
    },
  });

  // Fetch weight entries for the current date
  const { data: weights, isLoading } = useQuery<Weight[]>({
    queryKey: ["/api/weights", dateStr],
    queryFn: async () => {
      return await apiRequest("GET", `/api/weights?date=${dateStr}`);
    },
  });

  const todayWeight = weights?.[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Weight
        </h2>

        {/* Only show Log Weight button if no weight is logged for today */}
        {!todayWeight && !isLoading && (
          <AddWeightDialog currentDate={currentDate} />
        )}

        {/* Hidden dialog for editing */}
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
          <>
            <Skeleton className="h-16 w-full rounded-xl" />
          </>
        ) : !todayWeight ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.06]">
            <div className="p-3 rounded-full bg-blue-500/10 mb-3">
              <Scale className="h-5 w-5 text-blue-500/50" />
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
