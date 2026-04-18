import { useMemo, useState } from "react";
import {
  IconCalendar,
  IconClock,
  IconUsers,
  IconBuilding,
  IconTag,
  IconBookmark,
  IconX,
  IconCheck,
  IconPlus,
  IconFilter,
  IconDeviceDesktop,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type SourceFilter = "upload" | "browser" | "recall-bot" | "zoom-cloud";

export interface FilterState {
  dateFrom: string | null;
  dateTo: string | null;
  durationMinMs: number | null;
  durationMaxMs: number | null;
  participantEmails: string[];
  accountId: string | null;
  trackerIds: string[];
  internalOnly: boolean;
  source: SourceFilter | null;
}

export const EMPTY_FILTER: FilterState = {
  dateFrom: null,
  dateTo: null,
  durationMinMs: null,
  durationMaxMs: null,
  participantEmails: [],
  accountId: null,
  trackerIds: [],
  internalOnly: false,
  source: null,
};

export interface ParticipantOption {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface AccountOption {
  id: string;
  name: string;
  logoUrl?: string | null;
}

export interface TrackerOption {
  id: string;
  name: string;
  color: string;
}

interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  participants: ParticipantOption[];
  accounts: AccountOption[];
  trackers: TrackerOption[];
  workspaceId?: string;
  className?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function msToMinutes(ms: number | null): number | null {
  if (ms == null) return null;
  return Math.round(ms / 60000);
}

function minutesToMs(m: number): number {
  return Math.round(m * 60000);
}

const DURATION_MAX_MIN = 180;

export function FilterBar({
  value,
  onChange,
  participants,
  accounts,
  trackers,
  workspaceId,
  className,
}: FilterBarProps) {
  const activeCount = useMemo(() => {
    let n = 0;
    if (value.dateFrom || value.dateTo) n++;
    if (value.durationMinMs != null || value.durationMaxMs != null) n++;
    if (value.participantEmails.length) n++;
    if (value.accountId) n++;
    if (value.trackerIds.length) n++;
    if (value.internalOnly) n++;
    if (value.source) n++;
    return n;
  }, [value]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const qc = useQueryClient();
  const createSavedView = useActionMutation<any, { name: string; filtersJson: string; workspaceId?: string }>(
    "create-saved-view",
  );

  function set<K extends keyof FilterState>(key: K, v: FilterState[K]) {
    onChange({ ...value, [key]: v });
  }

  function reset() {
    onChange(EMPTY_FILTER);
  }

  const dateLabel = (() => {
    if (value.dateFrom && value.dateTo)
      return `${formatDate(value.dateFrom)} – ${formatDate(value.dateTo)}`;
    if (value.dateFrom) return `From ${formatDate(value.dateFrom)}`;
    if (value.dateTo) return `Until ${formatDate(value.dateTo)}`;
    return "Date";
  })();

  const durationLabel = (() => {
    const min = msToMinutes(value.durationMinMs);
    const max = msToMinutes(value.durationMaxMs);
    if (min != null && max != null) return `${min}–${max} min`;
    if (min != null) return `≥ ${min} min`;
    if (max != null) return `≤ ${max} min`;
    return "Duration";
  })();

  const participantsLabel = (() => {
    if (value.participantEmails.length === 0) return "Participants";
    if (value.participantEmails.length === 1)
      return value.participantEmails[0];
    return `${value.participantEmails.length} participants`;
  })();

  const accountLabel = value.accountId
    ? (accounts.find((a) => a.id === value.accountId)?.name ?? "Account")
    : "Account";

  const trackersLabel = (() => {
    if (value.trackerIds.length === 0) return "Trackers";
    if (value.trackerIds.length === 1) {
      return trackers.find((t) => t.id === value.trackerIds[0])?.name ?? "Tracker";
    }
    return `${value.trackerIds.length} trackers`;
  })();

  const sourceLabel = (() => {
    if (!value.source) return "Source";
    return SOURCE_LABELS[value.source];
  })();

  async function handleSaveView() {
    const name = saveName.trim();
    if (!name) return;
    try {
      await createSavedView.mutateAsync({
        name,
        filtersJson: JSON.stringify(value),
        workspaceId,
      });
      toast.success(`View "${name}" saved`);
      qc.invalidateQueries({ queryKey: ["action", "list-saved-views"] });
      setSaveName("");
      setSaveOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="toolbar"
      aria-label="Filters"
    >
      {/* Date */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconCalendar}
            label={dateLabel}
            active={!!(value.dateFrom || value.dateTo)}
            onClear={
              value.dateFrom || value.dateTo
                ? () => onChange({ ...value, dateFrom: null, dateTo: null })
                : undefined
            }
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="range"
            selected={{
              from: value.dateFrom ? new Date(value.dateFrom) : undefined,
              to: value.dateTo ? new Date(value.dateTo) : undefined,
            }}
            onSelect={(range: any) => {
              onChange({
                ...value,
                dateFrom: range?.from
                  ? new Date(range.from).toISOString()
                  : null,
                dateTo: range?.to ? new Date(range.to).toISOString() : null,
              });
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {/* Duration */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconClock}
            label={durationLabel}
            active={
              value.durationMinMs != null || value.durationMaxMs != null
            }
            onClear={
              value.durationMinMs != null || value.durationMaxMs != null
                ? () =>
                    onChange({
                      ...value,
                      durationMinMs: null,
                      durationMaxMs: null,
                    })
                : undefined
            }
          />
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <Label className="text-xs text-muted-foreground">
            Duration (minutes)
          </Label>
          <Slider
            className="mt-4"
            min={0}
            max={DURATION_MAX_MIN}
            step={5}
            value={[
              msToMinutes(value.durationMinMs) ?? 0,
              msToMinutes(value.durationMaxMs) ?? DURATION_MAX_MIN,
            ]}
            onValueChange={(vals) => {
              const [lo, hi] = vals;
              onChange({
                ...value,
                durationMinMs: lo > 0 ? minutesToMs(lo) : null,
                durationMaxMs:
                  hi < DURATION_MAX_MIN ? minutesToMs(hi) : null,
              });
            }}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{msToMinutes(value.durationMinMs) ?? 0} min</span>
            <span>
              {msToMinutes(value.durationMaxMs) ?? DURATION_MAX_MIN} min
            </span>
          </div>
        </PopoverContent>
      </Popover>

      {/* Participants */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconUsers}
            label={participantsLabel}
            active={value.participantEmails.length > 0}
            onClear={
              value.participantEmails.length > 0
                ? () => set("participantEmails", [])
                : undefined
            }
          />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <ParticipantPicker
            options={participants}
            selected={value.participantEmails}
            onChange={(next) => set("participantEmails", next)}
          />
        </PopoverContent>
      </Popover>

      {/* Account */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconBuilding}
            label={accountLabel}
            active={!!value.accountId}
            onClear={value.accountId ? () => set("accountId", null) : undefined}
          />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="max-h-72 overflow-y-auto p-1">
            {accounts.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No accounts yet
              </div>
            )}
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  set("accountId", value.accountId === a.id ? null : a.id)
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                  value.accountId === a.id && "bg-accent",
                )}
              >
                {a.logoUrl ? (
                  <img
                    src={a.logoUrl}
                    alt=""
                    className="h-5 w-5 rounded object-cover"
                  />
                ) : (
                  <IconBuilding className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-left">{a.name}</span>
                {value.accountId === a.id && (
                  <IconCheck className="h-3.5 w-3.5" />
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Trackers */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconTag}
            label={trackersLabel}
            active={value.trackerIds.length > 0}
            onClear={
              value.trackerIds.length > 0
                ? () => set("trackerIds", [])
                : undefined
            }
          />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="max-h-72 overflow-y-auto p-1">
            {trackers.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No trackers yet
              </div>
            )}
            {trackers.map((t) => {
              const checked = value.trackerIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    const next = checked
                      ? value.trackerIds.filter((x) => x !== t.id)
                      : [...value.trackerIds, t.id];
                    set("trackerIds", next);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                    checked && "bg-accent",
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: t.color }}
                  />
                  <span className="flex-1 truncate text-left">{t.name}</span>
                  {checked && <IconCheck className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Source */}
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            icon={IconDeviceDesktop}
            label={sourceLabel}
            active={!!value.source}
            onClear={value.source ? () => set("source", null) : undefined}
          />
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <div className="p-1">
            {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  set("source", value.source === s ? null : s)
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                  value.source === s && "bg-accent",
                )}
              >
                <span className="flex-1 truncate text-left">
                  {SOURCE_LABELS[s]}
                </span>
                {value.source === s && <IconCheck className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Internal only */}
      <button
        type="button"
        onClick={() => set("internalOnly", !value.internalOnly)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs",
          value.internalOnly
            ? "bg-foreground text-background border-foreground"
            : "bg-background text-foreground border-border hover:bg-accent",
        )}
      >
        <IconUsers className="h-3.5 w-3.5" />
        Internal only
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={reset}
          >
            Clear all
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setSaveOpen(true)}
          disabled={activeCount === 0}
        >
          <IconBookmark className="h-3.5 w-3.5" />
          Save view
        </Button>
      </div>

      <AlertDialog open={saveOpen} onOpenChange={setSaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this view</AlertDialogTitle>
            <AlertDialogDescription>
              Save the current filters so you can jump back to this library
              slice later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g. Pricing objections — this week"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveView}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const SOURCE_LABELS: Record<SourceFilter, string> = {
  upload: "Uploaded file",
  browser: "In-browser recording",
  "recall-bot": "Meeting bot",
  "zoom-cloud": "Zoom Cloud",
};

interface ChipButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClear?: () => void;
}

const ChipButton = ({
  icon: Icon,
  label,
  active,
  onClear,
  ...rest
}: ChipButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...rest}
    className={cn(
      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs",
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background text-foreground border-border hover:bg-accent",
    )}
  >
    <Icon className="h-3.5 w-3.5" />
    <span className="truncate max-w-[12rem]">{label}</span>
    {onClear && active && (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="rounded-full text-background/80 hover:text-background"
      >
        <IconX className="h-3 w-3" />
      </span>
    )}
  </button>
);

interface ParticipantPickerProps {
  options: ParticipantOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function ParticipantPicker({
  options,
  selected,
  onChange,
}: ParticipantPickerProps) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((p) =>
      (p.displayName || p.email).toLowerCase().includes(needle),
    );
  }, [options, q]);

  return (
    <div>
      <div className="border-b border-border p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="h-8"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No people
          </div>
        )}
        {filtered.map((p) => {
          const checked = selected.includes(p.email);
          return (
            <button
              key={p.email}
              type="button"
              onClick={() => {
                const next = checked
                  ? selected.filter((x) => x !== p.email)
                  : [...selected, p.email];
                onChange(next);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                checked && "bg-accent",
              )}
            >
              <Avatar className="h-6 w-6">
                {p.avatarUrl ? (
                  <AvatarImage src={p.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                  {(p.displayName || p.email).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate">{p.displayName || p.email}</div>
                {p.displayName && (
                  <div className="truncate text-[10px] text-muted-foreground">
                    {p.email}
                  </div>
                )}
              </div>
              {checked && <IconCheck className="h-3.5 w-3.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
