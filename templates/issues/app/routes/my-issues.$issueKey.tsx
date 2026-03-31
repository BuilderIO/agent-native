import { useParams } from "react-router";
import { MyIssuesPage } from "@/pages/MyIssuesPage";

export default function MyIssuesDetailRoute() {
  const { issueKey } = useParams();
  return <MyIssuesPage selectedIssueKey={issueKey} />;
}
