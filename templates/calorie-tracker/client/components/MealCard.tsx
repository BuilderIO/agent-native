import { Meal } from "@shared/api";
import { Trash2, Edit2, Loader2, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface MealCardProps {
  meal: Meal;
  onDelete: (id: number) => void;
  onEdit: (meal: Meal) => void;
  isDeleting?: boolean;
}

export function MealCard({
  meal,
  onDelete,
  onEdit,
  isDeleting,
}: MealCardProps) {
  return (
    <div className="group relative flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04] transition-all duration-200">
      {/* Icon */}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <Utensils className="h-4 w-4 text-emerald-400" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-0.5">
          <h3 className="font-medium text-foreground/90 truncate">
            {meal.name}
          </h3>
          <span className="text-xs text-muted-foreground/50 shrink-0">
            {format(new Date(meal.date), "h:mm a")}
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-foreground/70">
            {meal.calories} kcal
          </span>
          {((meal.protein ?? 0) > 0 ||
            (meal.carbs ?? 0) > 0 ||
            (meal.fat ?? 0) > 0) && (
            <span className="text-muted-foreground/40 text-xs">
              {(meal.protein ?? 0) > 0 && `${meal.protein}p`}
              {(meal.protein ?? 0) > 0 &&
                ((meal.carbs ?? 0) > 0 || (meal.fat ?? 0) > 0) &&
                " · "}
              {(meal.carbs ?? 0) > 0 && `${meal.carbs}c`}
              {(meal.carbs ?? 0) > 0 && (meal.fat ?? 0) > 0 && " · "}
              {(meal.fat ?? 0) > 0 && `${meal.fat}f`}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-white/5"
          onClick={() => onEdit(meal)}
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
          onClick={() => meal.id && onDelete(meal.id)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
