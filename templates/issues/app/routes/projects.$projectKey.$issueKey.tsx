import { useParams } from "react-router";
import { ProjectIssuesPage } from "@/pages/ProjectIssuesPage";

export default function ProjectIssueDetailRoute() {
  const { projectKey, issueKey } = useParams();
  return (
    <ProjectIssuesPage projectKey={projectKey!} selectedIssueKey={issueKey} />
  );
}
