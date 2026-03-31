import { useParams, useMatch, Outlet } from "react-router";
import { ProjectIssuesPage } from "@/pages/ProjectIssuesPage";

export default function ProjectIssuesRoute() {
  const { projectKey } = useParams();
  const isExact = useMatch("/projects/:projectKey");
  if (!isExact) return <Outlet />;
  return <ProjectIssuesPage projectKey={projectKey!} />;
}
