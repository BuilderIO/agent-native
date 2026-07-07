/**
 * Cmd+J "Ask about this meeting" sidebar.
 *
 * Granola's signature pattern (from `granola-ux.md` §6):
 *
 *   "During recording, empty state on right pane: literally blank — the point
 *    is to NOT fill the canvas with AI noise mid-meeting. Mid-meeting AI is
 *    accessed only via Cmd+J chat sidebar."
 *
 * Implementation:
 *   - 320px slide-in panel on the right (shadcn `Sheet`).
 *   - Header + 3 quick-prompt buttons + free-form composer.
 *   - All AI work delegates to the agent chat via `sendToAgentChat` (per the
 *     `delegate-to-agent` skill). Never inline LLM calls.
 *   - The keyboard handler is mounted ONCE per page-mount (single
 *     `keydown` listener with cleanup) so toggling open/close doesn't leak
 *     listeners. Esc and Cmd+J both close the sheet.
 */

import { sendToAgentChat, useT } from "@agent-native/core/client";
import {
  IconCommand,
  IconNotes,
  IconSend,
  IconWand,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const QUICK_PROMPTS: Array<{ labelKey: string; promptKey: string }> = [
  {
    labelKey: "quickAsk.whatDidIMiss",
    promptKey: "quickAsk.whatDidIMissPrompt",
  },
  {
    labelKey: "quickAsk.suggestQuestions",
    promptKey: "quickAsk.suggestQuestionsPrompt",
  },
  {
    labelKey: "quickAsk.summarizeLastFive",
    promptKey: "quickAsk.summarizeLastFivePrompt",
  },
  {
    labelKey: "quickAsk.makeMeSoundSmart",
    promptKey: "quickAsk.makeMeSoundSmartPrompt",
  },
  {
    labelKey: "quickAsk.actionItemsForMe",
    promptKey: "quickAsk.actionItemsForMePrompt",
  },
];

interface TranscriptSegment {
  startMs: number;
  endMs?: number;
  text: string;
  speaker?: string | null;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
}

interface QuickAskSidebarProps {
  meetingId: string;
  meetingTitle?: string;
  segments?: TranscriptSegment[] | null;
}

/**
 * Mounts the Cmd+J keybinding on the meeting detail page. The toggle is
 * idempotent: pressing Cmd+J while open closes the sheet (and vice versa).
 *
 * IMPORTANT: we register exactly one keydown handler. The `useEffect` cleanup
 * unsubscribes — so route changes / unmounts never leave a stale listener.
 */
export function QuickAskSidebar({
  meetingId,
  meetingTitle,
  segments,
}: QuickAskSidebarProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Single global keydown listener; toggles on Cmd/Ctrl+J. Esc is handled
  // natively by `Sheet` (Radix Dialog).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (cmdOrCtrl && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus the composer whenever the sheet opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      // Build a compact context object: meeting id + last 200 segments.
      // Agent chat is the single source of truth — no inline LLM calls.
      const tail = (segments ?? []).slice(-200);
      const turn: ChatTurn = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        text: trimmed,
        ts: Date.now(),
      };
      setHistory((prev) => [...prev, turn]);
      setDraft("");
      sendToAgentChat({
        message: trimmed,
        context: JSON.stringify({
          meetingId,
          meetingTitle: meetingTitle ?? null,
          transcript: tail,
        }),
        submit: true,
        openSidebar: false,
        background: false,
      });
      // Optimistic placeholder so the user sees we received the prompt.
      setHistory((prev) => [
        ...prev,
        {
          id: `${turn.id}-ack`,
          role: "system",
          text: t("quickAsk.sentToChat"),
          ts: Date.now(),
        },
      ]);
    },
    [meetingId, meetingTitle, segments, t],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-[320px] sm:max-w-[320px] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <IconWand className="h-4 w-4 text-primary" />
            {t("quickAsk.title")}
          </SheetTitle>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <kbd className="inline-flex items-center gap-0.5 rounded border border-border bg-muted/50 px-1 py-px font-mono">
              <IconCommand className="h-3 w-3" />J
            </kbd>
            <span>{t("quickAsk.toggleHint")}</span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("quickAsk.quickPrompts")}
            </p>
            <div className="flex flex-col gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.labelKey}
                  type="button"
                  onClick={() => send(t(q.promptKey))}
                  className="text-start text-xs rounded-md border border-border bg-background px-2.5 py-2 hover:bg-accent/40 cursor-pointer"
                >
                  {t(q.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("quickAsk.history")}
              </p>
              <div className="space-y-2">
                {history.map((t) => (
                  <Card
                    key={t.id}
                    className={cn(
                      "px-2.5 py-1.5 text-xs leading-relaxed",
                      t.role === "user"
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/40 border-border",
                    )}
                  >
                    {t.text}
                  </Card>
                ))}
              </div>
            </div>
          )}

          {history.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-6 text-muted-foreground">
              <IconNotes className="h-5 w-5" />
              <p className="text-xs">{t("quickAsk.emptyDescription")}</p>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="border-t border-border p-3 flex items-end gap-2"
        >
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("quickAsk.placeholder")}
            className="min-h-[44px] max-h-32 resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!draft.trim()}
            className="cursor-pointer h-9 w-9 shrink-0"
            aria-label={t("quickAsk.send")}
          >
            <IconSend className="h-4 w-4 rtl:-scale-x-100" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
