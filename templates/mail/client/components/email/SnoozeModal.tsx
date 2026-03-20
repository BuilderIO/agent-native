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
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative z-10 w-[520px] overflow-hidden rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
        style={{ background: "#252830" }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2.5">
            {/* Clock icon */}
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-4 w-4"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 6v4l2.5 2.5" strokeLinecap="round" />
            </svg>
            <span
              className="text-[14px] tracking-wide"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Remind me
            </span>
          </div>
          <span
            className="text-[12px] flex items-center gap-0.5"
            style={{ color: "rgba(255,255,255,0.2)" }}
          >
            if no reply
            <svg
              viewBox="0 0 12 12"
              fill="currentColor"
              className="h-2.5 w-2.5"
            >
              <path
                d="M2 4l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>

        {/* Input row */}
        <div
          className="relative flex items-center"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Left accent bar */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] transition-opacity duration-150"
            style={{
              background: "linear-gradient(180deg, #6e7cf5 0%, #8b6ff5 100%)",
              opacity: nlTyping ? (nlFailed ? 0.3 : 1) : 0.6,
            }}
          />

          <div className="flex-1 flex items-center justify-between px-5 py-3.5 pl-6">
            <input
              ref={inputRef}
              type="text"
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="Try: 8 am, 3 days, aug 7"
              className="flex-1 bg-transparent text-[14px] font-mono outline-none min-w-0"
              style={{
                color: nlFailed
                  ? "rgba(255,120,100,0.8)"
                  : "rgba(255,255,255,0.88)",
                caretColor: "#7c8bf5",
              }}
            />
            {nlTyping && (
              <span
                className="shrink-0 ml-4 text-[12px] font-mono"
                style={{
                  color: nlParsed
                    ? "rgba(255,255,255,0.5)"
                    : nlFailed
                      ? "rgba(255,100,80,0.5)"
                      : "rgba(255,255,255,0.2)",
                }}
              >
                {parseDate.isPending
                  ? "…"
                  : nlParsed
                    ? parsedFormatted
                    : "no match"}
              </span>
            )}
          </div>
        </div>

        {/* Options list */}
        <div className="pb-1.5 pt-0.5">
          {options.map((opt, i) => {
            const active = i === selectedIndex;
            return (
              <button
                key={opt.label}
                onClick={() => handleConfirm(opt)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "relative w-full flex items-center justify-between px-5 py-2.5 text-left transition-colors duration-75",
                )}
                style={{
                  background: active
                    ? "rgba(255,255,255,0.055)"
                    : "transparent",
                }}
              >
                {/* Active accent */}
                {active && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{
                      background:
                        "linear-gradient(180deg, #6e7cf5 0%, #8b6ff5 100%)",
                    }}
                  />
                )}

                <span
                  className="text-[14px] font-mono pl-1"
                  style={{
                    color: active
                      ? "rgba(255,255,255,0.92)"
                      : "rgba(255,255,255,0.62)",
                  }}
                >
                  {opt.label}
                </span>
                <span
                  className="text-[13px] font-mono tabular-nums"
                  style={{
                    color: active
                      ? "rgba(255,255,255,0.55)"
                      : "rgba(255,255,255,0.28)",
                  }}
                >
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
