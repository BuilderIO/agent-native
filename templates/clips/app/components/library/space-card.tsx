import { useNavigate } from "react-router";
import { IconUsersGroup, IconVideo } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export interface SpaceCardData {
  id: string;
  name: string;
  color?: string | null;
  iconEmoji?: string | null;
  memberCount?: number;
  recordingCount?: number;
  memberEmails?: string[];
}

interface SpaceCardProps {
  space: SpaceCardData;
  className?: string;
}

export function SpaceCard({ space, className }: SpaceCardProps) {
  const navigate = useNavigate();
  const color = space.color || "#625DF5";
  const members = space.memberEmails ?? [];

  return (
    <button
      type="button"
      onClick={() => navigate(`/spaces/${space.id}`)}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left",
        "hover:border-[#625DF5]/40 hover:-translate-y-0.5 transition-transform duration-100 ease-out",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_22px_-6px_rgba(98,93,245,0.22)]",
        className,
      )}
    >
      <div
        className="relative flex h-24 items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
        }}
      >
        <span className="text-3xl">{space.iconEmoji ?? "🗂️"}</span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="text-sm font-semibold text-foreground truncate">
          {space.name}
        </h3>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <IconUsersGroup className="h-3.5 w-3.5" />
            <span>
              {space.memberCount ?? members.length} member
              {(space.memberCount ?? members.length) === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <IconVideo className="h-3.5 w-3.5" />
            <span>
              {space.recordingCount ?? 0} recording
              {(space.recordingCount ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {members.length > 0 && (
          <div className="mt-2 flex -space-x-1">
            {members.slice(0, 5).map((email) => {
              const initials = (email.split("@")[0] || "?")
                .slice(0, 2)
                .toUpperCase();
              return (
                <div
                  key={email}
                  title={email}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-[#625DF5]/15 text-[9px] font-medium text-[#625DF5]"
                >
                  {initials}
                </div>
              );
            })}
            {members.length > 5 && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-[9px] text-muted-foreground">
                +{members.length - 5}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
