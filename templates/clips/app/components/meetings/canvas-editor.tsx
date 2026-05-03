import { useEffect, useRef, useState } from "react";
import { IconWand } from "@tabler/icons-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ActionItem {
  id?: string;
  text: string;
  assigneeEmail?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
}

interface CanvasEditorProps {
  /** AI-generated summary (renders muted-gray). */
  summaryMd: string;
  /** AI-generated bullets (renders muted-gray). */
  bullets: string[];
  /** AI-generated action items (renders muted-gray). */
  actionItems: ActionItem[];
  /** User's own notes (renders bold black). Top of the canvas. */
  userNotesMd: string;
  /**
   * Save user notes. Called on blur after edit.
   */
  onUserNotesChange: (next: string) => void;
  /**
   * Save AI summary. Called when the user edits the summary section.
   * The container should also flip the section to userNotesMd if you want
   * Granola's "transfer to user" behavior — see onTransferAiToUser.
   */
  onSummaryChange: (next: string) => void;
  /**
   * Optional: when the user starts editing AI content, "promote" it into
   * userNotesMd so re-generation doesn't blow it away. Granola convention.
   */
  onTransferAiToUser?: (transferredMd: string) => void;
  /** Render bullets with magnifier (BulletLink) wrappers. */
  renderBullet?: (bullet: string, index: number) => React.ReactNode;
}

/**
 * Two-tone meeting canvas (Granola-signature):
 *   - User notes (top): bold black `text-foreground`
 *   - AI content (below): muted gray `text-muted-foreground`
 *   - Click any block to edit; on blur saves optimistically.
 *   - Editing AI text "transfers" it into the user's notes (so it survives
 *     re-generation), and the new merged text flips to black.
 */
export function CanvasEditor({
  summaryMd,
  bullets,
  actionItems,
  userNotesMd,
  onUserNotesChange,
  onSummaryChange,
  onTransferAiToUser,
  renderBullet,
}: CanvasEditorProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-6 max-w-2xl">
        {/* User notes block — black, top */}
        <UserNotesBlock value={userNotesMd} onChange={onUserNotesChange} />

        {/* Divider only when there's both user notes and AI content */}
        {userNotesMd &&
          (summaryMd || bullets.length > 0 || actionItems.length > 0) && (
            <div className="h-px bg-border/60" />
          )}

        {/* AI summary — muted gray */}
        {summaryMd && (
          <AiSummaryBlock
            value={summaryMd}
            onChange={onSummaryChange}
            onTransferToUser={onTransferAiToUser}
          />
        )}

        {/* AI bullets — muted gray, with optional BulletLink wrappers */}
        {bullets.length > 0 && (
          <AiBulletsBlock bullets={bullets} renderBullet={renderBullet} />
        )}

        {/* AI action items — muted gray */}
        {actionItems.length > 0 && <AiActionItemsBlock items={actionItems} />}
      </div>
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

  const commit = () => {
    setEditing(false);
    const next = draft;
    if (next !== value) onChange(next);
  };

  if (editing) {
    return (
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
        placeholder="Your notes…"
        className="min-h-[80px] text-base leading-relaxed text-foreground font-medium border-none shadow-none focus-visible:ring-0 px-0"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block w-full text-left cursor-text"
      title="Click to add your notes"
    >
      {value ? (
        <p className="text-base leading-relaxed text-foreground font-medium whitespace-pre-wrap">
          {value}
        </p>
      ) : (
        <p className="text-base leading-relaxed text-muted-foreground/50 italic">
          Click to add your notes…
        </p>
      )}
    </button>
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
          className="min-h-[100px] text-sm leading-relaxed text-foreground border-none shadow-none focus-visible:ring-0 px-0"
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="group relative space-y-1.5">
        <AiTabIndicator />
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block w-full text-left cursor-text"
          title="Click to edit (your edits are saved as your own notes)"
        >
          <p
            className={cn(
              "text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground rounded -mx-1 px-1 group-hover:bg-accent/30",
            )}
          >
            {value}
          </p>
        </button>
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

function AiActionItemsBlock({ items }: { items: ActionItem[] }) {
  return (
    <div className="space-y-1.5">
      <AiTabIndicator label="Action items" />
      <ul className="space-y-1 text-sm leading-relaxed text-muted-foreground">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span>☐</span>
            <span className={cn("flex-1", it.completedAt && "line-through")}>
              {it.text}
              {it.assigneeEmail && (
                <span className="ml-1.5 text-xs">— {it.assigneeEmail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AiTabIndicator({ label = "AI" }: { label?: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
      <IconWand className="h-3 w-3" />
      <span>{label}</span>
    </div>
  );
}
