import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  SourceUnlinkDialog,
  type SourceUnlinkProvider,
} from "./SourceUnlinkDialog";
import { dbText } from "./text";

/** How often "2 minutes ago" moves on. */
const RELATIVE_TIME_TICK_MS = 30_000;

/** Stands in for a name while a sentence is split around it. */
const NAME_MARK = "\u0000";

export function useNow(intervalMs = RELATIVE_TIME_TICK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * A sentence with a name in bold, in any language: the sentence is built with
 * a mark where the name goes and split around it.
 */
export function SentenceWithName({
  sentence,
  name,
}: {
  sentence: (mark: string) => string;
  name: string;
}) {
  const [before, after = ""] = sentence(NAME_MARK).split(NAME_MARK);
  return (
    <span className="min-w-0 break-words text-foreground">
      {before}
      <strong className="font-medium">{name}</strong>
      {after}
    </span>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Where a source is and how current it is, as Details and Sources show it. */
export function SourceFacts({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid min-w-0 gap-1.5 text-xs">
      {rows.map((row) => (
        <DetailRow key={row.label} label={row.label}>
          {row.value}
        </DetailRow>
      ))}
    </dl>
  );
}

/** An item of the status line, led by its "·" (see the line for why). */
export function Dotted({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center">
      <span aria-hidden className="w-3 shrink-0 text-center">
        ·
      </span>
      {children}
    </span>
  );
}

/** "Sync now", which asks the source for changes instead of waiting. */
export function SourceSyncNowButton({
  pending,
  disabled,
  size = "xs",
  onClick,
}: {
  pending: boolean;
  disabled?: boolean | undefined;
  size?: "xs" | "sm";
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={pending || disabled}
      onClick={onClick}
    >
      {pending ? (
        <Spinner className={size === "sm" ? "me-1 size-3.5" : undefined} />
      ) : (
        <IconRefresh
          className={size === "sm" ? "me-1 size-3.5" : undefined}
          aria-hidden
        />
      )}
      {dbText("sourceSyncNow")}
    </Button>
  );
}

export interface SourceStatusUnlink {
  provider: SourceUnlinkProvider;
  documentId: string;
  sourceId: string;
  pageCount: number;
  onUnlinked?: (() => void) | undefined;
}

export interface SourceStatusProblem {
  text: ReactNode;
  /** What to do about it, like Reconnect or Retry. */
  actions?: ReactNode;
  /** Offers Unlink… beside the problem, for one only unlinking resolves. */
  offerUnlink?: boolean;
}

/**
 * The one line above a collection that comes from a source: where its pages
 * come from, when they last updated, and Details with Sync now and Unlink…. A
 * problem that stops updates gets its own red line with what to do about it,
 * and an update under way shows how far it has got. Each source fills in only
 * what it can do.
 */
export function SourceStatusLine({
  provider,
  icon,
  from,
  onOpenSource,
  updated,
  links,
  facts,
  sync,
  unlink,
  problem,
  notes,
  progress,
}: {
  provider: string;
  icon: ReactNode;
  /** "From the **docs** folder on GitHub". */
  from: ReactNode;
  /** Opens the source's page in Sources; without it, `from` is plain text. */
  onOpenSource?: (() => void) | undefined;
  /** "Updated 2 minutes ago"; null leaves it out, as while stopped. */
  updated: string | null;
  /** More items on the line, like "Edit on GitHub", each led by its dot. */
  links?: ReactNode[];
  facts: ReactNode;
  sync: {
    pending: boolean;
    disabled?: boolean | undefined;
    run: () => void;
  } | null;
  /** Unlink… for people who can edit the collection; null for the rest. */
  unlink: SourceStatusUnlink | null;
  problem?: SourceStatusProblem | null;
  /** Quiet lines under the line, like a pause the source recovers from. */
  notes?: string[];
  /** How far an update has got; a null percent while it can't say. */
  progress?: { label: string; percent: number | null } | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const openUnlink = () => {
    setDetailsOpen(false);
    setUnlinkOpen(true);
  };

  return (
    <div
      className="mb-2 grid min-w-0 gap-1 text-xs"
      data-source-status={provider}
    >
      {/* Every item starts with its dot, and the row sits one dot to the left
          of a clipped box, so the dot of whichever item starts a line is cut
          off: no line starts or ends with a dot, however the row wraps. */}
      <div className="-m-px overflow-hidden p-px">
        <div className="-ms-3 flex min-w-0 flex-wrap items-center gap-y-1 text-muted-foreground">
          <Dotted>
            {onOpenSource ? (
              <button
                type="button"
                onClick={onOpenSource}
                className="inline-flex min-w-0 items-center rounded-sm text-start underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {icon}
                {from}
              </button>
            ) : (
              <>
                {icon}
                {from}
              </>
            )}
          </Dotted>
          {updated ? (
            <Dotted>
              <span>{updated}</span>
            </Dotted>
          ) : null}
          {links?.map((link, index) => (
            <Dotted key={index}>{link}</Dotted>
          ))}
          {/* No dot before Details, but the same lead, so it isn't cut off. */}
          <span className="ps-3">
            <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {dbText("sourceDetails")}
                  <IconChevronDown className="size-3" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <div className="grid min-w-0 gap-3">
                  {facts}
                  {sync || unlink ? (
                    <div className="flex flex-wrap gap-1.5">
                      {sync ? (
                        <SourceSyncNowButton
                          pending={sync.pending}
                          disabled={sync.disabled}
                          onClick={sync.run}
                        />
                      ) : null}
                      {unlink ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline-destructive"
                          onClick={openUnlink}
                        >
                          {dbText("sourceUnlink")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          </span>
        </div>
      </div>

      {problem ? (
        // Only the problem is announced: the line above holds controls and a
        // time that moves on every half minute.
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-destructive"
          role="alert"
          data-source-problem
        >
          <span className="min-w-0 break-words">{problem.text}</span>
          {problem.actions}
          {problem.offerUnlink && unlink ? (
            <Button
              type="button"
              size="xs"
              variant="outline-destructive"
              onClick={openUnlink}
            >
              {dbText("sourceUnlink")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {notes?.map((note) => (
        <div key={note} className="break-words text-muted-foreground">
          {note}
        </div>
      ))}

      {progress ? (
        <div className="grid max-w-sm gap-1">
          <div className="text-muted-foreground">{progress.label}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-foreground/70 transition-all",
                progress.percent === null
                  ? "w-full animate-pulse"
                  : "w-(--source-sync-progress)",
              )}
              style={
                progress.percent === null
                  ? undefined
                  : ({
                      "--source-sync-progress": `${progress.percent}%`,
                    } as CSSProperties)
              }
            />
          </div>
        </div>
      ) : null}

      {unlink ? (
        <SourceUnlinkDialog
          open={unlinkOpen}
          onOpenChange={setUnlinkOpen}
          {...unlink}
        />
      ) : null}
    </div>
  );
}
