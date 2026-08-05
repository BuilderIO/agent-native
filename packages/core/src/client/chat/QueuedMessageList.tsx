import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconPencil,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

export interface QueuedMessageView {
  id: string;
  text: string;
  imageSources: string[];
}

export interface QueuedMessageListProps {
  messages: readonly QueuedMessageView[];
  onEdit: (id: string, text: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  /**
   * Interrupt the active run and send this message now. Omitted when there is
   * no run to interrupt, which is also when the affordance makes no sense.
   */
  onSendNow?: (id: string) => void;
  /**
   * Lets the caller keep each row inside its own scroller item without this
   * component depending on the scroller.
   */
  wrap?: (id: string, node: React.ReactNode) => React.ReactNode;
}

const ACTION_BUTTON_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

function QueuedMessageRow({
  message,
  position,
  total,
  onEdit,
  onMove,
  onRemove,
  onSendNow,
}: {
  message: QueuedMessageView;
  position: number;
  total: number;
  onEdit: (id: string, text: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onSendNow?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(message.text);
  }, [editing, message.text]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    // An empty edit would silently destroy the message; treat it as a cancel
    // and make the user use Remove if that is what they meant.
    if (next.length > 0 && next !== message.text) onEdit(message.id, next);
    setEditing(false);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Queued
          <span className="tabular-nums opacity-70">
            {position + 1}/{total}
          </span>
        </span>
        {onSendNow && (
          <button
            type="button"
            className={ACTION_BUTTON_CLASS}
            onClick={() => onSendNow(message.id)}
            aria-label={`Send queued message ${position + 1} now, interrupting the current run`}
            title="Send now (interrupts the current run)"
          >
            <IconPlayerPlay className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          onClick={() => onMove(message.id, -1)}
          disabled={position === 0}
          aria-label={`Move queued message ${position + 1} earlier`}
        >
          <IconArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          onClick={() => onMove(message.id, 1)}
          disabled={position === total - 1}
          aria-label={`Move queued message ${position + 1} later`}
        >
          <IconArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          onClick={() => setEditing((value) => !value)}
          aria-label={`Edit queued message ${position + 1}`}
          aria-pressed={editing}
        >
          <IconPencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASS}
          onClick={() => onRemove(message.id)}
          aria-label={`Remove queued message ${position + 1}`}
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-w-[85%] rounded-lg border border-dashed border-border bg-accent/40 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/70">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              aria-label={`Queued message ${position + 1} text`}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                className={ACTION_BUTTON_CLASS}
                onClick={() => setEditing(false)}
                aria-label="Cancel edit"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={ACTION_BUTTON_CLASS}
                onClick={commit}
                aria-label="Save edit"
              >
                <IconCheck className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          message.text
        )}
        {message.imageSources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.imageSources.map((source, index) => (
              <img
                key={index}
                src={source}
                alt=""
                className="h-12 w-12 rounded border border-border/50 object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function QueuedMessageList({
  messages,
  onEdit,
  onMove,
  onRemove,
  onSendNow,
  wrap,
}: QueuedMessageListProps) {
  return (
    <>
      {messages.map((message, index) => {
        const row = (
          <QueuedMessageRow
            key={message.id}
            message={message}
            position={index}
            total={messages.length}
            onEdit={onEdit}
            onMove={onMove}
            onRemove={onRemove}
            onSendNow={onSendNow}
          />
        );
        return wrap ? (
          <React.Fragment key={message.id}>
            {wrap(message.id, row)}
          </React.Fragment>
        ) : (
          row
        );
      })}
    </>
  );
}

/**
 * Move one queued message by `direction`, returning a new array. Out-of-range
 * moves return the original array so a caller cannot silently drop a message.
 */
export function reorderQueuedMessages<T extends { id: string }>(
  messages: readonly T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return [...messages];
  const target = index + direction;
  if (target < 0 || target >= messages.length) return [...messages];
  const next = [...messages];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}
