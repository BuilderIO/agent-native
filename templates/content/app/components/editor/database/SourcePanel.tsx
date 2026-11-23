import { IconChevronDown, IconExternalLink } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { sourceRelativeTime, sourceUpdatedText } from "./source-status-text";
import { SourceProgress } from "./SourceStatusLine";
import {
  SourceUnlinkButton,
  type SourceUnlinkProvider,
} from "./SourceUnlinkDialog";
import { dbText } from "./text";

export function SourcePanel({
  provider,
  children,
}: {
  provider: SourceUnlinkProvider;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-4 text-sm" data-source-panel={provider}>
      {children}
    </div>
  );
}

export function SourcePanelStatus({
  checkedAt,
  now,
  upToDate = true,
  empty = false,
  problem,
  progress,
  notes,
}: {
  checkedAt: string | null;
  now: number;
  upToDate?: boolean;
  empty?: boolean;
  problem?: { text: string; actions?: ReactNode } | null;
  progress?: { label: string; percent: number | null } | null;
  notes?: string[];
}) {
  return (
    <div className="grid min-w-0 gap-2 text-xs" data-source-panel-status>
      {problem ? (
        <div className="grid min-w-0 gap-2 text-destructive" role="alert">
          <p className="break-words">{problem.text}</p>
          {problem.actions ? (
            <div className="flex flex-wrap gap-1.5">{problem.actions}</div>
          ) : null}
        </div>
      ) : progress ? (
        <SourceProgress {...progress} />
      ) : (
        <p className="break-words text-muted-foreground">
          {empty
            ? dbText("sourceNoDetailsChosen")
            : !checkedAt
              ? dbText("sourceNotUpdatedYet")
              : upToDate
                ? dbText("sourceUpToDate", {
                    time: sourceRelativeTime(checkedAt, now),
                  })
                : sourceUpdatedText(checkedAt, now)}
        </p>
      )}
      {notes?.map((note) => (
        <p key={note} className="break-words text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

export function SourcePanelEditing({ children }: { children: ReactNode }) {
  return <p className="break-words text-muted-foreground">{children}</p>;
}

export function SourcePanelOpenLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={href} target="_blank" rel="noreferrer">
        {label}
        <IconExternalLink className="ms-1 size-3.5" aria-hidden />
      </a>
    </Button>
  );
}

export function SourcePanelActions({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>;
}

export function SourcePanelMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="-ms-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {dbText("sourceMore")}
          <IconChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid min-w-0 gap-3 pt-2 text-xs">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SourcePanelUnlink({
  note,
  disabled,
  ...unlink
}: {
  note: string;
  provider: SourceUnlinkProvider;
  documentId: string;
  sourceId: string;
  pageCount: number;
  disabled?: boolean | undefined;
  onUnlinked?: (() => void) | undefined;
}) {
  return (
    <div className="grid min-w-0 gap-2 border-t border-border pt-3">
      <p className="break-words text-xs text-muted-foreground">{note}</p>
      <SourceUnlinkButton disabled={disabled} {...unlink} />
    </div>
  );
}
