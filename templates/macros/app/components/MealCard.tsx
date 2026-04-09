import {
  IconTrash,
  IconPencil,
  IconToolsKitchen2,
  IconLoader2,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { Meal } from "@shared/types";

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
    <div className="group relative flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04]">
      <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <IconToolsKitchen2 className="h-4 w-4 text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-foreground/90 truncate">{meal.name}</h3>
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
      <div className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground/50 hover:text-foreground hover:bg-white/5"
          onClick={() => onEdit(meal)}
        >
          <IconPencil className="h-4 w-4 md:h-3.5 md:w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
          onClick={() => meal.id && onDelete(meal.id)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <IconLoader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
          ) : (
            <IconTrash className="h-4 w-4 md:h-3.5 md:w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
