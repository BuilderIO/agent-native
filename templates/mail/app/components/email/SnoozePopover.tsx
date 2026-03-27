import { useState, useEffect, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useParseDate, useSnoozeEmail } from "@/hooks/use-scheduled-jobs";
import { IconAlarm } from "@tabler/icons-react";

interface SnoozePopoverProps {
  emailId: string;
  onSnoozed?: () => void;
  onArchive?: (emailId: string) => void;
  children: React.ReactNode; // trigger element
}

// Compute preset snooze times
function getPresets(): Array<{ label: string; date: Date }> {
  const now = new Date();
  const presets: Array<{ label: string; date: Date }> = [];

  // Later today: now + 4 hours, or 6pm if past that
  const laterToday = new Date(now);
  laterToday.setHours(Math.max(now.getHours() + 4, 18), 0, 0, 0);
  if (laterToday.getDate() === now.getDate()) {
    presets.push({ label: "Later today", date: laterToday });
  }

  // Tomorrow morning: 8am
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  presets.push({ label: "Tomorrow", date: tomorrow });

  // This weekend: Saturday 8am (or next Saturday)
  const weekend = new Date(now);
  const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
  weekend.setDate(now.getDate() + daysUntilSat);
  weekend.setHours(8, 0, 0, 0);
  presets.push({ label: "This weekend", date: weekend });

  // Next week: Monday 8am
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

export function SnoozePopover({
  emailId,
  onSnoozed,
  onArchive,
  children,
}: SnoozePopoverProps) {
  const [open, setOpen] = useState(false);
  const [nlInput, setNlInput] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [parsedFormatted, setParsedFormatted] = useState<string | null>(null);
  const [parseError, setParseError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snoozeEmail = useSnoozeEmail();
  const parseDate = useParseDate();
  const presets = getPresets();

  // Debounce NL date parsing
  useEffect(() => {
    if (!nlInput.trim()) {
      setSelectedDate(null);
      setParsedFormatted(null);
      setParseError(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await parseDate
        .mutateAsync({ nlInput, timezone: tz })
        .catch(() => null);
      if (!result || !result.timestamp) {
        setSelectedDate(null);
        setParsedFormatted(null);
        setParseError(true);
      } else {
        setSelectedDate(new Date(result.timestamp));
        setParsedFormatted(result.formatted);
        setParseError(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nlInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePreset = (date: Date) => {
    setSelectedDate(date);
    setParsedFormatted(null);
    setNlInput("");
    setParseError(false);
  };

  const handleSnooze = async () => {
    if (!selectedDate) return;
    await snoozeEmail.mutateAsync({
      emailId,
      runAt: selectedDate.getTime(),
    });
    // Archive the email immediately
    onArchive?.(emailId);
    onSnoozed?.();
    setOpen(false);
    setNlInput("");
    setSelectedDate(null);
  };

  const displayDate = selectedDate
    ? parsedFormatted || formatDate(selectedDate)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Snooze until
          </div>

          {/* Preset chips */}
          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePreset(preset.date)}
                className={cn(
                  "text-left px-2.5 py-1.5 rounded-md text-xs transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  selectedDate?.getTime() === preset.date.getTime() && !nlInput
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-foreground/80",
                )}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-muted-foreground text-[10px]">
                  {formatDate(preset.date)}
                </div>
              </button>
            ))}
          </div>

          {/* NL input */}
          <div className="space-y-1">
            <input
              type="text"
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="or try: friday 5pm, in 2 weeks..."
              className={cn(
                "w-full text-xs px-2.5 py-1.5 rounded-md border bg-background",
                "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1",
                parseError && nlInput
                  ? "border-destructive/50 focus:ring-destructive/30"
                  : "border-input focus:ring-ring/30",
              )}
            />
            {nlInput && (
              <div
                className={cn(
                  "text-[11px] px-1",
                  parseError ? "text-destructive/70" : "text-muted-foreground",
                )}
              >
                {parseError
                  ? "Couldn't parse that date"
                  : displayDate
                    ? `Snooze until ${displayDate}`
                    : "Parsing..."}
              </div>
            )}
          </div>

          {/* Confirm button */}
          <Button
            size="sm"
            className="w-full"
            disabled={!selectedDate || snoozeEmail.isPending}
            onClick={handleSnooze}
          >
            <IconAlarm className="h-3.5 w-3.5 mr-1.5" />
            {snoozeEmail.isPending ? "Snoozing..." : "Snooze"}
            {displayDate && !snoozeEmail.isPending && (
              <span className="ml-1 opacity-60 truncate max-w-[120px]">
                · {displayDate}
              </span>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
