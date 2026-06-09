import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconWand } from "@tabler/icons-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  dep: unknown,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, dep]);
}

interface CanvasEditorProps {
  /** Which content this canvas renders. */
  view: "user" | "ai";
  /** User's own notes (renders bold black). Required for the "user" view. */
  userNotesMd?: string;
  /** Save user notes. Called on blur after edit. */
  onUserNotesChange?: (next: string) => void;
  /** AI-generated summary (renders muted-gray). For the "ai" view. */
  summaryMd?: string;
  /** AI-generated bullets (renders muted-gray). For the "ai" view. */
  bullets?: string[];
  /** Save AI summary when the user edits the summary section. */
  onSummaryChange?: (next: string) => void;
  /**
   * Optional: when the user starts editing AI content, "promote" it into
   * userNotesMd so re-generation doesn't blow it away. Granola convention.
   */
  onTransferAiToUser?: (transferredMd: string) => void;
  /** Render bullets with magnifier (BulletLink) wrappers. */
  renderBullet?: (bullet: string, index: number) => React.ReactNode;
}

export function CanvasEditor({
  view,
  userNotesMd = "",
  onUserNotesChange,
  summaryMd = "",
  bullets = [],
  onSummaryChange,
  onTransferAiToUser,
  renderBullet,
}: CanvasEditorProps) {
  const showUser = view === "user";
  const showAi = view === "ai";
  const hasAi = summaryMd || bullets.length > 0;

  return (
    <div className="px-6 py-6 space-y-6 max-w-2xl">
      {/* User notes block */}
      {showUser && (
        <UserNotesBlock
          value={userNotesMd}
          onChange={onUserNotesChange ?? (() => {})}
        />
      )}

      {/* AI summary */}
      {showAi && summaryMd && (
        <AiSummaryBlock
          value={summaryMd}
          onChange={onSummaryChange ?? (() => {})}
          onTransferToUser={onTransferAiToUser}
        />
      )}

      {/* AI bullets — muted gray, with optional BulletLink wrappers */}
      {showAi && bullets.length > 0 && (
        <AiBulletsBlock bullets={bullets} renderBullet={renderBullet} />
      )}

      {/* Empty state when AI notes haven't been generated yet */}
      {showAi && !hasAi && (
        <p className="text-sm leading-relaxed text-muted-foreground/50 italic">
          No AI notes yet. Generate notes from a finished transcript.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UserNotesBlock({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // Sync external updates (live polling, desktop-app sync) into the editor —
  // but only while it's not focused, so we never clobber what's being typed.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useAutoGrow(ref, draft);

  return (
    <Textarea
      ref={ref}
      value={draft}
      placeholder="Your notes…"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        if (e.target.value !== value) onChange(e.target.value);
      }}
      className="min-h-[80px] resize-none overflow-hidden text-base leading-relaxed text-foreground font-medium border-none shadow-none focus-visible:ring-0 px-0"
    />
  );
}

/* -------------------------------------------------------------------------- */

function AiSummaryBlock({
  value,
  onChange,
  onTransferToUser,
}: {
  value: string;
  onChange: (next: string) => void;
  onTransferToUser?: (transferred: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [editing]);

  useAutoGrow(ref, editing ? draft : null);

  const commit = () => {
    setEditing(false);
    const next = draft;
    if (next === value) return;
    if (onTransferToUser) {
      // Promote edited AI content into user notes; clear original AI summary.
      onTransferToUser(next);
      onChange("");
    } else {
      onChange(next);
    }
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        <AiTabIndicator />
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          // Once the user starts typing, it visually flips to foreground.
          className="min-h-[100px] resize-none overflow-hidden text-sm leading-relaxed text-foreground border-none shadow-none focus-visible:ring-0 px-0"
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="group relative space-y-1.5">
        <AiTabIndicator />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full text-left cursor-text"
            >
              <p
                className={cn(
                  "text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground rounded -mx-1 px-1 group-hover:bg-accent/30",
                )}
              >
                {value}
              </p>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Click to edit (your edits are saved as your own notes)
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */

function AiBulletsBlock({
  bullets,
  renderBullet,
}: {
  bullets: string[];
  renderBullet?: (bullet: string, index: number) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <AiTabIndicator />
      <ul className="space-y-1.5">
        {bullets.map((b, i) => {
          const content = (
            <div className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
              <span>•</span>
              <span className="flex-1">{b}</span>
            </div>
          );
          return <li key={i}>{renderBullet ? renderBullet(b, i) : content}</li>;
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AiTabIndicator() {
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
      <IconWand className="h-3 w-3" />
      <span>AI</span>
    </div>
  );
}
