import { IconFlask, IconLoader2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

/** The canvas's primary test button. The page's test handler saves unsaved edits first. */
export function CanvasTestButton({
  label,
  disabled,
  testing,
  onTest,
}: {
  label: string;
  disabled?: boolean;
  /** A test or a save is starting: the button shows a spinner while it stays disabled. */
  testing?: boolean;
  onTest: () => void;
}) {
  return (
    <Button
      size="sm"
      className="rounded-full shadow-sm"
      disabled={disabled}
      onClick={onTest}
    >
      {testing ? <IconLoader2 className="animate-spin" /> : <IconFlask />}
      {label}
    </Button>
  );
}
