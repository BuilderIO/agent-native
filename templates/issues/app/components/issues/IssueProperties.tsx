import { StatusBadge } from "./StatusBadge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTransitions, useTransitionIssue } from "@/hooks/use-transitions";
import type { JiraIssue, JiraTransition } from "@shared/types";
import { format } from "date-fns";
import { toast } from "sonner";

interface IssuePropertiesProps {
  issue: JiraIssue;
}

export function IssueProperties({ issue }: IssuePropertiesProps) {
  const { fields } = issue;
  const { data: transitionsData } = useTransitions(issue.key);
  const transitionMutation = useTransitionIssue();

  const transitions: JiraTransition[] = transitionsData?.transitions || [];

  const handleTransition = (transitionId: string) => {
    transitionMutation.mutate(
      { issueKey: issue.key, transitionId },
      { onError: () => toast.error("Failed to transition issue") },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border/50 bg-muted/30 p-3 sm:grid-cols-2 sm:p-4">
      {/* Status */}
      <PropertyCell label="Status">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="cursor-pointer">
              <StatusBadge status={fields.status} />
            </button>
          </DropdownMenuTrigger>
          {transitions.length > 0 && (
            <DropdownMenuContent align="start" className="w-48">
              {transitions.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => handleTransition(t.id)}
                  className="text-[13px]"
                >
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </PropertyCell>

      {/* Assignee */}
      <PropertyCell label="Assignee">
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
            <span className="truncate text-[13px] text-foreground">
              {fields.assignee.displayName}
            </span>
          </div>
        ) : (
          <span className="text-[13px] text-muted-foreground">Unassigned</span>
        )}
      </PropertyCell>

      {/* Priority */}
      <PropertyCell label="Priority">
        <span className="text-[13px] text-foreground">
          {fields.priority?.name || "None"}
        </span>
      </PropertyCell>

      {/* Type */}
      <PropertyCell label="Type">
        <span className="text-[13px] text-foreground">
          {fields.issuetype?.name}
        </span>
      </PropertyCell>

      {/* Reporter */}
      <PropertyCell label="Reporter">
        <span className="truncate text-[13px] text-foreground">
          {fields.reporter?.displayName || "None"}
        </span>
      </PropertyCell>

      {/* Project */}
      <PropertyCell label="Project">
        <span className="truncate text-[13px] text-foreground">
          {fields.project?.name}
        </span>
      </PropertyCell>

      {/* Sprint */}
      {fields.sprint && (
        <PropertyCell label="Sprint">
          <span className="truncate text-[13px] text-foreground">
            {fields.sprint.name}
          </span>
        </PropertyCell>
      )}

      {/* Labels */}
      {fields.labels && fields.labels.length > 0 && (
        <PropertyCell label="Labels">
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
        </PropertyCell>
      )}

      {/* Created */}
      {fields.created && (
        <PropertyCell label="Created">
          <span className="text-[12px] text-muted-foreground">
            {format(new Date(fields.created), "MMM d, yyyy")}
          </span>
        </PropertyCell>
      )}

      {/* Updated */}
      {fields.updated && (
        <PropertyCell label="Updated">
          <span className="text-[12px] text-muted-foreground">
            {format(new Date(fields.updated), "MMM d, yyyy")}
          </span>
        </PropertyCell>
      )}

      {/* Parent */}
      {fields.parent && (
        <PropertyCell label="Parent" span2>
          <span className="text-[13px] text-foreground">
            {fields.parent.key} — {fields.parent.fields.summary}
          </span>
        </PropertyCell>
      )}
    </div>
  );
}

function PropertyCell({
  label,
  children,
  span2,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
