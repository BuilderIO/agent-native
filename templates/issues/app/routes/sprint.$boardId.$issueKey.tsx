import { useParams } from "react-router";
import { SprintPage } from "@/pages/SprintPage";

export function meta() {
  return [{ title: "Sprint Issue — Issues" }];
}

export default function SprintIssueRoute() {
  const { boardId, issueKey } = useParams();
  return <SprintPage boardId={boardId!} selectedIssueKey={issueKey} />;
}
