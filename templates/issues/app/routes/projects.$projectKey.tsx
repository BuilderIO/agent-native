import { useParams, useMatch, Outlet } from "react-router";
import { ProjectIssuesPage } from "@/pages/ProjectIssuesPage";

export function meta() {
  return [{ title: "Project — Issues" }];
}

export default function ProjectIssuesRoute() {
  const { projectKey } = useParams();
  const isExact = useMatch("/projects/:projectKey");
  if (!isExact) return <Outlet />;
  return <ProjectIssuesPage projectKey={projectKey!} />;
}
