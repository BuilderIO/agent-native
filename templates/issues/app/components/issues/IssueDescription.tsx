import { adfToHtml } from "@/lib/adf-client";

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
    <div className="adf-content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
