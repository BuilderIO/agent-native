import { useState } from "react";
import {
  IconTrash,
  IconPencil,
  IconLoader2,
  IconScale,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Weight } from "@shared/types";

interface WeightCardProps {
  weight: Weight;
  onEdit: (weight: Weight) => void;
  onDelete: (weight: Weight) => void;
  isDeleting?: boolean;
}

export function WeightCard({
  weight,
  onEdit,
  onDelete,
  isDeleting,
}: WeightCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="group relative flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04]">
      <div className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <IconScale className="h-4 w-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-xl font-bold text-foreground">
            {weight.weight}
          </span>
          <span className="text-xs font-medium text-muted-foreground">lbs</span>
        </div>
        <p className="text-xs text-muted-foreground/50">
          {weight.notes || "Weight entry"}
        </p>
      </div>
      <div className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit weight ${weight.weight} lbs`}
          className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground/50 hover:text-foreground hover:bg-white/5"
          onClick={() => onEdit(weight)}
        >
          <IconPencil className="h-4 w-4 md:h-3.5 md:w-3.5" />
        </Button>
        <AlertDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete weight ${weight.weight} lbs`}
              className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <IconLoader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
              ) : (
                <IconTrash className="h-4 w-4 md:h-3.5 md:w-3.5" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete weight entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this weight entry ({weight.weight}{" "}
                lbs).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete(weight)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
