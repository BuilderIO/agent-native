import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  useCreateScheduledJob,
  useParseDate,
} from "@/hooks/use-scheduled-jobs";
import { toast } from "sonner";

interface SnoozeModalProps {
  open: boolean;
  emailId: string | null;
  onClose: () => void;
  onSnoozed?: (emailId: string) => void;
}

interface Option {
  label: string;
  sublabel?: string;
  date: Date;
  isCustom?: boolean;
}

function getPresets(): Option[] {
  const now = new Date();

  // Tomorrow 8am
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  // Next week: Monday 8am
  const nextWeek = new Date(now);
  const daysUntilMon = (1 - now.getDay() + 7) % 7 || 7;
  nextWeek.setDate(now.getDate() + daysUntilMon);
  nextWeek.setHours(8, 0, 0, 0);

  // This weekend: Saturday 8am
  const weekend = new Date(now);
  const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
  weekend.setDate(now.getDate() + daysUntilSat);
  weekend.setHours(8, 0, 0, 0);

  // Someday: 3 months
  const someday = new Date(now);
  someday.setMonth(someday.getMonth() + 3);
  someday.setHours(8, 0, 0, 0);

  return [
    { label: "tomorrow", date: tomorrow },
    { label: "next week", date: nextWeek },
    { label: "this weekend", date: weekend },
    { label: "someday", date: someday, sublabel: "¯\\_(ツ)_/¯" },
  ];
}

function formatRight(date: Date, sublabel?: string): string {
  if (sublabel) return sublabel;
  const day = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

export function SnoozeModal({
  open,
  emailId,
  onClose,
  onSnoozed,
}: SnoozeModalProps) {
  const [nlInput, setNlInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [parsedDate, setParsedDate] = useState<Date | null>(null);
  const [parsedLabel, setParsedLabel] = useState<string | null>(null);
  const [parsedFormatted, setParsedFormatted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presets = getPresets();

  const queryClient = useQueryClient();
  const createJob = useCreateScheduledJob();
  const parseDate = useParseDate();

  // Reset & focus on open
  useEffect(() => {
    if (open) {
      setNlInput("");
      setSelectedIndex(0);
      setParsedDate(null);
      setParsedLabel(null);
      setParsedFormatted(null);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced NL parse
  useEffect(() => {
    if (!nlInput.trim()) {
      setParsedDate(null);
      setParsedLabel(null);
      setParsedFormatted(null);
      setSelectedIndex(0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await parseDate
        .mutateAsync({ nlInput, timezone: tz })
        .catch(() => null);
      if (result?.timestamp && result.formatted) {
        setParsedDate(new Date(result.timestamp));
        setParsedLabel(result.formatted);
        setParsedFormatted(result.formatted);
        setSelectedIndex(0);
      } else {
        setParsedDate(null);
        setParsedLabel(null);
        setParsedFormatted(null);
      }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nlInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which options list to show
  const options: Option[] =
    nlInput.trim() && parsedDate
      ? [{ label: parsedLabel ?? nlInput, date: parsedDate, isCustom: true }]
      : presets;

  const handleConfirm = useCallback(
    async (opt: Option) => {
      if (!emailId) return;
      try {
        await createJob.mutateAsync({
          type: "snooze",
          emailId,
          payload: {},
          runAt: opt.date.getTime(),
        });
        // Archive before dispatching — don't advance UI if archive failed
        const archiveRes = await fetch(`/api/emails/${emailId}/archive`, {
          method: "PATCH",
        });
        if (!archiveRes.ok) throw new Error("Archive failed");
        queryClient.invalidateQueries({ queryKey: ["emails"] });
        // Dispatch after successful archive so list advances selection
        window.dispatchEvent(
          new CustomEvent("email:snoozed", { detail: { emailId } }),
        );
        onSnoozed?.(emailId);
        onClose();
        toast(`Snoozed until ${formatRight(opt.date, opt.sublabel)}`);
      } catch (err: any) {
        const msg = err?.message ?? "";
        if (
          msg.includes("no such table") ||
          msg.includes("scheduled_jobs") ||
          msg.includes("SQLITE")
        ) {
          toast.error(
            "Snooze DB not ready. Run: pnpm db:push in the mail template.",
          );
        } else {
          toast.error("Couldn't snooze — check the server logs.");
        }
      }
    },
    [emailId, createJob, queryClient, onSnoozed, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const sel = options[selectedIndex];
        if (sel) handleConfirm(sel);
      }
    },
    [options, selectedIndex, handleConfirm, onClose],
  );

  if (!open) return null;

  const nlTyping = nlInput.trim().length > 0;
  const nlParsed = nlTyping && parsedDate !== null;
  const nlFailed = nlTyping && !parsedDate && !parseDate.isPending;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal — matches CommandMenu positioning and style */}
      <div
        ref={null}
        className="fixed left-1/2 top-[5vh] -translate-x-1/2 w-full max-w-lg rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Header / input row */}
        <div className="flex items-center border-b px-3">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mr-2 h-4 w-4 shrink-0 opacity-50"
          >
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 6v4l2.5 2.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            placeholder="Try: 8 am, 3 days, aug 7"
            className={cn(
              "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground",
              nlFailed && "text-destructive",
            )}
          />
          {nlTyping && (
            <span className="shrink-0 ml-3 text-xs text-muted-foreground tabular-nums">
              {parseDate.isPending
                ? "…"
                : nlParsed
                  ? parsedFormatted
                  : "no match"}
            </span>
          )}
        </div>

        {/* Options list */}
        <div className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Snooze until
          </div>
          {options.map((opt, i) => {
            const active = i === selectedIndex;
            return (
              <button
                key={opt.label}
                onClick={() => handleConfirm(opt)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "relative w-full flex items-center justify-between rounded-sm px-2 py-1.5 text-sm text-left transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span>{opt.label}</span>
                <span className="ml-auto text-xs tracking-widest text-muted-foreground tabular-nums">
                  {formatRight(opt.date, opt.sublabel)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
