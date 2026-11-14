import { useT } from "@agent-native/core/client/i18n";
import type { DocumentProperty } from "@shared/api";
import { commentPropertyValueText } from "@shared/comment-property-target";
import { IconMessage, IconMessagePlus } from "@tabler/icons-react";
import { createContext, useContext, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";
import { cn } from "@/lib/utils";

import {
  formatPropertyDate,
  formatPropertyDateTime,
} from "./property-date-format";

/**
 * What a Page editor tells its Properties about their Comment threads, and how
 * a Property starts or opens one. Without a provider, Properties show no
 * Comment controls.
 */
export interface PropertyCommentsValue {
  canComment: boolean;
  /** Open threads on each Property, oldest first. */
  openThreadsByProperty: ReadonlyMap<string, readonly CommentThread[]>;
  /** The Property a new Comment is being written on, if any. */
  pendingPropertyId: string | null;
  /** The thread being read or hovered, if any. */
  activeThreadId: string | null;
  /** The Property of the thread being read, resolved or not, if any. */
  selectedPropertyId: string | null;
  startComment: (property: DocumentProperty) => void;
  openThread: (threadId: string) => void;
  /**
   * Info opens a Property's threads right under its row, so its count opens
   * and closes them there instead of opening one beside the page.
   */
  inline?: {
    /** The Property whose threads, or new Comment, show under its row. */
    openPropertyId: string | null;
    /** Changes each time Info asks back the new Comment waiting in it. */
    revealKey?: number | undefined;
    toggle: (propertyId: string) => void;
    renderThreads: (propertyId: string) => ReactNode;
  };
}

export const PropertyCommentsContext =
  createContext<PropertyCommentsValue | null>(null);

export function usePropertyComments() {
  return useContext(PropertyCommentsContext);
}

export function openThreadsByProperty(
  threads: readonly CommentThread[] | undefined,
): Map<string, CommentThread[]> {
  const byProperty = new Map<string, CommentThread[]>();
  for (const thread of threads ?? []) {
    const propertyId = thread.property?.propertyId;
    if (!propertyId || thread.resolved) continue;
    byProperty.set(propertyId, [...(byProperty.get(propertyId) ?? []), thread]);
  }
  return byProperty;
}

/** The Property a thread sits on, resolved or not, if any. */
export function threadPropertyId(
  threads: readonly CommentThread[] | undefined,
  threadId: string | null,
) {
  const thread = threads?.find((candidate) => candidate.threadId === threadId);
  return thread?.property?.propertyId ?? null;
}

const PENDING_COMMENT_WAIT_MS = 5_000;

/**
 * Brings a new Comment's box into view once it's drawn. Info may still be
 * reading its Properties when it asks the Comment back, so a box not there yet
 * is revealed when it appears, unless that takes more than a few seconds.
 * Returns a cleanup that stops a reveal still waiting.
 */
export function revealPendingComment(
  scope: Document | HTMLElement | null | undefined,
  selector: string,
  reveal: (composer: HTMLElement) => void,
): (() => void) | undefined {
  if (!scope) return undefined;
  const drawn = scope.querySelector<HTMLElement>(selector);
  if (drawn) {
    reveal(drawn);
    return undefined;
  }
  const observer = new MutationObserver(() => {
    const composer = scope.querySelector<HTMLElement>(selector);
    if (!composer) return;
    stop();
    reveal(composer);
  });
  const timer = setTimeout(
    () => observer.disconnect(),
    PENDING_COMMENT_WAIT_MS,
  );
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(scope, { childList: true, subtree: true });
  return stop;
}

/**
 * Threads anchored in the page body's text, which its editor highlights: not
 * those on a Property value or in another Blocks field tab.
 */
export function bodyCommentThreads(
  threads: CommentThread[] | undefined,
): CommentThread[] | undefined {
  return threads?.some((thread) => thread.property || thread.field)
    ? threads.filter((thread) => !thread.property && !thread.field)
    : threads;
}

export interface PropertyThreadTarget {
  name: string;
  /**
   * The value when the thread started, with dates read as the table shows
   * them. Threads that recorded none (one still being saved, or a relation,
   * rollup, or formula) show the value now, and nothing once the Property is
   * gone.
   */
  value: string | null;
  /**
   * `current` while the value still reads the same, `changed` once it
   * doesn't, `removed` when the Property is gone, and `unknown` before the
   * Page's Properties have loaded.
   */
  state: "current" | "changed" | "removed" | "unknown";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** ISO text as Properties show dates; anything else as it was written. */
function readableDate(text: string) {
  if (ISO_DATE.test(text)) return formatPropertyDate(text);
  if (ISO_DATE_TIME.test(text)) return formatPropertyDateTime(text);
  return text;
}

/**
 * A remembered value as its Property shows values. Comments remember dates
 * as ISO text, and a range as "start - end". A value recorded before the
 * Property became a date keeps its text.
 */
function readablePropertyValue(value: string, type: string | undefined) {
  if (type === "date") return value.split(" - ").map(readableDate).join(" - ");
  if (type === "created_time" || type === "last_edited_time") {
    return readableDate(value);
  }
  return value;
}

export function propertyThreadTarget(
  property: NonNullable<CommentThread["property"]>,
  properties: readonly DocumentProperty[] | undefined,
): PropertyThreadTarget {
  const current = properties?.find(
    (candidate) => candidate.definition.id === property.propertyId,
  );
  const currentValue = current ? commentPropertyValueText(current) : null;
  const value = property.propertyValue ?? currentValue;
  return {
    name: property.propertyName ?? current?.definition.name ?? "",
    value: value
      ? readablePropertyValue(value, current?.definition.type)
      : value,
    state: !properties
      ? "unknown"
      : !current
        ? "removed"
        : currentValue === value
          ? "current"
          : "changed",
  };
}

/** A Property thread's name and value as they read above the thread. */
export function propertyThreadTargetText(
  target: PropertyThreadTarget,
  t: ReturnType<typeof useT>,
): { name: string; value: string | null } {
  const value =
    target.value === null ? null : target.value || t("comments.propertyEmpty");
  return {
    name:
      target.state === "removed"
        ? t("comments.propertyRemoved", { name: target.name })
        : target.name,
    value:
      value !== null && target.state === "changed"
        ? t("comments.propertyWas", { value })
        : value,
  };
}

/**
 * The line a Property thread shows in place of quoted text, its value in
 * full, wrapping as needed.
 */
export function PropertyThreadTargetLabel({
  target,
  className,
}: {
  target: PropertyThreadTarget;
  className?: string;
}) {
  const t = useT();
  const { name, value } = propertyThreadTargetText(target, t);
  return (
    <span
      className={cn(
        "block min-w-0 break-words border-s-2 border-border ps-2.5 text-sm text-muted-foreground",
        className,
      )}
      data-comment-property-target={target.state}
    >
      <span className="font-medium text-foreground/80">{name}</span>
      {value === null ? null : ` · ${value}`}
    </span>
  );
}

/**
 * A Property row's Comment control, at the end of its name: the count of its
 * open threads, or with none, a button that appears after a moment's hover to
 * start one.
 */
export function PropertyCommentControl({
  property,
}: {
  property: DocumentProperty;
}) {
  const t = useT();
  const comments = usePropertyComments();
  if (!comments) return null;
  const threads =
    comments.openThreadsByProperty.get(property.definition.id) ?? [];
  const name = property.definition.name;
  const latest = threads.length ? threads[threads.length - 1] : undefined;
  if (latest) {
    const { inline } = comments;
    const open = inline?.openPropertyId === property.definition.id;
    const label = t("comments.openPropertyComments", {
      count: threads.length,
      name,
    });
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="comment-marker relative ms-auto flex h-6 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={label}
            aria-expanded={inline ? open : undefined}
            // Places the threads beside this Property in the margin. Info
            // has none, and a click on a thread's place would open it there.
            data-comment-thread={inline ? undefined : latest.threadId}
            data-property-comment-marker
            onClick={(event) => {
              event.stopPropagation();
              if (inline) inline.toggle(property.definition.id);
              else comments.openThread(latest.threadId);
            }}
          >
            <IconMessage className="size-3.5" aria-hidden="true" />
            {threads.length}
            {inline
              ? null
              : threads
                  .slice(0, -1)
                  .map((thread) => (
                    <span
                      key={thread.threadId}
                      className="pointer-events-none absolute inset-0"
                      aria-hidden="true"
                      data-comment-thread={thread.threadId}
                    />
                  ))}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  if (!comments.canComment) return null;
  const label = t("comments.commentOnProperty", { name });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            // Waits half a second into a hover, so passing over the rows
            // doesn't flicker a button on each; leaving hides it at once.
            "ms-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/property:opacity-100 group-hover/property:delay-500 [@media(any-hover:none)]:opacity-100",
            comments.pendingPropertyId === property.definition.id &&
              "opacity-100",
          )}
          aria-label={label}
          data-property-comment-start
          onClick={(event) => {
            event.stopPropagation();
            comments.startComment(property);
          }}
        >
          <IconMessagePlus className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * How a Property row looks while one of its threads is open or being
 * written, and whether its Comment control stays on screen.
 */
export function usePropertyCommentRowState(propertyId: string) {
  const comments = usePropertyComments();
  if (!comments) return { enabled: false as const };
  const threads = comments.openThreadsByProperty.get(propertyId) ?? [];
  const pending = comments.pendingPropertyId === propertyId;
  const active =
    (!!comments.activeThreadId &&
      threads.some((thread) => thread.threadId === comments.activeThreadId)) ||
    (threads.length > 0 && comments.inline?.openPropertyId === propertyId);
  return {
    enabled: true as const,
    pending,
    active,
    /**
     * What shows under the row in Info: its threads while open, with a
     * resolved one Show selected, and a new Comment on it, which stays until
     * it's posted or cancelled.
     */
    inlineThreads:
      comments.inline &&
      (pending ||
        (comments.inline.openPropertyId === propertyId &&
          (threads.length > 0 || comments.selectedPropertyId === propertyId)))
        ? comments.inline.renderThreads(propertyId)
        : null,
  };
}
