import { useState } from "react";
import { Weight } from "@shared/api";
import { Trash2, Pencil, Loader2, Scale } from "lucide-react";
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
import { format } from "date-fns";

interface WeightCardProps {
  onEdit: (weight: Weight) => void;
  onDelete: (weight: Weight) => void;
  weight: Weight;
  isDeleting?: boolean;
}

export function WeightCard({ weight, onEdit, onDelete, isDeleting }: WeightCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  return (
    <div className="group relative flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:bg-white/[0.04] transition-all duration-200">
      {/* Icon */}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <Scale className="h-4 w-4 text-blue-400" />
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

      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/50 hover:text-foreground hover:bg-white/5"
          onClick={() => onEdit(weight)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete weight entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this weight entry ({weight.weight} lbs).
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
