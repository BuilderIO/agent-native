import { useState } from "react";
import { Player } from "@remotion/player";
import type { CompositionEntry } from "@/remotion/registry";
import { cn } from "@/lib/utils";
import { IconTrash } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type CompositionCardProps = {
  composition: CompositionEntry;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (id: string) => void;
};

export function CompositionCard({
  composition,
  isSelected,
  onClick,
  onDelete,
}: CompositionCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "flex items-center gap-3 px-2 py-1.5 rounded-lg group cursor-pointer relative",
          isSelected
            ? "bg-accent/60 ring-1 ring-primary/25"
            : "bg-transparent hover:bg-secondary/60",
        )}
      >
        {/* Thumbnail */}
        <div className="w-14 h-10 flex-shrink-0 rounded-md overflow-hidden bg-background border border-border">
          <Player
            component={composition.component}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
            durationInFrames={composition.durationInFrames}
            fps={composition.fps}
            inputProps={composition.defaultProps}
            style={{ width: "100%", height: "100%", pointerEvents: "none" }}
            autoPlay={false}
            loop={false}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3
            className={cn(
              "text-xs font-medium truncate",
              isSelected ? "text-accent-foreground" : "text-foreground/80",
            )}
          >
            {composition.title}
          </h3>
          <span className="text-[10px] text-muted-foreground font-mono">
            {(composition.durationInFrames / composition.fps).toFixed(1)}s
            {" · "}
            {composition.width}×{composition.height}
          </span>
        </div>

        {/* Delete button — visible on hover */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
            title="Delete composition"
          >
            <IconTrash className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{composition.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(composition.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
