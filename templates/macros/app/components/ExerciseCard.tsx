import { useT } from "@agent-native/core/client";
import type { Exercise } from "@shared/types";
import {
  IconTrash,
  IconPencil,
  IconFlame,
  IconLoader2,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

interface ExerciseCardProps {
  exercise: Exercise;
  onDelete: (id: number) => void;
  onEdit: (exercise: Exercise) => void;
  isDeleting?: boolean;
  isPending?: boolean;
}

export function ExerciseCard({
  exercise,
  onDelete,
  onEdit,
  isDeleting,
  isPending,
}: ExerciseCardProps) {
  const t = useT();
  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 hover:bg-accent/40 sm:gap-4 sm:p-4">
      <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-orange-500/10 border border-orange-500/20">
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
      <div className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100">
        {isPending ? (
          <div
            className="flex h-9 w-9 items-center justify-center text-muted-foreground/60 md:h-7 md:w-7"
            aria-label={t("exercise.saving")}
          >
            <IconLoader2 className="h-4 w-4 animate-spin md:h-3.5 md:w-3.5" />
          </div>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.editNamed", { name: exercise.name })}
              className="h-9 w-9 text-muted-foreground/50 hover:bg-accent hover:text-foreground md:h-7 md:w-7"
              onClick={() => onEdit(exercise)}
            >
              <IconPencil className="h-4 w-4 md:h-3.5 md:w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.deleteNamed", { name: exercise.name })}
              className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onDelete(exercise.id!)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <IconLoader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
              ) : (
                <IconTrash className="h-4 w-4 md:h-3.5 md:w-3.5" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
