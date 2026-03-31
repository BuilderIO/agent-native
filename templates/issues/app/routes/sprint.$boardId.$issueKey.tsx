import { useParams } from "react-router";
import { SprintPage } from "@/pages/SprintPage";

export default function SprintIssueRoute() {
  const { boardId, issueKey } = useParams();
  return <SprintPage boardId={boardId!} selectedIssueKey={issueKey} />;
}
