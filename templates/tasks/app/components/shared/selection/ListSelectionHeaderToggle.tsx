import { IconChecks } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface ListSelectionHeaderToggleProps {
  selectionMode: boolean;
  disabled?: boolean;
  onSelectionModeChange: (next: boolean) => void;
}

export function ListSelectionHeaderToggle({
  selectionMode,
  disabled,
  onSelectionModeChange,
}: ListSelectionHeaderToggleProps) {
  return (
    <Button
      variant={selectionMode ? "secondary" : "ghost"}
      size="sm"
      className="h-8 shrink-0 gap-1.5 text-xs"
      disabled={disabled}
      onClick={() => onSelectionModeChange(!selectionMode)}
    >
      <IconChecks className="h-3.5 w-3.5" />
      {selectionMode ? "Done selecting" : "Select"}
    </Button>
  );
}
