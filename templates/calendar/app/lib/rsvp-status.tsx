import { IconCheck, IconCircleX, IconHelpCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

export function getRsvpStatusLabel(status?: string) {
  switch (status) {
    case "accepted":
      return "Yes";
    case "declined":
      return "No";
    case "tentative":
      return "Maybe";
    case "needsAction":
      return "Awaiting";
    default:
      return undefined;
  }
}

export function RsvpStatusIcon({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const label = getRsvpStatusLabel(status);
  if (!label) return null;

  const iconClassName = cn("h-3 w-3", className);
  if (status === "accepted") {
    return (
      <IconCheck
        className={cn(iconClassName, "text-emerald-500")}
        aria-label={`RSVP: ${label}`}
      />
    );
  }
  if (status === "declined") {
    return (
      <IconCircleX
        className={cn(iconClassName, "text-red-400")}
        aria-label={`RSVP: ${label}`}
      />
    );
  }
  return (
    <IconHelpCircle
      className={cn(
        iconClassName,
        status === "tentative" ? "text-yellow-500" : "text-muted-foreground/60",
      )}
      aria-label={`RSVP: ${label}`}
    />
  );
}
