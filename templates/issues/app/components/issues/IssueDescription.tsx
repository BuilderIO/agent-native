import { adfToHtml } from "@/lib/adf-client";
import { sanitizeHtml } from "@/lib/sanitize-html";

interface IssueDescriptionProps {
  description: unknown;
}

export function IssueDescription({ description }: IssueDescriptionProps) {
  if (!description) {
    return (
      <p className="text-[13px] italic text-muted-foreground">
        No description provided.
      </p>
    );
  }

  // String description from older Jira instances
  if (typeof description === "string") {
    return <div className="adf-content whitespace-pre-wrap">{description}</div>;
  }

  const html = adfToHtml(description);

  return (
    <div
      className="adf-content overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
