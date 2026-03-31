import { JobsListPage } from "@/pages/JobsListPage";

export function meta() {
  return [{ title: "Jobs — Recruiting" }];
}

export default function JobsRoute() {
  return <JobsListPage />;
}
