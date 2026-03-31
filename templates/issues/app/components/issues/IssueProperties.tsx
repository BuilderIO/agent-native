import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { useTransitions, useTransitionIssue } from "@/hooks/use-transitions";
import type { JiraIssue, JiraTransition } from "@shared/types";
import { format } from "date-fns";

interface IssuePropertiesProps {
  issue: JiraIssue;
}

export function IssueProperties({ issue }: IssuePropertiesProps) {
  const { fields } = issue;
  const { data: transitionsData } = useTransitions(issue.key);
  const transitionMutation = useTransitionIssue();
  const [showTransitions, setShowTransitions] = useState(false);

  const transitions: JiraTransition[] = transitionsData?.transitions || [];

  const handleTransition = (transitionId: string) => {
    transitionMutation.mutate({ issueKey: issue.key, transitionId });
    setShowTransitions(false);
  };

  return (
    <div className="space-y-4 p-4">
      {/* Status */}
      <PropertyRow label="Status">
        <div className="relative">
          <button
            onClick={() => setShowTransitions(!showTransitions)}
            className="cursor-pointer"
          >
            <StatusBadge status={fields.status} />
          </button>
          {showTransitions && transitions.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover py-1 shadow-md">
              {transitions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTransition(t.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-accent"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </PropertyRow>

      {/* Assignee */}
      <PropertyRow label="Assignee">
        {fields.assignee ? (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
              {fields.assignee.displayName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <span className="text-[13px] text-foreground">
              {fields.assignee.displayName}
            </span>
          </div>
        ) : (
          <span className="text-[13px] text-muted-foreground">Unassigned</span>
        )}
      </PropertyRow>

      {/* Priority */}
      <PropertyRow label="Priority">
        <span className="text-[13px] text-foreground">
          {fields.priority?.name || "None"}
        </span>
      </PropertyRow>

      {/* Type */}
      <PropertyRow label="Type">
        <span className="text-[13px] text-foreground">
          {fields.issuetype?.name}
        </span>
      </PropertyRow>

      {/* Reporter */}
      <PropertyRow label="Reporter">
        <span className="text-[13px] text-foreground">
          {fields.reporter?.displayName || "None"}
        </span>
      </PropertyRow>

      {/* Labels */}
      {fields.labels && fields.labels.length > 0 && (
        <PropertyRow label="Labels">
          <div className="flex flex-wrap gap-1">
            {fields.labels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        </PropertyRow>
      )}

      {/* Sprint */}
      {fields.sprint && (
        <PropertyRow label="Sprint">
          <span className="text-[13px] text-foreground">
            {fields.sprint.name}
          </span>
        </PropertyRow>
      )}

      {/* Project */}
      <PropertyRow label="Project">
        <span className="text-[13px] text-foreground">
          {fields.project?.name}
        </span>
      </PropertyRow>

      {/* Created */}
      {fields.created && (
        <PropertyRow label="Created">
          <span className="text-[12px] text-muted-foreground">
            {format(new Date(fields.created), "MMM d, yyyy")}
          </span>
        </PropertyRow>
      )}

      {/* Updated */}
      {fields.updated && (
        <PropertyRow label="Updated">
          <span className="text-[12px] text-muted-foreground">
            {format(new Date(fields.updated), "MMM d, yyyy")}
          </span>
        </PropertyRow>
      )}

      {/* Parent */}
      {fields.parent && (
        <PropertyRow label="Parent">
          <span className="text-[13px] text-foreground">
            {fields.parent.key} — {fields.parent.fields.summary}
          </span>
        </PropertyRow>
      )}
    </div>
  );
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
