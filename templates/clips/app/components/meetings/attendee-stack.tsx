/**
 * <AttendeeStack /> — overlapping avatar stack for meeting participants.
 *
 * Granola-style: up to 4 avatars (-space-x), then "+N" pill. Each avatar
 * gets a shadcn Tooltip showing name/email. Used on both list cards and
 * detail headers.
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface AttendeeStackParticipant {
  id?: string;
  email: string;
  name?: string | null;
  isOrganizer?: boolean;
}

export function attendeeInitials(p: AttendeeStackParticipant | string): string {
  const src =
    typeof p === "string" ? p : p.name?.trim() || p.email?.trim() || "?";
  const parts = src
    .replace(/@.*$/, "")
    .split(/\s+|[._-]/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}

interface AttendeeStackProps {
  participants: AttendeeStackParticipant[];
  max?: number;
  size?: "xs" | "sm" | "md";
}

export function AttendeeStack({
  participants,
  max = 4,
  size = "sm",
}: AttendeeStackProps) {
  if (!participants || participants.length === 0) return null;
  const visible = participants.slice(0, max);
  const extra = participants.length - visible.length;
  const sizeClass =
    size === "xs"
      ? "h-5 w-5 text-[8px]"
      : size === "md"
        ? "h-7 w-7 text-[11px]"
        : "h-6 w-6 text-[9px]";
  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((p, i) => (
          <Tooltip key={`${p.email}-${i}`}>
            <TooltipTrigger asChild>
              <Avatar
                className={`${sizeClass} ring-2 ring-background cursor-default`}
              >
                <AvatarImage alt={p.name || p.email} />
                <AvatarFallback className="font-medium">
                  {attendeeInitials(p)}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div className="font-medium">{p.name || p.email}</div>
              {p.name && (
                <div className="text-muted-foreground text-[10px]">
                  {p.email}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <span
            className={`relative z-10 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background font-medium tabular-nums ${sizeClass}`}
          >
            +{extra}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
