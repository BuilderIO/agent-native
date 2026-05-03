import { useMemo, useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconKeyboard,
  IconLoader2,
  IconMicrophone2,
  IconWand,
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

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  } catch {
    return iso;
  }
}

function sourceLabel(source: string | undefined): {
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

function HowToCard() {
  const [open, setOpen] = useState(true);
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
          <div className="rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <IconKeyboard className="h-4 w-4 text-foreground" />
              <span className="text-xs font-medium">Hold Fn</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hold the Fn key anywhere on your Mac. Speak. Release. Your text is
              dictated into the focused field.
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <IconCommand className="h-4 w-4 text-foreground" />
              <span className="text-xs font-medium">Cmd+Shift+Space</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Toggle dictation hands-free. Press once to start, again to stop.
              Useful for longer thoughts.
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DictationRow({ dictation }: { dictation: Dictation }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const cleanup = useActionMutation<any, { id: string }>("cleanup-dictation");
  const { label, icon } = sourceLabel(dictation.source);

  const preview = (dictation.cleanedText || dictation.fullText || "").slice(
    0,
    140,
  );

  const handleCleanup = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Optimistic — show spinner only on the row, don't await navigation.
    cleanup.mutate(
      { id: dictation.id },
      {
        onSuccess: () => {
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
          {formatTimestamp(dictation.createdAt)}
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
        <div className="col-span-2 text-right text-xs text-muted-foreground tabular-nums">
          {formatDuration(dictation.durationMs)}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Original
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
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cleaned
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCleanup}
                  disabled={cleanup.isPending}
                  className="h-6 gap-1 text-[10px] cursor-pointer"
                >
                  {cleanup.isPending ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <IconWand className="h-3 w-3" />
                  )}
                  Cleanup with AI
                </Button>
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

export default function DictateRoute() {
  const { data, isLoading, isError } = useActionQuery<
    { dictations: Dictation[] } | Dictation[] | undefined
  >("list-dictations", {}, { retry: false });

  const dictations: Dictation[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.dictations ?? [];
  }, [data]);

  return (
    <div className="p-6 max-w-5xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconMicrophone2 className="h-6 w-6" />
          Dictate
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Voice-to-text dictation history. Hold Fn anywhere to dictate.
        </p>
      </div>

      <HowToCard />

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
      ) : dictations.length === 0 ? (
        <div
          className={cn(
            "rounded-md border border-dashed border-border bg-accent/20",
            "px-6 py-12 text-center",
          )}
        >
          <IconMicrophone2 className="h-8 w-8 text-muted-foreground/60 mx-auto" />
          <p className="mt-2 text-sm text-muted-foreground">
            No dictations yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Hold the Fn key anywhere to start your first one.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <div className="grid grid-cols-12 items-center gap-3 px-4 py-2 border-b border-border bg-accent/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div className="col-span-2">When</div>
            <div className="col-span-2">Source</div>
            <div className="col-span-6">Text</div>
            <div className="col-span-2 text-right">Duration</div>
          </div>
          <div>
            {dictations.map((d) => (
              <DictationRow key={d.id} dictation={d} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
