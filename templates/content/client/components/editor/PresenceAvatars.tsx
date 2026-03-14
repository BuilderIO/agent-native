import { type PresenceUser } from "@/hooks/use-presence";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MAX_VISIBLE = 5;

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-teal-500",
];

function getColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitial(user: PresenceUser): string {
  if (user.displayName) return user.displayName.charAt(0).toUpperCase();
  if (user.email) return user.email.charAt(0).toUpperCase();
  return "?";
}

function getLabel(user: PresenceUser): string {
  if (user.displayName && user.email)
    return `${user.displayName} (${user.email})`;
  return user.displayName || user.email || "Unknown";
}

interface PresenceAvatarsProps {
  viewers: PresenceUser[];
}

export function PresenceAvatars({ viewers }: PresenceAvatarsProps) {
  if (viewers.length === 0) return null;

  const visible = viewers.slice(0, MAX_VISIBLE);
  const overflow = viewers.length - MAX_VISIBLE;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((user) => (
        <Tooltip key={user.userId}>
          <TooltipTrigger asChild>
            <div className="relative">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={getLabel(user)}
                  className="w-6 h-6 rounded-full border-2 border-background object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className={`w-6 h-6 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-medium text-white ${getColor(user.userId)}`}
                >
                  {getInitial(user)}
                </div>
              )}
              {/* Green online dot */}
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-background" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {getLabel(user)}
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-6 h-6 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
              +{overflow}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {viewers
              .slice(MAX_VISIBLE)
              .map((u) => getLabel(u))
              .join(", ")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
