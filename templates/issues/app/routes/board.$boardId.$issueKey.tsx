import { useParams } from "react-router";
import { BoardPage } from "@/pages/BoardPage";

export default function BoardIssueRoute() {
  const { boardId, issueKey } = useParams();
  return <BoardPage boardId={boardId!} selectedIssueKey={issueKey} />;
}
