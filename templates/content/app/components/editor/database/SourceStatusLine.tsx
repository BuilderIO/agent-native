import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useContentDatabaseSourceRefreshing } from "@/hooks/use-content-database";
import { cn } from "@/lib/utils";

import {
  SourceUnlinkDialog,
  type SourceUnlinkProvider,
} from "./SourceUnlinkDialog";
import { dbText } from "./text";

const RELATIVE_TIME_TICK_MS = 30_000;

const NAME_MARK = "\u0000";

export function useNow(intervalMs = RELATIVE_TIME_TICK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

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

export function SourceProgress({
  label,
  percent,
}: {
  label: string;
  percent: number | null;
}) {
  return (
    <div className="grid max-w-sm gap-1">
      <div className="text-muted-foreground">{label}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-foreground/70 transition-all",
            percent === null
              ? "w-full animate-pulse"
              : "w-(--source-sync-progress)",
          )}
          style={
            percent === null
              ? undefined
              : ({
                  "--source-sync-progress": `${percent}%`,
                } as CSSProperties)
          }
        />
      </div>
    </div>
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
  actions?: ReactNode;
  offerUnlink?: boolean;
}

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
  from: ReactNode;
  onOpenSource?: (() => void) | undefined;
  updated: string | null;
  links?: ReactNode[];
  facts: ReactNode;
  sync: {
    pending: boolean;
    disabled?: boolean | undefined;
    run: () => void;
  } | null;
  unlink: SourceStatusUnlink | null;
  problem?: SourceStatusProblem | null;
  notes?: string[];
  progress?: { label: string; percent: number | null } | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const refreshing = useContentDatabaseSourceRefreshing(
    unlink ? unlink.sourceId : null,
  );
  const unlinkDisabled = sync?.pending === true || refreshing;
  const openUnlink = () => {
    setDetailsOpen(false);
    setUnlinkOpen(true);
  };

  return (
    <div
      className="mb-2 grid min-w-0 gap-1 text-xs"
      data-source-status={provider}
    >
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
                          disabled={unlinkDisabled}
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
              disabled={unlinkDisabled}
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

      {progress ? <SourceProgress {...progress} /> : null}

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
