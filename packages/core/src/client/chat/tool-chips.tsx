import {
  IconBrain,
  IconFileDiff,
  IconFileText,
  IconTerminal2,
} from "@tabler/icons-react";

import { cn } from "../utils.js";
import {
  AgentActivityObject,
  type AgentActivityObjectReference,
} from "./agent-activity-object.js";

export type ToolChipKind = "think" | "write" | "run" | "read";
export type ToolChipTone = "default" | "add" | "remove";

export interface ToolChipDetail {
  text: string;
  tone?: ToolChipTone;
}

export interface ToolChipStep {
  id: string;
  kind: ToolChipKind;
  label: string;
  chip: string;
  object?: AgentActivityObjectReference;
  details?: ToolChipDetail[];
  mono?: boolean;
}

export interface ToolChipDiff {
  id: string;
  file: string;
  additions: number;
  deletions?: number;
  object?: AgentActivityObjectReference;
}

export interface ToolChipsProps {
  steps?: ToolChipStep[];
  diffs?: ToolChipDiff[];
  className?: string;
}

const KIND_ICONS = {
  think: IconBrain,
  write: IconFileDiff,
  run: IconTerminal2,
  read: IconFileText,
} as const;

function DetailLine({ line }: { line: ToolChipDetail }) {
  return (
    <span
      className={cn(
        "agent-kit-density truncate font-mono",
        line.tone === "add" && "agent-kit-tone-positive",
        line.tone === "remove" && "text-destructive",
        line.tone === "default" && "text-muted-foreground",
      )}
    >
      {line.text}
    </span>
  );
}

function ToolStepRow({ step }: { step: ToolChipStep }) {
  const Icon = KIND_ICONS[step.kind];
  const hasDetails = Boolean(step.details?.length);

  return (
    <div>
      <div className="agent-kit-activity-row flex w-full min-w-0 items-center gap-2 text-left">
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">
          {step.label}
        </span>
        {step.object ? (
          <AgentActivityObject
            object={step.object}
            className="agent-kit-activity-object-boundary ms-auto shrink"
          />
        ) : (
          <span
            className={cn(
              "agent-kit-activity-object-boundary ms-auto shrink truncate text-right text-muted-foreground",
              step.mono && "font-mono",
            )}
          >
            {step.chip}
          </span>
        )}
      </div>
      {hasDetails && step.details ? (
        <div className="flex flex-col gap-0.5 py-0.5">
          {step.details.map((line, index) => (
            <DetailLine key={`${step.id}-detail-${index}`} line={line} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiffChip({ diff }: { diff: ToolChipDiff }) {
  return (
    <div
      data-agent-tool-diff-row=""
      className="agent-kit-activity-row flex w-full min-w-0 items-center gap-2 text-muted-foreground"
    >
      <IconFileDiff className="size-3.5 shrink-0" />
      <AgentActivityObject
        object={
          diff.object ?? {
            kind: "file",
            label: diff.file,
          }
        }
        className="min-w-0 flex-1 text-left"
      />
      <span className="ms-auto flex shrink-0 items-center gap-1.5 tabular-nums">
        <span className="agent-kit-tone-positive">+{diff.additions}</span>
        <span className="text-destructive">−{diff.deletions ?? 0}</span>
      </span>
    </div>
  );
}

export function ToolChips({
  steps = [],
  diffs = [],
  className,
}: ToolChipsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-col gap-1">
        {steps.map((step) => (
          <ToolStepRow key={step.id} step={step} />
        ))}
        {diffs.length ? (
          <div className="flex flex-col gap-0.5 pt-1">
            {diffs.map((diff) => (
              <DiffChip key={diff.id} diff={diff} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
