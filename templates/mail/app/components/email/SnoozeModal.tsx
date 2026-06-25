import { useT } from "@agent-native/core/client";
import { IconClock } from "@tabler/icons-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useParseDate, useSnoozeEmail } from "@/hooks/use-scheduled-jobs";
import { cn } from "@/lib/utils";

interface SnoozeModalProps {
  open: boolean;
  emailId: string | null;
  accountEmail?: string;
  targets?: SnoozeTarget[];
  onClose: () => void;
  onSnoozed?: (emailIds: string[]) => void;
}

interface SnoozeTarget {
  emailId: string;
  accountEmail?: string;
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

// Weekday autocomplete options — next occurrence of each weekday at 8am.
// Only used when the user starts typing a day-of-week prefix.
function getWeekdayOptions(): Option[] {
  const now = new Date();
  const names = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const today = now.getDay();
  return names.map((name, idx) => {
    const daysUntil = (idx - today + 7) % 7 || 7; // next occurrence, never today
    const d = new Date(now);
    d.setDate(now.getDate() + daysUntil);
    d.setHours(8, 0, 0, 0);
    return { label: name, date: d };
  });
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
  accountEmail,
  targets,
  onClose,
  onSnoozed,
}: SnoozeModalProps) {
  const t = useT();
  const [nlInput, setNlInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [parsedDate, setParsedDate] = useState<Date | null>(null);
  const [parsedFormatted, setParsedFormatted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presets = getPresets();

  const snoozeEmail = useSnoozeEmail();
  const parseDate = useParseDate();
  const snoozeTargets = useMemo(
    () =>
      targets && targets.length > 0
        ? targets
        : emailId
          ? [{ emailId, accountEmail }]
          : [],
    [accountEmail, emailId, targets],
  );

  // Reset & focus on open
  useEffect(() => {
    if (open) {
      setNlInput("");
      setSelectedIndex(0);
      setParsedDate(null);
      setParsedFormatted(null);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced NL parse
  useEffect(() => {
    setSelectedIndex(0);
    if (!nlInput.trim()) {
      setParsedDate(null);
      setParsedFormatted(null);
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
        setParsedFormatted(result.formatted);
        setSelectedIndex(0);
      } else {
        setParsedDate(null);
        setParsedFormatted(null);
      }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nlInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter presets + weekdays by prefix match
  // (e.g. "tom" → "tomorrow", "next" → "next week", "mond" → "monday")
  const query = nlInput.trim().toLowerCase();
  const filteredMatches = query
    ? [...presets, ...getWeekdayOptions()].filter((p) =>
        p.label.toLowerCase().startsWith(query),
      )
    : presets;

  // Which options list to show — prefix matches, plus server-parsed custom date
  // (skip custom if it duplicates a match)
  const options: Option[] = query
    ? [
        ...filteredMatches,
        ...(parsedDate && filteredMatches.length === 0
          ? [
              {
                label: nlInput,
                date: parsedDate,
                isCustom: true,
              },
            ]
          : []),
      ]
    : presets;

  const handleConfirm = useCallback(
    (opt: Option) => {
      if (snoozeTargets.length === 0) return;
      const emailIds = snoozeTargets.map((target) => target.emailId);

      // Optimistic: close immediately, show toast, advance selection
      onClose();
      toast(
        snoozeTargets.length > 1
          ? t("mail.toasts.snoozedConversationsUntil", {
              count: snoozeTargets.length,
              time: formatRight(opt.date, opt.sublabel),
            })
          : t("mail.toasts.snoozedUntil", {
              time: formatRight(opt.date, opt.sublabel),
            }),
      );
      window.dispatchEvent(
        new CustomEvent("email:snoozed", {
          detail: { emailId: emailIds[0], emailIds },
        }),
      );
      onSnoozed?.(emailIds);

      // Fire API in background — surface errors after the fact
      for (const target of snoozeTargets) {
        snoozeEmail
          .mutateAsync({
            emailId: target.emailId,
            runAt: opt.date.getTime(),
            accountEmail: target.accountEmail,
          })
          .catch((err: any) => {
            const msg = err?.message ?? "";
            if (
              msg.includes("no such table") ||
              msg.includes("scheduled_jobs") ||
              msg.includes("SQLITE")
            ) {
              toast.error(t("mail.toasts.snoozeDbNotReady"));
            } else {
              toast.error(msg || t("mail.toasts.couldNotSnooze"));
            }
          });
      }
    },
    [snoozeTargets, snoozeEmail, onSnoozed, onClose],
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

  const nlTyping = nlInput.trim().length > 0;
  const nlParsed = nlTyping && parsedDate !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="top-[5vh] translate-y-0 max-w-lg gap-0 p-0 overflow-hidden"
        onKeyDown={handleKeyDown}
        hideClose
      >
        {/* Header / input row */}
        <div className="flex items-center border-b px-3">
          <IconClock className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            type="text"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            placeholder={t("mail.snooze.modalPlaceholder")}
            className="h-11 border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {nlTyping && (nlParsed || parseDate.isPending) && (
            <span className="shrink-0 ml-3 text-xs text-muted-foreground tabular-nums">
              {parseDate.isPending ? "…" : parsedFormatted}
            </span>
          )}
        </div>

        {/* Options list */}
        <div className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {t("mail.snooze.snoozeUntil")}
          </div>
          {options.map((opt, i) => {
            const active = i === selectedIndex;
            return (
              <button
                key={opt.label}
                onClick={() => handleConfirm(opt)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  "relative w-full flex items-center justify-between rounded-sm px-2 py-1.5 text-sm text-left",
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
      </DialogContent>
    </Dialog>
  );
}
