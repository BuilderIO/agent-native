import { useT } from "@agent-native/core/client/i18n";
import type { DocumentProperty } from "@shared/api";
import { commentPropertyValueText } from "@shared/comment-property-target";
import { IconMessage, IconMessagePlus } from "@tabler/icons-react";
import { createContext, useContext } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";
import { cn } from "@/lib/utils";

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
  startComment: (property: DocumentProperty) => void;
  openThread: (threadId: string) => void;
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

/** Threads anchored in body text, which the editor highlights. */
export function bodyCommentThreads(
  threads: CommentThread[] | undefined,
): CommentThread[] | undefined {
  return threads?.some((thread) => thread.property)
    ? threads.filter((thread) => !thread.property)
    : threads;
}

export interface PropertyThreadTarget {
  name: string;
  /**
   * The value when the thread started. Threads that recorded none (one
   * still being saved, or a relation, rollup, or formula) show the value
   * now, and nothing once the Property is gone.
   */
  value: string | null;
  /**
   * `current` while the value still reads the same, `changed` once it
   * doesn't, `removed` when the Property is gone, and `unknown` before the
   * Page's Properties have loaded.
   */
  state: "current" | "changed" | "removed" | "unknown";
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
    value,
    state: !properties
      ? "unknown"
      : !current
        ? "removed"
        : currentValue === value
          ? "current"
          : "changed",
  };
}

/** The line a Property thread shows in place of quoted text. */
export function PropertyThreadTargetLabel({
  target,
  className,
}: {
  target: PropertyThreadTarget;
  className?: string;
}) {
  const t = useT();
  const value =
    target.value === null ? null : target.value || t("comments.propertyEmpty");
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 border-s-2 border-border ps-2.5 text-sm text-muted-foreground",
        className,
      )}
      data-comment-property-target={target.state}
    >
      <span className="shrink-0 font-medium text-foreground/80">
        {target.state === "removed"
          ? t("comments.propertyRemoved", { name: target.name })
          : target.name}
      </span>
      {value === null ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">
            {target.state === "changed"
              ? t("comments.propertyWas", { value })
              : value}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * A Property row's Comment control: a marker with the count when it has open
 * threads, otherwise a button that appears on hover to start one.
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
  if (threads.length > 0) {
    const latest = threads[threads.length - 1]!;
    const label = t("comments.openPropertyComments", {
      count: threads.length,
      name,
    });
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring comment-marker"
            aria-label={label}
            data-comment-thread={latest.threadId}
            data-property-comment-marker
            onClick={(event) => {
              event.stopPropagation();
              comments.openThread(latest.threadId);
            }}
          >
            <IconMessage className="size-3.5" aria-hidden="true" />
            {threads.length > 1 ? threads.length : null}
            {threads.slice(0, -1).map((thread) => (
              // Places every thread beside this Property in the margin.
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
            "absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/property:opacity-100 [@media(any-hover:none)]:opacity-100",
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
    !!comments.activeThreadId &&
    threads.some((thread) => thread.threadId === comments.activeThreadId);
  return {
    enabled: true as const,
    pending,
    active,
    shown: pending || threads.length > 0,
  };
}
