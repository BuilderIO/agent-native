import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useActionMutation } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/timestamp-format";

export interface SpeakerParticipant {
  speakerLabel: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  color?: string | null;
  isInternal?: boolean;
  talkMs?: number;
  talkPct?: number;
}

export interface SpeakerAvatarsProps {
  callId: string;
  participants: SpeakerParticipant[];
  onRefetch?: () => void;
  className?: string;
}

export function SpeakerAvatars(props: SpeakerAvatarsProps) {
  const { callId, participants, onRefetch, className } = props;
  if (!participants?.length) return null;

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {participants.map((p) => (
        <SpeakerChip
          key={p.speakerLabel}
          callId={callId}
          participant={p}
          onRefetch={onRefetch}
        />
      ))}
    </div>
  );
}

function SpeakerChip({
  callId,
  participant,
  onRefetch,
}: {
  callId: string;
  participant: SpeakerParticipant;
  onRefetch?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(participant.email ?? "");
  const [name, setName] = useState(
    participant.displayName === participant.speakerLabel
      ? ""
      : (participant.displayName ?? ""),
  );

  const resolve = useActionMutation("resolve-participant", {
    onSuccess: () => {
      setOpen(false);
      onRefetch?.();
    },
  });

  const talkPct = Math.max(0, Math.min(100, participant.talkPct ?? 0));
  const circ = 2 * Math.PI * 14;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-full border border-border pl-1 pr-3 py-1 hover:bg-accent">
          <div className="relative h-7 w-7">
            <Avatar className="h-7 w-7">
              {participant.avatarUrl ? (
                <AvatarImage src={participant.avatarUrl} />
              ) : null}
              <AvatarFallback
                className="text-[10px] font-semibold"
                style={
                  participant.color
                    ? {
                        backgroundColor: participant.color,
                        color: "#fff",
                      }
                    : undefined
                }
              >
                {initials(participant.displayName || participant.speakerLabel)}
              </AvatarFallback>
            </Avatar>
            <svg
              className="absolute inset-0 -rotate-90 pointer-events-none"
              width={30}
              height={30}
              viewBox="0 0 30 30"
            >
              <circle
                cx="15"
                cy="15"
                r="14"
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="1.5"
              />
              <circle
                cx="15"
                cy="15"
                r="14"
                fill="none"
                stroke="hsl(var(--foreground))"
                strokeWidth="1.5"
                strokeDasharray={`${(circ * talkPct) / 100} ${circ}`}
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="flex flex-col items-start leading-tight min-w-0">
            <span className="text-xs font-medium truncate max-w-[140px]">
              {participant.displayName}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {participant.talkPct != null
                ? `${Math.round(participant.talkPct)}%`
                : "—"}
              {participant.talkMs != null ? (
                <span className="ml-1 opacity-70">
                  {formatMs(participant.talkMs)}
                </span>
              ) : null}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">Resolve speaker</div>
            <div className="text-xs text-muted-foreground">
              Identify who {participant.speakerLabel} really is.
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Display name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={resolve.isPending || (!email && !name)}
              onClick={() =>
                resolve.mutate({
                  callId,
                  speakerLabel: participant.speakerLabel,
                  email: email || undefined,
                  displayName: name || undefined,
                } as any)
              }
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
