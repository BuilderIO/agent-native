import { IconBrandGithub } from "@tabler/icons-react";

import {
  buildErrorReportTemplate,
  buildGitHubIssueUrl,
  type ErrorReportTemplateOptions,
} from "./error-reporting.js";
import { FeedbackButton } from "./FeedbackButton.js";
import { cn } from "./utils.js";

export interface ErrorReportActionsProps extends ErrorReportTemplateOptions {
  feedbackLabel?: string;
  feedbackPlaceholder?: string;
  githubLabel?: string;
  className?: string;
  feedbackClassName?: string;
  githubClassName?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}

export function ErrorReportActions({
  feedbackLabel = "Send feedback",
  feedbackPlaceholder = "Describe what happened before this error appeared.",
  githubLabel = "Open GitHub issue",
  className,
  feedbackClassName,
  githubClassName,
  side = "top",
  align = "center",
  ...report
}: ErrorReportActionsProps) {
  const template = buildErrorReportTemplate({
    ...report,
    prompt: report.prompt ?? feedbackPlaceholder,
  });
  const githubIssueUrl = buildGitHubIssueUrl(report);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-2",
        className,
      )}
    >
      <FeedbackButton
        variant="outlined"
        label={feedbackLabel}
        placeholder={feedbackPlaceholder}
        initialValue={template}
        side={side}
        align={align}
        className={cn("h-8 text-xs", feedbackClassName)}
      />
      <a
        href={githubIssueUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground underline-offset-4 hover:bg-muted/60 hover:text-foreground hover:underline",
          githubClassName,
        )}
      >
        <IconBrandGithub className="size-3.5" />
        {githubLabel}
      </a>
    </div>
  );
}
