import { useParams } from "react-router";
import { IssueDetail } from "@/components/issues/IssueDetail";

export function IssueDetailPage() {
  const { issueKey } = useParams();

  if (!issueKey) return null;

  return (
    <div className="h-full">
      <IssueDetail issueKey={issueKey} closePath="/my-issues" />
    </div>
  );
}
