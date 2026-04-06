import {
  IconTrash,
  IconPencil,
  IconFlame,
  IconLoader2,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { Exercise } from "@shared/types";

interface ExerciseCardProps {
  exercise: Exercise;
  onDelete: (id: number) => void;
  onEdit: (exercise: Exercise) => void;
  isDeleting?: boolean;
}

export function ExerciseCard({
  exercise,
  onDelete,
  onEdit,
  isDeleting,
}: ExerciseCardProps) {
  return (
    <div className="group relative flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04] transition-all duration-200">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20">
        <IconFlame className="h-4 w-4 text-orange-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-foreground/90 truncate">
          {exercise.name}
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-orange-400">
            -{exercise.calories_burned} kcal
          </span>
          {exercise.duration_minutes && (
            <span className="text-muted-foreground/40 text-xs">
              {exercise.duration_minutes} min
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-white/5"
          onClick={() => onEdit(exercise)}
        >
          <IconPencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
          onClick={() => onDelete(exercise.id!)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconTrash className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
