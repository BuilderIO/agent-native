import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconSend, IconChevronDown, IconCalendar } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { parseSendLaterDate } from "@/lib/schedule-date";

interface SendLaterButtonProps {
  onSend: () => void;
  onSendLater: (runAt: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  isSending?: boolean;
  isScheduling?: boolean;
}

function getPresets(
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
): Array<{
  labelKey: string;
  labelOptions?: Record<string, string>;
  date: Date;
}> {
  const now = new Date();
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);

  const tomorrowAfternoon = new Date(tomorrowMorning);
  tomorrowAfternoon.setHours(13, 0, 0, 0);

  const mondayMorning = new Date(now);
  const daysUntilMon = (1 - now.getDay() + 7) % 7 || 7;
  mondayMorning.setDate(now.getDate() + daysUntilMon);
  mondayMorning.setHours(8, 0, 0, 0);

  return [
    { labelKey: "mail.sendLater.tomorrowMorning", date: tomorrowMorning },
    { labelKey: "mail.sendLater.tomorrowAfternoon", date: tomorrowAfternoon },
    {
      labelKey: "mail.sendLater.weekdayMorning",
      labelOptions: {
        weekday: formatDate(mondayMorning, { weekday: "long" }),
      },
      date: mondayMorning,
    },
  ];
}

function formatLocalDateTime(date: Date): string {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 16);
}

export function SendLaterButton({
  onSend,
  onSendLater,
  open,
  onOpenChange,
  disabled,
  isSending,
  isScheduling,
}: SendLaterButtonProps) {
  const t = useT();
  const formatters = useFormatters();
  const [internalOpen, setInternalOpen] = useState(false);
  const [naturalInput, setNaturalInput] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const isOpen = open ?? internalOpen;
  const updateOpen = onOpenChange ?? setInternalOpen;
  const presets = useMemo(
    () => getPresets(formatters.formatDate),
    [formatters],
  );
  const query = naturalInput.trim();
  const parsedDate = useMemo(
    () => parseSendLaterDate(naturalInput),
    [naturalInput],
  );
  const suggestions = query
    ? parsedDate
      ? [
          {
            label: t("mail.sendLater.scheduleAt", {
              date: formatters.formatDate(parsedDate, {
                weekday: "long",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
            }),
            date: parsedDate,
          },
        ]
      : []
    : presets.map((preset) => ({
        label: t(preset.labelKey, preset.labelOptions),
        date: preset.date,
      }));
  const listboxId = useId();
  const dateInputId = useId();
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setNaturalInput("");
      setActiveIndex(-1);
    }
  }, [isOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setNaturalInput("");
      setActiveIndex(-1);
      if (dateInputRef.current) dateInputRef.current.value = "";
    }
    updateOpen(nextOpen);
  };

  const isDisabled = disabled || isSending || isScheduling;

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;

    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
      }
    }

    input.click();
  };

  const handleSendLater = (date: Date) => {
    if (
      isDisabled ||
      !Number.isFinite(date.getTime()) ||
      date.getTime() <= Date.now()
    ) {
      return;
    }
    onSendLater(date.getTime());
    handleOpenChange(false);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setNaturalInput("");
      setActiveIndex(-1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (current < 0) {
          return direction > 0 ? 0 : suggestions.length - 1;
        }
        return (current + direction + suggestions.length) % suggestions.length;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const suggestion =
        activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      if (suggestion) handleSendLater(suggestion.date);
    }
  };

  return (
    <div className="flex items-center">
      <Button
        size="sm"
        variant="default"
        className="rounded-r-none pr-3"
        disabled={disabled || isSending || isScheduling}
        onClick={onSend}
        type="button"
      >
        <IconSend className="h-3.5 w-3.5 mr-1.5" />
        {isSending ? t("mail.compose.sending") : t("mail.compose.send")}
      </Button>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="default"
            className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
            aria-label={t("mail.sendLater.scheduleSend")}
            disabled={disabled || isSending || isScheduling}
            type="button"
          >
            <IconChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 max-w-[calc(100vw-2rem)] p-3"
          align="end"
          side="top"
          onEscapeKeyDown={(event) => {
            if (!query) return;
            event.preventDefault();
            setNaturalInput("");
            setActiveIndex(-1);
          }}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("mail.sendLater.scheduleSend")}
            </div>
            <Input
              type="text"
              role="combobox"
              aria-label={t("mail.sendLater.dateInput")}
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls={suggestions.length ? listboxId : undefined}
              aria-activedescendant={
                activeIndex >= 0 && suggestions[activeIndex]
                  ? `${listboxId}-option-${activeIndex}`
                  : undefined
              }
              autoFocus
              placeholder={t("mail.sendLater.inputPlaceholder")}
              value={naturalInput}
              disabled={isDisabled}
              onChange={(event) => {
                const nextInput = event.currentTarget.value;
                setNaturalInput(nextInput);
                setActiveIndex(nextInput.trim() ? 0 : -1);
              }}
              onKeyDown={handleInputKeyDown}
            />
            {suggestions.length > 0 && (
              <div id={listboxId} role="listbox" className="space-y-1">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.label}-${suggestion.date.getTime()}`}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    onClick={() => handleSendLater(suggestion.date)}
                    disabled={isDisabled}
                    className="group flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors aria-selected:bg-accent aria-selected:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="min-w-0 text-sm font-medium">
                      {suggestion.label}
                    </span>
                    {!query && (
                      <span className="shrink-0 text-[11px] text-muted-foreground group-hover:text-accent-foreground/70">
                        {formatters.formatDate(suggestion.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {query && !parsedDate && (
              <div
                role="status"
                className="px-2.5 py-2 text-sm text-muted-foreground"
              >
                {t("mail.sendLater.noDateMatch")}
              </div>
            )}
            <div className="border-t pt-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={openDatePicker}
                  disabled={isDisabled}
                  aria-controls={dateInputId}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <IconCalendar className="h-4 w-4" />
                  {t("mail.sendLater.pickDateTime")}
                </button>
                <input
                  id={dateInputId}
                  ref={dateInputRef}
                  type="datetime-local"
                  min={formatLocalDateTime(new Date(Date.now() + 60_000))}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    const date = new Date(event.currentTarget.value);
                    if (Number.isFinite(date.getTime())) {
                      handleSendLater(date);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
