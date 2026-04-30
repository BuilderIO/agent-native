import { ProjectListPage } from "@/pages/ProjectListPage";

export function meta() {
  return [{ title: "Projects — Issues" }];
}

export default function ProjectsRoute() {
  return <ProjectListPage />;
}
