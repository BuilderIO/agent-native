import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  IconArrowsExchange,
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconCopy,
  IconKeyboard,
  IconLoader2,
  IconMicrophone2,
} from "@tabler/icons-react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DayHeader } from "@/components/meetings/day-header";
import { PageHeader } from "@/components/library/page-header";

export function meta() {
  return [{ title: "Dictate · Clips" }];
}

interface Dictation {
  id: string;
  fullText: string;
  cleanedText?: string | null;
  durationMs?: number | null;
  audioUrl?: string | null;
  source?: "fn-hold" | "cmd-shift-space" | string;
  createdAt: string;
}

type SourceFilter = "all" | "fn-hold" | "cmd-shift-space";

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function dayBucket(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const startOfDay = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ms = 24 * 60 * 60 * 1000;
    const diff = Math.round((startOfDay(today) - startOfDay(d)) / ms);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff > 1 && diff <= 6) {
      return d.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "Earlier";
  }
}

function sourceMeta(source: string | undefined): {
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "fn-hold":
      return {
        label: "Hold Fn",
        icon: <IconKeyboard className="h-3 w-3" />,
      };
    case "cmd-shift-space":
      return {
        label: "Cmd+Shift+Space",
        icon: <IconCommand className="h-3 w-3" />,
      };
    default:
      return {
        label: source ?? "Voice",
        icon: <IconMicrophone2 className="h-3 w-3" />,
      };
  }
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error("Couldn't copy");
  }
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function HowToCard({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-accent/20 mb-6"
    >
      <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
        <div className="flex items-center gap-2">
          <IconMicrophone2 className="h-4 w-4 text-foreground" />
          <span className="text-sm font-medium">How to use Dictate</span>
        </div>
        {open ? (
          <IconChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <IconChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Kbd>Fn</Kbd>
              <span className="text-xs font-medium">Hold to dictate</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hold the Fn key anywhere on your Mac. Speak. Release. Your text is
              dictated into the focused field.
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Space</Kbd>
              <span className="text-xs font-medium">Toggle hands-free</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Press once to start, again to stop. Useful for longer thoughts.
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: SourceFilter;
  onChange: (next: SourceFilter) => void;
  counts: Record<SourceFilter, number>;
}) {
  const tabs: Array<{ id: SourceFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "fn-hold", label: "Hold Fn" },
    { id: "cmd-shift-space", label: "Cmd+Shift+Space" },
  ];
  return (
    <div className="flex items-center gap-1 mb-3">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs cursor-pointer transition-colors",
              active
                ? "bg-foreground text-background"
                : "bg-accent/40 text-foreground hover:bg-accent/70",
            )}
          >
            {t.label}
            <span
              className={cn(
                "tabular-nums text-[10px]",
                active ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {counts[t.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DictationRow({ dictation }: { dictation: Dictation }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const cleanup = useActionMutation<any, { id: string }>("cleanup-dictation");
  const replaceOriginal = useActionMutation<
    any,
    { id: string; fullText: string }
  >("update-dictation");
  const { label, icon } = sourceMeta(dictation.source);

  const preview = (dictation.cleanedText || dictation.fullText || "").slice(
    0,
    140,
  );

  const handleCleanup = (e: React.MouseEvent) => {
    e.stopPropagation();
    cleanup.mutate(
      { id: dictation.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
      },
    );
  };

  const handleReplaceOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!dictation.cleanedText) return;
    const next = dictation.cleanedText;
    // Optimistic — patch the list cache immediately.
    qc.setQueryData<any>(["action", "list-dictations", {}], (prev: any) => {
      if (!prev) return prev;
      const list: Dictation[] = Array.isArray(prev) ? prev : prev.dictations;
      if (!list) return prev;
      const updated = list.map((d) =>
        d.id === dictation.id ? { ...d, fullText: next } : d,
      );
      return Array.isArray(prev) ? updated : { ...prev, dictations: updated };
    });
    replaceOriginal.mutate(
      { id: dictation.id, fullText: next },
      {
        onSuccess: () => {
          toast.success("Replaced original with cleaned text");
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
        onError: () => {
          toast.error("Couldn't replace");
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
      },
    );
  };

  return (
    <div
      className={cn(
        "border-b border-border last:border-b-0 cursor-pointer",
        expanded ? "bg-accent/20" : "hover:bg-accent/10",
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-sm">
        <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {expanded ? (
            <IconChevronDown className="h-3.5 w-3.5" />
          ) : (
            <IconChevronRight className="h-3.5 w-3.5" />
          )}
          {formatTime(dictation.createdAt)}
        </div>
        <div className="col-span-2">
          <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
            {icon}
            {label}
          </Badge>
        </div>
        <div className="col-span-6 truncate text-foreground/90">
          {preview || (
            <span className="text-muted-foreground italic">No text</span>
          )}
        </div>
        <div className="col-span-1 text-right text-xs text-muted-foreground tabular-nums">
          {formatDuration(dictation.durationMs)}
        </div>
        <div className="col-span-1 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              void copyToClipboard(
                dictation.cleanedText || dictation.fullText || "",
                "text",
              );
            }}
            className="h-7 w-7 p-0 cursor-pointer"
            title="Copy"
          >
            <IconCopy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Original
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyToClipboard(dictation.fullText || "", "original");
                  }}
                  className="h-6 gap-1 text-[10px] cursor-pointer"
                >
                  <IconCopy className="h-3 w-3" />
                  Copy
                </Button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {dictation.fullText || (
                  <span className="text-muted-foreground italic">
                    Empty transcript
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cleaned
                </div>
                <div className="flex items-center gap-1">
                  {dictation.cleanedText && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyToClipboard(
                            dictation.cleanedText || "",
                            "cleaned",
                          );
                        }}
                        className="h-6 gap-1 text-[10px] cursor-pointer"
                      >
                        <IconCopy className="h-3 w-3" />
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleReplaceOriginal}
                        disabled={replaceOriginal.isPending}
                        className="h-6 gap-1 text-[10px] cursor-pointer"
                        title="Replace original with cleaned"
                      >
                        {replaceOriginal.isPending ? (
                          <IconLoader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <IconArrowsExchange className="h-3 w-3" />
                        )}
                        Replace
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCleanup}
                    disabled={cleanup.isPending}
                    className="h-6 gap-1 text-[10px] cursor-pointer"
                  >
                    {cleanup.isPending ? (
                      <IconLoader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    Cleanup with AI
                  </Button>
                </div>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {dictation.cleanedText || (
                  <span className="text-muted-foreground italic">
                    Click "Cleanup with AI" to fix punctuation, casing, and
                    filler words.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-gradient-to-br from-accent/30 via-transparent to-transparent px-6 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background">
        <IconMicrophone2 className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-medium text-foreground">
        Start your first dictation
      </p>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
        Hold a key anywhere on your Mac, speak, and let Clips clean it up. Your
        history will live here.
      </p>
      <div className="mt-5 flex items-center justify-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Fn</Kbd>
          <span>hold</span>
        </span>
        <span className="text-muted-foreground/40">or</span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>Space</Kbd>
        </span>
      </div>
    </div>
  );
}

export default function DictateRoute() {
  const { data, isLoading, isError } = useActionQuery<
    { dictations: Dictation[] } | Dictation[] | undefined
  >("list-dictations", {}, { retry: false });

  const [filter, setFilter] = useState<SourceFilter>("all");

  const dictations: Dictation[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.dictations ?? [];
  }, [data]);

  const counts = useMemo<Record<SourceFilter, number>>(() => {
    const c: Record<SourceFilter, number> = {
      all: dictations.length,
      "fn-hold": 0,
      "cmd-shift-space": 0,
    };
    for (const d of dictations) {
      if (d.source === "fn-hold") c["fn-hold"]++;
      else if (d.source === "cmd-shift-space") c["cmd-shift-space"]++;
    }
    return c;
  }, [dictations]);

  const filtered = useMemo(() => {
    if (filter === "all") return dictations;
    return dictations.filter((d) => d.source === filter);
  }, [dictations, filter]);

  const grouped = useMemo<Array<[string, Dictation[]]>>(() => {
    const map = new Map<string, Dictation[]>();
    // Already comes back desc; keep order.
    for (const d of filtered) {
      const k = dayBucket(d.createdAt);
      const arr = map.get(k) ?? [];
      arr.push(d);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const isEmpty = !isLoading && !isError && dictations.length === 0;

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Dictate
        </h1>
      </PageHeader>
      <div className="p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            Voice-to-text dictation with AI cleanup. Hold Fn anywhere on your
            Mac to start.
          </p>
        </div>

        <HowToCard defaultOpen={isEmpty} />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Couldn't load dictations.
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <FilterTabs value={filter} onChange={setFilter} counts={counts} />

            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No dictations matching this filter.
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([day, items]) => (
                  <div key={day} className="space-y-2">
                    <DayHeader label={day} />
                    <div className="rounded-lg border border-border bg-background overflow-hidden">
                      <div className="grid grid-cols-12 items-center gap-3 px-4 py-2 border-b border-border bg-accent/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="col-span-2">When</div>
                        <div className="col-span-2">Source</div>
                        <div className="col-span-6">Text</div>
                        <div className="col-span-1 text-right">Duration</div>
                        <div className="col-span-1" />
                      </div>
                      <div>
                        {items.map((d) => (
                          <DictationRow key={d.id} dictation={d} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
