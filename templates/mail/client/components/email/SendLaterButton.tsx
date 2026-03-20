import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconSend, IconChevronDown, IconAlarmFilled } from "@tabler/icons-react";

interface SendLaterButtonProps {
  onSend: () => void;
  onSendLater: (runAt: number) => void;
  disabled?: boolean;
  isSending?: boolean;
}

function getPresets(): Array<{ label: string; date: Date }> {
  const now = new Date();
  const presets: Array<{ label: string; date: Date }> = [];

  const laterToday = new Date(now);
  laterToday.setHours(Math.max(now.getHours() + 4, 18), 0, 0, 0);
  if (laterToday.getDate() === now.getDate()) {
    presets.push({ label: "Later today", date: laterToday });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  presets.push({ label: "Tomorrow morning", date: tomorrow });

  const nextWeek = new Date(now);
  const daysUntilMon = (1 - now.getDay() + 7) % 7 || 7;
  nextWeek.setDate(now.getDate() + daysUntilMon);
  nextWeek.setHours(8, 0, 0, 0);
  presets.push({ label: "Next week", date: nextWeek });

  return presets;
}

function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SendLaterButton({
  onSend,
  onSendLater,
  disabled,
  isSending,
}: SendLaterButtonProps) {
  const [open, setOpen] = useState(false);
  const presets = getPresets();

  const handleSendLater = (date: Date) => {
    onSendLater(date.getTime());
    setOpen(false);
  };

  return (
    <div className="flex items-center">
      <Button
        size="sm"
        variant="default"
        className="rounded-r-none pr-3"
        disabled={disabled || isSending}
        onClick={onSend}
      >
        <IconSend className="h-3.5 w-3.5 mr-1.5" />
        {isSending ? "Sending..." : "Send"}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="default"
            className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
            disabled={disabled}
          >
            <IconChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end" side="top">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Schedule send
            </div>
            <div className="space-y-1">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleSendLater(preset.date)}
                  className="w-full flex items-center justify-between text-left px-2.5 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors group"
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="text-[11px] text-muted-foreground group-hover:text-accent-foreground/70">
                    {formatDate(preset.date)}
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t pt-2">
              <button
                onClick={() => {
                  setOpen(false);
                  // TODO: open full date picker
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm text-muted-foreground"
              >
                <IconAlarmFilled className="h-4 w-4" />
                Pick date & time...
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
