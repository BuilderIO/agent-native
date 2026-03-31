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

  const html = adfToHtml(description);

  return (
    <div className="adf-content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
