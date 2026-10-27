import { IconFlask } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/** The canvas's primary test button. The page's test handler saves unsaved edits first. */
export function CanvasTestButton({
  label,
  disabled,
  onTest,
}: {
  label: string;
  disabled?: boolean;
  onTest: () => void;
}) {
  return (
    <Button
      size="sm"
      className="rounded-full shadow-sm"
      disabled={disabled}
      onClick={onTest}
    >
      <IconFlask />
      {label}
    </Button>
  );
}
