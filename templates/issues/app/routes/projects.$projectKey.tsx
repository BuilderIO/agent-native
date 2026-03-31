import { useParams } from "react-router";
import { ProjectIssuesPage } from "@/pages/ProjectIssuesPage";

export default function ProjectIssuesRoute() {
  const { projectKey } = useParams();
  return <ProjectIssuesPage projectKey={projectKey!} />;
}
